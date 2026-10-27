import * as THREE from 'three';
import type { Mood } from './mood';
import type { RiderPack } from './RiderPack';
import type { Race } from './race';

/**
 * The hot moods: flame tongues off the wheels, back and helmet, sparks, and a heat glow round the
 * rider. How much of each depends on the mood's heat: a warm rider smoulders, mostly at the wheels;
 * an inferno is tall flames all over and a shower of sparks.
 *
 * Everything is one draw call: an instanced quad drawn by a shader that shapes each sprite (a
 * wavering teardrop for a flame, a streak for a spark, a soft disc for the glow), so there are no
 * textures to load. The CPU only moves the particles; size over life, colour and flicker are in
 * the shader.
 *
 * Particles live in world space: each keeps part of the rider's speed ("carry") and drifts back
 * from it, so flames lean into the wind and the wheels leave a short burning trail on the road.
 */

const FLAME_COUNT = 120;
const EMBER_COUNT = 40;
/** Emission at full heat (inferno); scaled down with it. */
const FLAME_RATE_PER_S = 110;
const EMBER_RATE_PER_S = 30;
const FLAME_LIFE_S = [0.4, 0.7] as const;
const EMBER_LIFE_S = [0.7, 1.2] as const;
const FLAME_RISE_MPS = [0.9, 1.8] as const;
const FLAME_BUOYANCY = 2;
/** Sparks float rather than fall, but slow their climb. */
const EMBER_SINK = 1.2;
const EMBER_SIZE_M = [0.035, 0.06] as const;
/** Glow size from barely warm to full heat. */
const GLOW_SIZE_M = [0.9, 1.7] as const;

/** How hot each mood burns, 0–1. Eased per rider so moving between levels doesn't pop. */
const HEAT: Record<Mood, number> = { sleepy: 0, normal: 0, warm: 0.3, fire: 0.65, inferno: 1 };
const HEAT_EASE_S = 0.4;
/** Below this the rider has cooled off: no new sprites. */
const MIN_HEAT = 0.03;

/** Where flames start, in the rider model's frame (see riderModel.ts). */
const WHEEL_RADIUS = 0.34;
const WHEEL_Z = [-0.5, 0.52] as const;
const HIP = new THREE.Vector3(0, 1.0, -0.2);
const SHOULDERS = new THREE.Vector3(0, 1.36, 0.16);
const HELMET = new THREE.Vector3(0, 1.68, 0.25);
const GLOW_CENTRE = new THREE.Vector3(0, 0.95, -0.1);
/** Body flames sit this far either side of the centre line. */
const TORSO_EDGE_M = [0.14, 0.24] as const;

/** Sprite kinds, matched in the shader. */
const FLAME = 0;
const EMBER = 1;
const GLOW = 2;

const VERTEX = /* glsl */ `
uniform float uTime;
attribute vec3 aPos;
attribute vec3 aDir;
attribute vec4 aParams;
varying vec2 vUv;
varying float vT;
varying float vSeed;
varying float vKind;

void main() {
  float t = aParams.x;
  float size = aParams.y;
  vSeed = aParams.z;
  vKind = aParams.w;
  vT = t;
  vUv = position.xy;

  // Axial billboard: the sprite's height runs along aDir, its width faces the camera.
  float speed = length(aDir);
  vec3 axis = speed > 0.0001 ? aDir / speed : vec3(0.0, 1.0, 0.0);
  vec3 side = cross(axis, normalize(cameraPosition - aPos));
  float sideLength = length(side);
  side = sideLength > 0.001 ? side / sideLength : vec3(1.0, 0.0, 0.0);

  float stretch = 1.0;
  if (vKind < 0.5) {
    // Flame: swells fast, then shrinks as it burns out; taller than wide.
    size *= mix(0.45, 1.0, smoothstep(0.0, 0.2, t)) * (1.0 - 0.55 * t);
    stretch = 1.7;
  } else if (vKind < 1.5) {
    // Spark: streaked along its motion.
    stretch = 1.0 + speed * 0.9;
  } else {
    // Glow: breathes.
    size *= 1.0 + 0.08 * sin(uTime * 9.0 + vSeed * 6.0);
  }

  vec3 world = aPos + side * position.x * size + axis * position.y * size * stretch;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vT;
varying float vSeed;
varying float vKind;

void main() {
  vec3 color;
  float alpha;
  // How much the sprite hides what's behind it: 0 is purely additive (glows, but vanishes on snow).
  float cover;

  if (vKind < 0.5) {
    // Teardrop: a round base (radius 0.35 at h = 0.35) tapering to a point at the tip, with two
    // waves running up it so the tongue licks. Waves grow towards the tip; the base stays put.
    float h = vUv.y * 0.5 + 0.5;
    float x = vUv.x * 0.5
      + sin(h * 7.0 - uTime * 16.0 + vSeed * 40.0) * 0.07 * h
      + sin(h * 13.0 - uTime * 23.0 + vSeed * 17.0) * 0.03 * h;
    float d = h < 0.35
      ? length(vec2(x, h - 0.35)) / 0.35
      : abs(x) / max(0.35 * (1.0 - h) / 0.65, 0.001);
    float body = 1.0 - smoothstep(0.55, 1.0, d);
    // Hottest in the middle and low down, cooling as the flame ages.
    float heat = (1.0 - smoothstep(0.0, 0.65, d)) * (1.0 - smoothstep(0.3, 0.9, h)) * (1.0 - vT * 0.8);
    color = mix(vec3(0.85, 0.12, 0.03), vec3(1.0, 0.45, 0.06), smoothstep(0.0, 0.35, heat + 0.25 * (1.0 - vT)));
    color = mix(color, vec3(1.0, 0.85, 0.35), smoothstep(0.3, 0.7, heat));
    color = mix(color, vec3(1.0, 0.98, 0.85), smoothstep(0.75, 1.0, heat));
    alpha = body * smoothstep(0.0, 0.08, vT) * (1.0 - smoothstep(0.55, 1.0, vT));
    cover = 0.4;
  } else if (vKind < 1.5) {
    float d = length(vUv);
    float flicker = 0.6 + 0.4 * sin(uTime * 40.0 + vSeed * 60.0);
    alpha = (1.0 - smoothstep(0.1, 1.0, d)) * (1.0 - vT) * flicker;
    color = mix(vec3(1.0, 0.5, 0.1), vec3(1.0, 0.95, 0.6), 1.0 - d);
    cover = 0.2;
  } else {
    // vT carries the glow's strength, eased as the mood comes and goes.
    float d = min(length(vUv), 1.0);
    alpha = (1.0 - d) * (1.0 - d) * 0.55 * vT;
    color = vec3(1.0, 0.45, 0.1);
    cover = 0.1;
  }

  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color * alpha, alpha * cover);
}
`;

// Scratch objects for the per-frame work.
const point = new THREE.Vector3();
const forward = new THREE.Vector3();

const between = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);
const jitter = (amount: number) => (Math.random() - 0.5) * 2 * amount;

const lerp = ([lo, hi]: readonly [number, number], t: number) => lo + (hi - lo) * t;

/**
 * A random flame origin in the rider model's frame, with its size and how much of the rider's speed
 * it keeps. A cooler rider burns mostly at the wheels; the body catches as the heat rises.
 */
const flameSource = (out: THREE.Vector3, heat: number) => {
  const pick = Math.random();
  const wheels = 0.8 - 0.35 * heat;
  if (pick < wheels) {
    // The back half of either rim: the wheels leave a trail of fire on the road.
    const z = WHEEL_Z[Math.random() < 0.6 ? 0 : 1];
    const a = Math.random() * Math.PI;
    out.set(jitter(0.04), WHEEL_RADIUS + WHEEL_RADIUS * Math.cos(a), z - WHEEL_RADIUS * Math.sin(a));
    return { size: 0.28, carry: 0.6 };
  }
  if (pick < wheels + (1 - wheels) * 0.73) {
    // Up the edges of the torso, not the middle: the chase camera looks at the rider's back, and
    // flames there would hide the jersey.
    out.lerpVectors(HIP, SHOULDERS, Math.random());
    out.x += (Math.random() < 0.5 ? -1 : 1) * between(TORSO_EDGE_M);
    return { size: 0.34, carry: 0.85 };
  }
  out.copy(HELMET);
  out.x += jitter(0.05);
  return { size: 0.32, carry: 0.85 };
};

export class FireEffect {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

  private readonly count: number;
  private readonly glowStart = FLAME_COUNT + EMBER_COUNT;
  // Per sprite, uploaded every frame: world position, axis (relative motion), and t/size/seed/kind.
  private readonly pos: Float32Array;
  private readonly dir: Float32Array;
  private readonly params: Float32Array;
  // Per sprite, CPU only: velocity split into the share of the rider's speed it keeps and its drift.
  private readonly carry: Float32Array;
  private readonly life: Float32Array;

  private readonly uTime = { value: 0 };
  private nextFlame = 0;
  private nextEmber = 0;
  private live = false;
  /** Per rider: fractional sprites owed, and how hot they're burning (eased towards their mood's HEAT). */
  private readonly flameDebt: number[];
  private readonly emberDebt: number[];
  private readonly heat: number[];

  constructor(riderCount: number) {
    this.count = this.glowStart + riderCount;
    this.pos = new Float32Array(this.count * 3);
    this.dir = new Float32Array(this.count * 3);
    this.params = new Float32Array(this.count * 4);
    this.carry = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count).fill(1);
    this.flameDebt = new Array(riderCount).fill(0);
    this.emberDebt = new Array(riderCount).fill(0);
    this.heat = new Array(riderCount).fill(0);

    for (let i = 0; i < this.count; i++) {
      const kind = i < FLAME_COUNT ? FLAME : i < this.glowStart ? EMBER : GLOW;
      // t = 1 (dead) and size 0 until spawned.
      this.params.set([1, 0, Math.random(), kind], i * 4);
    }

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const instanced = (array: Float32Array, size: number) =>
      new THREE.InstancedBufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPos', instanced(this.pos, 3));
    geometry.setAttribute('aDir', instanced(this.dir, 3));
    geometry.setAttribute('aParams', instanced(this.params, 4));
    geometry.instanceCount = this.count;

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uTime: this.uTime },
      transparent: true,
      depthWrite: false,
      // Premultiplied output: colour adds, alpha decides how much of the background it covers.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  update(race: Race, pack: RiderPack, dt: number) {
    this.uTime.value += dt;
    let any = false;

    race.riders.forEach((rider, r) => {
      const anchor = pack.anchor(r);
      if (!anchor) return;
      const heat = (this.heat[r] ?? 0) + (HEAT[rider.mood] - (this.heat[r] ?? 0)) * (1 - Math.exp(-dt / HEAT_EASE_S));
      this.heat[r] = heat;
      forward.setFromMatrixColumn(anchor, 2);

      if (heat > MIN_HEAT) {
        this.flameDebt[r] = (this.flameDebt[r] ?? 0) + FLAME_RATE_PER_S * heat * dt;
        this.emberDebt[r] = (this.emberDebt[r] ?? 0) + EMBER_RATE_PER_S * heat * dt;
        for (; (this.flameDebt[r] as number) >= 1; this.flameDebt[r] = (this.flameDebt[r] as number) - 1) {
          this.spawnFlame(anchor, rider.speed, heat);
        }
        for (; (this.emberDebt[r] as number) >= 1; this.emberDebt[r] = (this.emberDebt[r] as number) - 1) {
          this.spawnEmber(anchor, rider.speed, heat);
        }
      } else {
        this.flameDebt[r] = 0;
        this.emberDebt[r] = 0;
      }

      const g = this.glowStart + r;
      if (heat > 0.01) {
        any = true;
        point.copy(GLOW_CENTRE).applyMatrix4(anchor);
        this.pos.set([point.x, point.y, point.z], g * 3);
        this.dir.set([0, 1, 0], g * 3);
        this.params[g * 4] = heat;
        this.params[g * 4 + 1] = lerp(GLOW_SIZE_M, heat);
      } else {
        this.params[g * 4 + 1] = 0;
      }
    });

    for (let i = 0; i < this.glowStart; i++) {
      const t = this.params[i * 4] as number;
      if (t >= 1) continue;
      const next = t + dt / (this.life[i] as number);
      this.params[i * 4] = next;
      if (next >= 1) {
        this.params[i * 4 + 1] = 0;
        continue;
      }
      any = true;
      const k = i * 3;
      this.dir[k + 1] = (this.dir[k + 1] as number) + (i < FLAME_COUNT ? FLAME_BUOYANCY : -EMBER_SINK) * dt;
      for (let a = 0; a < 3; a++) {
        this.pos[k + a] =
          (this.pos[k + a] as number) + ((this.carry[k + a] as number) + (this.dir[k + a] as number)) * dt;
      }
    }

    if (!any && !this.live) return;
    this.live = any;
    this.mesh.visible = any;
    const { attributes } = this.mesh.geometry;
    for (const name of ['aPos', 'aDir', 'aParams']) {
      (attributes[name] as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  /** Hotter flames are bigger, rise faster and burn longer. */
  private spawnFlame(anchor: THREE.Matrix4, speed: number, heat: number) {
    const i = this.nextFlame;
    this.nextFlame = (i + 1) % FLAME_COUNT;
    const { size, carry } = flameSource(point, heat);
    point.applyMatrix4(anchor);
    // Drift is relative to the rider: back at the speed it doesn't keep, plus its own rise.
    this.spawn(
      i,
      carry,
      speed,
      between(FLAME_RISE_MPS) * (0.7 + 0.6 * heat),
      0.3,
      size * between([0.8, 1.2]) * (0.5 + 0.6 * heat),
      between(FLAME_LIFE_S) * (0.8 + 0.3 * heat)
    );
  }

  private spawnEmber(anchor: THREE.Matrix4, speed: number, heat: number) {
    const i = FLAME_COUNT + this.nextEmber;
    this.nextEmber = (this.nextEmber + 1) % EMBER_COUNT;
    flameSource(point, heat);
    point.applyMatrix4(anchor);
    this.spawn(i, 0.7, speed, between([1.5, 3]), 1.2, between(EMBER_SIZE_M), between(EMBER_LIFE_S));
  }

  /** Starts sprite `i` at `point`, keeping `carry` of the rider's speed along `forward`. */
  private spawn(i: number, carry: number, speed: number, rise: number, spread: number, size: number, life: number) {
    const back = speed * (1 - carry);
    this.pos.set([point.x, point.y, point.z], i * 3);
    this.carry.set([forward.x * speed * carry, forward.y * speed * carry, forward.z * speed * carry], i * 3);
    this.dir.set([-forward.x * back + jitter(spread), rise, -forward.z * back + jitter(spread)], i * 3);
    this.params[i * 4] = 0;
    this.params[i * 4 + 1] = size;
    this.params[i * 4 + 2] = Math.random();
    this.life[i] = life;
  }
}
