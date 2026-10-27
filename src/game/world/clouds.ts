import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { createRandom, smoothstep } from './noise';
import type { WorldContext, WorldLayer } from './types';

/** Puffs in one cloud (unit-sized), as [x, y, z, radius]. Squashed afterwards by `SQUASH_Y`. */
const PUFFS: [number, number, number, number][] = [
  [0, 0.15, 0, 0.62],
  [-0.62, 0, 0.08, 0.44],
  [0.6, 0.02, -0.06, 0.48],
  [-0.22, 0.3, -0.18, 0.4],
  [0.28, 0.26, 0.2, 0.38],
  [1.05, -0.06, 0.1, 0.3]
];
const SQUASH_Y = 0.62;
/** Clouds live in a square of this half-size around the origin and wrap at its edges, m. */
const SPREAD_M = 1600;
/** They shrink to nothing over the outer part of the square, so the wrap never pops. */
const FADE_FROM = 0.82;
const SIZE_M = [45, 95];
const HEIGHT_JITTER_M = 45;
/** Gentle breeze, m/s. */
const WIND = new THREE.Vector3(3.2, 0, 1.4);
/** Unlit share of the cloud colour, so their undersides stay soft rather than going grey. */
const GLOW = 0.3;

type Cloud = { x: number; y: number; z: number; scale: THREE.Vector3; rotation: THREE.Quaternion };

/** One merged, flat-shaded cluster of squashed icosahedrons, shaded light on top and darker underneath. */
const buildCloudGeometry = (color: THREE.Color, shadow: THREE.Color) => {
  const parts = PUFFS.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 0).translate(x, y, z));
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Failed to merge cloud puffs');
  geometry.scale(1, SQUASH_Y, 1);
  geometry.computeVertexNormals();

  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const face = new THREE.Color();
  for (let i = 0; i < position.count; i += 3) {
    const y = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
    face.lerpColors(shadow, color, smoothstep(-0.2, 0.25, y));
    for (let k = 0; k < 3; k++) colors.set([face.r, face.g, face.b], (i + k) * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
};

/**
 * Drifting clouds: `quality.clouds` instances of one merged puff cluster, one draw call. The
 * instance matrices are rewritten each frame from fixed per-cloud data (no allocation).
 */
export const createCloudsLayer = (ctx: WorldContext): WorldLayer => {
  const { theme, quality, ground } = ctx;
  const color = new THREE.Color(theme.clouds.color);
  const geometry = buildCloudGeometry(color, new THREE.Color(theme.clouds.shadow));
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: color.clone().multiplyScalar(GLOW)
  });
  const mesh = new THREE.InstancedMesh(geometry, material, quality.clouds);
  mesh.name = 'clouds';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Instances span the whole sky; the default bounds are one cloud at the origin.
  mesh.frustumCulled = false;

  const random = createRandom(theme.seed ^ 0xc10d);
  const up = new THREE.Vector3(0, 1, 0);
  const clouds: Cloud[] = Array.from({ length: quality.clouds }, () => {
    const size = (SIZE_M[0] as number) + random() * ((SIZE_M[1] as number) - (SIZE_M[0] as number));
    return {
      x: (random() * 2 - 1) * SPREAD_M,
      y: ground.baseY + theme.clouds.height + (random() * 2 - 1) * HEIGHT_JITTER_M,
      z: (random() * 2 - 1) * SPREAD_M,
      scale: new THREE.Vector3(size, size * (0.8 + random() * 0.4), size * (0.55 + random() * 0.35)),
      rotation: new THREE.Quaternion().setFromAxisAngle(up, random() * Math.PI * 2)
    };
  });

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const wrap = (v: number) => ((((v + SPREAD_M) % (2 * SPREAD_M)) + 2 * SPREAD_M) % (2 * SPREAD_M)) - SPREAD_M;

  const place = (elapsed: number) => {
    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i] as Cloud;
      position.set(wrap(cloud.x + WIND.x * elapsed), cloud.y, wrap(cloud.z + WIND.z * elapsed));
      const edge = Math.max(Math.abs(position.x), Math.abs(position.z));
      scale.copy(cloud.scale).multiplyScalar(smoothstep(SPREAD_M, SPREAD_M * FADE_FROM, edge));
      mesh.setMatrixAt(i, matrix.compose(position, cloud.rotation, scale));
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(0);

  return {
    object: mesh,
    update: (_dt, elapsed) => place(elapsed),
    dispose: () => {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    }
  };
};
