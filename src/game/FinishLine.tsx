import * as React from 'react';
import * as THREE from 'three';

import { poseAt, type Track } from './track';

const POST_HEIGHT = 6;
const BANNER_HEIGHT = 1.4;

/** A grid of alternating black/white squares in the XY plane, centred on the origin. */
const checkerGeometry = (cols: number, rows: number, width: number, height: number) => {
  const positions: number[] = [];
  const colors: number[] = [];
  const cw = width / cols;
  const ch = height / rows;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x0 = -width / 2 + c * cw;
      const y0 = -height / 2 + r * ch;
      const shade = (c + r) % 2 === 0 ? 0.08 : 0.95;
      positions.push(x0, y0, 0, x0 + cw, y0, 0, x0 + cw, y0 + ch, 0, x0, y0, 0, x0 + cw, y0 + ch, 0, x0, y0 + ch, 0);
      for (let k = 0; k < 6; k++) colors.push(shade, shade, shade);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
};

/** Finish gantry plus a checkered line painted across the road at distance 0. */
export const FinishLine = ({ track, roadWidth }: { track: Track; roadWidth: number }) => {
  const pose = poseAt(track, 0);
  const span = roadWidth + 1.6;
  const banner = React.useMemo(() => checkerGeometry(Math.round(span / 0.6), 2, span, BANNER_HEIGHT), [span]);
  const line = React.useMemo(() => checkerGeometry(Math.round(roadWidth / 0.5), 2, roadWidth, 1), [roadWidth]);

  return (
    <group
      position={[pose.x, pose.y, pose.z]}
      // Rolled with the road's bank (local +x is the rider's left, so it rises by −bank per metre).
      rotation={[-Math.atan(pose.grade), Math.atan2(pose.dirX, pose.dirZ), -Math.atan(pose.bank), 'YXZ']}
    >
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (roadWidth / 2 + 0.5), POST_HEIGHT / 2, 0]}>
          <boxGeometry args={[0.5, POST_HEIGHT, 0.5]} />
          <meshLambertMaterial color='#ff5a1f' />
        </mesh>
      ))}
      <mesh geometry={banner} position={[0, POST_HEIGHT + BANNER_HEIGHT / 2 - 0.4, 0]}>
        <meshBasicMaterial side={THREE.DoubleSide} vertexColors />
      </mesh>
      <mesh geometry={line} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshLambertMaterial vertexColors />
      </mesh>
    </group>
  );
};

const CONFETTI_COUNT = 400;
const CONFETTI_LIFE_S = 6;
const CONFETTI_GRAVITY = 3.5;
const PALETTE = ['#ff5a1f', '#ffd23f', '#2d7ff9', '#18b26b', '#b44dff', '#ffffff'].map((c) => new THREE.Color(c));

/** One-shot confetti burst from the finish gantry, as a single Points draw call. */
export class Confetti {
  readonly points: THREE.Points;
  private readonly positions = new Float32Array(CONFETTI_COUNT * 3);
  private readonly velocities = new Float32Array(CONFETTI_COUNT * 3);
  private age = Number.POSITIVE_INFINITY;

  constructor() {
    const colors = new Float32Array(CONFETTI_COUNT * 3);
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const c = PALETTE[i % PALETTE.length] as THREE.Color;
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.3, vertexColors: true }));
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** Fires from the top of the gantry at the start/finish of `track`. */
  burst(track: Track, roadWidth: number) {
    const pose = poseAt(track, 0);
    const rightX = -pose.dirZ;
    const rightZ = pose.dirX;
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const across = (Math.random() - 0.5) * (roadWidth + 1);
      this.positions.set([pose.x + rightX * across, pose.y + POST_HEIGHT + 0.5, pose.z + rightZ * across], i * 3);
      const speed = 3 + Math.random() * 5;
      const spread = (Math.random() - 0.5) * 2;
      this.velocities.set(
        [
          (rightX * spread - pose.dirX * 0.5) * speed,
          3 + Math.random() * 5,
          (rightZ * spread - pose.dirZ * 0.5) * speed
        ],
        i * 3
      );
    }
    this.age = 0;
    this.points.visible = true;
  }

  update(dt: number) {
    if (this.age > CONFETTI_LIFE_S) return;
    this.age += dt;
    if (this.age > CONFETTI_LIFE_S) {
      this.points.visible = false;
      return;
    }
    // Paper flutters: strong air drag, gentle gravity.
    const drag = Math.exp(-1.6 * dt);
    for (let i = 0; i < CONFETTI_COUNT * 3; i += 3) {
      this.velocities[i] = (this.velocities[i] as number) * drag;
      this.velocities[i + 1] = (this.velocities[i + 1] as number) * drag - CONFETTI_GRAVITY * dt;
      this.velocities[i + 2] = (this.velocities[i + 2] as number) * drag;
      this.positions[i] = (this.positions[i] as number) + (this.velocities[i] as number) * dt;
      this.positions[i + 1] = (this.positions[i + 1] as number) + (this.velocities[i + 1] as number) * dt;
      this.positions[i + 2] = (this.positions[i + 2] as number) + (this.velocities[i + 2] as number) * dt;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
