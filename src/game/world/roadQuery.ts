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
  /** Searches at least this far; beyond it `nearest` may return null. */
  maxDistance: number;
};

const CELL_M = 40;

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

  return { nearest, maxDistance: CELL_M };
};
