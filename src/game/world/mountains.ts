import * as THREE from 'three';

import { createRandom, lerp, noise2, ridged, smoothstep } from './noise';
import type { WorldContext, WorldLayer } from './types';

/**
 * Foothill radii as fractions of the terrain extent. The ring starts tucked under the terrain
 * (FOOT) and is clear above it by SHOULDER, so the terrain beyond `mountainsCoverRadius` is hidden.
 */
const FOOT = 0.93;
const SHOULDER = 1.04;
/** How far below the terrain the foot sits, and how far above it the shoulder rises, m. */
const FOOT_TUCK_M = 12;
const SHOULDER_RISE_M = 30;
/** Extra cover margin beyond the shoulder before terrain cells can be dropped. */
const COVER_MARGIN = 0.01;
/** Base colour blends from the terrain's top band to mountain rock over this rise above the shoulder, m. */
const ROCK_BLEND_M = 80;
/** Albedo pre-tinted towards the haze colour; the far ridge gets more. */
const HAZE_TINT = [0.2, 0.32];
/**
 * Scene fog is capped per vertex: full at the foot (so it matches the fogged terrain it meets)
 * easing to this at the peaks (so the ring isn't fogged out at 1.5–1.9 km).
 */
const PEAK_FOG_CAP = [0.5, 0.6];
const JITTER = 0.06;
const SNOW_JITTER_FRACTION = 0.05;
const SNOW_MIN_NY = 0.45;

/** Radius beyond which the mountain ring is above the terrain everywhere. Terrain can be culled past it. */
export const mountainsCoverRadius = (extent: number) => extent * (SHOULDER + COVER_MARGIN);

type Row = { radius: number; height: number };
/** Builds the rows (inner → outer) of one ridge column; heights are above `baseY`. */
type RidgeProfile = (crest: number, detail: number, terrainEdge: number) => Row[];

type Ridge = { profile: RidgeProfile; frequency: number; layer: 0 | 1 };

/**
 * The two ranges: a front range rising out of the terrain's foothills, and taller snowy peaks
 * behind it whose foot hides behind the front range.
 */
const ridges = (ctx: WorldContext): Ridge[] => {
  const { radius: R, depth: D, height: H } = ctx.theme.mountains;
  const e = ctx.ground.extent;
  return [
    {
      frequency: 5,
      layer: 0,
      profile: (crest, detail, edge) => [
        { radius: e * FOOT, height: edge - FOOT_TUCK_M },
        { radius: e * SHOULDER, height: edge + SHOULDER_RISE_M + (detail + 1) * 20 },
        { radius: R - D * 0.32 + detail * 30, height: lerp(edge + 60, H * (0.2 + 0.42 * crest), 0.55) },
        { radius: R - D * 0.18, height: H * (0.2 + 0.42 * crest) },
        { radius: R + D * 0.05, height: H * (0.12 + 0.2 * crest) }
      ]
    },
    {
      frequency: 3.2,
      layer: 1,
      profile: (crest, detail) => [
        { radius: R - D * 0.3, height: H * 0.15 },
        { radius: R + D * 0.02 + detail * 40, height: H * (0.3 + 0.35 * crest) + detail * 30 },
        { radius: R + D * 0.25, height: H * (0.35 + 0.65 * crest) },
        { radius: R + D * 0.5, height: H * (0.2 + 0.3 * crest) }
      ]
    }
  ];
};

/**
 * Distant mountain ring: two jagged ridges of flat-shaded triangles merged into one mesh, one
 * draw call. Silhouettes come from ridged noise sampled around a circle so the ring wraps
 * seamlessly.
 *
 * Atmospheric perspective comes from two things: the albedo is pre-tinted towards the haze
 * colour, and the scene fog is capped per vertex (a small shader patch) — fully fogged at the
 * foot, where the ring meets the equally fogged terrain, and only partly at the peaks.
 */
export const createMountainsLayer = (ctx: WorldContext): WorldLayer => {
  const { ground, quality, theme } = ctx;
  const { mountains } = theme;
  const segments = quality.mountainSegments;
  const H = mountains.height;
  const lastBand = theme.terrain.bands.reduce((a, b) => (b.height > a.height ? b : a));
  const foothill = new THREE.Color(lastBand.color);
  const rock = new THREE.Color(mountains.base);
  const snow = new THREE.Color(mountains.snow);
  const haze = new THREE.Color(mountains.haze);
  const random = createRandom(theme.seed ^ 0x3a7c9);
  const cover = mountainsCoverRadius(ground.extent);

  const positions: number[] = [];
  const colors: number[] = [];
  const fogCaps: number[] = [];
  const color = new THREE.Color();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (const ridge of ridges(ctx)) {
    const seed = theme.seed + 101 * (ridge.layer + 1);
    // Column angles get a little jitter so the facets don't read as a regular fan.
    const jitter = Array.from({ length: segments }, () => (random() - 0.5) * 0.6);
    const columns: THREE.Vector3[][] = [];
    for (let col = 0; col <= segments; col++) {
      const k = col % segments;
      const angle = ((k + (jitter[k] as number)) / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const crest = ridged(cos * ridge.frequency, sin * ridge.frequency, 4, seed) ** mountains.sharpness;
      const detail = noise2(cos * 14 + 3.1, sin * 14 - 1.7, seed + 7) * 2 - 1;
      // Highest ground the shoulder has to clear (the square's corners reach past the extent).
      const edge =
        Math.max(ground.heightAt(cos * ground.extent, sin * ground.extent), ground.heightAt(cos * cover, sin * cover)) -
        ground.baseY;
      columns.push(
        ridge
          .profile(crest, detail, edge)
          .map((row) => new THREE.Vector3(cos * row.radius, ground.baseY + row.height, sin * row.radius))
      );
    }

    const tint = HAZE_TINT[ridge.layer] as number;
    const peakCap = PEAK_FOG_CAP[ridge.layer] as number;
    const footHeight = (columns[0]?.[0]?.y ?? ground.baseY) - ground.baseY;

    const face = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => {
      a.copy(p);
      b.copy(q);
      c.copy(r);
      const ny = ab.subVectors(b, a).cross(ac.subVectors(c, a)).normalize().y;
      const height = (a.y + b.y + c.y) / 3 - ground.baseY;
      const j = random() * 2 - 1;
      color.lerpColors(foothill, rock, smoothstep(footHeight, footHeight + ROCK_BLEND_M, height));
      const snowLine = H * (mountains.snowLine + j * SNOW_JITTER_FRACTION);
      if (height > snowLine && ny > SNOW_MIN_NY) color.copy(snow);
      color.lerp(haze, tint).multiplyScalar(1 + j * JITTER);
      for (const v of [a, b, c]) {
        positions.push(v.x, v.y, v.z);
        colors.push(color.r, color.g, color.b);
        fogCaps.push(lerp(1, peakCap, smoothstep(footHeight, H * 0.7, v.y - ground.baseY)));
      }
    };

    for (let col = 0; col < segments; col++) {
      const left = columns[col] as THREE.Vector3[];
      const right = columns[col + 1] as THREE.Vector3[];
      for (let row = 0; row + 1 < left.length; row++) {
        const p00 = left[row] as THREE.Vector3;
        const p01 = left[row + 1] as THREE.Vector3;
        const p10 = right[row] as THREE.Vector3;
        const p11 = right[row + 1] as THREE.Vector3;
        // Faces point inwards (towards the course), counter-clockwise seen from the origin.
        face(p00, p11, p01);
        face(p00, p10, p11);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('fogCap', new THREE.Float32BufferAttribute(fogCaps, 1));
  // Non-indexed, so these are face normals: the flat-shaded look without dFdx/dFdy.
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float fogCap;\nvarying float vFogCap;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvFogCap = fogCap;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFogCap;')
      .replace(
        '#include <fog_fragment>',
        THREE.ShaderChunk.fog_fragment.replace('fogColor, fogFactor', 'fogColor, min( fogFactor, vFogCap )')
      );
  };
  material.customProgramCacheKey = () => 'mountains-fog-cap';

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'mountains';
  mesh.matrixAutoUpdate = false;

  return {
    object: mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    }
  };
};
