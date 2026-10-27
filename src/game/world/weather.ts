import * as THREE from 'three';

import { createRandom } from './noise';
import type { WorldContext, WorldLayer } from './types';

/**
 * Falling snow, leaves or drifting pollen: one THREE.Points draw call. All motion is in the vertex
 * shader from a time uniform, so the CPU only moves two uniforms per frame.
 *
 * Each particle has a fixed start position; the shader adds wind, fall and sway, then wraps the
 * result into a box around a point just ahead of the camera (`mod`), so the particles are fixed in
 * the world (no swimming as the camera turns) yet never run out. They shrink to nothing near the
 * box faces, so the wrap never pops.
 */

/** Size of the wrap box (x, y, z), m. Small, so the particles stay dense where they're visible. */
const BOX_M = [46, 26, 46] as const;
/** The box is centred this far ahead of the camera, so few particles are wasted behind it. */
const AHEAD_M = 12;
/** Particles fade out between this fraction of the half-box and its faces. */
const FADE_FROM = 0.7;
/** Point size cap, px: a flake brushing the lens shouldn't fill the screen. */
const MAX_POINT_PX = 26;
/** Each particle falls this fraction faster or slower than the theme's speed. */
const SPEED_JITTER = 0.3;
/** Sway frequency, rad/s; leaves flutter faster. */
const SWAY_RATE = 0.8;
const LEAF_SWAY_RATE = 1.4;
/** Leaves: max spin about the view axis and how fast they flip edge-on, rad/s. */
const LEAF_SPIN = 2.2;
const LEAF_TUMBLE = 2.6;
/** Leaf outline: an ellipse this much narrower than long, never thinner than MIN_FACE of that (fully edge-on). */
const LEAF_ASPECT = 0.55;
const LEAF_MIN_FACE = 0.2;
/** Leaves catch the light as they turn: brightness from edge-on to face-on. */
const LEAF_SHADE = [0.65, 1] as const;

const f = (n: number) => n.toFixed(4);

const VERTEX_DECLARATIONS = /* glsl */ `
uniform float uTime;
uniform vec3 uCentre;
uniform vec3 uBox;
uniform vec3 uVelocity;
uniform float uSway;
attribute float aSeed;
varying float vSpin;
varying float vFace;
`;

/** Replaces begin_vertex: drift, sway, then wrap into the box. `weatherFade` is used for the point size below. */
const MOTION_VERTEX = (swayRate: number) => /* glsl */ `
float weatherPhase = aSeed * 6.2832;
float weatherSpeed = 1.0 + (aSeed - 0.5) * ${f(2 * SPEED_JITTER)};
vec3 drifted = position + vec3(uVelocity.x, uVelocity.y * weatherSpeed, uVelocity.z) * uTime;
drifted.x += sin(uTime * ${f(swayRate)} + weatherPhase) * uSway;
drifted.z += cos(uTime * ${f(swayRate * 0.8)} + weatherPhase * 1.3) * uSway;
vec3 local = mod(drifted - uCentre + 0.5 * uBox, uBox) - 0.5 * uBox;
vec3 transformed = uCentre + local;
vec3 edge = abs(local) / (0.5 * uBox);
float weatherFade = 1.0 - smoothstep(${f(FADE_FROM)}, 1.0, max(max(edge.x, edge.y), edge.z));
vSpin = weatherPhase + uTime * ${f(LEAF_SPIN)} * (aSeed * 2.0 - 1.0);
vFace = max(abs(sin(uTime * ${f(LEAF_TUMBLE)} * (0.6 + aSeed) + weatherPhase * 3.0)), ${f(LEAF_MIN_FACE)});
`;

/** Round flakes; leaves are a spinning ellipse that narrows as it turns edge-on. */
const SHAPE_FRAGMENT = /* glsl */ `
#include <clipping_planes_fragment>
{
  vec2 c = gl_PointCoord - 0.5;
#ifdef WEATHER_LEAVES
  float s = sin(vSpin);
  float k = cos(vSpin);
  c = vec2(k * c.x - s * c.y, s * c.x + k * c.y);
  c.y /= ${f(LEAF_ASPECT)} * vFace;
#endif
  if (dot(c, c) > 0.25) discard;
}
`;

const LEAF_SHADE_FRAGMENT = /* glsl */ `
#include <color_fragment>
#ifdef WEATHER_LEAVES
diffuseColor.rgb *= mix(${f(LEAF_SHADE[0])}, ${f(LEAF_SHADE[1])}, vFace);
#endif
`;

export const createWeatherLayer = (ctx: WorldContext): WorldLayer | null => {
  const { theme, quality } = ctx;
  const { weather } = theme;
  if (!weather) return null;
  const count = Math.round(quality.weather * weather.density);
  if (count === 0) return null;
  const leaves = weather.kind === 'leaves';

  const random = createRandom(theme.seed ^ 0x5eed);
  const palette = weather.colors.map((c) => new THREE.Color(c));
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const [bx, by, bz] = BOX_M;
  for (let i = 0; i < count; i++) {
    positions.set([random() * bx, random() * by, random() * bz], i * 3);
    const color = palette[Math.floor(random() * palette.length)] ?? palette[0];
    if (color) colors.set([color.r, color.g, color.b], i * 3);
    seeds[i] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const uniforms = {
    uTime: { value: 0 },
    uCentre: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(bx, by, bz) },
    uVelocity: { value: new THREE.Vector3(weather.wind[0], -weather.fallSpeed, weather.wind[1]) },
    uSway: { value: weather.sway }
  };
  const material = new THREE.PointsMaterial({ size: weather.size, sizeAttenuation: true, vertexColors: true });
  if (leaves) material.defines = { WEATHER_LEAVES: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <begin_vertex>', MOTION_VERTEX(leaves ? LEAF_SWAY_RATE : SWAY_RATE))
      .replace(
        '#include <logdepthbuf_vertex>',
        `gl_PointSize = min(gl_PointSize, ${f(MAX_POINT_PX)}) * weatherFade;\n#include <logdepthbuf_vertex>`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSpin;\nvarying float vFace;')
      .replace('#include <clipping_planes_fragment>', SHAPE_FRAGMENT)
      .replace('#include <color_fragment>', LEAF_SHADE_FRAGMENT);
  };
  material.customProgramCacheKey = () => (leaves ? 'weather-leaves' : 'weather-round');

  const points = new THREE.Points(geometry, material);
  points.name = 'weather';
  // Positions are made in the shader, so the geometry's bounds mean nothing.
  points.frustumCulled = false;
  points.matrixAutoUpdate = false;

  const ahead = new THREE.Vector3();
  return {
    object: points,
    update: (_dt, elapsed, camera) => {
      uniforms.uTime.value = elapsed;
      camera.getWorldDirection(ahead);
      uniforms.uCentre.value.copy(camera.position).addScaledVector(ahead, AHEAD_M);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    }
  };
};
