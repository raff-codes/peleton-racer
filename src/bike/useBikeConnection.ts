import * as React from 'react';

import PelotonSensors from '../../modules/peloton-sensors/src/PelotonSensorsModule';
import { startSimulator } from './simulator';
import { useBike } from './store';

/**
 * Connects to the Peloton sensor service. Off a Peloton (or if the service can't be
 * bound) it switches to the simulator so the game stays playable for development.
 */
export const useBikeConnection = () => {
  React.useEffect(() => {
    const { setSample, setStatus, setSource } = useBike.getState();
    let stopSimulator: (() => void) | null = null;

    const sampleSub = PelotonSensors.addListener('onSample', setSample);
    const statusSub = PelotonSensors.addListener('onStatus', ({ state, detail }) => {
      setStatus(state, detail);
      if (state === 'unavailable' && !stopSimulator) {
        setSource('simulator');
        stopSimulator = startSimulator();
      }
    });

    PelotonSensors.start();

    return () => {
      sampleSub.remove();
      statusSub.remove();
      PelotonSensors.stop();
      stopSimulator?.();
    };
  }, []);
};
