import * as THREE from 'three';

import { smoothstep } from './noise';
import type { WorldContext, WorldLayer } from './types';

const ANGLES = 48;
/** Ring radii as fractions of the shore radius at each angle (the centre is a single vertex). */
const RINGS = [0.3, 0.55, 0.75, 0.9, 1];
/** Shore search: start inside the bowl, step outwards until the ground clears the water. */
const SEARCH_FROM = 0.5;
const SEARCH_STEP_M = 3;
/**
 * Never wider than this (× lake radius), even where low ground runs on below the water level:
 * the height field's `isWater` stops at 1.05×, so trees may stand beyond it.
 */
const MAX_RADIUS = 1.2;
/** Ground must be this far above the water to count as shore. */
const SHORE_CLEARANCE_M = 0.3;
/** The surface runs this far past the shoreline so its edge is always buried under the terrain. */
const SHORE_MARGIN_M = 8;
/** Water reaches its deep colour at this fraction of the lake's depth. */
const DEEP_AT = 0.7;
const SHININESS = 70;
const SPECULAR = 0.35;

/**
 * Fragment patch: tilts the surface normal with a few travelling sine waves, so the sun's
 * specular highlight glitters across the lake. Pure maths, no textures; the geometry is static.
 */
const SHIMMER_FRAGMENT = /* glsl */ `
#include <normal_fragment_maps>
{
  vec2 p = vWaterXZ * 0.09;
  float t = uWaterTime;
  vec2 tilt = vec2(
    sin(p.x * 1.7 + p.y * 0.6 + t * 0.9) + 0.6 * sin(p.x * 4.3 - p.y * 2.9 + t * 1.7),
    sin(p.y * 2.1 - p.x * 0.8 - t * 1.1) + 0.6 * sin(p.y * 3.7 + p.x * 3.3 - t * 1.4)
  );
  normal = normalize(normal + mat3(viewMatrix) * vec3(tilt.x, 0.0, tilt.y) * 0.06);
}
`;

/** Glossy water whose normal is tilted by `SHIMMER_FRAGMENT`, driven by one time uniform. */
const createShimmerMaterial = (time: { value: number }) => {
  const material = new THREE.MeshPhongMaterial({
    vertexColors: true,
    shininess: SHININESS,
    specular: new THREE.Color().setScalar(SPECULAR)
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWaterXZ;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWaterXZ = (modelMatrix * vec4(transformed, 1.0)).xz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWaterTime;\nvarying vec2 vWaterXZ;')
      .replace('#include <normal_fragment_maps>', SHIMMER_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'water-shimmer';
  return material;
};

/**
 * The lake: a polar disc at the water level whose rim follows the actual shoreline (found by
 * marching out until the ground clears the water), so the edge sits under the terrain wherever
 * the ground rises within `MAX_RADIUS`. Vertex colours shade from shallow at the edge to deep in the middle.
 * One draw call; animated by a single uniform. A frozen lake is matte Lambert ice: no glint, no shimmer.
 */
export const createWaterLayer = (ctx: WorldContext): WorldLayer | null => {
  const { ground, theme } = ctx;
  const { water } = theme;
  const level = ground.waterLevel;
  if (!water || level === null) return null;

  const shoreRadius = (angle: number) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let r = water.radius * SEARCH_FROM;
    while (r < water.radius * MAX_RADIUS) {
      if (ground.heightAt(water.x + cos * r, water.z + sin * r) > level + SHORE_CLEARANCE_M) break;
      r += SEARCH_STEP_M;
    }
    return Math.min(r + SHORE_MARGIN_M, water.radius * MAX_RADIUS);
  };

  const deep = new THREE.Color(water.color);
  const shallow = new THREE.Color(water.shallow);
  const color = new THREE.Color();
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const vertex = (x: number, z: number) => {
    const depth = level - ground.heightAt(x, z);
    color.lerpColors(shallow, deep, smoothstep(0, water.depth * DEEP_AT, depth));
    positions.push(x, level, z);
    colors.push(color.r, color.g, color.b);
    normals.push(0, 1, 0);
  };

  vertex(water.x, water.z);
  for (let k = 0; k < ANGLES; k++) {
    const angle = (k / ANGLES) * Math.PI * 2;
    const shore = shoreRadius(angle);
    for (const f of RINGS) vertex(water.x + Math.cos(angle) * shore * f, water.z + Math.sin(angle) * shore * f);
  }

  // Vertex (k, ring) lives at 1 + k * RINGS.length + ring.
  const at = (k: number, ring: number) => 1 + (k % ANGLES) * RINGS.length + ring;
  const indices: number[] = [];
  for (let k = 0; k < ANGLES; k++) {
    // Counter-clockwise seen from above (+y): centre, next angle, this angle.
    indices.push(0, at(k + 1, 0), at(k, 0));
    for (let ring = 0; ring + 1 < RINGS.length; ring++) {
      indices.push(at(k, ring), at(k + 1, ring), at(k + 1, ring + 1));
      indices.push(at(k, ring), at(k + 1, ring + 1), at(k, ring + 1));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const time = { value: 0 };
  const material = water.frozen ? new THREE.MeshLambertMaterial({ vertexColors: true }) : createShimmerMaterial(time);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water';
  mesh.matrixAutoUpdate = false;

  const layer: WorldLayer = {
    object: mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    }
  };
  // Ice is static, so it needs no per-frame update.
  if (!water.frozen) {
    layer.update = (_dt, elapsed) => {
      time.value = elapsed;
    };
  }
  return layer;
};
