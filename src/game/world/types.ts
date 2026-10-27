import type * as THREE from 'three';

import type { Track } from '../track';
import type { HeightField } from './heightField';
import type { QualitySettings } from './quality';
import type { RoadQuery } from './roadQuery';
import type { Theme } from './theme';

/** Road surface width, m. The ribbon is centred on the track line. */
export const ROAD_WIDTH = 9;

/** Everything a world layer needs to build itself. Built once per track. */
export type WorldContext = {
  track: Track;
  theme: Theme;
  quality: QualitySettings;
  road: RoadQuery;
  ground: HeightField;
};

/**
 * A self-contained piece of scenery (terrain, sky, trees, props...). Built imperatively so the
 * scene can add `object` with <primitive> and drive `update` from the single frame loop.
 */
export type WorldLayer = {
  object: THREE.Object3D;
  /** Per-frame animation. `elapsed` is seconds since the world was built. Must not allocate. */
  update?: (dt: number, elapsed: number, camera: THREE.Camera) => void;
  dispose: () => void;
};
