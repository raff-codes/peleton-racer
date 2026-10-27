import * as THREE from 'three';

import type { WorldContext, WorldLayer } from './types';

/** Dome radius as a fraction of the far plane, so it is never clipped. */
const RADIUS_OF_FAR = 0.9;
const WIDTH_SEGMENTS = 24;
const HEIGHT_SEGMENTS = 12;
/** Drawn before everything else; with depth off it can never hide scenery. */
const RENDER_ORDER = -1000;

const vertexShader = /* glsl */ `
varying vec3 vDirection;

void main() {
  // The dome is centred on the camera, so the local position is the view direction.
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Horizon → zenith gradient with a sun disc and glow. Below and right at the horizon it is the
 * fog colour, so fully fogged scenery dissolves into the sky. Not tone mapped: three applies fog
 * after tone mapping, so the fog colour reaches the screen as authored and the sky must match it.
 */
const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform float uGlowExponent;
uniform float uGlowStrength;
varying vec3 vDirection;

void main() {
  vec3 direction = normalize(vDirection);
  float up = direction.y;
  vec3 color = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.55));
  color = mix(uFog, color, smoothstep(-0.02, 0.14, up));

  float toSun = max(dot(direction, uSunDirection), 0.0);
  float disc = smoothstep(0.9990, 0.9995, toSun);
  float glow = pow(toSun, uGlowExponent) * uGlowStrength + pow(toSun, 120.0) * 0.35;
  color = mix(color, uSunColor, clamp(disc + glow, 0.0, 1.0));

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

/** The wide halo at glow size 1: pow(toSun, exponent) × strength. Bigger sizes lower the exponent. */
const HALO_EXPONENT = 10;
const HALO_STRENGTH = 0.22;

/**
 * Sky dome: a low-poly sphere whose colour is computed per pixel, so it needs few triangles.
 * One draw call. Follows the camera every frame (call `update`).
 */
export const createSkyLayer = (ctx: WorldContext): WorldLayer => {
  const { sky, fog } = ctx.theme;
  const radius = ctx.quality.drawDistance * RADIUS_OF_FAR;
  const geometry = new THREE.SphereGeometry(radius, WIDTH_SEGMENTS, HEIGHT_SEGMENTS);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uZenith: { value: new THREE.Color(sky.zenith) },
      uHorizon: { value: new THREE.Color(sky.horizon) },
      uFog: { value: new THREE.Color(fog.color) },
      uSunColor: { value: new THREE.Color(sky.sunColor) },
      uSunDirection: { value: new THREE.Vector3(...sky.sunDirection).normalize() },
      uGlowExponent: { value: HALO_EXPONENT / sky.glow.size },
      uGlowStrength: { value: HALO_STRENGTH * sky.glow.strength }
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.renderOrder = RENDER_ORDER;
  mesh.frustumCulled = false;

  return {
    object: mesh,
    update: (_dt, _elapsed, camera) => {
      mesh.position.copy(camera.position);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    }
  };
};
