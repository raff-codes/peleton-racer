import * as THREE from 'three';
import type { RiderPack } from './RiderPack';
import type { Race } from './race';

/**
 * Cosmetic effects for a rider's mood (see mood.ts): a flame trail when on fire, rising Z's when
 * sleepy. Shared pools across all riders, built imperatively like the RiderPack.
 *
 * Flames are world-space particles, so they stream off behind a moving rider on their own. Z's
 * follow the rider's head instead: a sleepy rider is slow, but not so slow that the Z's keep up.
 */

const FLAME_COUNT = 72;
const FLAME_RATE_PER_S = 55;
const FLAME_LIFE_S = 0.6;
/** Flames keep this share of the rider's speed, so the trail is a couple of metres, not a comet tail. */
const FLAME_CARRY = 0.65;
const FLAME_RISE_MPS = 1.6;
const FLAME_BUOYANCY = 2.5;
const FLAME_SIZE_M = 0.32;
/** Where flames start, in the rider model's frame: off the rear wheel, the saddle and the back. */
const FLAME_SOURCES = [
  new THREE.Vector3(0, 0.3, -0.62),
  new THREE.Vector3(0, 0.95, -0.4),
  new THREE.Vector3(0, 1.2, -0.1)
];
const FLAME_JITTER_M = 0.14;
/** Hot to cool over a flame's life. */
const FLAME_COLORS = ['#fff3b0', '#ffc02e', '#ff6a1a', '#d4240f'].map((c) => new THREE.Color(c));

const Z_COUNT = 5;
const Z_INTERVAL_S = 0.85;
const Z_LIFE_S = 2.6;
const Z_RISE_MPS = 0.5;
const Z_SWAY_M = 0.22;
const Z_SIZE_M = [0.16, 0.42] as const;
/** Just above and behind the helmet, in the rider model's frame. */
const HEAD = new THREE.Vector3(0.15, 1.75, 0.2);
/** A slight tilt, like a comic-strip Z. */
const Z_TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.25);

// Scratch objects for the per-frame work.
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const forward = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();
const color = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** A "Z" outline, unit size, centred on the origin in the XY plane. */
const zGeometry = () => {
  const points: [number, number][] = [
    [-0.5, 0.5],
    [0.5, 0.5],
    [0.5, 0.3],
    [-0.15, -0.3],
    [0.5, -0.3],
    [0.5, -0.5],
    [-0.5, -0.5],
    [-0.5, -0.3],
    [0.15, 0.3],
    [-0.5, 0.3]
  ];
  return new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))));
};

type Z = { mesh: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>; rider: number; age: number; phase: number };

export class MoodEffects {
  readonly root = new THREE.Group();

  private readonly flames: THREE.InstancedMesh;
  private readonly flamePos = new Float32Array(FLAME_COUNT * 3);
  private readonly flameVel = new Float32Array(FLAME_COUNT * 3);
  /** Age over lifetime, 0–1; ≥ 1 is a free slot. */
  private readonly flameT = new Float32Array(FLAME_COUNT).fill(1);
  private readonly flameYaw = new Float32Array(FLAME_COUNT);
  private nextFlame = 0;
  private liveFlames = 0;

  private readonly zGeometry = zGeometry();
  private readonly zs: Z[] = [];
  private nextZ = 0;

  /** Per rider: fractional flames owed, and seconds until the next Z. */
  private readonly flameDebt: number[];
  private readonly zTimer: number[];

  constructor(riderCount: number) {
    this.flameDebt = new Array(riderCount).fill(0);
    this.zTimer = new Array(riderCount).fill(0);

    this.flames = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.5, 1, 5).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.88, depthWrite: false }),
      FLAME_COUNT
    );
    this.flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < FLAME_COUNT; i++) {
      this.flames.setMatrixAt(i, HIDDEN);
      this.flames.setColorAt(i, FLAME_COLORS[0] as THREE.Color);
    }
    this.flames.frustumCulled = false;
    this.flames.visible = false;
    this.root.add(this.flames);

    for (let i = 0; i < Z_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: '#9cc0ff',
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(this.zGeometry, material);
      mesh.visible = false;
      this.root.add(mesh);
      this.zs.push({ mesh, rider: 0, age: Z_LIFE_S, phase: 0 });
    }
  }

  update(race: Race, pack: RiderPack, dt: number, camera: THREE.Camera) {
    race.riders.forEach((rider, i) => {
      const anchor = pack.anchor(i);
      if (!anchor) return;

      if (rider.mood === 'fire') {
        this.flameDebt[i] = (this.flameDebt[i] ?? 0) + FLAME_RATE_PER_S * dt;
        forward.setFromMatrixColumn(anchor, 2).multiplyScalar(rider.speed * FLAME_CARRY);
        while ((this.flameDebt[i] as number) >= 1) {
          this.flameDebt[i] = (this.flameDebt[i] as number) - 1;
          this.spawnFlame(anchor, forward);
        }
      } else {
        this.flameDebt[i] = 0;
      }

      if (rider.mood === 'sleepy') {
        this.zTimer[i] = (this.zTimer[i] ?? 0) - dt;
        if ((this.zTimer[i] as number) <= 0) {
          this.zTimer[i] = Z_INTERVAL_S;
          this.spawnZ(i);
        }
      } else {
        this.zTimer[i] = 0;
      }
    });

    this.updateFlames(dt);
    this.updateZs(pack, dt, camera);
  }

  dispose() {
    this.flames.geometry.dispose();
    (this.flames.material as THREE.Material).dispose();
    this.flames.dispose();
    this.zGeometry.dispose();
    for (const z of this.zs) z.mesh.material.dispose();
  }

  private spawnFlame(anchor: THREE.Matrix4, carry: THREE.Vector3) {
    const i = this.nextFlame;
    this.nextFlame = (i + 1) % FLAME_COUNT;
    const source = FLAME_SOURCES[Math.floor(Math.random() * FLAME_SOURCES.length)] as THREE.Vector3;
    position
      .set(
        source.x + (Math.random() - 0.5) * 2 * FLAME_JITTER_M,
        source.y + (Math.random() - 0.5) * FLAME_JITTER_M,
        source.z + (Math.random() - 0.5) * FLAME_JITTER_M
      )
      .applyMatrix4(anchor);
    this.flamePos.set([position.x, position.y, position.z], i * 3);
    this.flameVel.set(
      [
        carry.x + (Math.random() - 0.5) * 0.8,
        carry.y + FLAME_RISE_MPS * (0.7 + Math.random() * 0.6),
        carry.z + (Math.random() - 0.5) * 0.8
      ],
      i * 3
    );
    // Start a little way into its life so the pool turns over evenly instead of in bursts.
    this.flameT[i] = Math.random() * 0.1;
    this.flameYaw[i] = Math.random() * Math.PI * 2;
  }

  private updateFlames(dt: number) {
    let live = 0;
    for (let i = 0; i < FLAME_COUNT; i++) {
      const t = this.flameT[i] as number;
      if (t >= 1) continue;
      const next = t + dt / FLAME_LIFE_S;
      this.flameT[i] = next;
      if (next >= 1) {
        this.flames.setMatrixAt(i, HIDDEN);
        continue;
      }
      live++;

      const k = i * 3;
      this.flameVel[k + 1] = (this.flameVel[k + 1] as number) + FLAME_BUOYANCY * dt;
      for (let a = 0; a < 3; a++) {
        this.flamePos[k + a] = (this.flamePos[k + a] as number) + (this.flameVel[k + a] as number) * dt;
      }

      // Swell briefly, then shrink away; a fast flicker on the height so it licks rather than floats.
      const size = FLAME_SIZE_M * Math.min(1, next * 6) * (1 - next);
      const flicker = 1.5 + 0.4 * Math.sin((next + i) * 40);
      position.fromArray(this.flamePos, k);
      rotation.setFromAxisAngle(UP, this.flameYaw[i] as number);
      scale.set(size, size * flicker, size);
      this.flames.setMatrixAt(i, matrix.compose(position, rotation, scale));

      const band = next * (FLAME_COLORS.length - 1);
      const from = Math.floor(band);
      color
        .copy(FLAME_COLORS[from] as THREE.Color)
        .lerp(FLAME_COLORS[Math.min(from + 1, FLAME_COLORS.length - 1)] as THREE.Color, band - from);
      this.flames.setColorAt(i, color);
    }

    if (live === 0 && this.liveFlames === 0) return;
    this.liveFlames = live;
    this.flames.visible = live > 0;
    this.flames.instanceMatrix.needsUpdate = true;
    if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true;
  }

  private spawnZ(rider: number) {
    const z = this.zs[this.nextZ] as Z;
    this.nextZ = (this.nextZ + 1) % Z_COUNT;
    z.rider = rider;
    z.age = 0;
    z.phase = Math.random() * Math.PI * 2;
    z.mesh.visible = true;
  }

  private updateZs(pack: RiderPack, dt: number, camera: THREE.Camera) {
    for (const z of this.zs) {
      if (z.age >= Z_LIFE_S) continue;
      z.age += dt;
      const anchor = pack.anchor(z.rider);
      if (z.age >= Z_LIFE_S || !anchor) {
        z.mesh.visible = false;
        continue;
      }
      const t = z.age / Z_LIFE_S;
      // Drift up and sideways from the head, always facing the camera.
      z.mesh.position
        .copy(HEAD)
        .applyMatrix4(anchor)
        .addScaledVector(UP, z.age * Z_RISE_MPS);
      z.mesh.position.x += Math.sin(z.age * 2.2 + z.phase) * Z_SWAY_M;
      z.mesh.quaternion.copy(camera.quaternion).multiply(Z_TILT);
      z.mesh.scale.setScalar(Z_SIZE_M[0] + (Z_SIZE_M[1] - Z_SIZE_M[0]) * t);
      z.mesh.material.opacity = Math.min(1, t * 5) * Math.min(1, (1 - t) * 3);
    }
  }
}
