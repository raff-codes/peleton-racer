import type { GameMap } from '../game/maps';
import { RIDER } from '../game/physics';
import {
  DEFAULT_LEVEL_W,
  type GhostEntry,
  PLAYER_ID,
  type PlayerEntry,
  type Race,
  type RideSetup,
  skipAhead as skipRaceAhead,
  standings
} from '../game/race';
import { courseBests, insertRide, riderLevelW } from './db';
import { activeProfile } from './profiles';
import type { NewRide } from './types';

/** Shortest ride worth keeping in history when it wasn't finished (free rides, abandoned races). */
const MIN_SAVED_S = 60;
const MAX_GHOSTS = 5;

export type PersonalBest = { isPb: boolean; previousS: number | null };

type Session = {
  race: Race;
  map: GameMap;
  setup: RideSetup;
  startedAt: number;
  saved: boolean;
  /** The field was moved along the road: the ride isn't a real effort, so it's never saved */
  skipped: boolean;
};

/** The ride in progress, so it can be saved from wherever it ends (finish line, pause menu). */
let current: Session | null = null;

export const playerForActiveProfile = (): PlayerEntry => {
  const profile = activeProfile();
  return profile
    ? {
        name: profile.name,
        color: profile.color,
        massKg: profile.weightKg + RIDER.bikeKg,
        levelW: riderLevelW(profile.id) ?? DEFAULT_LEVEL_W
      }
    : { name: 'You', color: '#ff5a1f', massKg: RIDER.massKg, levelW: DEFAULT_LEVEL_W };
};

/**
 * Household ghosts for a time trial: everyone's best finished time over this course and
 * distance, including the rider's own PB.
 */
export const ghostsFor = (map: GameMap, setup: RideSetup): GhostEntry[] => {
  if (setup.mode !== 'timeTrial') return [];
  const me = activeProfile();
  return courseBests(map.id, setup.laps)
    .slice(0, MAX_GHOSTS)
    .map((best) => ({
      id: `ghost-${best.profileId}`,
      name: best.profileId === me?.id ? 'Your best' : best.profileName,
      color: best.profileColor,
      trace: best.trace
    }));
};

export const beginSession = (race: Race, map: GameMap, setup: RideSetup) => {
  current = { race, map, setup, startedAt: Date.now(), saved: false, skipped: false };
};

const toRecord = (session: Session, profileId: number): NewRide => {
  const { race, map, setup, startedAt } = session;
  const player = race.riders.find((r) => r.id === PLAYER_ID);
  const finishedAt = player?.finishedAt ?? null;
  const durationS = finishedAt ?? race.elapsed;
  const order = standings(race);
  return {
    profileId,
    mapId: map.id,
    mode: setup.mode,
    laps: setup.mode === 'freeRide' ? 0 : setup.laps,
    difficulty: setup.difficulty,
    startedAt,
    durationS,
    distanceM: finishedAt !== null ? map.track.length * setup.laps : race.stats.distanceM,
    finished: finishedAt !== null,
    place: race.riders.length > 1 && finishedAt !== null ? order.findIndex((r) => r.id === PLAYER_ID) + 1 : null,
    avgPower: durationS > 0 ? race.stats.energyJ / durationS : 0,
    maxPower: race.stats.maxPower,
    avgSpeedKmh: durationS > 0 ? (race.stats.distanceM / durationS) * 3.6 : 0,
    maxSpeedKmh: race.stats.maxSpeed * 3.6,
    trace: race.trace
  };
};

/** Saves a finished ride once and reports whether it beat the rider's previous best here. */
export const saveFinishedRide = (): PersonalBest | null => {
  const profile = activeProfile();
  if (!current || current.saved || current.skipped || !profile) return null;
  const { map, setup } = current;
  const previous = courseBests(map.id, setup.laps).find((b) => b.profileId === profile.id) ?? null;
  const record = toRecord(current, profile.id);
  insertRide(record);
  current.saved = true;
  return { isPb: previous === null || record.durationS < previous.durationS, previousS: previous?.durationS ?? null };
};

/** Keeps an unfinished ride (free ride, quitting mid-race) if it was long enough to count. */
export const saveUnfinishedRide = () => {
  const profile = activeProfile();
  if (!current || current.saved || current.skipped || !profile || current.race.elapsed < MIN_SAVED_S) return;
  insertRide(toRecord(current, profile.id));
  current.saved = true;
};

/** Simulator only: moves the field `metres` along the road. The ride is then never saved. */
export const skipAhead = (metres: number) => {
  if (!current) return;
  current.skipped = true;
  skipRaceAhead(current.race, metres);
};

export const endSession = () => {
  current = null;
};
