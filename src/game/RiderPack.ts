import * as THREE from 'three';

import {
  BOTTOM_BRACKET,
  buildBodyGeometry,
  buildCrankGeometry,
  buildShinGeometry,
  buildThighGeometry,
  HIP,
  solveLeg
} from './models/riderModel';
import type { Race, Rider } from './race';
import { curvatureAt, poseAt } from './track';

const MAX_LEAN_RAD = 0.6;
/** A sleepy rider wobbles side to side: amplitude, rate (rad/s) and how fast it fades in and out. */
const DROWSY_SWAY_RAD = 0.09;
const DROWSY_SWAY_RATE = 1.7;
const DROWSY_EASE_S = 0.8;
/** The bike reports whole-number rpm in steps; ease towards each reading so the legs don't lurch. */
const CADENCE_EASE_S = 0.25;
const G = 9.81;
const FORWARD = new THREE.Vector3(0, 0, 1);
const CRANK_AXIS = new THREE.Vector3(1, 0, 0);

// Scratch objects for the per-frame matrix work.
const local = new THREE.Matrix4();
const world = new THREE.Matrix4();
const position = new THREE.Vector3();
const direction = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const unitScale = new THREE.Vector3(1, 1, 1);

/** Soft contact shadow: a flat ellipse on the road under each bike, lifted to avoid z-fighting. */
const SHADOW_LIFT_M = 0.04;
const SHADOW_FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const SHADOW_OFFSET = new THREE.Vector3(0, SHADOW_LIFT_M, 0);
const SHADOW_SCALE = new THREE.Vector3(0.45, 1.05, 1);

type RiderNode = {
  id: string;
  root: THREE.Group;
  lean: THREE.Group;
  crankAngle: number;
  /** Displayed rpm, eased towards the reported cadence */
  cadence: number;
  /** 0–1: how far into the sleepy wobble, eased so it doesn't snap on or off */
  drowse: number;
  swayPhase: number;
};

/**
 * Every rider in the race, built imperatively so the frame loop can pose them without React.
 * Draw calls: one body per rider, plus one instanced mesh each for all thighs, shins and cranks.
 */
export class RiderPack {
  readonly root = new THREE.Group();
  private readonly nodes: RiderNode[];
  private readonly thighs: THREE.InstancedMesh;
  private readonly shins: THREE.InstancedMesh;
  private readonly cranks: THREE.InstancedMesh;
  private readonly shadows: THREE.InstancedMesh;
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({
    color: '#000000',
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(riders: Pick<Rider, 'id' | 'color'>[]) {
    this.nodes = riders.map((r) => {
      const root = new THREE.Group();
      const lean = new THREE.Group();
      const body = this.track(buildBodyGeometry(r.color));
      lean.add(new THREE.Mesh(body, this.material));
      root.add(lean);
      this.root.add(root);
      return { id: r.id, root, lean, crankAngle: riders.indexOf(r) * 1.3, cadence: 0, drowse: 0, swayPhase: 0 };
    });

    const instanced = (geometry: THREE.BufferGeometry, count: number) => {
      const mesh = new THREE.InstancedMesh(this.track(geometry), this.material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Instances span the whole course; the default bounds are the geometry at the origin.
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    };
    this.thighs = instanced(buildThighGeometry(), riders.length * 2);
    this.shins = instanced(buildShinGeometry(), riders.length * 2);
    this.cranks = instanced(buildCrankGeometry(), riders.length);

    // Real shadow maps are too expensive for the tablet; a blob grounds the riders almost as well.
    this.shadows = new THREE.InstancedMesh(
      this.track(new THREE.CircleGeometry(1, 14)),
      this.shadowMaterial,
      riders.length
    );
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.root.add(this.shadows);
  }

  /** Places, leans and pedals every rider. `cadenceFor` returns rpm for a rider. */
  update(race: Race, dt: number, cadenceFor: (rider: Rider) => number) {
    race.riders.forEach((rider, i) => {
      const node = this.nodes[i];
      if (!node || node.id !== rider.id) return;

      const pose = poseAt(race.track, rider.distance);
      node.root.position.set(pose.x - pose.dirZ * rider.lane, pose.y, pose.z + pose.dirX * rider.lane);
      node.root.rotation.set(-Math.atan(pose.grade), Math.atan2(pose.dirX, pose.dirZ), 0, 'YXZ');
      // Lean into corners like a real bike: tan(lean) = v²κ / g.
      const lean = Math.atan((rider.speed * rider.speed * curvatureAt(race.track, rider.distance)) / G);
      node.drowse += ((rider.mood === 'sleepy' ? 1 : 0) - node.drowse) * (1 - Math.exp(-dt / DROWSY_EASE_S));
      node.swayPhase += dt * DROWSY_SWAY_RATE;
      const sway = node.drowse * DROWSY_SWAY_RAD * Math.sin(node.swayPhase);
      node.lean.rotation.z = Math.max(-MAX_LEAN_RAD, Math.min(MAX_LEAN_RAD, lean)) + sway;
      node.root.updateMatrixWorld(true);
      // Under the bike, not the leaning rider: follows the road's pitch and heading only.
      this.shadows.setMatrixAt(
        i,
        world.multiplyMatrices(node.root.matrixWorld, local.compose(SHADOW_OFFSET, SHADOW_FLAT, SHADOW_SCALE))
      );

      node.cadence += (cadenceFor(rider) - node.cadence) * (1 - Math.exp(-dt / CADENCE_EASE_S));
      node.crankAngle += (node.cadence / 60) * Math.PI * 2 * dt;
      const leanWorld = node.lean.matrixWorld;

      rotation.setFromAxisAngle(CRANK_AXIS, node.crankAngle);
      position.set(0, BOTTOM_BRACKET.y, BOTTOM_BRACKET.z);
      this.cranks.setMatrixAt(i, world.multiplyMatrices(leanWorld, local.compose(position, rotation, unitScale)));

      ([1, -1] as const).forEach((side, s) => {
        const { knee, ankle } = solveLeg(node.crankAngle, side);
        const x = side * HIP.x;
        this.setSegment(this.thighs, i * 2 + s, leanWorld, x, HIP.y, HIP.z, knee.y, knee.z);
        this.setSegment(this.shins, i * 2 + s, leanWorld, x, knee.y, knee.z, ankle.y, ankle.z);
      });
    });

    this.cranks.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.thighs.instanceMatrix.needsUpdate = true;
    this.shins.instanceMatrix.needsUpdate = true;
  }

  /** The leaning rider's world matrix as of the last update, in the rider model's local frame. */
  anchor(index: number): THREE.Matrix4 | null {
    return this.nodes[index]?.lean.matrixWorld ?? null;
  }

  dispose() {
    for (const geometry of this.geometries) geometry.dispose();
    this.material.dispose();
    this.shadowMaterial.dispose();
  }

  private track(geometry: THREE.BufferGeometry) {
    this.geometries.push(geometry);
    return geometry;
  }

  /** Points a +z-aligned limb segment from (y0,z0) to (y1,z1) in the rider's side plane at lateral x. */
  private setSegment(
    mesh: THREE.InstancedMesh,
    index: number,
    parent: THREE.Matrix4,
    x: number,
    y0: number,
    z0: number,
    y1: number,
    z1: number
  ) {
    direction.set(0, y1 - y0, z1 - z0).normalize();
    rotation.setFromUnitVectors(FORWARD, direction);
    position.set(x, y0, z0);
    mesh.setMatrixAt(index, world.multiplyMatrices(parent, local.compose(position, rotation, unitScale)));
  }
}
