import { create } from 'zustand';

import PelotonSensors from '../../modules/peloton-sensors/src/PelotonSensorsModule';
import { endSession, saveUnfinishedRide } from '../data/session';
import { useHud } from './hudStore';
import { type GameMap, type MapId, mapById } from './maps';
import type { RideSetup } from './race';

export type QualityLevel = 'low' | 'high';

/** Everything picked on the menu: which map, and how to ride it. */
export type RideChoice = RideSetup & { mapId: MapId };

/**
 * The original Bike's tablet has the weakest GPU, so it starts on low; the Bike+ and anything
 * that isn't a Peloton (emulator, phones) start on high. The rider can flip it from the HUD.
 */
const defaultQuality = (): QualityLevel => {
  const device = PelotonSensors.getDeviceInfo();
  return device.isPeloton && device.bike === 'bike' ? 'low' : 'high';
};

type SettingsStore = {
  quality: QualityLevel;
  /** The menu's current selection; kept between rides so "ride again" is one tap. */
  draft: RideChoice;
  /** The ride in progress; null shows the menu. */
  ride: RideChoice | null;
  paused: boolean;
  /** Which screen shows when no ride is in progress */
  view: 'menu' | 'history';
  showMenu: () => void;
  showHistory: () => void;
  toggleQuality: () => void;
  updateDraft: (change: Partial<RideChoice>) => void;
  startRide: () => void;
  /** Same ride from the start line. */
  restartRide: () => void;
  endRide: () => void;
  pause: () => void;
  resume: () => void;
};

export const useSettings = create<SettingsStore>((set, get) => ({
  quality: defaultQuality(),
  draft: { mapId: 'alpine-2', mode: 'race', laps: 2, difficulty: 'normal', challenges: false },
  ride: null,
  paused: false,
  view: 'menu',
  showMenu: () => set({ view: 'menu' }),
  showHistory: () => set({ view: 'history' }),
  toggleQuality: () => set((s) => ({ quality: s.quality === 'high' ? 'low' : 'high' })),
  updateDraft: (change) => set((s) => ({ draft: { ...s.draft, ...change } })),
  startRide: () => {
    // Clear the previous ride's HUD (finish time, standings) before the new one mounts.
    useHud.getState().restart();
    set({ ride: get().draft, paused: false });
  },
  restartRide: () => {
    saveUnfinishedRide();
    useHud.getState().restart();
    set({ paused: false });
  },
  endRide: () => {
    saveUnfinishedRide();
    endSession();
    set({ ride: null, paused: false });
  },
  pause: () => set({ paused: true }),
  resume: () => set({ paused: false })
}));

/** The ride in progress with its map resolved, or null on the menu. */
export const useCurrentRide = (): { map: GameMap; setup: RideSetup } | null => {
  const ride = useSettings((s) => s.ride);
  return ride ? { map: mapById(ride.mapId), setup: ride } : null;
};
