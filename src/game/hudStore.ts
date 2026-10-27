import { create } from 'zustand';

import type { PersonalBest } from '../data/session';
import type { RacePhase } from './race';

export type HudStanding = {
  id: string;
  name: string;
  color: string;
  gapM: number;
  /** Position round the current lap, 0–1 */
  lapFraction: number;
  finishedAt: number | null;
};

/** Snapshot of the race for the overlay, published a few times a second from the render loop. */
export type HudStats = {
  avgPower: number;
  maxPower: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  draftSeconds: number;
};

type HudStore = {
  raceId: number;
  speedKmh: number;
  distanceM: number;
  lap: number;
  laps: number;
  gradePct: number;
  elapsed: number;
  phase: RacePhase;
  countdown: number;
  /** Drag saved by drafting right now, % */
  draftPct: number;
  position: number;
  standings: HudStanding[];
  finishedAt: number | null;
  /** Metres to the finish line for the player */
  remainingM: number;
  stats: HudStats;
  fps: number;
  /** Set once when the player finishes and the ride has been saved */
  personalBest: PersonalBest | null;
  publish: (snapshot: Omit<HudStore, 'raceId' | 'publish' | 'restart' | 'personalBest' | 'setPersonalBest'>) => void;
  setPersonalBest: (pb: PersonalBest | null) => void;
  restart: () => void;
};

export const useHud = create<HudStore>((set) => ({
  raceId: 0,
  speedKmh: 0,
  distanceM: 0,
  lap: 1,
  laps: 2,
  gradePct: 0,
  elapsed: 0,
  phase: 'waiting',
  countdown: 0,
  draftPct: 0,
  position: 1,
  standings: [],
  finishedAt: null,
  remainingM: 0,
  stats: { avgPower: 0, maxPower: 0, avgSpeedKmh: 0, maxSpeedKmh: 0, draftSeconds: 0 },
  fps: 0,
  personalBest: null,
  publish: (snapshot) => set(snapshot),
  setPersonalBest: (personalBest) => set({ personalBest }),
  restart: () =>
    set((s) => ({
      raceId: s.raceId + 1,
      finishedAt: null,
      phase: 'waiting',
      elapsed: 0,
      personalBest: null,
      standings: []
    }))
}));
