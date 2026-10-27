import type { Track, TrackPoint } from '../track';
import { ROAD_WIDTH } from './types';

export type RoadHit = {
  /** Horizontal distance from the query point to the road centre line, m */
  distance: number;
  /** Road surface height at the nearest point, banked towards the query point's side (to the edge at most) */
  y: number;
  /** Distance along the track at the nearest point, m */
  along: number;
  /** Unit heading of the road at the nearest point (xz) */
  dirX: number;
  dirZ: number;
};

export type RoadQuery = {
  /** Nearest point on the road centre line, or null if nothing within `maxDistance`. */
  nearest: (x: number, z: number) => RoadHit | null;
  /**
   * The nearest point of every separate pass of the road within `within` m (default and at most
   * `maxDistance`), e.g. each of a switchback's legs, nearest first. Fills and returns a shared
   * array: copy anything kept past the next call.
   */
  passes: (x: number, z: number, within?: number) => readonly RoadHit[];
  /** Searches at least this far; beyond it `nearest` may return null. */
  maxDistance: number;
};

const CELL_M = 40;
const HALF_WIDTH = ROAD_WIDTH / 2;

/** Banked surface height at parameter t of segment a→b, for a point (x, z) beside it. */
const bankedY = (
  a: TrackPoint,
  b: TrackPoint,
  t: number,
  px: number,
  pz: number,
  x: number,
  z: number,
  sx: number,
  sz: number,
  len: number
) => {
  // Signed lateral offset: positive on the right, along (−dirZ, dirX).
  const lateral = Math.max(-HALF_WIDTH, Math.min(HALF_WIDTH, ((x - px) * -sz + (z - pz) * sx) / len));
  return a.y + (b.y - a.y) * t + (a.bank + (b.bank - a.bank) * t) * lateral;
};
/** Closest points further apart than this along the road belong to different passes, m (> a hairpin's half circle). */
const PASS_SEPARATION_M = 60;

/**
 * Spatial hash over the track's centre-line segments, so "how far am I from the road" is
 * cheap enough to call for every terrain vertex and every tree candidate.
 */
export const createRoadQuery = (track: Track): RoadQuery => {
  const cells = new Map<number, number[]>();
  // Numeric key (no string building): this is called for every terrain vertex and tree candidate.
  const key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
  const n = track.points.length;

  for (let i = 0; i < n; i++) {
    const a = track.points[i] as TrackPoint;
    const b = track.points[(i + 1) % n] as TrackPoint;
    // Register the segment in every cell its bounding box touches.
    const x0 = Math.floor(Math.min(a.x, b.x) / CELL_M);
    const x1 = Math.floor(Math.max(a.x, b.x) / CELL_M);
    const z0 = Math.floor(Math.min(a.z, b.z) / CELL_M);
    const z1 = Math.floor(Math.max(a.z, b.z) / CELL_M);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz);
        const list = cells.get(k);
        if (list) list.push(i);
        else cells.set(k, [i]);
      }
    }
  }

  const nearest = (x: number, z: number): RoadHit | null => {
    const cx = Math.floor(x / CELL_M);
    const cz = Math.floor(z / CELL_M);
    let best: RoadHit | null = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = cells.get(key(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          const a = track.points[i] as TrackPoint;
          const b = track.points[(i + 1) % n] as TrackPoint;
          const sx = b.x - a.x;
          const sz = b.z - a.z;
          const len2 = sx * sx + sz * sz || 1;
          const t = Math.max(0, Math.min(1, ((x - a.x) * sx + (z - a.z) * sz) / len2));
          const px = a.x + sx * t;
          const pz = a.z + sz * t;
          const distance = Math.hypot(x - px, z - pz);
          if (!best || distance < best.distance) {
            const len = Math.sqrt(len2);
            const segLength = i + 1 === n ? track.length - a.distance : b.distance - a.distance;
            best = {
              distance,
              y: bankedY(a, b, t, px, pz, x, z, sx, sz, len),
              along: a.distance + segLength * t,
              dirX: sx / len,
              dirZ: sz / len
            };
          }
        }
      }
    }
    return best;
  };

  // Scratch for `passes`: every nearby segment's closest point, then one winner per pass.
  type Candidate = RoadHit & { taken: boolean };
  const candidates: Candidate[] = [];
  const found: RoadHit[] = [];
  const lapGap = (p: number, q: number) => {
    const gap = Math.abs(p - q) % track.length;
    return Math.min(gap, track.length - gap);
  };
  const passes = (x: number, z: number, within = CELL_M): readonly RoadHit[] => {
    found.length = 0;
    let count = 0;
    const cx = Math.floor(x / CELL_M);
    const cz = Math.floor(z / CELL_M);
    const within2 = within * within;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = cells.get(key(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          const a = track.points[i] as TrackPoint;
          const b = track.points[(i + 1) % n] as TrackPoint;
          const sx = b.x - a.x;
          const sz = b.z - a.z;
          const len2 = sx * sx + sz * sz || 1;
          const t = Math.max(0, Math.min(1, ((x - a.x) * sx + (z - a.z) * sz) / len2));
          const px = a.x + sx * t;
          const pz = a.z + sz * t;
          const d2 = (x - px) ** 2 + (z - pz) ** 2;
          if (d2 > within2) continue;
          const segLength = i + 1 === n ? track.length - a.distance : b.distance - a.distance;
          const len = Math.sqrt(len2);
          const c = candidates[count] ?? { distance: 0, y: 0, along: 0, dirX: 0, dirZ: 0, taken: false };
          candidates[count++] = c;
          c.distance = Math.sqrt(d2);
          c.y = bankedY(a, b, t, px, pz, x, z, sx, sz, len);
          c.along = a.distance + segLength * t;
          c.dirX = sx / len;
          c.dirZ = sz / len;
          c.taken = false;
        }
      }
    }
    // Repeatedly take the nearest candidate left as a pass, and drop every candidate on the same
    // stretch of road. (A segment can sit in several cells, so the same point can appear twice.)
    for (;;) {
      let best: Candidate | null = null;
      for (let k = 0; k < count; k++) {
        const c = candidates[k] as Candidate;
        if (!c.taken && (!best || c.distance < best.distance)) best = c;
      }
      if (!best) break;
      found.push(best);
      for (let k = 0; k < count; k++) {
        const c = candidates[k] as Candidate;
        if (lapGap(c.along, best.along) <= PASS_SEPARATION_M) c.taken = true;
      }
    }
    return found;
  };

  return { nearest, passes, maxDistance: CELL_M };
};
