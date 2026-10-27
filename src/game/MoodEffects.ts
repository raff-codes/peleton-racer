import * as THREE from 'three';
import { FireEffect } from './FireEffect';
import type { RiderPack } from './RiderPack';
import type { Race } from './race';

/**
 * Cosmetic effects for a rider's mood (see mood.ts): fire when going hard (FireEffect), rising Z's
 * when sleepy. Shared pools across all riders, built imperatively like the RiderPack.
 *
 * Z's follow the rider's head rather than staying where they were spawned: a sleepy rider is slow,
 * but not so slow that the Z's keep up.
 */

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

const UP = new THREE.Vector3(0, 1, 0);

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

  private readonly fire: FireEffect;

  private readonly zGeometry = zGeometry();
  private readonly zs: Z[] = [];
  private nextZ = 0;

  /** Per rider: seconds until the next Z. */
  private readonly zTimer: number[];

  constructor(riderCount: number) {
    this.zTimer = new Array(riderCount).fill(0);
    this.fire = new FireEffect(riderCount);
    this.root.add(this.fire.mesh);

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

    this.fire.update(race, pack, dt);
    this.updateZs(pack, dt, camera);
  }

  dispose() {
    this.fire.dispose();
    this.zGeometry.dispose();
    for (const z of this.zs) z.mesh.material.dispose();
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
