import type { Track } from '../track';
import { createCloudsLayer } from './clouds';
import { createGroundShadowsLayer } from './groundShadows';
import { createHeightField } from './heightField';
import { createLandmarksLayer, type Landmark, placeLandmarks } from './landmarks';
import { createLightingLayer } from './lighting';
import { createMountainsLayer } from './mountains';
import type { QualitySettings } from './quality';
import { createRoadLayer } from './road';
import { createRoadQuery } from './roadQuery';
import { createRoadsideLayer } from './roadside';
import { createSkyLayer } from './sky';
import { createTerrainLayer } from './terrain';
import type { Theme } from './theme';
import type { WorldContext, WorldLayer } from './types';
import { createVegetationLayer } from './vegetation';
import { createWaterLayer } from './water';
import { createWeatherLayer } from './weather';

export type World = { context: WorldContext; layers: WorldLayer[] };

/** Builds every scenery layer for a track. Expensive (hundreds of ms on the tablet): do it once per track/quality. */
export const createWorld = (
  track: Track,
  theme: Theme,
  quality: QualitySettings,
  landmarks: readonly Landmark[] = []
): World => {
  const road = createRoadQuery(track);
  const context: WorldContext = {
    track,
    theme,
    quality,
    road,
    ground: createHeightField(track, theme, road),
    shadows: [],
    landmarks: placeLandmarks(track, landmarks)
  };
  const layers = [
    createLightingLayer(context),
    createSkyLayer(context),
    createMountainsLayer(context),
    createTerrainLayer(context),
    createRoadLayer(context),
    createWaterLayer(context),
    createCloudsLayer(context),
    createVegetationLayer(context),
    createRoadsideLayer(context),
    createLandmarksLayer(context),
    // After every layer that registers shadow casters.
    createGroundShadowsLayer(context),
    createWeatherLayer(context)
  ].filter((layer): layer is WorldLayer => layer !== null);
  return { context, layers };
};
