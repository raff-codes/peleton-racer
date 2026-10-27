import type { Track, TrackPoint } from '../track';

export type RoadHit = {
  /** Horizontal distance from the query point to the road centre line, m */
  distance: number;
  /** Road surface height at the nearest point */
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
   * The nearest point of every separate pass of the road nearby (a switchback's legs, say),
   * nearest first. Fills and returns a shared array: copy anything kept past the next call.
   */
  passes: (x: number, z: number) => readonly RoadHit[];
  /** Searches at least this far; beyond it `nearest` may return null. */
  maxDistance: number;
};

const CELL_M = 40;
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
              y: a.y + (b.y - a.y) * t,
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

  // Scratch for `passes`: every segment's closest point, then one winner per pass.
  const candidates: { distance: number; y: number; along: number; dirX: number; dirZ: number }[] = [];
  const found: RoadHit[] = [];
  const passes = (x: number, z: number): readonly RoadHit[] => {
    found.length = 0;
    let count = 0;
    const cx = Math.floor(x / CELL_M);
    const cz = Math.floor(z / CELL_M);
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
          const segLength = i + 1 === n ? track.length - a.distance : b.distance - a.distance;
          const len = Math.sqrt(len2);
          const c = candidates[count] ?? { distance: 0, y: 0, along: 0, dirX: 0, dirZ: 0 };
          candidates[count++] = c;
          c.distance = Math.hypot(x - (a.x + sx * t), z - (a.z + sz * t));
          c.y = a.y + (b.y - a.y) * t;
          c.along = a.distance + segLength * t;
          c.dirX = sx / len;
          c.dirZ = sz / len;
        }
      }
    }
    // Nearest first; a candidate is a new pass if it's far along the road from every pass kept.
    // (A segment can sit in several cells, so the same point can appear more than once.)
    const sorted = candidates.slice(0, count).sort((p, q) => p.distance - q.distance);
    for (const c of sorted) {
      const separate = found.every((f) => {
        const gap = Math.abs(f.along - c.along) % track.length;
        return Math.min(gap, track.length - gap) > PASS_SEPARATION_M;
      });
      if (separate) found.push(c);
    }
    return found;
  };

  return { nearest, passes, maxDistance: CELL_M };
};
