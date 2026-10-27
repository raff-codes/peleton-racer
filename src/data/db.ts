import { openDatabaseSync } from 'expo-sqlite';

import type { MapId } from '../game/maps';
import type { BestRide, NewProfile, NewRide, Profile, ProfileTotals, RideRecord, RideTrace } from './types';

const db = openDatabaseSync('peleton.db');

/** Ordered schema steps; `PRAGMA user_version` records how many have run. Append only. */
const MIGRATIONS = [
  `CREATE TABLE profiles (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     color TEXT NOT NULL,
     weight_kg REAL NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE rides (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
     map_id TEXT NOT NULL,
     mode TEXT NOT NULL,
     laps INTEGER NOT NULL,
     difficulty TEXT NOT NULL,
     started_at INTEGER NOT NULL,
     duration_s REAL NOT NULL,
     distance_m REAL NOT NULL,
     finished INTEGER NOT NULL,
     place INTEGER,
     avg_power REAL NOT NULL,
     max_power REAL NOT NULL,
     avg_speed_kmh REAL NOT NULL,
     max_speed_kmh REAL NOT NULL,
     trace TEXT NOT NULL
   );
   CREATE INDEX rides_profile ON rides(profile_id, started_at);
   CREATE INDEX rides_course ON rides(map_id, laps, finished, duration_s);`
];

const migrate = () => {
  db.execSync('PRAGMA foreign_keys = ON;');
  const current = db.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
  MIGRATIONS.slice(current).forEach((sql, i) => {
    db.withTransactionSync(() => {
      db.execSync(sql);
      db.execSync(`PRAGMA user_version = ${current + i + 1}`);
    });
  });
};
migrate();

type ProfileRow = { id: number; name: string; color: string; weight_kg: number; created_at: number };
type RideRow = {
  id: number;
  profile_id: number;
  map_id: string;
  mode: string;
  laps: number;
  difficulty: string;
  started_at: number;
  duration_s: number;
  distance_m: number;
  finished: number;
  place: number | null;
  avg_power: number;
  max_power: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  trace?: string;
};

const toProfile = (r: ProfileRow): Profile => ({
  id: r.id,
  name: r.name,
  color: r.color,
  weightKg: r.weight_kg,
  createdAt: r.created_at
});

const toRide = (r: RideRow): RideRecord => ({
  id: r.id,
  profileId: r.profile_id,
  mapId: r.map_id as MapId,
  mode: r.mode as RideRecord['mode'],
  laps: r.laps,
  difficulty: r.difficulty as RideRecord['difficulty'],
  startedAt: r.started_at,
  durationS: r.duration_s,
  distanceM: r.distance_m,
  finished: r.finished === 1,
  place: r.place,
  avgPower: r.avg_power,
  maxPower: r.max_power,
  avgSpeedKmh: r.avg_speed_kmh,
  maxSpeedKmh: r.max_speed_kmh
});

export const listProfiles = () =>
  db.getAllSync<ProfileRow>('SELECT * FROM profiles ORDER BY created_at').map(toProfile);

export const createProfile = (p: NewProfile) =>
  db.runSync('INSERT INTO profiles (name, color, weight_kg, created_at) VALUES (?, ?, ?, ?)', [
    p.name,
    p.color,
    p.weightKg,
    Date.now()
  ]).lastInsertRowId;

export const updateProfile = (id: number, p: NewProfile) =>
  db.runSync('UPDATE profiles SET name = ?, color = ?, weight_kg = ? WHERE id = ?', [p.name, p.color, p.weightKg, id]);

/** Also deletes the profile's rides (foreign key cascade). */
export const deleteProfile = (id: number) => db.runSync('DELETE FROM profiles WHERE id = ?', [id]);

export const insertRide = (ride: NewRide) =>
  db.runSync(
    `INSERT INTO rides (profile_id, map_id, mode, laps, difficulty, started_at, duration_s, distance_m, finished,
       place, avg_power, max_power, avg_speed_kmh, max_speed_kmh, trace)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ride.profileId,
      ride.mapId,
      ride.mode,
      ride.laps,
      ride.difficulty,
      ride.startedAt,
      ride.durationS,
      ride.distanceM,
      ride.finished ? 1 : 0,
      ride.place,
      ride.avgPower,
      ride.maxPower,
      ride.avgSpeedKmh,
      ride.maxSpeedKmh,
      JSON.stringify(ride.trace)
    ]
  ).lastInsertRowId;

/** A profile's rides, newest first (without traces, which only ghosts need). */
export const listRides = (profileId: number) =>
  db
    .getAllSync<RideRow>(
      `SELECT id, profile_id, map_id, mode, laps, difficulty, started_at, duration_s, distance_m, finished, place,
         avg_power, max_power, avg_speed_kmh, max_speed_kmh
       FROM rides WHERE profile_id = ? ORDER BY started_at DESC`,
      [profileId]
    )
    .map(toRide);

export const profileTotals = (profileId: number): ProfileTotals => {
  const row = db.getFirstSync<{ rides: number; distance: number | null; duration: number | null }>(
    'SELECT COUNT(*) AS rides, SUM(distance_m) AS distance, SUM(duration_s) AS duration FROM rides WHERE profile_id = ?',
    [profileId]
  );
  return { rides: row?.rides ?? 0, distanceM: row?.distance ?? 0, durationS: row?.duration ?? 0 };
};

/**
 * Each profile's fastest finished ride over a set distance on a course, fastest first. Any mode
 * counts: a race finish is as valid a time as a time trial. These are the household ghosts.
 */
export const courseBests = (mapId: MapId, laps: number): BestRide[] =>
  db
    .getAllSync<RideRow & { profile_name: string; profile_color: string }>(
      `SELECT r.*, p.name AS profile_name, p.color AS profile_color
       FROM rides r JOIN profiles p ON p.id = r.profile_id
       WHERE r.map_id = ? AND r.laps = ? AND r.finished = 1
         AND r.duration_s = (
           SELECT MIN(r2.duration_s) FROM rides r2
           WHERE r2.profile_id = r.profile_id AND r2.map_id = r.map_id AND r2.laps = r.laps AND r2.finished = 1
         )
       GROUP BY r.profile_id
       ORDER BY r.duration_s`,
      [mapId, laps]
    )
    .map((r) => ({
      ...toRide(r),
      profileName: r.profile_name,
      profileColor: r.profile_color,
      trace: JSON.parse(r.trace ?? '{"t":[],"d":[]}') as RideTrace
    }));
