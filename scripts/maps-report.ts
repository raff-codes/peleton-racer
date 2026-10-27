/**
 * Prints each map's circuit as a rider feels it: lap length, climbs and descents, steepest
 * grade, tightest bend and the grade at the finish line. Run with `pnpm maps:report` after
 * touching a track, and check the numbers still match the map's tagline.
 */
import { lapStats, MAPS } from '../src/game/maps';
import { curvatureAt, type Track, type TrackPoint } from '../src/game/track';

/** A rise or fall must reverse by this much before it counts as over, m: ignores ripples. */
const REVERSAL_M = 1.5;
/** Climbs smaller than this aren't worth listing, m. */
const MIN_GAIN_M = 3;
const CURVATURE_STEP_M = 2;

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
  for (const s of stretches(track)) {
    const kind = s.gain > 0 ? 'climb  ' : 'descent';
    console.log(
      `  ${kind} ${m(s.from).padStart(7)} → ${m(s.to).padStart(7)}  ${m(s.length).padStart(6)}` +
        `  ${(s.gain > 0 ? '+' : '') + s.gain.toFixed(1)} m  avg ${pct(s.gain / s.length)}  max ${pct(s.maxGrade)}`
    );
  }
}
