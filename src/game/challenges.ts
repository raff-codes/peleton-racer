import { HOT_MOODS } from './mood';
import type { Race, Rider } from './race';
import type { Track } from './track';

/**
 * Optional challenges along the road, scored on top of the ride:
 * - power gates: arches with a watt band; ride through with your (smoothed) power inside it
 * - cadence drills: from a marker, hold a cadence (and for a grind, some power) for a few seconds
 *
 * They sit at fixed spots on every lap, and the kinds rotate from lap to lap, so a lap is never
 * quite the same twice. Bands are W/kg of rider + bike and line up with the mood tiers, so a
 * "fire" gate wants the same effort that sets the rider alight.
 */

export type GateKind = 'tempo' | 'threshold' | 'surge';
export type DrillKind = 'spin' | 'grind';
export type ChallengeKind = GateKind | DrillKind;

const [WARM, FIRE, INFERNO] = HOT_MOODS;

/** Power band of each gate, W/kg of rider + bike. */
export const GATE_BANDS: Record<GateKind, { lo: number; hi: number }> = {
  tempo: { lo: 1.5, hi: WARM.enter },
  threshold: { lo: WARM.enter, hi: FIRE.enter },
  surge: { lo: FIRE.enter, hi: INFERNO.enter }
};

/** What each drill asks for, for DRILL_S seconds. */
export const DRILLS: Record<DrillKind, { minRpm: number; maxRpm: number; minWPerKg: number }> = {
  spin: { minRpm: 95, maxRpm: Number.POSITIVE_INFINITY, minWPerKg: 0 },
  grind: { minRpm: 55, maxRpm: 75, minWPerKg: WARM.enter }
};

/** HUD and marker colour of each kind; gates take the colour of the mood their effort sets off. */
export const CHALLENGE_STYLE: Record<ChallengeKind, { label: string; color: string }> = {
  tempo: { label: 'TEMPO GATE', color: '#18b26b' },
  threshold: { label: 'THRESHOLD GATE', color: '#ffb703' },
  surge: { label: 'SURGE GATE', color: '#ff5a1f' },
  spin: { label: 'SPIN DRILL', color: '#4cc9f0' },
  grind: { label: 'GRIND DRILL', color: '#b44dff' }
};

export const DRILL_S = 15;
/** Share of a drill's time that must be on target to pass. */
export const DRILL_PASS = 0.7;

const GATE_KINDS: GateKind[] = ['tempo', 'threshold', 'surge'];
const DRILL_KINDS: DrillKind[] = ['spin', 'grind'];

/**
 * Where challenges sit on a lap, as a fraction of it. Clear of the start/finish so they never
 * clash with the sprint, and drills are spaced so even a fast one ends before the next gate.
 */
export const SLOTS = [
  { fraction: 0.14, type: 'gate' },
  { fraction: 0.3, type: 'drill' },
  { fraction: 0.5, type: 'gate' },
  { fraction: 0.64, type: 'drill' },
  { fraction: 0.8, type: 'gate' }
] as const;

export const GATE_POINTS = 100;
export const DRILL_POINTS = 100;
/** Each success in a row adds this to the multiplier, up to MAX_MULTIPLIER. */
const STREAK_STEP = 0.25;
const MAX_MULTIPLIER = 2;

export type Challenge = { index: number; kind: ChallengeKind; distance: number };

export type ChallengeResult = { kind: ChallengeKind; success: boolean; points: number; at: number };

export type ChallengeState = {
  /** Index of the next challenge to reach; they're numbered round the laps (lap × SLOTS + slot) */
  next: number;
  /** A drill under way */
  drill: { kind: DrillKind; elapsed: number; onTarget: number } | null;
  score: number;
  streak: number;
  passed: number;
  attempted: number;
  last: ChallengeResult | null;
};

export const createChallenges = (): ChallengeState => ({
  next: 0,
  drill: null,
  score: 0,
  streak: 0,
  passed: 0,
  attempted: 0,
  last: null
});

const slotOf = (index: number) => SLOTS[index % SLOTS.length] as (typeof SLOTS)[number];

/** Which gate or drill of the lap each slot is (0, 1, 2…), so neighbouring gates differ. */
const NTH_OF_TYPE = SLOTS.map((slot, i) => SLOTS.slice(0, i).filter((other) => other.type === slot.type).length);

/** Rotates the kinds by lap: each slot cycles through its type's kinds. */
export const challengeKind = (index: number): ChallengeKind => {
  const lap = Math.floor(index / SLOTS.length);
  const kinds = slotOf(index).type === 'gate' ? GATE_KINDS : DRILL_KINDS;
  return kinds[((NTH_OF_TYPE[index % SLOTS.length] ?? 0) + lap) % kinds.length] as ChallengeKind;
};

export const challengeDistance = (track: Track, index: number) =>
  (Math.floor(index / SLOTS.length) + slotOf(index).fraction) * track.length;

/** The next challenge in `slot` from `distance`: this lap's if it's still ahead, otherwise next lap's. */
export const nextInSlot = (track: Track, slot: number, distance: number) => {
  const laps = distance / track.length;
  const lap = Math.floor(laps);
  const fraction = (SLOTS[slot] as (typeof SLOTS)[number]).fraction;
  return (laps - lap < fraction ? lap : lap + 1) * SLOTS.length + slot;
};

export const challengeAt = (track: Track, index: number): Challenge => ({
  index,
  kind: challengeKind(index),
  distance: challengeDistance(track, index)
});

export const isGate = (kind: ChallengeKind): kind is GateKind => kind in GATE_BANDS;

const roundWatts = (wPerKg: number, massKg: number) => Math.round((wPerKg * massKg) / 5) * 5;

/**
 * The power a challenge asks of this rider, rounded to 5 W so it reads cleanly: a gate's band, a
 * drill's minimum (open-ended), or null for a drill with no power target.
 */
export const challengeWatts = (kind: ChallengeKind, massKg: number) => {
  if (isGate(kind)) return { lo: roundWatts(GATE_BANDS[kind].lo, massKg), hi: roundWatts(GATE_BANDS[kind].hi, massKg) };
  const { minWPerKg } = DRILLS[kind];
  return minWPerKg > 0 ? { lo: roundWatts(minWPerKg, massKg), hi: Number.POSITIVE_INFINITY } : null;
};

const onDrillTarget = (kind: DrillKind, power: number, cadence: number, massKg: number) => {
  const drill = DRILLS[kind];
  return cadence >= drill.minRpm && cadence <= drill.maxRpm && power / massKg >= drill.minWPerKg;
};

/** Points multiplier after `streak` successes in a row. */
export const streakMultiplier = (streak: number) => Math.min(MAX_MULTIPLIER, 1 + streak * STREAK_STEP);

const award = (state: ChallengeState, kind: ChallengeKind, success: boolean, basePoints: number, at: number) => {
  const points = success ? Math.round(basePoints * streakMultiplier(state.streak)) : 0;
  state.attempted++;
  state.score += points;
  state.streak = success ? state.streak + 1 : 0;
  if (success) state.passed++;
  // Reused rather than reallocated: the HUD copies it a few times a second.
  if (state.last) {
    state.last.kind = kind;
    state.last.success = success;
    state.last.points = points;
    state.last.at = at;
  } else {
    state.last = { kind, success, points, at };
  }
};

/**
 * Advances the challenges for the player, judged on the race's smoothed power and cadence.
 * Challenges at or past the finish are never set.
 */
export const stepChallenges = (state: ChallengeState, race: Race, player: Rider, dt: number) => {
  const { playerPower: power, playerCadence: cadence, elapsed, track } = race;
  const { massKg, distance } = player;

  if (state.drill) {
    const drill = state.drill;
    drill.elapsed += dt;
    if (onDrillTarget(drill.kind, power, cadence, massKg)) drill.onTarget += dt;
    if (drill.elapsed >= DRILL_S) {
      const share = drill.onTarget / drill.elapsed;
      award(state, drill.kind, share >= DRILL_PASS, DRILL_POINTS * share, elapsed);
      state.drill = null;
    }
  }

  const endDistance = track.length * race.laps;
  // A loop, not an if: a big frame step could cross more than one marker.
  for (;;) {
    const at = challengeDistance(track, state.next);
    if (at >= endDistance || distance < at) return;
    const kind = challengeKind(state.next);
    state.next++;
    if (isGate(kind)) {
      const wPerKg = power / massKg;
      award(state, kind, wPerKg >= GATE_BANDS[kind].lo && wPerKg <= GATE_BANDS[kind].hi, GATE_POINTS, elapsed);
    } else if (!state.drill) {
      state.drill = { kind, elapsed: 0, onTarget: 0 };
    }
  }
};
