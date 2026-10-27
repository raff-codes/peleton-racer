export type TrackPoint = {
  x: number;
  y: number;
  z: number;
  /** Cumulative distance along the track to this point, m */
  distance: number;
  /** Rise over horizontal run towards the next point */
  grade: number;
};

export type Track = {
  name: string;
  points: TrackPoint[];
  length: number;
  minY: number;
};

export type TrackPose = {
  x: number;
  y: number;
  z: number;
  grade: number;
  /** Unit heading in the xz plane */
  dirX: number;
  dirZ: number;
};

const SAMPLES = 600;

/** A sine term: `amp * sin(freq * angle + phase)`. `freq` must be a whole number so the loop closes. */
export type Harmonic = { amp: number; freq: number; phase?: number };

export type LoopSpec = {
  name: string;
  /** Mean distance of the road from the origin, m */
  radius: number;
  /** Radial wobble around the loop: these shape the bends */
  bends: Harmonic[];
  /** Height around the loop, m: these shape the climbs (grade ≈ amp × freq / radius) */
  hills: Harmonic[];
};

const sumHarmonics = (terms: Harmonic[], angle: number) =>
  terms.reduce((sum, h) => sum + h.amp * Math.sin(h.freq * angle + (h.phase ?? 0)), 0);

/**
 * A closed circuit around the origin, built from a wobbly radius and elevation harmonics.
 * Scenery assumes the loop stays roughly 210–450 m from the origin (lake inside, foothills outside).
 */
export const buildLoop = (spec: LoopSpec): Track => {
  const raw: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const a = (i / SAMPLES) * Math.PI * 2;
    const r = spec.radius + sumHarmonics(spec.bends, a);
    raw.push({ x: r * Math.cos(a), y: sumHarmonics(spec.hills, a), z: r * Math.sin(a) });
  }

  const points: TrackPoint[] = [];
  let distance = 0;
  let minY = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SAMPLES; i++) {
    const p = raw[i] as (typeof raw)[number];
    const next = raw[(i + 1) % SAMPLES] as (typeof raw)[number];
    const run = Math.hypot(next.x - p.x, next.z - p.z);
    points.push({ ...p, distance, grade: (next.y - p.y) / run });
    distance += Math.hypot(run, next.y - p.y);
    minY = Math.min(minY, p.y);
  }

  return { name: spec.name, points, length: distance, minY };
};

/** The original ~2.1 km rolling circuit: a couple of punchy climbs (up to ~6%) and matching descents. */
export const HILL_LOOP = buildLoop({
  name: 'Rolling Hills Circuit',
  radius: 300,
  bends: [
    { amp: 60, freq: 3 },
    { amp: 25, freq: 5, phase: Math.PI / 2 }
  ],
  hills: [
    { amp: 7, freq: 2 },
    { amp: 3, freq: 3, phase: 1 }
  ]
});

/** Metres climbed in one lap. */
export const lapClimb = (track: Track) =>
  track.points.reduce((sum, p, i) => {
    const next = track.points[(i + 1) % track.points.length] as TrackPoint;
    return sum + Math.max(0, next.y - p.y);
  }, 0);

/** Index of the last point at or before `d` (d already wrapped into [0, length)). */
const indexAt = (track: Track, d: number) => {
  const { points } = track;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((points[mid] as TrackPoint).distance <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

/** Position, grade and heading at a distance along the track. Wraps for multi-lap distances. */
export const poseAt = (track: Track, distance: number): TrackPose => {
  const d = ((distance % track.length) + track.length) % track.length;
  const i = indexAt(track, d);
  const a = track.points[i] as TrackPoint;
  const b = track.points[(i + 1) % track.points.length] as TrackPoint;
  const segment = (i + 1 === track.points.length ? track.length : b.distance) - a.distance;
  const t = segment > 0 ? (d - a.distance) / segment : 0;

  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return {
    x: a.x + dx * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + dz * t,
    grade: a.grade,
    dirX: dx / len,
    dirZ: dz / len
  };
};

const CURVATURE_SPAN_M = 3;

/**
 * Signed curvature at a distance (1/m): positive when the road bends right. Used for
 * cornering lean, so it's sampled over a few metres to smooth out the polyline kinks.
 */
export const curvatureAt = (track: Track, distance: number) => {
  const before = poseAt(track, distance - CURVATURE_SPAN_M);
  const after = poseAt(track, distance + CURVATURE_SPAN_M);
  let turn = Math.atan2(after.dirX, after.dirZ) - Math.atan2(before.dirX, before.dirZ);
  if (turn > Math.PI) turn -= Math.PI * 2;
  if (turn < -Math.PI) turn += Math.PI * 2;
  // Heading angle grows when turning left, so negate for "positive = right".
  return -turn / (CURVATURE_SPAN_M * 2);
};
