import { create } from 'zustand';

import type { PersonalBest } from '../data/session';
import type { ChallengeKind, ChallengeResult } from './challenges';
import type { Mood } from './mood';
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

/** The challenge coming up, or the drill under way. */
export type HudChallenge = {
  kind: ChallengeKind;
  /** Metres to the gate or the drill's start line; 0 once a drill is under way */
  inM: number;
  /** Gates: the band to ride through in; grind drills: the minimum (hi is Infinity), W */
  watts: { lo: number; hi: number } | null;
  /** Drills under way: seconds left, and the share of the drill on target so far (0–1) */
  secondsLeft: number | null;
  onTarget: number;
};

export type HudChallenges = {
  /** Shown once it's close; null between challenges */
  upcoming: HudChallenge | null;
  score: number;
  streak: number;
  passed: number;
  attempted: number;
  /** The latest gate or drill result, stamped with race time so the HUD can flash it briefly */
  last: ChallengeResult | null;
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
  mood: Mood;
  position: number;
  standings: HudStanding[];
  finishedAt: number | null;
  /** Metres to the finish line for the player */
  remainingM: number;
  stats: HudStats;
  /** Null when the ride has no challenges */
  challenges: HudChallenges | null;
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
  mood: 'normal',
  position: 1,
  standings: [],
  finishedAt: null,
  remainingM: 0,
  stats: { avgPower: 0, maxPower: 0, avgSpeedKmh: 0, maxSpeedKmh: 0, draftSeconds: 0 },
  challenges: null,
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
      standings: [],
      challenges: null
    }))
}));
