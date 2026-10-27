import type { Track, TrackPoint } from '../track';
import { fbm, lerp, smoothstep } from './noise';
import type { RoadQuery } from './roadQuery';
import type { Theme } from './theme';
import { ROAD_WIDTH } from './types';

export type HeightField = {
  /** Ground height at a point. Near the road it meets the road surface; elsewhere it's natural terrain. */
  heightAt: (x: number, z: number) => number;
  /** Lowest road point; theme heights (bands, snow line, mountains) are relative to this */
  baseY: number;
  /** Half-size of the terrain square, m */
  extent: number;
  /** Water surface height, or null if the theme has no lake */
  waterLevel: number | null;
  /** True where the point is under water (for keeping trees and props out of the lake) */
  isWater: (x: number, z: number) => boolean;
};

/** Terrain sits this far below the road surface so the ground never pokes through the road. */
const ROAD_SINK_M = 0.35;
/** Flat shoulder either side of the road before the ground starts blending back to natural. */
const SHOULDER_M = 1.5;
/**
 * Distance from the shoulder over which the ground blends from road height to natural, m. Ground
 * above the road is cut back steeply (a rocky cutting); ground below falls away on a gentle bank.
 */
const CUT_BLEND_M = 12;
const FILL_BLEND_M = 30;
/** Height difference (m) over which the blend eases from cut to fill, so the ground has no seam where they meet. */
const CUT_FILL_EASE_M = 3;

/**
 * The land around the road follows its height, so a climb runs up a hillside rather than through
 * a trench. A coarse grid holds, per cell, a Gaussian-weighted average of nearby road heights and
 * the distance to the road; the natural terrain is lifted by that average close to the road and
 * its noise hills are calmed there, fading back to fully natural further out.
 */
const RELIEF_CELL_M = 20;
const RELIEF_SIGMA_M = 45;
/** Every n-th track point is enough for a field this smooth. */
const RELIEF_POINT_STRIDE = 3;
const RELIEF_FADE = { start: 60, end: 260 };
/** Noise hills are scaled down to this share at the road, back to full by `end` m away. */
const CALM_HILLS = { share: 0.35, start: 15, end: 150 };

type Relief = { lift: (x: number, z: number) => number; distance: (x: number, z: number) => number };

const createRelief = (track: Track, extent: number, baseY: number): Relief => {
  const cells = Math.ceil((extent * 2) / RELIEF_CELL_M) + 1;
  const lift = new Float32Array(cells * cells);
  const distance = new Float32Array(cells * cells);
  const points = track.points.filter((_, i) => i % RELIEF_POINT_STRIDE === 0);
  const inv2Sigma2 = 1 / (2 * RELIEF_SIGMA_M * RELIEF_SIGMA_M);

  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const x = -extent + i * RELIEF_CELL_M;
      const z = -extent + j * RELIEF_CELL_M;
      let weights = 0;
      let heights = 0;
      let nearest2 = Number.POSITIVE_INFINITY;
      for (const p of points as TrackPoint[]) {
        const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d2 < nearest2) nearest2 = d2;
        const w = Math.exp(-d2 * inv2Sigma2);
        weights += w;
        heights += w * (p.y - baseY);
      }
      const nearest = Math.sqrt(nearest2);
      distance[j * cells + i] = nearest;
      lift[j * cells + i] =
        weights > 1e-6 ? (heights / weights) * (1 - smoothstep(RELIEF_FADE.start, RELIEF_FADE.end, nearest)) : 0;
    }
  }

  const sample = (grid: Float32Array) => (x: number, z: number) => {
    const fx = Math.min(cells - 1.001, Math.max(0, (x + extent) / RELIEF_CELL_M));
    const fz = Math.min(cells - 1.001, Math.max(0, (z + extent) / RELIEF_CELL_M));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const at = (di: number, dj: number) => grid[(j + dj) * cells + i + di] as number;
    return lerp(lerp(at(0, 0), at(1, 0), tx), lerp(at(0, 1), at(1, 1), tx), tz);
  };
  return { lift: sample(lift), distance: sample(distance) };
};

export const createHeightField = (track: Track, theme: Theme, road: RoadQuery): HeightField => {
  const { terrain, water, seed } = theme;
  const baseY = track.minY;
  const groundBase = baseY - 4;
  const waterLevel = water ? groundBase - 1 : null;
  const relief = createRelief(track, terrain.extent, baseY);

  const natural = (x: number, z: number) => {
    const calm = lerp(CALM_HILLS.share, 1, smoothstep(CALM_HILLS.start, CALM_HILLS.end, relief.distance(x, z)));
    const hills = (fbm(x / terrain.hillScale, z / terrain.hillScale, 4, seed) - 0.5) * 2 * terrain.hillAmplitude * calm;
    const r = Math.hypot(x, z);
    const rise = smoothstep(terrain.edgeRise.start, terrain.edgeRise.end, r) * terrain.edgeRise.height;
    let h = groundBase + hills + rise + relief.lift(x, z);
    if (water && waterLevel !== null) {
      const d = Math.hypot(x - water.x, z - water.z);
      // Lift the land around the lake above water level so the shore is a bank, not a flooded valley.
      h = Math.max(h, lerp(h, waterLevel + 2, smoothstep(water.radius * 2, water.radius * 1.2, d)));
      const bowl = smoothstep(water.radius * 1.35, water.radius * 0.55, d);
      h = lerp(h, waterLevel - water.depth, bowl);
    }
    return h;
  };

  const edge = ROAD_WIDTH / 2 + SHOULDER_M;
  const heightAt = (x: number, z: number) => {
    const h = natural(x, z);
    const passes = road.passes(x, z);
    if (passes.length === 0) return h;
    // Each nearby pass pulls the ground to its height; where two passes overlap (between a
    // switchback's legs) the ground eases between them instead of stepping at the midline. The
    // inverse-square weight from each shoulder keeps the ground at a road on that road's height.
    let pull = 0;
    let weights = 0;
    let heights = 0;
    for (const pass of passes) {
      const roadY = pass.y - ROAD_SINK_M;
      const blend = lerp(CUT_BLEND_M, FILL_BLEND_M, smoothstep(-CUT_FILL_EASE_M, CUT_FILL_EASE_M, roadY - h));
      const w = 1 - smoothstep(edge, edge + blend, pass.distance);
      if (w <= 0) continue;
      const weight = w / (Math.max(0, pass.distance - edge) + 1) ** 2;
      weights += weight;
      heights += weight * roadY;
      pull = Math.max(pull, w);
    }
    return weights > 0 ? lerp(h, heights / weights, pull) : h;
  };

  const isWater = (x: number, z: number) =>
    waterLevel !== null &&
    water !== null &&
    Math.hypot(x - water.x, z - water.z) < water.radius * 1.05 &&
    heightAt(x, z) < waterLevel + 0.2;

  return { heightAt, baseY, extent: terrain.extent, waterLevel, isWater };
};
