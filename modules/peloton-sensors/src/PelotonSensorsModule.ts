import { NativeModule, requireNativeModule } from 'expo';

import { DeviceInfo, PelotonSensorsModuleEvents } from './PelotonSensors.types';

declare class PelotonSensorsModule extends NativeModule<PelotonSensorsModuleEvents> {
  getDeviceInfo(): DeviceInfo;
  start(): void;
  stop(): void;
}

export default requireNativeModule<PelotonSensorsModule>('PelotonSensors');
