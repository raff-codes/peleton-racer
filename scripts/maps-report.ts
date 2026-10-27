/**
 * Prints each map's circuit as a rider feels it: lap length, climbs and descents, steepest
 * grade, tightest bend and the grade at the finish line, plus how the road sits against the
 * scenery's assumptions. Run with `pnpm maps:report` after touching a track, and check the
 * numbers still match the map's tagline.
 */
import { lapStats, MAPS } from '../src/game/maps';
import { curvatureAt, poseAt, surfaceY, type Track, type TrackPoint } from '../src/game/track';
import { createHeightField } from '../src/game/world/heightField';
import { HIGH, LOW, type QualitySettings } from '../src/game/world/quality';
import { createRoadQuery } from '../src/game/world/roadQuery';
import { ROAD_WIDTH } from '../src/game/world/types';

/** A rise or fall must reverse by this much before it counts as over, m: ignores ripples. */
const REVERSAL_M = 1.5;
/** Climbs smaller than this aren't worth listing, m. */
const MIN_GAIN_M = 3;
const CURVATURE_STEP_M = 2;
/** Terrain within this of the road surface doesn't count as covering it (the paint sits 0.02 m up), m. */
const COVER_TOLERANCE_M = 0.02;

type Stretch = { from: number; to: number; gain: number; length: number; maxGrade: number };

/** Climbs (positive gain) and descents (negative), from the line round one lap. */
const stretches = (track: Track): Stretch[] => {
  const { points, length } = track;
  const n = points.length;
  const at = (i: number) => points[i % n] as TrackPoint;
  const distanceAt = (i: number) => (i >= n ? length + at(i).distance : at(i).distance);

  // Start at the lowest point so the first stretch is a whole climb, then rotate back to the line.
  let start = 0;
  for (let i = 1; i < n; i++) if (at(i).y < at(start).y) start = i;

  const out: Stretch[] = [];
  let anchor = start;
  let extreme = start;
  let rising = true;
  for (let k = 1; k <= n; k++) {
    const i = start + k;
    const y = at(i).y;
    const beyond = rising ? y > at(extreme).y : y < at(extreme).y;
    if (beyond) extreme = i;
    const reversed = rising ? at(extreme).y - y > REVERSAL_M : y - at(extreme).y > REVERSAL_M;
    if (reversed || k === n) {
      let maxGrade = 0;
      for (let j = anchor; j < extreme; j++) {
        const g = at(j).grade;
        if (Math.abs(g) > Math.abs(maxGrade)) maxGrade = g;
      }
      out.push({
        from: distanceAt(anchor) % length,
        to: distanceAt(extreme) % length,
        gain: at(extreme).y - at(anchor).y,
        length: distanceAt(extreme) - distanceAt(anchor),
        maxGrade
      });
      anchor = extreme;
      extreme = i;
      rising = !rising;
    }
  }
  return out.filter((s) => Math.abs(s.gain) >= MIN_GAIN_M).sort((a, b) => a.from - b.from);
};

const tightestBend = (track: Track) => {
  let max = 0;
  for (let d = 0; d < track.length; d += CURVATURE_STEP_M) max = Math.max(max, Math.abs(curvatureAt(track, d)));
  return max > 0 ? 1 / max : Number.POSITIVE_INFINITY;
};

/** The road's reach from the origin, and its closest approach to the lake in lake radii. */
const footprint = ({ track, theme }: (typeof MAPS)[number]) => {
  const radii = track.points.map((p) => Math.hypot(p.x, p.z));
  const { water } = theme;
  const lake = water
    ? Math.min(...track.points.map((p) => Math.hypot(p.x - water.x, p.z - water.z))) / water.radius
    : null;
  return { min: Math.min(...radii), max: Math.max(...radii), lake };
};

/**
 * How far the terrain mesh rises above the road, m (negative = clear), and the share of the road
 * it covers. The mesh is a grid of straight-edged triangles between `heightAt` samples (as
 * terrain.ts builds it), so it can bridge over the road where the exact ground never does.
 */
const meshOverRoad = ({ track, theme }: (typeof MAPS)[number], quality: QualitySettings) => {
  const ground = createHeightField(track, theme, createRoadQuery(track));
  const n = quality.terrainCells;
  const step = (ground.extent * 2) / n;
  const stride = n + 1;
  const heights = new Float32Array(stride * stride);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++)
      heights[j * stride + i] = ground.heightAt(-ground.extent + i * step, -ground.extent + j * step);
  }
  const h = (i: number, j: number) => heights[j * stride + i] as number;
  // The triangle containing (x, z), with the grid's alternating diagonals.
  const mesh = (x: number, z: number) => {
    const fx = (x + ground.extent) / step;
    const fz = (z + ground.extent) / step;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    if ((i + j) % 2 === 0) {
      return u >= v
        ? h(i, j) + u * (h(i + 1, j) - h(i, j)) + v * (h(i + 1, j + 1) - h(i + 1, j))
        : h(i, j) + v * (h(i, j + 1) - h(i, j)) + u * (h(i + 1, j + 1) - h(i, j + 1));
    }
    return u + v <= 1
      ? h(i, j) + u * (h(i + 1, j) - h(i, j)) + v * (h(i, j + 1) - h(i, j))
      : h(i + 1, j + 1) + (1 - u) * (h(i, j + 1) - h(i + 1, j + 1)) + (1 - v) * (h(i + 1, j) - h(i + 1, j + 1));
  };
  const half = ROAD_WIDTH / 2;
  let worst = Number.NEGATIVE_INFINITY;
  let covered = 0;
  let samples = 0;
  for (let d = 0; d < track.length; d += 1) {
    const p = poseAt(track, d);
    for (let lateral = -half; lateral <= half; lateral += 0.5) {
      const over = mesh(p.x - p.dirZ * lateral, p.z + p.dirX * lateral) - surfaceY(p, lateral, half);
      worst = Math.max(worst, over);
      samples++;
      if (over > COVER_TOLERANCE_M) covered++;
    }
  }
  return { worst, covered: covered / samples };
};

const pct = (g: number) => `${(g * 100).toFixed(1)}%`;
const m = (v: number) => `${v.toFixed(0)} m`;

for (const map of MAPS) {
  const stats = lapStats(map);
  const { track } = map;
  console.log(`\n${map.name} (${map.id}): ${map.tagline}`);
  console.log(
    `  lap ${stats.lapKm.toFixed(2)} km · climb ${m(stats.climbM)} · max ${pct(stats.maxGradePct / 100)}` +
      ` · tightest bend r ${m(tightestBend(track))} · at the line ${pct((track.points[0] as TrackPoint).grade)}`
  );
  const reach = footprint(map);
  console.log(
    `  ${m(reach.min)}–${m(reach.max)} from the origin (scenery expects 210–450 m)` +
      (reach.lake !== null ? ` · lake ${reach.lake.toFixed(2)} radii away (shore bank reaches 2)` : '')
  );
  const mesh = (
    [
      ['High', HIGH],
      ['Low', LOW]
    ] as const
  ).map(([label, quality]) => {
    const { worst, covered } = meshOverRoad(map, quality);
    return covered > 0 ? `${label} covers ${pct(covered)} of the road (up to ${worst.toFixed(2)} m)` : `${label} clear`;
  });
  console.log(`  terrain mesh over the road: ${mesh.join(' · ')}`);
  for (const s of stretches(track)) {
    const kind = s.gain > 0 ? 'climb  ' : 'descent';
    console.log(
      `  ${kind} ${m(s.from).padStart(7)} → ${m(s.to).padStart(7)}  ${m(s.length).padStart(6)}` +
        `  ${(s.gain > 0 ? '+' : '') + s.gain.toFixed(1)} m  avg ${pct(s.gain / s.length)}  max ${pct(s.maxGrade)}`
    );
  }
}
