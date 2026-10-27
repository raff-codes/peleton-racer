import * as THREE from 'three';

import { poseAt, type Track } from '../track';
import { createRandom } from './noise';
import type { RoadFrame } from './roadsideMarkings';
import { buildSpectatorGeometry, PAINT_SHIRT, PAINT_SKIN, SHOULDER } from './roadsideModels';
import type { WorldContext } from './types';

/** A stretch of track, [from, to) in metres; `to` may exceed the lap length (wraps). */
export type Span = { from: number; to: number };

/** Grade above which a stretch counts as a climb worth lining with fans. */
const CLIMB_GRADE = 0.03;
/** Fans line the last this-many metres before the line. */
export const FINISH_CROWD_M = 80;
/** Climbs closer than this to the line belong to the finish dressing instead. */
const FINISH_KEEP_OUT_M = 25;
const MIN_CLIMB_M = 25;
const FINISH_SHARE = 0.35;
const NEAR_LATERAL = 6.5;
const FAR_LATERAL = 10;
const MIN_SPACING_M = 0.8;
const CLUSTER_SPREAD_M = 9;

/**
 * Climbs (grade > CLIMB_GRADE) and the finish straight, as track spans. Shared with the fence
 * placement so fences never run through a crowd.
 */
export const crowdZones = (track: Track) => {
  const { length } = track;
  const finish: Span = { from: length - FINISH_CROWD_M, to: length };
  const inFinish = (d: number) => d >= length - FINISH_CROWD_M - FINISH_KEEP_OUT_M || d < FINISH_KEEP_OUT_M;
  const climbs: Span[] = [];
  let from: number | null = null;
  for (const p of track.points) {
    const climbing = p.grade > CLIMB_GRADE && !inFinish(p.distance);
    if (climbing && from === null) from = p.distance;
    if (!climbing && from !== null) {
      if (p.distance - from >= MIN_CLIMB_M) climbs.push({ from, to: p.distance });
      from = null;
    }
  }
  if (from !== null && length - from >= MIN_CLIMB_M) climbs.push({ from, to: length });
  return { finish, climbs };
};

type Fan = { x: number; y: number; z: number; faceX: number; faceZ: number; energy: number };

/** Picks spectator spots: a third packed along the finish straight, the rest in clusters up the climbs. */
const placeFans = (ctx: WorldContext, frame: RoadFrame) => {
  const { track, quality, ground, road, theme } = ctx;
  const random = createRandom(theme.seed + 71);
  const { finish, climbs } = crowdZones(track);
  const fans: Fan[] = [];
  const counts = { finish: 0, climbs: 0 };

  const tryPlace = (d: number, side: number, energy: number) => {
    const lateral = side * (NEAR_LATERAL + random() * (FAR_LATERAL - NEAR_LATERAL));
    const p = frame.at(d, lateral);
    if (fans.some((f) => Math.hypot(f.x - p.x, f.z - p.z) < MIN_SPACING_M)) return false;
    if (ground.isWater(p.x, p.z)) return false;
    // Another part of the loop could pass close by; keep off every road, not just this one.
    const hit = road.nearest(p.x, p.z);
    if (hit && hit.distance < NEAR_LATERAL - 0.2) return false;
    const centre = poseAt(track, d);
    const yaw = (random() - 0.5) * 0.6;
    const toRoadX = centre.x - p.x;
    const toRoadZ = centre.z - p.z;
    const len = Math.hypot(toRoadX, toRoadZ) || 1;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    fans.push({
      x: p.x,
      y: ground.heightAt(p.x, p.z),
      z: p.z,
      faceX: (toRoadX * c + toRoadZ * s) / len,
      faceZ: (toRoadZ * c - toRoadX * s) / len,
      energy
    });
    return true;
  };

  const finishTarget = Math.round(quality.spectators * FINISH_SHARE);
  for (let attempt = 0; counts.finish < finishTarget && attempt < finishTarget * 20; attempt++) {
    const d = finish.from + random() * (finish.to - finish.from - 2);
    if (tryPlace(d, random() < 0.5 ? -1 : 1, 0.6 + random() * 0.4)) counts.finish++;
  }

  const climbTarget = quality.spectators - counts.finish;
  const climbTotal = climbs.reduce((sum, c) => sum + c.to - c.from, 0);
  const pickClimbDistance = () => {
    let r = random() * climbTotal;
    for (const c of climbs) {
      if (r < c.to - c.from) return c.from + r;
      r -= c.to - c.from;
    }
    return 0;
  };
  for (let attempt = 0; climbTotal > 0 && counts.climbs < climbTarget && attempt < climbTarget * 20; attempt++) {
    // A cluster: a few fans on one side, around a shared spot, all similarly excited.
    const centre = pickClimbDistance();
    const side = random() < 0.5 ? -1 : 1;
    const size = 4 + Math.floor(random() * 7);
    const mood = random();
    for (let k = 0; k < size && counts.climbs < climbTarget; k++) {
      const d = centre + (random() - 0.5) * CLUSTER_SPREAD_M * 2;
      if (tryPlace(d, side, Math.min(1, 0.15 + mood * 0.7 + random() * 0.3))) counts.climbs++;
    }
  }
  return { fans, counts };
};

/** Seconds; uTime wraps here so sin() keeps its precision on mediump-leaning mobile GPUs. */
export const TIME_WRAP_S = 600;

const f = (n: number) => n.toFixed(3);

/**
 * Lambert material that animates the crowd entirely on the GPU: energetic fans hop and wave
 * their arms overhead, calm ones sway with arms at their sides. Per instance: `aCheer` (phase,
 * energy), `aShirt`, `aSkin`.
 */
const createSpectatorMaterial = (time: { value: number }) => {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
attribute vec2 aCheer;
attribute vec3 aShirt;
attribute vec3 aSkin;
attribute float aPaint;
attribute float aArm;`
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3( position );
float cheerT = uTime * ( 2.0 + 2.5 * aCheer.y ) + aCheer.x;
// Arms are modelled straight up; swing them out (wave) or right down (calm) about the shoulder.
float armUp = 0.5 + 0.35 * sin( cheerT * 2.0 + aArm * 1.3 );
float armDown = 2.85 + 0.08 * sin( cheerT );
float armAngle = -aArm * mix( armDown, armUp, smoothstep( 0.45, 0.75, aCheer.y ) );
vec2 shoulder = vec2( aArm * ${f(SHOULDER.x)}, ${f(SHOULDER.y)} );
vec2 rel = transformed.xy - shoulder;
float ca = cos( armAngle );
float sa = sin( armAngle );
transformed.xy = mix( transformed.xy, shoulder + vec2( ca * rel.x - sa * rel.y, sa * rel.x + ca * rel.y ), abs( aArm ) );
// Hop: only the excited ones leave the ground.
transformed.y += max( sin( cheerT ), 0.0 ) * 0.28 * smoothstep( 0.6, 1.0, aCheer.y );`
      )
      .replace(
        '#include <color_vertex>',
        `vColor = vec4( color, 1.0 );
vColor.rgb = mix( vColor.rgb, aShirt, step( ${f(PAINT_SHIRT - 0.5)}, aPaint ) * step( aPaint, ${f(PAINT_SHIRT + 0.5)} ) );
vColor.rgb = mix( vColor.rgb, aSkin, step( ${f(PAINT_SKIN - 0.5)}, aPaint ) );`
      );
  };
  material.customProgramCacheKey = () => 'roadside-spectators';
  return material;
};

/**
 * Every spectator as one InstancedMesh. Matrices are written once; all motion is in the vertex
 * shader, driven by the shared `time` uniform.
 */
export const createSpectators = (ctx: WorldContext, frame: RoadFrame, time: { value: number }) => {
  const { fans, counts } = placeFans(ctx, frame);
  const random = createRandom(ctx.theme.seed + 97);
  const geometry = buildSpectatorGeometry();
  const count = fans.length;
  const cheer = new Float32Array(count * 2);
  const shirts = new Float32Array(count * 3);
  const skins = new Float32Array(count * 3);
  const shirtColors = ctx.theme.roadside.shirts.map((c) => new THREE.Color(c));
  const skinColors = ctx.theme.roadside.skin.map((c) => new THREE.Color(c));
  const pick = (colors: THREE.Color[]) => colors[Math.floor(random() * colors.length)] ?? new THREE.Color();

  const material = createSpectatorMaterial(time);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = 'spectators';
  // Instances span the course and hop/wave in the shader; the default bounds don't know that.
  mesh.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  fans.forEach((fan, i) => {
    rotation.setFromAxisAngle(up, Math.atan2(fan.faceX, fan.faceZ));
    const s = 0.9 + random() * 0.18;
    matrix.compose(position.set(fan.x, fan.y, fan.z), rotation, scale.set(s, s, s));
    mesh.setMatrixAt(i, matrix);
    cheer.set([random() * Math.PI * 2, fan.energy], i * 2);
    const shirt = pick(shirtColors);
    const skin = pick(skinColors);
    shirts.set([shirt.r, shirt.g, shirt.b], i * 3);
    skins.set([skin.r, skin.g, skin.b], i * 3);
  });
  mesh.instanceMatrix.needsUpdate = true;
  geometry.setAttribute('aCheer', new THREE.InstancedBufferAttribute(cheer, 2));
  geometry.setAttribute('aShirt', new THREE.InstancedBufferAttribute(shirts, 3));
  geometry.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skins, 3));

  return {
    mesh,
    counts,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    }
  };
};
