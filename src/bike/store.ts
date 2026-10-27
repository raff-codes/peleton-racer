import { create } from 'zustand';

import type { SensorSample, SensorState } from '../../modules/peloton-sensors/src/PelotonSensors.types';

export type BikeSource = 'peloton' | 'simulator';

type BikeStore = {
  source: BikeSource;
  state: SensorState;
  detail: string | null;
  sample: SensorSample;
  /** Target watts for the simulator, ignored when riding the real bike. */
  simPower: number;
  setSample: (sample: SensorSample) => void;
  setStatus: (state: SensorState, detail: string | null) => void;
  setSource: (source: BikeSource) => void;
  nudgeSimPower: (delta: number) => void;
};

export const useBike = create<BikeStore>((set) => ({
  source: 'peloton',
  state: 'connecting',
  detail: null,
  sample: { power: 0, cadence: 0, resistance: 0, timestamp: 0 },
  simPower: 150,
  setSample: (sample) => set({ sample }),
  setStatus: (state, detail) => set({ state, detail }),
  setSource: (source) => set({ source }),
  nudgeSimPower: (delta) => set((s) => ({ simPower: Math.min(600, Math.max(0, s.simPower + delta)) }))
}));
