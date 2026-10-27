import * as THREE from 'three';

import type { WorldContext, WorldLayer } from './types';

/** Something standing on the ground that should cast a soft shadow (tree, rock, bale, fan): its base, footprint and height, m. */
export type ShadowCaster = { x: number; y: number; z: number; radius: number; height: number };

/** A shadow is at least this long (sun overhead), and at most this many times its caster's height (sun low). */
const MIN_LENGTH_RADII = 2;
const MAX_LENGTH_HEIGHTS = 3.5;
/** Darkness at the base for a theme lit only by its sun; scaled by the sun's share of the light. */
const OPACITY = 0.7;
/** Lifted off the ground (polygonOffset does the rest) and starts this far back under the caster. */
const LIFT_M = 0.06;
const UNDERLAP_RADII = 0.6;

// Scratch for composing instance matrices.
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();
const basis = new THREE.Matrix4();
const across = new THREE.Vector3();
const along = new THREE.Vector3();
const normal = new THREE.Vector3();

/**
 * Soft ground shadows for every caster other layers registered in `ctx.shadows` (trees, rocks,
 * bales, fans): one instanced quad each, one draw call. No shadow maps; each is an ellipse that fades
 * towards its tip, stretched away from the theme's sun by height / tan(sun elevation), and
 * tilted to the ground along its length so it neither floats nor sinks on a slope.
 *
 * Must be built after the layers that add casters.
 */
export const createGroundShadowsLayer = (ctx: WorldContext): WorldLayer | null => {
  const { shadows, ground, theme } = ctx;
  if (shadows.length === 0) return null;

  const [sx, sy, sz] = theme.sky.sunDirection;
  const horizontal = Math.hypot(sx, sz) || 1;
  // Shadows fall away from the sun.
  const awayX = -sx / horizontal;
  const awayZ = -sz / horizontal;
  const perHeight = Math.min(MAX_LENGTH_HEIGHTS, horizontal / Math.max(1e-3, sy));
  const { sunIntensity, hemiIntensity } = theme.light;
  const opacity = OPACITY * (sunIntensity / (sunIntensity + hemiIntensity));

  // A unit quad in xz: x across the shadow (−0.5..0.5), z along it (0 at the caster, 1 at the tip).
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
  const material = new THREE.MeshBasicMaterial({
    color: '#000000',
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vShadowUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShadowUv = vec2(position.x * 2.0, position.z);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vShadowUv;')
      .replace(
        '#include <opaque_fragment>',
        // Ellipse falloff, densest just past the caster and fading towards the tip.
        `float shadowR = length(vec2(vShadowUv.x, vShadowUv.y * 2.0 - 1.0));
diffuseColor.a *= (1.0 - smoothstep(0.45, 1.0, shadowR)) * mix(1.0, 0.5, vShadowUv.y);
#include <opaque_fragment>`
      );
  };
  material.customProgramCacheKey = () => 'ground-shadow';

  const mesh = new THREE.InstancedMesh(geometry, material, shadows.length);
  mesh.name = 'ground-shadows';
  shadows.forEach((c, i) => {
    const length = Math.max(c.radius * MIN_LENGTH_RADII, c.height * perHeight);
    const back = c.radius * UNDERLAP_RADII;
    const x0 = c.x - awayX * back;
    const z0 = c.z - awayZ * back;
    const x1 = x0 + awayX * length;
    const z1 = z0 + awayZ * length;
    const y0 = ground.heightAt(x0, z0) + LIFT_M;
    const y1 = ground.heightAt(x1, z1) + LIFT_M;
    // Local z along the ground towards the tip, x across it, y their normal.
    along.set(x1 - x0, y1 - y0, z1 - z0);
    const span = along.length();
    along.divideScalar(span);
    across.set(awayZ, 0, -awayX);
    normal.crossVectors(along, across).normalize();
    across.crossVectors(normal, along);
    rotation.setFromRotationMatrix(basis.makeBasis(across, normal, along));
    mesh.setMatrixAt(i, matrix.compose(position.set(x0, y0, z0), rotation, scale.set(c.radius * 2, 1, span)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  // After the ground and the road, before anything else transparent.
  mesh.renderOrder = 1;

  return {
    object: mesh,
    dispose: () => {
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    }
  };
};
