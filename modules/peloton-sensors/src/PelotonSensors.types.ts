export type SensorSample = {
  /** Watts */
  power: number;
  /** RPM */
  cadence: number;
  /** Peloton resistance, 0–100 */
  resistance: number;
  /** Epoch ms */
  timestamp: number;
};

export type SensorState = 'connecting' | 'connected' | 'disconnected' | 'unavailable';

export type SensorStatus = {
  state: SensorState;
  detail: string | null;
};

export type DeviceInfo = {
  brand: string;
  model: string;
  sdkInt: number;
  isPeloton: boolean;
  bike: 'bike' | 'bikePlus';
};

export type PelotonSensorsModuleEvents = {
  onSample: (sample: SensorSample) => void;
  onStatus: (status: SensorStatus) => void;
};
