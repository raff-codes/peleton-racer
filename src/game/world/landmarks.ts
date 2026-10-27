import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { poseAt, type Track } from '../track';
import {
  buildBoathouse,
  buildChapel,
  buildGallery,
  buildRuinedTower,
  GALLERY_HALF_WIDTH,
  type GallerySection
} from './landmarkModels';
import { createRoadFrame } from './roadsideMarkings';
import { placed } from './roadsideModels';
import type { Span } from './spectators';
import type { WorldContext, WorldLayer } from './types';

export type LandmarkKind = 'chapel' | 'ruinedTower' | 'boathouse' | 'snowGallery';

/**
 * A set-piece a map places beside (or over) its road, so each lap has something to recognise.
 * Course data: it lives on the map next to the track it's placed along.
 */
export type Landmark = {
  kind: LandmarkKind;
  /** Distance along the lap, m; negative counts back from the line */
  at: number;
  /** Metres right of the centre line (negative = left); 0 straddles the road */
  lateral: number;
  /** Turn from facing along the road, rad; positive turns left, −π/2 faces right */
  yaw?: number;
};

/** A landmark resolved onto its track: where it stands, which way it faces, what it keeps clear. */
export type PlacedLandmark = {
  landmark: Landmark;
  x: number;
  z: number;
  /** Unit vector its front (+z) faces */
  dirX: number;
  dirZ: number;
  /** Nothing else stands within this radius, m (0 = no circle) */
  clearance: number;
  /** Stretches of the lap it occupies: fences, signs and fans keep off them */
  spans: Span[];
};

const GALLERY_LENGTH_M = 48;
const GALLERY_SECTION_M = 4;
/** Lateral distance (m) either side of the road compared to find which way is uphill. */
const UPHILL_PROBE_M = 14;
/** Jetties run out until the water is at least this deep below the bank... */
const JETTY_DEPTH_M = 0.3;
/** ...then this much further, but never longer than JETTY_MAX_M. */
const JETTY_BEYOND_M = 12;
const JETTY_MAX_M = 80;
const JETTY_DECK_ABOVE_WATER_M = 0.6;
const JETTY_POSTS_BELOW_WATER_M = 1.5;

type Spec = {
  clearance: number;
  /** Half the stretch of road it covers, m, or null if it stands off the road */
  spanHalf: number | null;
  /** Footprint radius sampled to bed it into a slope, m */
  footprint: number;
  shadow: { radius: number; height: number } | null;
};

const SPECS: Record<LandmarkKind, Spec> = {
  chapel: { clearance: 16, spanHalf: null, footprint: 6, shadow: { radius: 5, height: 12 } },
  ruinedTower: { clearance: 15, spanHalf: null, footprint: 5, shadow: { radius: 5, height: 13 } },
  boathouse: { clearance: 14, spanHalf: null, footprint: 5, shadow: { radius: 5, height: 7 } },
  snowGallery: { clearance: 0, spanHalf: GALLERY_LENGTH_M / 2 + 6, footprint: 0, shadow: null }
};

/** Splits a span that wraps past the line into spans within [0, length). */
const wrapSpan = (from: number, to: number, length: number): Span[] => {
  const f = ((from % length) + length) % length;
  const t = f + (to - from);
  return t <= length
    ? [{ from: f, to: t }]
    : [
        { from: f, to: length },
        { from: 0, to: t - length }
      ];
};

export const placeLandmarks = (track: Track, landmarks: readonly Landmark[]): PlacedLandmark[] =>
  landmarks.map((landmark) => {
    const pose = poseAt(track, landmark.at);
    const spec = SPECS[landmark.kind];
    const facing = Math.atan2(pose.dirX, pose.dirZ) + (landmark.yaw ?? 0);
    return {
      landmark,
      x: pose.x - pose.dirZ * landmark.lateral,
      z: pose.z + pose.dirX * landmark.lateral,
      dirX: Math.sin(facing),
      dirZ: Math.cos(facing),
      clearance: spec.clearance,
      spans:
        spec.spanHalf === null ? [] : wrapSpan(landmark.at - spec.spanHalf, landmark.at + spec.spanHalf, track.length)
    };
  });

/** True if nothing else should stand at (x, z) for the landmarks' footprints. */
export const clearOfLandmarks = (landmarks: readonly PlacedLandmark[], x: number, z: number) =>
  landmarks.every((l) => l.clearance === 0 || Math.hypot(x - l.x, z - l.z) > l.clearance);

/** Every stretch of road a landmark covers. */
export const landmarkSpans = (landmarks: readonly PlacedLandmark[]) => landmarks.flatMap((l) => l.spans);

/**
 * Every landmark on the map, merged into one mesh (one draw call). Stand-alone buildings are
 * bedded into the slope at their lowest footprint point and cast ground shadows; a gallery is
 * built along the road itself.
 */
export const createLandmarksLayer = (ctx: WorldContext): WorldLayer | null => {
  const { landmarks, ground, theme, track } = ctx;
  if (landmarks.length === 0) return null;
  const frame = createRoadFrame(track);
  const parts: THREE.BufferGeometry[] = [];

  for (const l of landmarks) {
    const spec = SPECS[l.landmark.kind];
    let base = ground.heightAt(l.x, l.z);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      base = Math.min(base, ground.heightAt(l.x + Math.cos(a) * spec.footprint, l.z + Math.sin(a) * spec.footprint));
    }
    const stand = (models: THREE.BufferGeometry[]) => {
      for (const m of models) parts.push(placed(m, l.x, base, l.z, l.dirX, l.dirZ));
    };

    switch (l.landmark.kind) {
      case 'chapel':
        stand(buildChapel({ wall: '#f1ede4', roof: '#4b4f58', wood: '#5a3e2b', stone: '#9a968e', gold: '#d9b44a' }));
        break;
      case 'ruinedTower':
        stand(buildRuinedTower({ stone: '#8f877a', dark: '#2e2a26', ivy: theme.vegetation.leafy }));
        break;
      case 'boathouse': {
        const water = ground.waterLevel ?? base - 1;
        let reach = 0;
        while (
          reach < JETTY_MAX_M &&
          ground.heightAt(l.x + l.dirX * reach, l.z + l.dirZ * reach) > water - JETTY_DEPTH_M
        ) {
          reach += 1;
        }
        const deck = water + JETTY_DECK_ABOVE_WATER_M - base;
        stand(
          buildBoathouse(
            { wood: theme.roadside.fence, roof: '#5b3a33', post: '#4a3628', boat: '#a8452f', lamp: '#ffd27a' },
            Math.min(JETTY_MAX_M, reach + JETTY_BEYOND_M),
            deck,
            deck - (water - JETTY_POSTS_BELOW_WATER_M - base)
          )
        );
        break;
      }
      case 'snowGallery': {
        const { at } = l.landmark;
        const left = frame.at(at, -UPHILL_PROBE_M);
        const right = frame.at(at, UPHILL_PROBE_M);
        const uphillSide = ground.heightAt(left.x, left.z) > ground.heightAt(right.x, right.z) ? -1 : 1;
        const sections: GallerySection[] = [];
        for (let d = -GALLERY_LENGTH_M / 2; d < GALLERY_LENGTH_M / 2; d += GALLERY_SECTION_M) {
          const a = frame.at(at + d, 0);
          const b = frame.at(at + d + GALLERY_SECTION_M, 0);
          const side = frame.at(at + d, uphillSide * GALLERY_HALF_WIDTH);
          sections.push({
            a: new THREE.Vector3(a.x, a.y, a.z),
            b: new THREE.Vector3(b.x, b.y, b.z),
            uphill: new THREE.Vector3(side.x - a.x, 0, side.z - a.z).normalize()
          });
        }
        parts.push(...buildGallery({ concrete: '#9aa0a8', snow: theme.terrain.snow, dark: '#3c4048' }, sections));
        break;
      }
    }
    if (spec.shadow) ctx.shadows.push({ x: l.x, y: base, z: l.z, ...spec.shadow });
  }

  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'landmarks';
  mesh.matrixAutoUpdate = false;

  return {
    object: mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    }
  };
};
