import * as THREE from 'three';

import type { Track, TrackPoint } from '../track';
import type { HeightField } from './heightField';
import type { Theme } from './theme';
import { ROAD_WIDTH } from './types';

export type RoadPoint = { x: number; y: number; z: number };

export type RoadFrame = {
  /**
   * A point `lateral` m to the right of the centre line at `distance` (wraps), at road height
   * (banked; beyond the road's edge it stays at the edge's height).
   * Matches the road ribbon exactly: offsets are taken per track sample with that sample's
   * heading, then interpolated, which is how the scene triangulates the road.
   */
  at: (distance: number, lateral: number) => RoadPoint;
};

export const createRoadFrame = (track: Track): RoadFrame => {
  const { points, length } = track;
  const n = points.length;
  // Right-hand normal of each sample's outgoing segment, (−dirZ, dirX).
  const normals = points.map((a, i) => {
    const b = points[(i + 1) % n] as TrackPoint;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: -(b.z - a.z) / len, z: (b.x - a.x) / len };
  });

  const indexAt = (d: number) => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((points[mid] as TrackPoint).distance <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const at = (distance: number, lateral: number): RoadPoint => {
    const d = ((distance % length) + length) % length;
    const i = indexAt(d);
    const j = (i + 1) % n;
    const a = points[i] as TrackPoint;
    const b = points[j] as TrackPoint;
    const na = normals[i] as { x: number; z: number };
    const nb = normals[j] as { x: number; z: number };
    const segment = (j === 0 ? length : b.distance) - a.distance;
    const t = segment > 0 ? (d - a.distance) / segment : 0;
    const edge = Math.max(-ROAD_WIDTH / 2, Math.min(ROAD_WIDTH / 2, lateral));
    const ax = a.x + na.x * lateral;
    const az = a.z + na.z * lateral;
    return {
      x: ax + (b.x + nb.x * lateral - ax) * t,
      y: a.y + a.bank * edge + (b.y + b.bank * edge - (a.y + a.bank * edge)) * t,
      z: az + (b.z + nb.z * lateral - az) * t
    };
  };

  return { at };
};

/** Paint is lifted this far off the road; polygonOffset on the material does the rest. */
const PAINT_LIFT_M = 0.02;
const EDGE_LINE_WIDTH = 0.15;
const EDGE_LINE_INSET = 0.3;
const CENTRE_LINE_WIDTH = 0.12;
const DASH_M = 3;
const GAP_M = 3;
/** Half-depth of the finish checker (1 m deep, centred on distance 0) plus a little margin. */
const FINISH_CLEAR_M = 0.7;
/**
 * Gravel shoulder from the road edge (sharing the road's edge vertices in xz, a hair lower so the
 * road always wins) sloping down to the ground. Not tucked under the road: polygonOffset would
 * pull a tucked strip through the road edge at distance.
 */
const VERGE_INNER = ROAD_WIDTH / 2;
const VERGE_OUTER = ROAD_WIDTH / 2 + 1.2;
const VERGE_TUCK_M = 0.01;
const VERGE_LIFT_M = 0.04;

type Edge = { lateral: number; height: (p: RoadPoint) => number };

/**
 * Road paint (edge lines, dashed centre line) and the gravel verge, as one vertex-coloured
 * mesh: they share a material, so it's one draw call for the whole lap.
 */
export const buildMarkings = (track: Track, frame: RoadFrame, ground: HeightField, theme: Theme) => {
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];

  /** A strip between two lateral offsets from `d0` to `d1`, with a vertex at every track sample in between. */
  const strip = (d0: number, d1: number, left: Edge, right: Edge, color: THREE.Color) => {
    const stations = [d0];
    for (const p of track.points) if (p.distance > d0 && p.distance < d1) stations.push(p.distance);
    stations.push(d1);
    stations.forEach((d, k) => {
      for (const edge of [left, right]) {
        const p = frame.at(d, edge.lateral);
        positions.push(p.x, edge.height(p), p.z);
        colors.push(color.r, color.g, color.b);
      }
      if (k === 0) return;
      // Left-to-right then forward winds counter-clockwise seen from above, like the road.
      const base = positions.length / 3 - 4;
      index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    });
  };

  const paint = new THREE.Color(theme.roadside.lines);
  const onRoad = (p: RoadPoint) => p.y + PAINT_LIFT_M;
  const line = (d0: number, d1: number, lateral: number, width: number) =>
    strip(
      d0,
      d1,
      { lateral: lateral - width / 2, height: onRoad },
      { lateral: lateral + width / 2, height: onRoad },
      paint
    );

  const start = FINISH_CLEAR_M;
  const end = track.length - FINISH_CLEAR_M;
  const edgeLateral = ROAD_WIDTH / 2 - EDGE_LINE_INSET - EDGE_LINE_WIDTH / 2;
  line(start, end, -edgeLateral, EDGE_LINE_WIDTH);
  line(start, end, edgeLateral, EDGE_LINE_WIDTH);
  for (let d = start + GAP_M / 2; d + DASH_M <= end; d += DASH_M + GAP_M) line(d, d + DASH_M, 0, CENTRE_LINE_WIDTH);

  const verge = new THREE.Color(theme.roadside.verge);
  const underRoad = (p: RoadPoint) => p.y - VERGE_TUCK_M;
  const onGround = (p: RoadPoint) => ground.heightAt(p.x, p.z) + VERGE_LIFT_M;
  strip(
    0,
    track.length,
    { lateral: -VERGE_OUTER, height: onGround },
    { lateral: -VERGE_INNER, height: underRoad },
    verge
  );
  strip(
    0,
    track.length,
    { lateral: VERGE_INNER, height: underRoad },
    { lateral: VERGE_OUTER, height: onGround },
    verge
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
};

/** Pulls the paint towards the camera in depth so it never z-fights the road, even far away. */
export const createMarkingsMaterial = () =>
  new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4
  });
