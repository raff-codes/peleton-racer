import * as THREE from 'three';

import { mountainsCoverRadius } from './mountains';
import { createRandom, smoothstep } from './noise';
import type { WorldContext, WorldLayer } from './types';

/** Slope where grass gives way to rock, as the face normal's y (cos 30° → cos 42°). */
const ROCK_FROM_NY = 0.86;
const ROCK_FULL_NY = 0.74;
/** Snow fades in over this many metres either side of the snow line, and slides off cliffs. */
const SNOW_BLEND_M = 4;
const SNOW_MIN_NY = 0.6;
/** Per-triangle brightness jitter (±) and how far it nudges the snow line, so nothing reads as banded. */
const JITTER = 0.07;
const SNOW_JITTER_M = 6;

type Painter = (height: number, ny: number, jitter: number, out: THREE.Color) => THREE.Color;

/** Colour for a face from its height above the lowest road point and its steepness. */
const createPainter = (ctx: WorldContext): Painter => {
  const { terrain } = ctx.theme;
  const bands = [...terrain.bands]
    .sort((a, b) => a.height - b.height)
    .map((b) => ({ height: b.height, color: new THREE.Color(b.color) }));
  const rock = new THREE.Color(terrain.rock);
  const snow = new THREE.Color(terrain.snow);
  const first = bands[0];
  const last = bands[bands.length - 1];
  if (!first || !last) throw new Error('Theme needs at least one terrain band');

  return (height, ny, jitter, out) => {
    if (height <= first.height) out.copy(first.color);
    else if (height >= last.height) out.copy(last.color);
    else {
      for (let i = 1; i < bands.length; i++) {
        const hi = bands[i] as (typeof bands)[number];
        if (height > hi.height) continue;
        const lo = bands[i - 1] as (typeof bands)[number];
        out.lerpColors(lo.color, hi.color, (height - lo.height) / (hi.height - lo.height));
        break;
      }
    }
    out.lerp(rock, smoothstep(ROCK_FROM_NY, ROCK_FULL_NY, ny));
    const snowLine = terrain.snowLine + jitter * SNOW_JITTER_M;
    out.lerp(
      snow,
      smoothstep(snowLine - SNOW_BLEND_M, snowLine + SNOW_BLEND_M, height) *
        smoothstep(SNOW_MIN_NY - 0.15, SNOW_MIN_NY, ny)
    );
    return out.multiplyScalar(1 + jitter * JITTER);
  };
};

/**
 * The ground: one flat-shaded grid over the whole terrain square, one draw call.
 *
 * Non-indexed so every triangle carries its own face normal and colour — the low-poly look.
 * Normals are baked rather than using `flatShading`, which derives them per pixel with dFdx/dFdy
 * and shimmers on mediump mobile GPUs at these coordinates. Cells wholly outside the mountain
 * ring's cover radius (the square's corners) are skipped: the foothills hide them anyway.
 */
export const createTerrainLayer = (ctx: WorldContext): WorldLayer => {
  const { ground, quality, theme } = ctx;
  const n = quality.terrainCells;
  const stride = n + 1;
  const step = (ground.extent * 2) / n;
  const coordAt = (i: number) => -ground.extent + i * step;

  const heights = new Float32Array(stride * stride);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) heights[j * stride + i] = ground.heightAt(coordAt(i), coordAt(j));
  }
  const heightOf = (i: number, j: number) => heights[j * stride + i] as number;

  // A cell is kept if its nearest point to the origin is inside the cover radius.
  const cover = mountainsCoverRadius(ground.extent);
  const halfDiagonal = step * Math.SQRT1_2;
  const kept: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(coordAt(i) + step / 2, coordAt(j) + step / 2);
      if (r - halfDiagonal < cover) kept.push(j * n + i);
    }
  }

  const positions = new Float32Array(kept.length * 18);
  const normals = new Float32Array(kept.length * 18);
  const colors = new Float32Array(kept.length * 18);
  const paint = createPainter(ctx);
  const random = createRandom(theme.seed ^ 0x7e11a1);
  const color = new THREE.Color();
  let o = 0;

  /** Appends triangle (a, b, c), given as grid coordinates, with its face normal and colour. */
  const triangle = (ai: number, aj: number, bi: number, bj: number, ci: number, cj: number) => {
    const ax = coordAt(ai);
    const ay = heightOf(ai, aj);
    const az = coordAt(aj);
    const bx = coordAt(bi);
    const by = heightOf(bi, bj);
    const bz = coordAt(bj);
    const cx = coordAt(ci);
    const cy = heightOf(ci, cj);
    const cz = coordAt(cj);
    // Face normal = (c - a) × (b - a), wound so it points up.
    let nx = (cy - ay) * (bz - az) - (cz - az) * (by - ay);
    let ny = (cz - az) * (bx - ax) - (cx - ax) * (bz - az);
    let nz = (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    paint((ay + by + cy) / 3 - ground.baseY, ny, random() * 2 - 1, color);
    // Counter-clockwise seen from above: a, c, b.
    vertex(ax, ay, az, nx, ny, nz);
    vertex(cx, cy, cz, nx, ny, nz);
    vertex(bx, by, bz, nx, ny, nz);
  };

  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = z;
    normals[o] = nx;
    normals[o + 1] = ny;
    normals[o + 2] = nz;
    colors[o] = color.r;
    colors[o + 1] = color.g;
    colors[o + 2] = color.b;
    o += 3;
  };

  for (const cell of kept) {
    const i = cell % n;
    const j = (cell - i) / n;
    // Alternate the diagonal so the facets don't all lean the same way.
    if ((i + j) % 2 === 0) {
      triangle(i, j, i + 1, j, i + 1, j + 1);
      triangle(i, j, i + 1, j + 1, i, j + 1);
    } else {
      triangle(i, j, i + 1, j, i, j + 1);
      triangle(i + 1, j, i + 1, j + 1, i, j + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.matrixAutoUpdate = false;

  return {
    object: mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    }
  };
};
