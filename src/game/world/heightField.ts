import type { Track } from '../track';
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
/** Distance from the road edge over which the ground blends from road height to natural. */
const BLEND_M = 30;

export const createHeightField = (track: Track, theme: Theme, road: RoadQuery): HeightField => {
  const { terrain, water, seed } = theme;
  const baseY = track.minY;
  const groundBase = baseY - 4;
  const waterLevel = water ? groundBase - 1 : null;

  const natural = (x: number, z: number) => {
    const hills = (fbm(x / terrain.hillScale, z / terrain.hillScale, 4, seed) - 0.5) * 2 * terrain.hillAmplitude;
    const r = Math.hypot(x, z);
    const rise = smoothstep(terrain.edgeRise.start, terrain.edgeRise.end, r) * terrain.edgeRise.height;
    let h = groundBase + hills + rise;
    if (water && waterLevel !== null) {
      const d = Math.hypot(x - water.x, z - water.z);
      // Lift the land around the lake above water level so the shore is a bank, not a flooded valley.
      h = Math.max(h, lerp(h, waterLevel + 2, smoothstep(water.radius * 2, water.radius * 1.2, d)));
      const bowl = smoothstep(water.radius * 1.35, water.radius * 0.55, d);
      h = lerp(h, waterLevel - water.depth, bowl);
    }
    return h;
  };

  const heightAt = (x: number, z: number) => {
    const h = natural(x, z);
    const hit = road.nearest(x, z);
    if (!hit) return h;
    const t = smoothstep(ROAD_WIDTH / 2 + SHOULDER_M, ROAD_WIDTH / 2 + SHOULDER_M + BLEND_M, hit.distance);
    return lerp(hit.y - ROAD_SINK_M, h, t);
  };

  const isWater = (x: number, z: number) =>
    waterLevel !== null &&
    water !== null &&
    Math.hypot(x - water.x, z - water.z) < water.radius * 1.05 &&
    heightAt(x, z) < waterLevel + 0.2;

  return { heightAt, baseY, extent: terrain.extent, waterLevel, isWater };
};
