import type { RideTrace } from '../data/types';
import { type ChallengeState, createChallenges, stepChallenges } from './challenges';
import { type Mood, stepMood } from './mood';
import { RIDER, stepSpeed } from './physics';
import { poseAt, type Track } from './track';

export type Rider = {
  id: string;
  name: string;
  color: string;
  /** Lateral offset from the centre line, m (positive = right of travel) */
  lane: number;
  /** Lane the rider is steering towards */
  targetLane: number;
  /** Seconds until the rider may pick a new target lane; stops lane wobble */
  laneCooldown: number;
  /** Fixed power for bots; null for the player and ghosts */
  botPower: number | null;
  botStyle: BotStyle;
  /** A recorded ride replayed by time: ghosts follow it exactly and don't interact with anyone */
  ghost: RideTrace | null;
  /** Rider + bike, kg */
  massKg: number;
  speed: number;
  distance: number;
  /** Current drag reduction from drafting, 0–DRAFT_MAX */
  draft: number;
  /** Seconds spent boxed in behind a slower wheel while having the legs to go faster */
  heldBack: number;
  /** Cosmetic: sleepy to inferno from the rider's effort, so a bot's attack shows; ghosts stay normal */
  mood: Mood;
  moodPending: number;
  finishedAt: number | null;
};

/** Race: you against nine bots. Time trial: solo against the clock. Free ride: solo, no finish line. */
export type RideMode = 'race' | 'timeTrial' | 'freeRide';
export type Difficulty = 'easy' | 'normal' | 'hard';

/** What the rider picked on the menu. `challenges` adds power gates and cadence drills to the road. */
export type RideSetup = { mode: RideMode; laps: number; difficulty: Difficulty; challenges: boolean };

/** Bot watts are scaled by this; the roster's base efforts are tuned for "normal". */
export const DIFFICULTY_SCALE: Record<Difficulty, number> = { easy: 0.75, normal: 1, hard: 1.3 };

/**
 * How a bot spends its watts. Climbers dig in on steep ground, sprinters save it for the line,
 * rouleurs press on the flats and descents. Steady riders just hold their number.
 */
export type BotStyle = 'steady' | 'climber' | 'sprinter' | 'rouleur';

/** The bot field at "normal" difficulty: base watts spread so there's always someone near your level. */
export const BOT_ROSTER: { id: string; name: string; color: string; watts: number; style: BotStyle }[] = [
  { id: 'steady', name: 'Steady Sam', color: '#2d7ff9', watts: 125, style: 'steady' },
  { id: 'dev', name: 'Domestique Dev', color: '#8d99ae', watts: 140, style: 'steady' },
  { id: 'kai', name: 'Climbing Kai', color: '#06d6a0', watts: 150, style: 'climber' },
  { id: 'rosa', name: 'Rouleur Rosa', color: '#ef476f', watts: 165, style: 'rouleur' },
  { id: 'pete', name: 'Puncheur Pete', color: '#ffb703', watts: 180, style: 'climber' },
  { id: 'tess', name: 'Tempo Tess', color: '#18b26b', watts: 195, style: 'steady' },
  { id: 'sol', name: 'Sprinter Sol', color: '#f72585', watts: 205, style: 'sprinter' },
  { id: 'bea', name: 'Breakaway Bea', color: '#4cc9f0', watts: 225, style: 'rouleur' },
  { id: 'dan', name: 'Diesel Dan', color: '#b44dff', watts: 245, style: 'steady' }
];

/** Base-watt range of the bot field at a difficulty, for the menu. */
export const botWattRange = (difficulty: Difficulty) => {
  const watts = BOT_ROSTER.map((b) => Math.round(b.watts * DIFFICULTY_SCALE[difficulty]));
  return { min: Math.min(...watts), max: Math.max(...watts) };
};

const CLIMB_GRADE = 0.03;
const CLIMBER_BOOST = 1.15;
const ROULEUR_BOOST = 1.08;
const SPRINTER_BOOST = 1.3;
const SPRINT_DISTANCE_M = 300;

/** Start grid: three abreast, rows this far apart, player on the front row. */
const GRID_LANES = [0, -2.2, 2.2];
const GRID_ROW_GAP_M = 2.5;

/** waiting → (first pedal stroke) → countdown → racing */
export type RacePhase = 'waiting' | 'countdown' | 'racing';

/** Player's effort over the race, frozen once they cross the line. */
export type RaceStats = {
  /** Integral of power over time, J; divide by elapsed for average watts */
  energyJ: number;
  /** Distance ridden since the gun, m */
  distanceM: number;
  maxPower: number;
  maxSpeed: number;
  draftSeconds: number;
};

export type Race = {
  track: Track;
  mode: RideMode;
  /** Infinity in free ride: nobody ever finishes */
  laps: number;
  phase: RacePhase;
  /** Seconds left in the countdown */
  countdown: number;
  /** Seconds since the start gun */
  elapsed: number;
  /** Player power after smoothing; raw sensor readings are too jumpy to drive speed directly */
  playerPower: number;
  /** Player cadence after the same smoothing, rpm; judged by the cadence drills */
  playerCadence: number;
  /** Power gates and cadence drills, when picked on the menu */
  challenges: ChallengeState | null;
  stats: RaceStats;
  /** The player's ride so far, sampled every TRACE_INTERVAL_S of race time; saved as a future ghost */
  trace: RideTrace;
  riders: Rider[];
};

/** Who else is on the road, beyond the bots: e.g. household members' best rides. */
export type GhostEntry = { id: string; name: string; color: string; trace: RideTrace };

/** The player's identity and weight, from their profile. */
export type PlayerEntry = { name: string; color: string; massKg: number };

export const PLAYER_ID = 'you';

const COUNTDOWN_S = 3;
const TRACE_INTERVAL_S = 1;
/** Ghosts ride side by side in these lanes so a few PBs on one course stay readable. */
const GHOST_LANES = [2.6, -2.4, 3.3, -3.2, 1.2];
/** Time constant of the exponential smoothing on player power. */
const POWER_SMOOTHING_S = 1.2;
/** Bots hold a steady effort with a slow surge so they don't move in lockstep. */
const BOT_SURGE_W = 15;

/** Max drag reduction right on a wheel; tapers to nothing at DRAFT_END_GAP_M. */
export const DRAFT_MAX = 0.3;
const DRAFT_FULL_GAP_M = 1;
const DRAFT_END_GAP_M = 5;

/** Riders closer than this laterally are in line (can draft, can block). */
const RIDER_WIDTH_M = 1;
/** Closest a rider can sit behind another in the same line, wheel to wheel. */
const MIN_GAP_M = 1.8;
/** How far up the road riders look when choosing a line. */
const LOOKAHEAD_M = 10;
const LANE_LIMIT_M = 3.5;
const LANE_STEP_M = 1.4;
const LANE_SPEED_MPS = 1.2;
const LANE_COOLDOWN_S = 4;
/** Speed advantage (m/s) needed before a rider pulls out to pass instead of sitting in. */
const OVERTAKE_MARGIN_MPS = 0.3;
/**
 * A boxed-in rider's speed is capped at the wheel in front, so speed alone never says they want
 * past. After this long held back they pull out anyway.
 */
const HELD_BACK_PASS_S = 3;

const makeRider = (
  id: string,
  name: string,
  color: string,
  lane: number,
  botPower: number | null,
  extra: { ghost?: RideTrace; massKg?: number; style?: BotStyle; distance?: number } = {}
): Rider => ({
  id,
  name,
  color,
  lane,
  targetLane: lane,
  laneCooldown: 0,
  botPower,
  botStyle: extra.style ?? 'steady',
  ghost: extra.ghost ?? null,
  massKg: extra.massKg ?? RIDER.massKg,
  speed: 0,
  distance: extra.distance ?? 0,
  draft: 0,
  heldBack: 0,
  mood: 'normal',
  moodPending: 0,
  finishedAt: null
});

export const createRace = (
  track: Track,
  setup: RideSetup,
  player: PlayerEntry = { name: 'You', color: '#ff5a1f', massKg: RIDER.massKg },
  ghosts: GhostEntry[] = []
): Race => {
  const scale = DIFFICULTY_SCALE[setup.difficulty];
  // Bots fill the grid row by row; the player starts at the back so the chase camera sees the pack, not
  // nine riders between it and the player. Over a 2 km+ race the few metres are noise.
  const slot = (i: number) => ({
    lane: GRID_LANES[i % GRID_LANES.length] ?? 0,
    distance: -Math.floor(i / GRID_LANES.length) * GRID_ROW_GAP_M
  });
  const bots =
    setup.mode === 'race'
      ? BOT_ROSTER.map((b, i) => {
          const { lane, distance } = slot(i);
          return makeRider(b.id, b.name, b.color, lane, Math.round(b.watts * scale), { style: b.style, distance });
        })
      : [];
  return {
    track,
    mode: setup.mode,
    laps: setup.mode === 'freeRide' ? Number.POSITIVE_INFINITY : setup.laps,
    phase: 'waiting',
    countdown: COUNTDOWN_S,
    elapsed: 0,
    playerPower: 0,
    playerCadence: 0,
    challenges: setup.challenges ? createChallenges() : null,
    stats: { energyJ: 0, distanceM: 0, maxPower: 0, maxSpeed: 0, draftSeconds: 0 },
    trace: { t: [], d: [] },
    riders: [
      makeRider(PLAYER_ID, player.name, player.color, 0, null, {
        massKg: player.massKg,
        distance: bots.length ? slot(Math.ceil(bots.length / GRID_LANES.length) * GRID_LANES.length).distance : 0
      }),
      ...bots,
      ...ghosts.map((g, i) =>
        makeRider(g.id, g.name, g.color, GHOST_LANES[i % GHOST_LANES.length] ?? 0, null, { ghost: g.trace })
      )
    ]
  };
};

/** Road distance from `rider` forward to `other`, wrapping round the lap (0 ≤ gap < track length). */
const gapAhead = (track: Track, rider: Rider, other: Rider) =>
  (((other.distance - rider.distance) % track.length) + track.length) % track.length;

const inLine = (a: Rider, b: Rider) => Math.abs(a.lane - b.lane) < RIDER_WIDTH_M;

/** Nearest rider ahead within `range`, optionally only those in the same line. */
const nearestAhead = (race: Race, rider: Rider, range: number, sameLine: boolean) => {
  let best: { other: Rider; gap: number } | null = null;
  for (const other of race.riders) {
    if (other === rider || other.ghost || (sameLine && !inLine(rider, other))) continue;
    const gap = gapAhead(race.track, rider, other);
    if (gap > 0 && gap < range && (!best || gap < best.gap)) best = { other, gap };
  }
  return best;
};

/** A lane is free if nobody is alongside (a few metres either way) within a rider's width. */
const laneIsFree = (race: Race, rider: Rider, lane: number) =>
  race.riders.every((other) => {
    if (other === rider || other.ghost) return true;
    const ahead = gapAhead(race.track, rider, other);
    const alongside = ahead < 4 || ahead > race.track.length - 4;
    return !alongside || Math.abs(other.lane - lane) >= RIDER_WIDTH_M;
  });

/**
 * Auto-steering shared by the player and bots: pull out to pass slower riders, otherwise
 * tuck in behind the rider ahead to take their draft.
 */
const chooseLane = (race: Race, rider: Rider, dt: number) => {
  rider.laneCooldown = Math.max(0, rider.laneCooldown - dt);
  if (rider.laneCooldown === 0) {
    const blocker = nearestAhead(race, rider, LOOKAHEAD_M, true);
    const wheel = nearestAhead(race, rider, LOOKAHEAD_M, false);
    let target = rider.targetLane;

    const wantsPast =
      rider.speed > (blocker?.other.speed ?? Number.POSITIVE_INFINITY) + OVERTAKE_MARGIN_MPS ||
      rider.heldBack >= HELD_BACK_PASS_S;
    if (blocker && wantsPast) {
      const options = [blocker.other.lane - LANE_STEP_M, blocker.other.lane + LANE_STEP_M]
        .filter((lane) => Math.abs(lane) <= LANE_LIMIT_M && laneIsFree(race, rider, lane))
        .sort((a, b) => Math.abs(a - rider.lane) - Math.abs(b - rider.lane));
      if (options[0] !== undefined) target = options[0];
    } else if (!blocker && wheel && rider.speed <= wheel.other.speed + OVERTAKE_MARGIN_MPS) {
      target = wheel.other.lane;
    }

    if (target !== rider.targetLane) {
      rider.targetLane = target;
      rider.laneCooldown = LANE_COOLDOWN_S;
    }
  }

  const step = LANE_SPEED_MPS * dt;
  rider.lane += Math.max(-step, Math.min(step, rider.targetLane - rider.lane));
};

const draftFor = (gap: number) =>
  DRAFT_MAX * Math.min(1, Math.max(0, (DRAFT_END_GAP_M - gap) / (DRAFT_END_GAP_M - DRAFT_FULL_GAP_M)));

/**
 * Where a recorded ride was at time `t`. Past the end of the recording the rider carries on at
 * their closing speed, so ghosts roll through the finish instead of stopping on the line.
 */
export const traceDistanceAt = (trace: RideTrace, t: number) => {
  const n = trace.t.length;
  if (n === 0) return 0;
  const lastT = trace.t[n - 1] as number;
  const lastD = trace.d[n - 1] as number;
  if (t >= lastT) {
    const prevT = trace.t[Math.max(0, n - 2)] as number;
    const prevD = trace.d[Math.max(0, n - 2)] as number;
    const closing = lastT > prevT ? (lastD - prevD) / (lastT - prevT) : 0;
    return lastD + closing * (t - lastT);
  }
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((trace.t[mid] as number) <= t) lo = mid;
    else hi = mid - 1;
  }
  const t0 = trace.t[lo] as number;
  const t1 = trace.t[lo + 1] as number;
  const d0 = trace.d[lo] as number;
  const d1 = trace.d[lo + 1] as number;
  return d0 + ((d1 - d0) * (t - t0)) / (t1 - t0 || 1);
};

/** When a recording crossed `distance`, or null if it never did. */
const traceTimeAt = (trace: RideTrace, distance: number) => {
  for (let i = 1; i < trace.d.length; i++) {
    const d1 = trace.d[i] as number;
    if (d1 >= distance) {
      const d0 = trace.d[i - 1] as number;
      const t0 = trace.t[i - 1] as number;
      const t1 = trace.t[i] as number;
      return t0 + ((t1 - t0) * (distance - d0)) / (d1 - d0 || 1);
    }
  }
  return null;
};

/** A bot's watts right now: its base effort, a slow surge, and a boost where its style is strongest. */
const botEffort = (race: Race, rider: Rider, base: number, raceDistance: number) => {
  const surge = BOT_SURGE_W * Math.sin(race.elapsed / 9 + base);
  const { grade } = poseAt(race.track, rider.distance);
  let boost = 1;
  if (rider.botStyle === 'climber' && grade > CLIMB_GRADE) boost = CLIMBER_BOOST;
  if (rider.botStyle === 'rouleur' && grade < CLIMB_GRADE / 2) boost = ROULEUR_BOOST;
  if (rider.botStyle === 'sprinter' && raceDistance - rider.distance < SPRINT_DISTANCE_M) boost = SPRINTER_BOOST;
  return (base + surge) * boost;
};

/** Advances the race. Nothing moves until the player pedals and the countdown ends. */
export const stepRace = (race: Race, sensors: { power: number; cadence: number }, dt: number) => {
  const smoothing = 1 - Math.exp(-dt / POWER_SMOOTHING_S);
  race.playerPower += (sensors.power - race.playerPower) * smoothing;
  race.playerCadence += (sensors.cadence - race.playerCadence) * smoothing;

  if (race.phase === 'waiting') {
    if (sensors.power > 0) race.phase = 'countdown';
    return;
  }
  if (race.phase === 'countdown') {
    race.countdown -= dt;
    if (race.countdown > 0) return;
    race.countdown = 0;
    race.phase = 'racing';
  }

  race.elapsed += dt;
  const raceDistance = race.track.length * race.laps;

  for (const rider of race.riders) {
    if (rider.ghost) {
      const distance = traceDistanceAt(rider.ghost, race.elapsed);
      rider.speed = dt > 0 ? Math.max(0, (distance - rider.distance) / dt) : rider.speed;
      rider.distance = distance;
      if (rider.finishedAt === null && distance >= raceDistance) {
        rider.finishedAt = traceTimeAt(rider.ghost, raceDistance) ?? race.elapsed;
      }
      continue;
    }

    chooseLane(race, rider, dt);

    const power = rider.botPower === null ? race.playerPower : botEffort(race, rider, rider.botPower, raceDistance);
    const ahead = nearestAhead(race, rider, DRAFT_END_GAP_M, true);
    rider.draft = ahead ? draftFor(ahead.gap) : 0;

    const { grade } = poseAt(race.track, rider.distance);
    const freeSpeed = stepSpeed(rider.speed, power, grade, dt, 1 - rider.draft, rider.massKg);
    // Boxed in on a wheel: can't ride through them, so match their speed until the lane opens.
    const boxedIn = ahead !== null && ahead.gap < MIN_GAP_M && freeSpeed > ahead.other.speed;
    rider.speed = boxedIn ? (ahead as NonNullable<typeof ahead>).other.speed : freeSpeed;
    rider.heldBack = boxedIn ? rider.heldBack + dt : 0;
    rider.distance += rider.speed * dt;

    if (rider.botPower === null && rider.finishedAt === null) {
      race.stats.energyJ += power * dt;
      race.stats.distanceM += rider.speed * dt;
      race.stats.maxPower = Math.max(race.stats.maxPower, power);
      race.stats.maxSpeed = Math.max(race.stats.maxSpeed, rider.speed);
      if (rider.draft > 0.05) race.stats.draftSeconds += dt;
    }

    const isPlayer = rider.botPower === null;
    stepMood(rider, power, rider.massKg, dt, rider.finishedAt === null);
    if (isPlayer && rider.finishedAt === null) {
      recordTrace(race, rider.distance);
      if (race.challenges) stepChallenges(race.challenges, race, rider, dt);
    }

    if (rider.finishedAt === null && rider.distance >= raceDistance) {
      rider.finishedAt = race.elapsed;
      // Close the recording exactly on the line so the ghost's finish time matches this result.
      if (isPlayer) pushTraceSample(race.trace, race.elapsed, raceDistance);
    }
  }
};

const pushTraceSample = (trace: RideTrace, t: number, d: number) => {
  trace.t.push(Math.round(t * 100) / 100);
  trace.d.push(Math.round(d * 10) / 10);
};

const recordTrace = (race: Race, distance: number) => {
  const last = race.trace.t[race.trace.t.length - 1];
  if (last === undefined || race.elapsed - last >= TRACE_INTERVAL_S)
    pushTraceSample(race.trace, race.elapsed, distance);
};

export const standings = (race: Race) =>
  [...race.riders].sort((a, b) => {
    if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
    if (a.finishedAt !== null) return -1;
    if (b.finishedAt !== null) return 1;
    return b.distance - a.distance;
  });
