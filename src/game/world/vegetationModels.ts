import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { lerp, noise2, smoothstep } from './noise';

/**
 * Low-poly vegetation and rocks, built in code. Local frame: +y up, origin on the ground at the
 * base of the trunk, units in metres at roughly real proportions (placement scales them).
 *
 * Every model is non-indexed with per-face normals, so plain MeshLambertMaterial renders it
 * flat-shaded without relying on derivative extensions (the tablet's GLES driver is old).
 *
 * Colour: multi-part models carry two extra attributes.
 * - `color`: the baked vertex colour. Foliage is near-white (a little darker on lower tiers for
 *   depth); bark is its real colour.
 * - `tint`: 1 on foliage, 0 on bark. The sway material only multiplies the per-instance colour
 *   into vertices where tint is 1, so a pine's palette green never muddies its trunk.
 * - `snow` (snowy builds only): how much lying snow a vertex carries, 0–1. Upward-facing foliage
 *   and rock tops get it, thickest at the top of each part, so a pine's tiers read as white caps
 *   over green skirts. The vegetation material mixes the theme's snow colour in by it.
 */

/** Attribute name for the foliage mask; the sway material declares it in its vertex shader. */
export const TINT_ATTRIBUTE = 'tint';

/** Attribute name for the lying-snow weight; declared by the vegetation materials when the theme is snowy. */
export const SNOW_ATTRIBUTE = 'snow';
/** Snow settles on faces whose normal points up by more than FROM (as normal y), fully by FULL. */
const SNOW_FROM_NY = 0.1;
const SNOW_FULL_NY = 0.45;
/** Snow left at the bottom of a part relative to its top, so caps thin out towards the lower edge. */
const SNOW_AT_BASE = 0.15;

/** Bark-free foliage gets the full instance colour; bark keeps its baked colour. */
const FOLIAGE = 1;
const BARK = 0;

/** Converts to non-indexed, drops UVs and recomputes normals so every face is flat. */
const flatten = (geometry: THREE.BufferGeometry) => {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute('uv');
  flat.computeVertexNormals();
  return flat;
};

/** Adds the `snow` weight: up-facing faces, more towards the top of the part, scaled by `mask` (0 = none). */
const snowed = (geometry: THREE.BufferGeometry, mask: number) => {
  const pos = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  geometry.computeBoundingBox();
  const box = geometry.boundingBox as THREE.Box3;
  const span = Math.max(box.max.y - box.min.y, 1e-6);
  const snow = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const up = smoothstep(SNOW_FROM_NY, SNOW_FULL_NY, normal.getY(i));
    snow[i] = mask * up * lerp(SNOW_AT_BASE, 1, (pos.getY(i) - box.min.y) / span);
  }
  geometry.setAttribute(SNOW_ATTRIBUTE, new THREE.BufferAttribute(snow, 1));
  return geometry;
};

/**
 * Flattens a part and paints it with a baked colour and a foliage mask, ready to merge. Snowy
 * parts also get a snow weight (zero on bark), so every part of a model has the same attributes.
 */
const part = (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, tint: number, snowy: boolean) => {
  const flat = flatten(geometry);
  if (snowy) snowed(flat, tint);
  const c = new THREE.Color(color);
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.setAttribute(TINT_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(count).fill(tint), 1));
  return flat;
};

const merge = (parts: THREE.BufferGeometry[]) => {
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('vegetationModels: parts have mismatched attributes');
  merged.computeBoundingSphere();
  return merged;
};

/**
 * Pushes each vertex in or out along its direction from `centre` by seeded noise of its
 * position. Vertices shared between faces sit at the same position, so they move together and
 * the shape stays closed: a lumpy canopy or a boulder rather than a perfect polyhedron.
 */
const lumpy = (geometry: THREE.BufferGeometry, amount: number, seed: number, centre = new THREE.Vector3()) => {
  const pos = geometry.getAttribute('position');
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).sub(centre);
    const n = noise2(p.x * 3.1 + p.y * 1.7 + 11.3, p.z * 3.3 - p.y * 2.3 + 5.9, seed);
    p.multiplyScalar(1 + (n - 0.5) * 2 * amount).add(centre);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  return geometry;
};

/** Open-ended trunk from the ground to `height`; the bottom is buried and the top is hidden in foliage. */
const trunk = (
  radiusBottom: number,
  radiusTop: number,
  height: number,
  color: THREE.ColorRepresentation,
  snowy: boolean
) =>
  part(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 5, 1, true).translate(0, height / 2, 0),
    color,
    BARK,
    snowy
  );

/** Foliage shade: lower tiers sit in their own shadow, so they're baked slightly darker. */
const shade = (k: number) => new THREE.Color(k, k, k);

/** Pine ≈ 9 m: short trunk under three stacked cones. 46 triangles. */
export const buildPineGeometry = (trunkColor: THREE.ColorRepresentation, snowy = false) =>
  merge([
    trunk(0.28, 0.18, 2.2, trunkColor, snowy),
    part(new THREE.ConeGeometry(2.3, 3.6, 6).translate(0, 1.4 + 1.8, 0), shade(0.82), FOLIAGE, snowy),
    part(new THREE.ConeGeometry(1.75, 3.2, 6).rotateY(0.5).translate(0, 3.6 + 1.6, 0), shade(0.91), FOLIAGE, snowy),
    part(new THREE.ConeGeometry(1.1, 2.9, 6).rotateY(1).translate(0, 5.8 + 1.45, 0), shade(1), FOLIAGE, snowy)
  ]);

/** Deciduous ≈ 7 m: trunk under a cluster of three lumpy icosahedra. 70 triangles. */
export const buildLeafyGeometry = (trunkColor: THREE.ColorRepresentation, snowy = false) =>
  merge([
    trunk(0.3, 0.2, 3.2, trunkColor, snowy),
    part(lumpy(new THREE.IcosahedronGeometry(2.2, 0), 0.18, 3).translate(0, 4.6, 0), shade(0.9), FOLIAGE, snowy),
    part(lumpy(new THREE.IcosahedronGeometry(1.5, 0), 0.2, 5).translate(1.2, 5.6, 0.5), shade(1), FOLIAGE, snowy),
    part(lumpy(new THREE.IcosahedronGeometry(1.4, 0), 0.2, 7).translate(-1, 5.3, -0.8), shade(0.96), FOLIAGE, snowy)
  ]);

/** Birch ≈ 8 m: tall slender pale trunk with two small canopies up top. 50 triangles. */
export const buildBirchGeometry = (barkColor: THREE.ColorRepresentation, snowy = false) =>
  merge([
    trunk(0.17, 0.1, 6.4, barkColor, snowy),
    part(lumpy(new THREE.IcosahedronGeometry(1.3, 0), 0.2, 11).translate(0.15, 5.4, 0.1), shade(0.9), FOLIAGE, snowy),
    part(lumpy(new THREE.IcosahedronGeometry(1, 0), 0.2, 13).translate(-0.3, 6.7, -0.15), shade(1), FOLIAGE, snowy)
  ]);

/** Bush ≈ 1.2 m: two squashed icosahedra, half sunk into the ground. 40 triangles. */
export const buildBushGeometry = (snowy = false) =>
  merge([
    part(
      lumpy(new THREE.IcosahedronGeometry(1, 0), 0.2, 17).scale(1, 0.7, 1).translate(0, 0.45, 0),
      shade(0.9),
      FOLIAGE,
      snowy
    ),
    part(
      lumpy(new THREE.IcosahedronGeometry(0.7, 0), 0.2, 19).scale(1, 0.75, 1).translate(0.7, 0.4, 0.3),
      shade(1),
      FOLIAGE,
      snowy
    )
  ]);

/**
 * Boulder ≈ 1 m: a deformed dodecahedron, flattened a little and centred so the lower part sits
 * below ground. One colour, so no vertex colours: the instance colour is the rock colour.
 * 36 triangles.
 */
export const buildRockGeometry = (snowy = false) => {
  const geometry = flatten(lumpy(new THREE.DodecahedronGeometry(0.8, 0), 0.28, 23).scale(1.15, 0.7, 1));
  if (snowy) snowed(geometry, 1);
  geometry.computeBoundingSphere();
  return geometry;
};

/** Triangle count of a non-indexed or indexed geometry. */
export const triangleCount = (geometry: THREE.BufferGeometry) =>
  (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
