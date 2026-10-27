import type { MapId } from '../game/maps';
import type { Difficulty, RideMode } from '../game/race';

export type Profile = {
  id: number;
  name: string;
  color: string;
  /** Rider weight, kg: feeds the physics, so climbs cost what they should */
  weightKg: number;
  createdAt: number;
};

export type NewProfile = Omit<Profile, 'id' | 'createdAt'>;

/**
 * Where the rider was over time, sampled once a second of race time. Parallel arrays keep the
 * stored JSON small. Replayed as a ghost by interpolating distance at a given time.
 */
export type RideTrace = { t: number[]; d: number[] };

export type RideRecord = {
  id: number;
  profileId: number;
  mapId: MapId;
  mode: RideMode;
  /** 0 for free rides (no set distance) */
  laps: number;
  difficulty: Difficulty;
  startedAt: number;
  /** Finish time for completed rides, otherwise time ridden, s */
  durationS: number;
  distanceM: number;
  finished: boolean;
  /** Place among all riders (bots and ghosts), null when riding alone */
  place: number | null;
  avgPower: number;
  maxPower: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
};

export type NewRide = Omit<RideRecord, 'id'> & { trace: RideTrace };

/** A profile's best finished time on one course + distance: the household leaderboard row. */
export type BestRide = RideRecord & { profileName: string; profileColor: string; trace: RideTrace };

export type ProfileTotals = { rides: number; distanceM: number; durationS: number };
