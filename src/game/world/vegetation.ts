import * as THREE from 'three';

import { poseAt } from '../track';
import { clearOfLandmarks } from './landmarks';
import { createRandom, fbm, lerp, smoothstep } from './noise';
import { ROAD_WIDTH, type WorldContext, type WorldLayer } from './types';
import {
  buildBirchGeometry,
  buildBushGeometry,
  buildLeafyGeometry,
  buildPineGeometry,
  buildRockGeometry,
  SNOW_ATTRIBUTE,
  TINT_ATTRIBUTE
} from './vegetationModels';

/**
 * Trees, bushes and rocks. One InstancedMesh per model (5 draw calls), placed once from seeded
 * noise so every ride sees the same forest. The theme weights the species mix and, for winter,
 * lays snow on upward-facing foliage and rock tops (a vertex weight, so no extra draw calls).
 */

/** Nothing closer than this to the road centre line, m: the road edge plus a clear verge. */
const ROAD_CLEAR_M = ROAD_WIDTH / 2 + 4;
/** Keep clear of the finish gantry: this far along the track either side of the line, and this close to the road. */
const GANTRY_ALONG_M = 25;
const GANTRY_LATERAL_M = 20;
/** Rocks favour altitude, reaching their full altitude bias this far (m) above the tree line. */
const ROCK_ALTITUDE_ABOVE_TREELINE_M = 15;
/** Density fades out between these radii (m), where the foothills rise into the mountain ring. */
const EDGE_FADE = { start: 760, end: 980 };
/** Chance of keeping a candidate outside a forest patch: the odd lone tree in a meadow. */
const MEADOW_TREE_CHANCE = 0.05;
/** Share of trees deliberately clumped 9–20 m from the road, so scenery whips past close by. */
const ROADSIDE_SHARE = 0.12;
const ROADSIDE_LATERAL = { min: ROAD_CLEAR_M + 0.5, max: 20 };
/** Max ground gradient (rise/run) a tree or bush stands on; rocks tolerate steeper ground. */
const MAX_TREE_SLOPE = 0.65;
const MAX_ROCK_SLOPE = 1.2;
/** Horizontal step (m) used to estimate slope from height samples. */
const SLOPE_STEP_M = 2;
/** Lake shore band (multiples of the lake radius) where broadleaf trees take over. */
const SHORE_RADII = 1.9;
/** Gives up on a type after this many candidates per wanted instance (keeps build time bounded). */
const ATTEMPTS_PER_INSTANCE = 40;
/** Max lean from vertical, radians (~4°). */
const MAX_LEAN = 0.07;

/** Wind: sideways displacement = WIND_STRENGTH × (local height)², so trunk bases stay put. */
const WIND_STRENGTH = 0.0028;
const WIND_SPEED = 1.3;

type Kind = 'pine' | 'leafy' | 'birch' | 'bush' | 'rock';

type Spot = { x: number; z: number; y: number; slope: number };

type Placement = { x: number; y: number; z: number; yaw: number; scale: THREE.Vector3; color: THREE.Color };

/** Lying snow, as shared uniforms: the theme's snow colour and amount. */
type SnowUniforms = { uSnowColor: { value: THREE.Color }; uSnowAmount: { value: number } };

/** GLSL that whitens a vertex by its `snow` weight; runs after the instance tint, so snow stays white. */
const SNOW_VERTEX = `vColor.rgb = mix(vColor.rgb, uSnowColor, ${SNOW_ATTRIBUTE} * uSnowAmount);`;
const SNOW_DECLARATIONS = `uniform vec3 uSnowColor;\nuniform float uSnowAmount;\nattribute float ${SNOW_ATTRIBUTE};`;

// Scratch objects for composing instance matrices.
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const lean = new THREE.Quaternion();
const yawQ = new THREE.Quaternion();
const axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Lambert with gentle wind sway. Vertices bend sideways by a sine of time and the instance's
 * world position (so neighbours aren't in lockstep), weighted by local height squared. Also
 * multiplies the instance colour only into foliage (see TINT_ATTRIBUTE) so trunks keep their colour.
 */
const createSwayMaterial = (uTime: { value: number }, snow: SnowUniforms | null) => {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    if (snow) Object.assign(shader.uniforms, snow);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;\nattribute float ${TINT_ATTRIBUTE};\n${snow ? SNOW_DECLARATIONS : ''}`
      )
      .replace(
        '#include <color_vertex>',
        THREE.ShaderChunk.color_vertex.replace(
          'vColor.rgb *= instanceColor.rgb;',
          `vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, ${TINT_ATTRIBUTE});\n${snow ? SNOW_VERTEX : ''}`
        )
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 swayOrigin = instanceMatrix[3].xyz;
  float swayPhase = uTime * ${WIND_SPEED.toFixed(3)} + swayOrigin.x * 0.045 + swayOrigin.z * 0.06;
  float swayWeight = ${WIND_STRENGTH.toFixed(5)} * position.y * position.y;
  transformed.x += sin(swayPhase) * swayWeight;
  transformed.z += sin(swayPhase * 0.83 + 1.7) * swayWeight * 0.6;
#endif`
      );
  };
  material.customProgramCacheKey = () => (snow ? 'vegetation-sway-snow' : 'vegetation-sway');
  return material;
};

/** Plain Lambert for rocks (colour from the instance); with snow, their tops whiten too. */
const createRockMaterial = (snow: SnowUniforms | null) => {
  const material = new THREE.MeshLambertMaterial();
  if (!snow) return material;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, snow);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SNOW_DECLARATIONS}`)
      .replace('#include <color_vertex>', `#include <color_vertex>\n${SNOW_VERTEX}`);
  };
  material.customProgramCacheKey = () => 'vegetation-rock-snow';
  return material;
};

const pick = <T>(list: readonly T[], random: () => number): T => {
  const item = list[Math.floor(random() * list.length)];
  if (item === undefined) throw new Error('vegetation: empty palette');
  return item;
};

/** A palette colour with a little brightness and hue jitter, so no two trees match exactly. */
const jittered = (palette: readonly string[], random: () => number, brightness = 0.08) =>
  new THREE.Color(pick(palette, random)).offsetHSL((random() - 0.5) * 0.02, 0, (random() - 0.5) * brightness);

export const createVegetationLayer = (ctx: WorldContext): WorldLayer => {
  const { track, theme, quality, road, ground } = ctx;
  const veg = theme.vegetation;
  const water = theme.water;
  const { treeline, species } = veg;
  const extent = ground.extent * 0.98;

  const forestDensity = (x: number, z: number) => fbm(x / veg.forestScale, z / veg.forestScale, 3, theme.seed + 101);

  /** Ground point if a model may stand at (x, z), else null. All the hard exclusions live here. */
  const spotAt = (x: number, z: number, maxSlope: number, maxHeight: number): Spot | null => {
    if (Math.abs(x) > extent || Math.abs(z) > extent) return null;
    const hit = road.nearest(x, z);
    if (hit) {
      if (hit.distance < ROAD_CLEAR_M) return null;
      const nearLine = hit.along < GANTRY_ALONG_M || hit.along > track.length - GANTRY_ALONG_M;
      if (nearLine && hit.distance < GANTRY_LATERAL_M) return null;
    }
    if (!clearOfLandmarks(ctx.landmarks, x, z)) return null;
    const y = ground.heightAt(x, z);
    if (y - ground.baseY > maxHeight) return null;
    if (ground.isWater(x, z)) return null;
    const gx = ground.heightAt(x + SLOPE_STEP_M, z) - y;
    const gz = ground.heightAt(x, z + SLOPE_STEP_M) - y;
    const slope = Math.hypot(gx, gz) / SLOPE_STEP_M;
    if (slope > maxSlope) return null;
    return { x, z, y, slope };
  };

  /** Chance of keeping a candidate from the density map alone: forest patches, meadows, fading edges. */
  const edgeKeep = (x: number, z: number) => 1 - smoothstep(EDGE_FADE.start, EDGE_FADE.end, Math.hypot(x, z));

  /** Which tree grows here: pines high up, broadleaf low down and around the lake. */
  const treeKind = (spot: Spot, random: () => number): Kind => {
    const altitude = smoothstep(0.1, 0.75, (spot.y - ground.baseY) / treeline);
    let shore = 0;
    if (water) {
      const d = Math.hypot(spot.x - water.x, spot.z - water.z) / water.radius;
      shore = smoothstep(SHORE_RADII, 1.1, d);
    }
    const pineChance = lerp(lerp(0.4, 0.95, altitude), 0.1, shore);
    const leafyShare = lerp(0.6, 0.45, shore);
    // The theme's species weights scale each natural share; still two draws, renormalised.
    const pine = pineChance * species.pine;
    const leafy = (1 - pineChance) * leafyShare * species.leafy;
    const birch = (1 - pineChance) * (1 - leafyShare) * species.birch;
    if (random() < pine / (pine + leafy + birch)) return 'pine';
    return random() < leafy / (leafy + birch) ? 'leafy' : 'birch';
  };

  const placements: Record<Kind, Placement[]> = { pine: [], leafy: [], birch: [], bush: [], rock: [] };

  const addTree = (spot: Spot, kind: Kind, random: () => number) => {
    const s = lerp(0.75, 1.3, random());
    placements[kind].push({
      x: spot.x,
      // Sink the base so the downhill side of the trunk doesn't float.
      y: spot.y - 0.25 - spot.slope * 0.4,
      z: spot.z,
      yaw: random() * Math.PI * 2,
      scale: new THREE.Vector3(s, s * lerp(0.9, 1.15, random()), s),
      color: jittered(kind === 'pine' ? veg.pine : kind === 'leafy' ? veg.leafy : veg.birchLeaf, random)
    });
  };

  // Trees: clumps hugging the road, then forests and lone meadow trees over the whole map.
  const treeRandom = createRandom(theme.seed + 1);
  const treeTotal = () => placements.pine.length + placements.leafy.length + placements.birch.length;
  const roadsideTarget = Math.round(quality.trees * ROADSIDE_SHARE);
  for (let attempt = 0; attempt < roadsideTarget * 10 && treeTotal() < roadsideTarget; attempt++) {
    const pose = poseAt(track, treeRandom() * track.length);
    const side = treeRandom() < 0.5 ? -1 : 1;
    const clump = 2 + Math.floor(treeRandom() * 4);
    for (let i = 0; i < clump; i++) {
      const lateral = side * lerp(ROADSIDE_LATERAL.min, ROADSIDE_LATERAL.max, treeRandom());
      const ahead = (treeRandom() - 0.5) * 16;
      const x = pose.x + pose.dirX * ahead - pose.dirZ * lateral;
      const z = pose.z + pose.dirZ * ahead + pose.dirX * lateral;
      const spot = spotAt(x, z, MAX_TREE_SLOPE, treeline);
      if (spot) addTree(spot, treeKind(spot, treeRandom), treeRandom);
    }
  }
  for (let attempt = 0; attempt < quality.trees * ATTEMPTS_PER_INSTANCE && treeTotal() < quality.trees; attempt++) {
    const x = (treeRandom() * 2 - 1) * extent;
    const z = (treeRandom() * 2 - 1) * extent;
    const inForest = forestDensity(x, z) > veg.forestThreshold;
    if (treeRandom() > edgeKeep(x, z) * (inForest ? 1 : MEADOW_TREE_CHANCE)) continue;
    const spot = spotAt(x, z, MAX_TREE_SLOPE, treeline);
    if (spot) addTree(spot, treeKind(spot, treeRandom), treeRandom);
  }

  // Bushes: thickest at forest edges, scattered through meadows.
  const bushRandom = createRandom(theme.seed + 2);
  const bushTarget = Math.round(quality.bushes * veg.bushDensity);
  for (let attempt = 0; attempt < bushTarget * ATTEMPTS_PER_INSTANCE; attempt++) {
    if (placements.bush.length >= bushTarget) break;
    const x = (bushRandom() * 2 - 1) * extent;
    const z = (bushRandom() * 2 - 1) * extent;
    const forest = forestDensity(x, z);
    const edge = 1 - Math.min(1, Math.abs(forest - veg.forestThreshold) * 12);
    if (bushRandom() > edgeKeep(x, z) * Math.max(0.15, edge)) continue;
    const spot = spotAt(x, z, MAX_TREE_SLOPE, treeline + 8);
    if (!spot) continue;
    const s = lerp(0.6, 1.4, bushRandom());
    placements.bush.push({
      x,
      y: spot.y - 0.15 - spot.slope * 0.3,
      z,
      yaw: bushRandom() * Math.PI * 2,
      scale: new THREE.Vector3(s * lerp(0.85, 1.2, bushRandom()), s * lerp(0.8, 1.1, bushRandom()), s),
      color: jittered(veg.bush, bushRandom)
    });
  }

  // Rocks: anywhere dry, favouring higher and steeper ground; non-uniform scale gives each a different shape.
  const rockRandom = createRandom(theme.seed + 3);
  const rockTarget = Math.round(quality.rocks * veg.rockDensity);
  const rockAltitude = treeline + ROCK_ALTITUDE_ABOVE_TREELINE_M;
  for (let attempt = 0; attempt < rockTarget * ATTEMPTS_PER_INSTANCE; attempt++) {
    if (placements.rock.length >= rockTarget) break;
    const x = (rockRandom() * 2 - 1) * extent;
    const z = (rockRandom() * 2 - 1) * extent;
    const spot = spotAt(x, z, MAX_ROCK_SLOPE, Number.POSITIVE_INFINITY);
    if (!spot) continue;
    if (rockRandom() > 0.3 + spot.slope + (spot.y - ground.baseY) / rockAltitude) continue;
    const s = lerp(0.5, 1.8, rockRandom() ** 2);
    placements.rock.push({
      x,
      y: spot.y - 0.2 * s - spot.slope * 0.3,
      z,
      yaw: rockRandom() * Math.PI * 2,
      scale: new THREE.Vector3(s * lerp(0.8, 1.3, rockRandom()), s * lerp(0.6, 1.2, rockRandom()), s),
      color: jittered(veg.rock, rockRandom, 0.12)
    });
  }

  const uTime = { value: 0 };
  const snow: SnowUniforms | null = veg.snow
    ? { uSnowColor: { value: new THREE.Color(veg.snow.color) }, uSnowAmount: { value: veg.snow.amount } }
    : null;
  const snowy = snow !== null;
  const swayMaterial = createSwayMaterial(uTime, snow);
  const rockMaterial = createRockMaterial(snow);

  const geometries: Record<Kind, THREE.BufferGeometry> = {
    pine: buildPineGeometry(veg.trunk, snowy),
    leafy: buildLeafyGeometry(veg.trunk, snowy),
    birch: buildBirchGeometry(veg.birchBark, snowy),
    bush: buildBushGeometry(snowy),
    rock: buildRockGeometry(snowy)
  };

  // Each model's footprint radius and height at scale 1, for its ground shadow.
  const sizes = {} as Record<Kind, { radius: number; height: number }>;
  for (const kind of Object.keys(geometries) as Kind[]) {
    const geometry = geometries[kind];
    geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    sizes[kind] = { radius: Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2, height: box.max.y };
  }

  const leanRandom = createRandom(theme.seed + 4);
  const object = new THREE.Group();
  object.name = 'vegetation';
  const meshes: THREE.InstancedMesh[] = [];
  for (const kind of Object.keys(placements) as Kind[]) {
    const list = placements[kind];
    if (list.length === 0) continue;
    const mesh = new THREE.InstancedMesh(geometries[kind], kind === 'rock' ? rockMaterial : swayMaterial, list.length);
    mesh.name = `vegetation-${kind}`;
    list.forEach((p, i) => {
      // Lean a few degrees about a random horizontal axis, then yaw about the vertical.
      const a = leanRandom() * Math.PI * 2;
      lean.setFromAxisAngle(axis.set(Math.cos(a), 0, Math.sin(a)), leanRandom() * MAX_LEAN);
      yawQ.setFromAxisAngle(UP, p.yaw);
      rotation.multiplyQuaternions(lean, yawQ);
      mesh.setMatrixAt(i, matrix.compose(position.set(p.x, p.y, p.z), rotation, p.scale));
      mesh.setColorAt(i, p.color);
      const size = sizes[kind];
      ctx.shadows.push({
        x: p.x,
        y: p.y,
        z: p.z,
        radius: size.radius * Math.max(p.scale.x, p.scale.z),
        height: size.height * p.scale.y
      });
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // One sphere around every instance so the whole type culls as a unit when it's behind the camera.
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    meshes.push(mesh);
    object.add(mesh);
  }

  return {
    object,
    update: (_dt, elapsed) => {
      uTime.value = elapsed;
    },
    dispose: () => {
      for (const mesh of meshes) mesh.dispose();
      for (const geometry of Object.values(geometries)) geometry.dispose();
      swayMaterial.dispose();
      rockMaterial.dispose();
    }
  };
};
