import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { curvatureAt, poseAt, type Track } from '../track';
import { clearOfLandmarks, landmarkSpans } from './landmarks';
import { createRandom } from './noise';
import { HIGH } from './quality';
import { buildMarkings, createMarkingsMaterial, createRoadFrame, type RoadFrame } from './roadsideMarkings';
import {
  beam,
  block,
  buildFlagCloth,
  buildHayBale,
  buildMarkerSign,
  buildPennant,
  buildRedBoardSign,
  buildRedTriangleSign,
  placed,
  pole,
  SINK_M
} from './roadsideModels';
import { createSpectators, crowdZones, type Span, TIME_WRAP_S } from './spectators';
import type { WorldContext, WorldLayer } from './types';

/**
 * Everything at the side of the road: paint and verge, fences, distance signs, the finish
 * barriers and flags, hay bales and the crowd. Four draw calls in total:
 * markings+verge, static props (merged), fluttering cloth (merged), spectators (instanced).
 */

// Fences
const FENCE_LATERAL = 6.8;
const FENCE_POST_SPACING_M = 2.5;
const FENCE_HEIGHT = 1.1;
/** Smoothed curvature (1/m) above which a bend gets a fence on its outside. */
const FENCE_BEND_CURVATURE = 1 / 160;
/** Below this the road counts as straight; straights get a fence on the right. */
const FENCE_STRAIGHT_CURVATURE = 1 / 450;
const MIN_FENCE_RUN_M = 25;

// Signs
const SIGN_LATERAL = 6;
const MARKER_SPACING_M = 500;
const WARNINGS_TO_GO_M = { flammeRouge: 1000, last200: 200 };

// Finish dressing (track distance 0 is the line; negative is before it)
const BARRIER_LATERAL = 5.2;
const BARRIER_PANEL_M = 2;
const BARRIER_BEFORE_M = 60;
const BARRIER_AFTER_M = 20;
/** Keeps barriers and flags off the gantry posts at ±(ROAD_WIDTH/2 + 0.5) and the checker. */
const GANTRY_CLEAR_M = 1.5;
const FLAG_LATERAL = 5.9;
const FLAG_POLE_HEIGHT = 4.6;
const FLAG_POLES_AT = [-52, -40, -28, -16, -6, 8, 18];

// Hay
/** Bales at HIGH quality for a hay density of 1 (the theme scales it). */
const HAY_BALES_AT_HIGH = 18;
/** A bale lying on its side (`buildHayBale`'s default 0.65 m radius, 1.2 m long): its shadow footprint. */
const HAY_BALE_SHADOW = { radius: 0.8, height: 1.3 };

/** Signed distance from the line for a lap distance: (-length/2, length/2]. */
const fromLine = (track: Track, d: number) => (d > track.length / 2 ? d - track.length : d);

const inSpans = (d: number, spans: Span[], margin: number) =>
  spans.some((s) => d >= s.from - margin && d < s.to + margin);

/** Curvature averaged over ±15 m: the raw value is noisy at the polyline's kinks. */
const smoothCurvature = (track: Track, d: number) => {
  let sum = 0;
  for (let k = -3; k <= 3; k++) sum += curvatureAt(track, d + k * 5);
  return sum / 7;
};

/** Post-and-rail fence: outside of bends and along straights, away from crowds and the finish. */
const buildFences = (ctx: WorldContext, frame: RoadFrame, detail: number) => {
  const { track, ground, theme } = ctx;
  const { finish, climbs } = crowdZones(track);
  const keepOut = [
    ...climbs,
    ...landmarkSpans(ctx.landmarks),
    { from: finish.from - 30, to: track.length },
    { from: 0, to: 40 }
  ];
  const rails = detail < 0.75 ? [0.75] : [0.5, 0.9];
  const parts: THREE.BufferGeometry[] = [];

  // Which side each post slot wants a fence on (0 = none), then keep only runs long enough to read.
  const slots: number[] = [];
  for (let d = 0; d < track.length - FENCE_POST_SPACING_M; d += FENCE_POST_SPACING_M) {
    const k = smoothCurvature(track, d);
    let side = 0;
    if (!inSpans(d, keepOut, 10)) {
      // Positive curvature bends right, so the outside is on the left.
      if (Math.abs(k) > FENCE_BEND_CURVATURE) side = k > 0 ? -1 : 1;
      else if (Math.abs(k) < FENCE_STRAIGHT_CURVATURE) side = 1;
    }
    slots.push(side);
  }
  const minPosts = Math.ceil(MIN_FENCE_RUN_M / FENCE_POST_SPACING_M);
  let metres = 0;
  for (let i = 0; i < slots.length; ) {
    const side = slots[i] ?? 0;
    let j = i;
    while (j < slots.length && slots[j] === side) j++;
    if (side !== 0 && j - i >= minPosts) {
      let previous: THREE.Vector3 | null = null;
      for (let k = i; k < j; k++) {
        const p = frame.at(k * FENCE_POST_SPACING_M, side * FENCE_LATERAL);
        const y = ground.heightAt(p.x, p.z);
        parts.push(block(0.12, FENCE_HEIGHT + SINK_M, 0.12, theme.roadside.fence, p.x, y - SINK_M, p.z));
        const here = new THREE.Vector3(p.x, y, p.z);
        if (previous) {
          for (const h of rails) {
            const lift = new THREE.Vector3(0, h, 0);
            parts.push(beam(previous.clone().add(lift), here.clone().add(lift), 0.1, 0.05, theme.roadside.fence));
          }
          metres += FENCE_POST_SPACING_M;
        }
        previous = here;
      }
    }
    i = j;
  }
  return { parts, metres };
};

/** A model standing at `lateral` beside distance `d`, its +z along the road. */
const standAt = (ctx: WorldContext, frame: RoadFrame, geometry: THREE.BufferGeometry, d: number, lateral: number) => {
  const p = frame.at(d, lateral);
  const pose = poseAt(ctx.track, d);
  return placed(geometry, p.x, ctx.ground.heightAt(p.x, p.z), p.z, pose.dirX, pose.dirZ);
};

/** Distance boards every 500 m (one stripe per 500 m) and the red warnings near the end of the lap. */
const buildSigns = (ctx: WorldContext, frame: RoadFrame) => {
  const { track, theme } = ctx;
  const { marker, barrier, flags } = theme.roadside;
  const red = barrier[1] ?? '#d7262e';
  const band = flags[2] ?? '#2d7ff9';
  const parts: THREE.BufferGeometry[] = [];
  const covered = landmarkSpans(ctx.landmarks);
  for (let d = MARKER_SPACING_M, k = 1; d < track.length - 50; d += MARKER_SPACING_M, k++) {
    // A board would stand inside a gallery; that one's skipped.
    if (inSpans(d, covered, 5)) continue;
    parts.push(standAt(ctx, frame, buildMarkerSign(marker, band, k), d, SIGN_LATERAL));
  }
  for (const side of [-1, 1]) {
    const flammeRouge = track.length - WARNINGS_TO_GO_M.flammeRouge;
    const last200 = track.length - WARNINGS_TO_GO_M.last200;
    parts.push(standAt(ctx, frame, buildRedTriangleSign(red, marker), flammeRouge, side * SIGN_LATERAL));
    parts.push(standAt(ctx, frame, buildRedBoardSign(red, marker), last200, side * SIGN_LATERAL));
  }
  return parts;
};

/** Red/white crowd barriers along both edges around the line, with a gap at the gantry posts. */
const buildBarriers = (ctx: WorldContext, frame: RoadFrame) => {
  const { ground, theme } = ctx;
  const colors = theme.roadside.barrier;
  const parts: THREE.BufferGeometry[] = [];
  const onGround = (d: number, lateral: number, lift: number) => {
    const p = frame.at(d, lateral);
    return new THREE.Vector3(p.x, ground.heightAt(p.x, p.z) + lift, p.z);
  };
  let n = 0;
  for (let d = -BARRIER_BEFORE_M; d < BARRIER_AFTER_M; d += BARRIER_PANEL_M, n++) {
    const d0 = d + 0.05;
    const d1 = d + BARRIER_PANEL_M - 0.05;
    if (d1 > -GANTRY_CLEAR_M && d0 < GANTRY_CLEAR_M) continue;
    const color = colors[n % colors.length] ?? '#ffffff';
    for (const side of [-1, 1]) {
      const lateral = side * BARRIER_LATERAL;
      parts.push(beam(onGround(d0, lateral, 0.85), onGround(d1, lateral, 0.85), 1.0, 0.06, color));
      for (const end of [d0 + 0.1, d1 - 0.1]) {
        const foot = onGround(end, lateral, 0);
        const pose = poseAt(ctx.track, end);
        parts.push(placed(block(0.6, 0.12, 0.08, '#9a9ea6'), foot.x, foot.y, foot.z, pose.dirX, pose.dirZ));
        parts.push(placed(block(0.05, 0.4, 0.05, '#9a9ea6'), foot.x, foot.y, foot.z, pose.dirX, pose.dirZ));
      }
    }
  }
  return parts;
};

/** Flag poles (static) plus their flags and the bunting strung between them (fluttering). */
const buildFinishFlags = (ctx: WorldContext, frame: RoadFrame) => {
  const { track, ground, theme } = ctx;
  const palette = theme.roadside.flags;
  const colorAt = (i: number) => palette[i % palette.length] ?? '#ffffff';
  const poles: THREE.BufferGeometry[] = [];
  const cloth: THREE.BufferGeometry[] = [];
  let pennant = 0;

  for (const side of [-1, 1]) {
    let previousTop: THREE.Vector3 | null = null;
    FLAG_POLES_AT.forEach((d, i) => {
      const p = frame.at(d, side * FLAG_LATERAL);
      const y = ground.heightAt(p.x, p.z);
      poles.push(pole(0.05, FLAG_POLE_HEIGHT + SINK_M, '#d9dde3').translate(p.x, y - SINK_M, p.z));
      const pose = poseAt(track, d);
      const dir = new THREE.Vector3(pose.dirX, 0, pose.dirZ);
      // Flags fly back along the road, as if the riders' headwind holds them out.
      const top = new THREE.Vector3(p.x, y + FLAG_POLE_HEIGHT - 0.05, p.z);
      cloth.push(buildFlagCloth(top, dir.clone().negate(), 1.3, 0.85, colorAt(i + (side > 0 ? 3 : 0))));

      const stringTop = new THREE.Vector3(p.x, y + FLAG_POLE_HEIGHT - 1.1, p.z);
      if (previousTop) {
        const span = stringTop.distanceTo(previousTop);
        const count = Math.floor(span / 0.5);
        for (let k = 1; k < count; k++) {
          const t = k / count;
          const at = previousTop.clone().lerp(stringTop, t);
          at.y -= 0.45 * 4 * t * (1 - t);
          const along = stringTop.clone().sub(previousTop).setY(0).normalize();
          cloth.push(buildPennant(at, along, colorAt(pennant++)));
        }
      }
      previousTop = stringTop;
    });
  }
  return { poles, cloth };
};

/** A few round bales out in the meadows, in twos and threes, on gentle dry ground. */
const buildHayBales = (ctx: WorldContext, detail: number) => {
  const { track, ground, road, theme } = ctx;
  const random = createRandom(theme.seed + 211);
  const target = Math.round(HAY_BALES_AT_HIGH * detail * theme.roadside.hayBales);
  const parts: THREE.BufferGeometry[] = [];
  const level = (x: number, z: number) =>
    Math.abs(ground.heightAt(x + 1.5, z) - ground.heightAt(x - 1.5, z)) +
      Math.abs(ground.heightAt(x, z + 1.5) - ground.heightAt(x, z - 1.5)) <
    0.6;
  const usable = (x: number, z: number) => {
    const hit = road.nearest(x, z);
    return (!hit || hit.distance > 15) && !ground.isWater(x, z) && clearOfLandmarks(ctx.landmarks, x, z) && level(x, z);
  };

  for (let attempt = 0; parts.length < target && attempt < target * 30; attempt++) {
    const d = random() * track.length;
    if (Math.abs(fromLine(track, d)) < 120) continue;
    const pose = poseAt(track, d);
    const side = random() < 0.5 ? -1 : 1;
    const lateral = side * (18 + random() * 45);
    const cx = pose.x - pose.dirZ * lateral;
    const cz = pose.z + pose.dirX * lateral;
    const group = 1 + Math.floor(random() * 3);
    for (let k = 0; k < group && parts.length < target; k++) {
      const x = cx + (random() - 0.5) * 6;
      const z = cz + (random() - 0.5) * 6;
      if (!usable(x, z)) continue;
      const yaw = random() * Math.PI;
      const y = ground.heightAt(x, z) - 0.08;
      parts.push(placed(buildHayBale(theme.roadside.hay), x, y, z, Math.sin(yaw), Math.cos(yaw)));
      ctx.shadows.push({ x, y, z, radius: HAY_BALE_SHADOW.radius, height: HAY_BALE_SHADOW.height });
    }
  }
  return parts;
};

/** The fluttering-cloth material: displaces each vertex along its `aSway` with a travelling wave. */
const createClothMaterial = (time: { value: number }) => {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec3 aSway;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3( position );
float wave = uTime * 5.0 + dot( position, vec3( 1.1, 0.4, 0.9 ) );
transformed += aSway * ( sin( wave ) + 0.35 * sin( wave * 2.3 + 1.7 ) );`
      );
  };
  material.customProgramCacheKey = () => 'roadside-cloth';
  return material;
};

export const createRoadsideLayer = (ctx: WorldContext): WorldLayer => {
  const { track, theme, ground, quality } = ctx;
  const detail = Math.min(1, quality.spectators / HIGH.spectators);
  const frame = createRoadFrame(track);
  const time = { value: 0 };
  const object = new THREE.Group();
  object.name = 'roadside';

  const markingsGeometry = buildMarkings(track, frame, ground, theme);
  const markingsMaterial = createMarkingsMaterial();
  const markings = new THREE.Mesh(markingsGeometry, markingsMaterial);
  markings.name = 'markings';

  const fences = buildFences(ctx, frame, detail);
  const flags = buildFinishFlags(ctx, frame);
  const staticParts = [
    ...fences.parts,
    ...buildSigns(ctx, frame),
    ...buildBarriers(ctx, frame),
    ...flags.poles,
    ...buildHayBales(ctx, detail)
  ];
  const propsGeometry = mergeGeometries(staticParts);
  for (const part of staticParts) part.dispose();
  const propsMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const props = new THREE.Mesh(propsGeometry, propsMaterial);
  props.name = 'props';

  const clothGeometry = mergeGeometries(flags.cloth);
  for (const part of flags.cloth) part.dispose();
  const clothMaterial = createClothMaterial(time);
  const cloth = new THREE.Mesh(clothGeometry, clothMaterial);
  cloth.name = 'cloth';

  const spectators = createSpectators(ctx, frame, time);
  object.add(markings, props, cloth, spectators.mesh);
  object.userData = { fenceMetres: fences.metres, spectators: spectators.counts };

  return {
    object,
    update: (_dt, elapsed) => {
      time.value = elapsed % TIME_WRAP_S;
    },
    dispose: () => {
      markingsGeometry.dispose();
      markingsMaterial.dispose();
      propsGeometry.dispose();
      propsMaterial.dispose();
      clothGeometry.dispose();
      clothMaterial.dispose();
      spectators.dispose();
    }
  };
};
