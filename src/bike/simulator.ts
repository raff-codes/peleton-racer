import { useBike } from './store';

const TICK_MS = 250;

/**
 * Fake rider for development off the bike (emulator, phone). Wobbles around the
 * target watts set by the on-screen controls, with a plausible cadence.
 */
export const startSimulator = () => {
  let t = 0;
  const id = setInterval(() => {
    t += TICK_MS / 1000;
    const { simPower, setSample } = useBike.getState();
    const power = simPower === 0 ? 0 : Math.max(0, simPower + Math.sin(t * 1.7) * 12 + (Math.random() - 0.5) * 10);
    setSample({
      power,
      cadence: power === 0 ? 0 : 70 + power / 12,
      resistance: Math.min(100, 20 + power / 8),
      timestamp: Date.now()
    });
  }, TICK_MS);
  return () => clearInterval(id);
};
