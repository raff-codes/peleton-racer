import * as THREE from 'three';

import type { WorldContext, WorldLayer } from './types';

/** How far out along the sun direction the directional light sits; only the direction matters. */
const SUN_DISTANCE_M = 600;

/**
 * Hemisphere fill plus a directional sun from the theme. The sun lines up with the sky's sun
 * disc. No shadows (too costly for the tablet's GPU).
 */
export const createLightingLayer = (ctx: WorldContext): WorldLayer => {
  const { light, sky } = ctx.theme;
  const group = new THREE.Group();
  group.name = 'lighting';

  const hemisphere = new THREE.HemisphereLight(light.hemiSky, light.hemiGround, light.hemiIntensity);
  const sun = new THREE.DirectionalLight(light.sunColor, light.sunIntensity);
  sun.position
    .set(...sky.sunDirection)
    .normalize()
    .multiplyScalar(SUN_DISTANCE_M);
  // In the group so its matrix stays current; the light shines from `position` towards it.
  sun.target.position.set(0, 0, 0);
  group.add(hemisphere, sun, sun.target);

  return {
    object: group,
    dispose: () => {
      hemisphere.dispose();
      sun.dispose();
    }
  };
};
