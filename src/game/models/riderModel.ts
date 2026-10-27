import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Low-poly road cyclist, built in code. Local frame: +z forward, +y up, +x to the rider's left,
 * origin on the ground between the wheels. Units are metres at roughly real proportions.
 *
 * Split into parts by how they move:
 * - body: bike + torso, arms, head. Rigid, one merged mesh per rider (jersey colour baked in).
 * - crank: rotates about the bottom bracket at the rider's cadence.
 * - thigh / shin: posed every frame by two-bone IK from hip to pedal.
 */

export const WHEEL_RADIUS = 0.34;
export const BOTTOM_BRACKET = { y: 0.3, z: -0.05 };
export const CRANK_LENGTH = 0.17;
export const HIP = { x: 0.1, y: 0.98, z: -0.22 };
export const THIGH_LENGTH = 0.45;
export const SHIN_LENGTH = 0.45;
/** Pedals sit this far either side of the centre line. */
const PEDAL_X = 0.12;

const SKIN = '#e0ac8a';
const SHORTS = '#1d1d22';
const TYRE = '#151515';
const RIM = '#b8bec6';
const FRAME = '#e8e8ea';
const COMPONENT = '#2b2d31';
const SHOE = '#f4f4f4';
const HELMET = '#f7f7f7';

const UP = new THREE.Vector3(0, 1, 0);

/** Bakes a flat colour into a geometry so differently coloured parts can share one draw call. */
const painted = (geometry: THREE.BufferGeometry, color: string) => {
  const c = new THREE.Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
};

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A cylinder from `a` to `b`. */
const tube = (a: THREE.Vector3, b: THREE.Vector3, radius: number, color: string, segments = 6) => {
  const dir = b.clone().sub(a);
  const geometry = new THREE.CylinderGeometry(radius, radius, dir.length(), segments, 1);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  return painted(geometry.translate(mid.x, mid.y, mid.z), color);
};

/** A box spanning `a` to `b` along its length, with the given cross-section. */
const slab = (a: THREE.Vector3, b: THREE.Vector3, width: number, depth: number, color: string) => {
  const dir = b.clone().sub(a);
  const geometry = new THREE.BoxGeometry(width, dir.length(), depth);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  return painted(geometry.translate(mid.x, mid.y, mid.z), color);
};

const wheel = (z: number) => [
  painted(
    new THREE.TorusGeometry(WHEEL_RADIUS - 0.02, 0.024, 6, 20).rotateY(Math.PI / 2).translate(0, WHEEL_RADIUS, z),
    TYRE
  ),
  painted(
    new THREE.TorusGeometry(WHEEL_RADIUS - 0.05, 0.014, 4, 20).rotateY(Math.PI / 2).translate(0, WHEEL_RADIUS, z),
    RIM
  ),
  tube(v(-0.05, WHEEL_RADIUS, z), v(0.05, WHEEL_RADIUS, z), 0.03, COMPONENT)
];

const REAR_AXLE = v(0, WHEEL_RADIUS, -0.5);
const FRONT_AXLE = v(0, WHEEL_RADIUS, 0.52);
const BB = v(0, BOTTOM_BRACKET.y, BOTTOM_BRACKET.z);
const SEAT_CLUSTER = v(0, 0.8, -0.2);
const HEAD_TOP = v(0, 0.8, 0.36);
const HEAD_BOTTOM = v(0, 0.64, 0.42);
const HIP_CENTRE = v(0, HIP.y, HIP.z);
const SHOULDER_CENTRE = v(0, 1.34, 0.18);

const bike = () => {
  const sides = [1, -1];
  return [
    ...wheel(REAR_AXLE.z),
    ...wheel(FRONT_AXLE.z),
    tube(HEAD_BOTTOM, BB, 0.026, FRAME),
    tube(BB, SEAT_CLUSTER, 0.024, FRAME),
    tube(SEAT_CLUSTER, HEAD_TOP, 0.022, FRAME),
    tube(HEAD_TOP, HEAD_BOTTOM, 0.03, FRAME),
    ...sides.flatMap((s) => [
      tube(v(s * 0.04, BB.y, BB.z), v(s * 0.05, REAR_AXLE.y, REAR_AXLE.z), 0.012, FRAME),
      tube(v(s * 0.03, SEAT_CLUSTER.y, SEAT_CLUSTER.z), v(s * 0.05, REAR_AXLE.y, REAR_AXLE.z), 0.011, FRAME),
      tube(v(s * 0.03, HEAD_BOTTOM.y, HEAD_BOTTOM.z), v(s * 0.05, FRONT_AXLE.y, FRONT_AXLE.z), 0.014, FRAME)
    ]),
    // Seatpost, saddle, stem, drop bar.
    tube(SEAT_CLUSTER, v(0, 0.9, -0.24), 0.014, COMPONENT),
    painted(new THREE.BoxGeometry(0.13, 0.04, 0.26).translate(0, 0.92, -0.22), COMPONENT),
    tube(HEAD_TOP, v(0, 0.84, 0.46), 0.016, COMPONENT),
    tube(v(-0.21, 0.84, 0.47), v(0.21, 0.84, 0.47), 0.014, COMPONENT),
    // Chainring on the drive (right) side.
    painted(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 12).rotateZ(Math.PI / 2).translate(-0.06, BB.y, BB.z), RIM)
  ];
};

const rider = (jersey: string) => {
  const sides = [1, -1];
  const head = v(0, 1.5, 0.3);
  return [
    slab(v(0, HIP.y - 0.04, HIP.z - 0.02), v(0, HIP.y + 0.08, HIP.z + 0.04), 0.3, 0.24, SHORTS),
    slab(HIP_CENTRE, SHOULDER_CENTRE, 0.36, 0.22, jersey),
    tube(SHOULDER_CENTRE, v(0, head.y - 0.09, head.z - 0.04), 0.05, SKIN),
    ...sides.flatMap((s) => {
      const shoulder = v(s * 0.18, SHOULDER_CENTRE.y - 0.02, SHOULDER_CENTRE.z);
      const elbow = v(s * 0.22, 1.06, 0.3);
      const hand = v(s * 0.19, 0.86, 0.48);
      return [tube(shoulder, elbow, 0.05, jersey), tube(elbow, hand, 0.04, SKIN)];
    }),
    painted(new THREE.SphereGeometry(0.1, 8, 6).translate(head.x, head.y, head.z), SKIN),
    painted(
      new THREE.SphereGeometry(0.13, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)
        .scale(1, 0.85, 1.3)
        .translate(0, head.y + 0.02, head.z - 0.02),
      HELMET
    ),
    // Jersey stripe on the helmet so riders are distinguishable from behind.
    painted(new THREE.BoxGeometry(0.05, 0.03, 0.3).translate(0, head.y + 0.12, head.z - 0.02), jersey)
  ];
};

export const buildBodyGeometry = (jersey: string) => mergeGeometries([...bike(), ...rider(jersey)]);

/** Crank arms and pedals around the bottom bracket; rotate about x by the crank angle. */
export const buildCrankGeometry = () =>
  mergeGeometries([
    painted(new THREE.BoxGeometry(0.02, CRANK_LENGTH, 0.03).translate(0.08, CRANK_LENGTH / 2, 0), COMPONENT),
    painted(new THREE.BoxGeometry(0.02, CRANK_LENGTH, 0.03).translate(-0.08, -CRANK_LENGTH / 2, 0), COMPONENT),
    painted(new THREE.BoxGeometry(0.09, 0.02, 0.1).translate(PEDAL_X, CRANK_LENGTH, 0), COMPONENT),
    painted(new THREE.BoxGeometry(0.09, 0.02, 0.1).translate(-PEDAL_X, -CRANK_LENGTH, 0), COMPONENT)
  ]);

/** Thigh along +z from the hip, length THIGH_LENGTH. */
export const buildThighGeometry = () =>
  painted(
    new THREE.CylinderGeometry(0.06, 0.075, THIGH_LENGTH, 6).rotateX(Math.PI / 2).translate(0, 0, THIGH_LENGTH / 2),
    SHORTS
  );

/** Shin along +z from the knee, ending in a shoe at the pedal. */
export const buildShinGeometry = () =>
  mergeGeometries([
    painted(
      new THREE.CylinderGeometry(0.04, 0.055, SHIN_LENGTH, 6).rotateX(Math.PI / 2).translate(0, 0, SHIN_LENGTH / 2),
      SKIN
    ),
    painted(new THREE.BoxGeometry(0.09, 0.07, 0.24).translate(0, 0, SHIN_LENGTH + 0.02), SHOE)
  ]);

export type LegPose = { knee: { y: number; z: number }; ankle: { y: number; z: number } };

/**
 * Two-bone IK in the rider's side plane: given the crank angle, where the knee and ankle sit.
 * `side` is +1 for the left leg (pedal up at angle 0) and -1 for the right.
 */
export const solveLeg = (crankAngle: number, side: 1 | -1): LegPose => {
  const ankle = {
    y: BOTTOM_BRACKET.y + side * CRANK_LENGTH * Math.cos(crankAngle),
    z: BOTTOM_BRACKET.z + side * CRANK_LENGTH * Math.sin(crankAngle)
  };
  const dy = ankle.y - HIP.y;
  const dz = ankle.z - HIP.z;
  const reach = Math.min(Math.hypot(dy, dz), THIGH_LENGTH + SHIN_LENGTH - 1e-3);
  const uy = dy / reach;
  const uz = dz / reach;
  // Distance along hip→ankle to the foot of the knee's perpendicular, then the knee's offset from it.
  const along = (THIGH_LENGTH ** 2 - SHIN_LENGTH ** 2 + reach ** 2) / (2 * reach);
  const out = Math.sqrt(Math.max(0, THIGH_LENGTH ** 2 - along ** 2));
  // Of the two perpendiculars, pick the one that puts the knee forward (+z).
  const [py, pz] = -uy >= 0 ? [uz, -uy] : [-uz, uy];
  return {
    knee: { y: HIP.y + uy * along + py * out, z: HIP.z + uz * along + pz * out },
    ankle
  };
};
