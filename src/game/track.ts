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

type Vec3 = { x: number; y: number; z: number };

/** Measures a closed ring of samples (the first is the line) into track points. */
const closeLoop = (name: string, raw: Vec3[]): Track => {
  const n = raw.length;
  const points: TrackPoint[] = [];
  let distance = 0;
  let minY = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const p = raw[i] as Vec3;
    const next = raw[(i + 1) % n] as Vec3;
    const run = Math.hypot(next.x - p.x, next.z - p.z);
    points.push({ ...p, distance, grade: (next.y - p.y) / run });
    distance += Math.hypot(run, next.y - p.y);
    minY = Math.min(minY, p.y);
  }
  return { name, points, length: distance, minY };
};

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
  const raw: Vec3[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const a = (i / SAMPLES) * Math.PI * 2;
    const r = spec.radius + sumHarmonics(spec.bends, a);
    raw.push({ x: r * Math.cos(a), y: sumHarmonics(spec.hills, a), z: r * Math.sin(a) });
  }
  return closeLoop(spec.name, raw);
};

export type CircuitSpec = {
  name: string;
  /**
   * Centre-line control points (x, z, height), m, in riding order. The road passes through each
   * one on a centripetal Catmull-Rom curve and closes back to the first, where the start/finish
   * line sits. Same scenery rule as `buildLoop`: keep it roughly 210–450 m from the origin.
   *
   * Height between points follows a monotone cubic along the road, so a climb never overshoots
   * its top: two points at the same height give a flat, and grade ≈ Δheight / road distance.
   */
  path: [number, number, number][];
};

/** Road samples are this far apart, m: fine enough for hairpins. */
const CIRCUIT_STEP_M = 3;
/** Curve evaluations per control-point span when measuring arc length. */
const SPAN_SUBDIVISIONS = 40;

/** One span of a centripetal Catmull-Rom (Barry–Goldman), from p1 (t = 0) to p2 (t = 1). */
const catmullRom = (p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]) => {
  const knot = (a: [number, number], b: [number, number]) =>
    Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t1 = knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const mix = (a: number, b: number, ta: number, tb: number, t: number) => ((tb - t) * a + (t - ta) * b) / (tb - ta);
  return (u: number, axis: 0 | 1) => {
    const t = t1 + (t2 - t1) * u;
    const a1 = mix(p0[axis], p1[axis], 0, t1, t);
    const a2 = mix(p1[axis], p2[axis], t1, t2, t);
    const a3 = mix(p2[axis], p3[axis], t2, t3, t);
    return mix(mix(a1, a2, 0, t2, t), mix(a2, a3, t1, t3, t), t1, t2, t);
  };
};

/** Periodic monotone cubic (Fritsch–Carlson) through [x, y] keys, x increasing in [0, 1). */
const periodicMonotone = (keys: [number, number][]) => {
  const n = keys.length;
  const x = (i: number) => (keys[((i % n) + n) % n] as [number, number])[0] + Math.floor(i / n);
  const y = (i: number) => (keys[((i % n) + n) % n] as [number, number])[1];
  const secant = (i: number) => (y(i + 1) - y(i)) / (x(i + 1) - x(i));
  const tangents = keys.map((_, i) => {
    const a = secant(i - 1);
    const b = secant(i);
    // Flat at a peak or a valley, otherwise the harmonic mean keeps each span monotone.
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });
  return (f: number) => {
    const u = f - Math.floor(f);
    let i = n - 1;
    for (let k = 0; k < n; k++) if ((keys[k] as [number, number])[0] <= u) i = k;
    const x0 = x(i);
    const h = x(i + 1) - x0;
    // Before the first key we're on the wrapped span from the last key.
    const s = ((u < x0 ? u + 1 : u) - x0) / h;
    const m0 = tangents[i] as number;
    const m1 = tangents[(i + 1) % n] as number;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * y(i) + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * y(i + 1) + (s3 - s2) * h * m1
    );
  };
};

/**
 * A closed circuit through hand-placed control points, with a height at each. Unlike
 * `buildLoop` it can double back on itself, so it draws hairpins, switchbacks and long straights.
 */
export const buildCircuit = (spec: CircuitSpec): Track => {
  const path = spec.path.map(([x, z]): [number, number] => [x, z]);
  const n = path.length;
  if (n < 4) throw new Error(`${spec.name}: a circuit needs at least four control points`);

  // Dense polyline along the curve, then resampled at an even spacing.
  const dense: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const at = (k: number) => path[(i + k + n) % n] as [number, number];
    const span = catmullRom(at(-1), at(0), at(1), at(2));
    for (let s = 0; s < SPAN_SUBDIVISIONS; s++) {
      const u = s / SPAN_SUBDIVISIONS;
      dense.push([span(u, 0), span(u, 1)]);
    }
  }
  const lengths = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1] as [number, number];
    const b = dense[i % dense.length] as [number, number];
    lengths.push((lengths[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = lengths[dense.length] as number;
  const samples = Math.round(total / CIRCUIT_STEP_M);
  // Each control point starts span i, so its share of the lap is where its height key goes.
  const height = periodicMonotone(
    spec.path.map(([, , y], i): [number, number] => [(lengths[i * SPAN_SUBDIVISIONS] as number) / total, y])
  );

  const raw: Vec3[] = [];
  let j = 0;
  for (let i = 0; i < samples; i++) {
    const d = (i / samples) * total;
    while ((lengths[j + 1] as number) < d) j++;
    const a = dense[j] as [number, number];
    const b = dense[(j + 1) % dense.length] as [number, number];
    const l0 = lengths[j] as number;
    const t = (d - l0) / ((lengths[j + 1] as number) - l0 || 1);
    raw.push({ x: a[0] + (b[0] - a[0]) * t, y: height(i / samples), z: a[1] + (b[1] - a[1]) * t });
  }
  return closeLoop(spec.name, raw);
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
