import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Low-poly roadside props, built in code. Every builder returns an indexed geometry with exactly
 * `position`, `normal` and `color` (plus any extra attributes noted), so whole layers can be merged
 * into one draw call. Local frames: +y up, origin on the ground unless noted.
 */

const UP = new THREE.Vector3(0, 1, 0);

/** Posts are sunk this far so they never float over a ground mesh coarser than `heightAt`. */
export const SINK_M = 0.3;

/** Bakes a flat colour into a geometry and drops uvs, so differently coloured parts can be merged. */
export const painted = (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation) => {
  const c = new THREE.Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (geometry.hasAttribute('uv')) geometry.deleteAttribute('uv');
  return geometry;
};

/** Adds a constant float attribute, e.g. a part id the vertex shader animates by. */
const tagged = (geometry: THREE.BufferGeometry, name: string, value: number) => {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count).fill(value), 1));
  return geometry;
};

/** A box sitting on y = `bottom`, centred on (x, z). */
export const block = (
  width: number,
  height: number,
  depth: number,
  color: THREE.ColorRepresentation,
  x = 0,
  bottom = 0,
  z = 0
) => painted(new THREE.BoxGeometry(width, height, depth).translate(x, bottom + height / 2, z), color);

/** Turns a +z-forward local model about y so +z points along (dirX, dirZ), then moves it to (x, y, z). */
export const placed = (geometry: THREE.BufferGeometry, x: number, y: number, z: number, dirX: number, dirZ: number) =>
  geometry.rotateY(Math.atan2(dirX, dirZ)).translate(x, y, z);

const basis = new THREE.Matrix4();
const along = new THREE.Vector3();
const side = new THREE.Vector3();
const up = new THREE.Vector3();

/**
 * A box whose length runs from `a` to `b` (following any slope) with a vertical face: rails and
 * barrier panels that should hug the ground between two posts.
 */
export const beam = (
  a: THREE.Vector3,
  b: THREE.Vector3,
  height: number,
  thickness: number,
  color: THREE.ColorRepresentation
) => {
  along.subVectors(b, a);
  const length = along.length();
  along.divideScalar(length);
  side.crossVectors(along, UP).normalize();
  up.crossVectors(side, along);
  basis.makeBasis(along, up, side).setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return painted(new THREE.BoxGeometry(length, height, thickness).applyMatrix4(basis), color);
};

/** An open, thin vertical pole (no caps: nobody sees them). */
export const pole = (radius: number, height: number, color: THREE.ColorRepresentation, segments = 6) =>
  painted(new THREE.CylinderGeometry(radius, radius, height, segments, 1, true).translate(0, height / 2, 0), color);

/** A round bale lying on its side, length along x. */
export const buildHayBale = (color: string, radius = 0.65, length = 1.2) =>
  painted(new THREE.CylinderGeometry(radius, radius, length, 10).rotateZ(Math.PI / 2).translate(0, radius, 0), color);

/** A flat sign board facing ±z, centred at (0, y), with `bands` horizontal stripes on both faces. */
export const buildMarkerSign = (board: string, band: string, bands: number) => {
  const postHeight = 1.5;
  const parts = [
    block(0.08, postHeight + SINK_M, 0.08, board, 0, -SINK_M),
    block(0.5, 0.62, 0.04, board, 0, postHeight - 0.62 + 0.15)
  ];
  for (let k = 0; k < bands; k++) {
    const y = postHeight - 0.05 - k * 0.12;
    parts.push(block(0.44, 0.06, 0.06, band, 0, y - 0.06));
  }
  return mergeGeometries(parts);
};

/** "Flamme rouge" style warning: a red downward triangle on a tall post. */
export const buildRedTriangleSign = (red: string, white: string) => {
  const triangle = painted(
    // Three radial segments make a triangle; rotating the axis onto z points a corner down.
    new THREE.CylinderGeometry(0.6, 0.6, 0.05, 3).rotateX(Math.PI / 2).translate(0, 2.3, 0),
    red
  );
  return mergeGeometries([block(0.1, 2.9 + SINK_M, 0.1, white, 0, -SINK_M), triangle]);
};

/** A red board with a white band, the "200 m to go" board. */
export const buildRedBoardSign = (red: string, white: string) =>
  mergeGeometries([
    block(0.1, 2.6 + SINK_M, 0.1, white, 0, -SINK_M),
    block(1.0, 0.7, 0.05, red, 0, 1.9),
    block(0.9, 0.12, 0.07, white, 0, 2.19)
  ]);

// ---------------------------------------------------------------------------------------------
// Spectators

/** `aPaint` values: which colour the vertex shader gives a vertex. */
export const PAINT_FIXED = 0;
export const PAINT_SHIRT = 1;
export const PAINT_SKIN = 2;

/** Shoulder pivot for the arm-wave in the vertex shader (local frame, x = ± this). */
export const SHOULDER = { x: 0.26, y: 1.38 };
export const ARM_LENGTH = 0.56;

const TROUSERS = '#2e3546';

/**
 * One spectator, facing +z, feet at y = 0, ~1.75 m tall. Extra attributes:
 * - `aPaint`: PAINT_FIXED keeps the baked colour, PAINT_SHIRT / PAINT_SKIN take per-instance colours.
 * - `aArm`: -1 / +1 for the left / right arm (pivoted at SHOULDER), 0 for everything else.
 * Arms are modelled pointing straight up; the shader swings them down or waves them.
 */
export const buildSpectatorGeometry = () => {
  const body = (geometry: THREE.BufferGeometry, paint: number, color = '#ffffff') =>
    tagged(tagged(painted(geometry, color), 'aPaint', paint), 'aArm', 0);
  const parts = [
    body(new THREE.BoxGeometry(0.15, 0.82, 0.18).translate(-0.1, 0.41, 0), PAINT_FIXED, TROUSERS),
    body(new THREE.BoxGeometry(0.15, 0.82, 0.18).translate(0.1, 0.41, 0), PAINT_FIXED, TROUSERS),
    body(new THREE.BoxGeometry(0.44, 0.6, 0.25).translate(0, 0.82 + 0.3, 0), PAINT_SHIRT),
    body(new THREE.SphereGeometry(0.13, 6, 4).translate(0, 1.58, 0), PAINT_SKIN)
  ];
  for (const s of [-1, 1]) {
    const x = s * SHOULDER.x;
    const sleeve = new THREE.BoxGeometry(0.11, ARM_LENGTH - 0.1, 0.11).translate(
      x,
      SHOULDER.y + (ARM_LENGTH - 0.1) / 2,
      0
    );
    const hand = new THREE.BoxGeometry(0.09, 0.1, 0.09).translate(x, SHOULDER.y + ARM_LENGTH - 0.05, 0);
    parts.push(tagged(tagged(painted(sleeve, '#ffffff'), 'aPaint', PAINT_SHIRT), 'aArm', s));
    parts.push(tagged(tagged(painted(hand, '#ffffff'), 'aPaint', PAINT_SKIN), 'aArm', s));
  }
  return mergeGeometries(parts);
};

// ---------------------------------------------------------------------------------------------
// Fluttering cloth: flags and bunting. Each vertex carries `aSway`, the direction and amount it
// may move (zero where the cloth is fixed), which the flag material animates with uTime.

const swayed = (geometry: THREE.BufferGeometry, sway: (index: number) => [number, number, number]) => {
  const count = geometry.getAttribute('position').count;
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) values.set(sway(i), i * 3);
  geometry.setAttribute('aSway', new THREE.BufferAttribute(values, 3));
  return geometry;
};

/**
 * A rectangular flag hanging from (top) along `dir` (unit, horizontal), in the vertical plane
 * containing `dir`. Sway grows towards the free edge.
 */
export const buildFlagCloth = (
  top: THREE.Vector3,
  dir: THREE.Vector3,
  width: number,
  height: number,
  color: string
) => {
  const geometry = new THREE.PlaneGeometry(width, height, 4, 1).translate(width / 2, -height / 2, 0);
  const local = geometry.getAttribute('position');
  const normal = new THREE.Vector3().crossVectors(dir, UP).normalize();
  const free = Array.from({ length: local.count }, (_, i) => local.getX(i) / width);
  basis.makeBasis(dir, UP, normal).setPosition(top);
  geometry.applyMatrix4(basis);
  painted(geometry, color);
  return swayed(geometry, (i) => {
    const w = (free[i] ?? 0) ** 1.3 * 0.28;
    return [normal.x * w, normal.y * w, normal.z * w];
  });
};

/**
 * One bunting pennant: a downward triangle hanging from a string point `at`, edge along `dir`.
 * Only the tip sways.
 */
export const buildPennant = (at: THREE.Vector3, dir: THREE.Vector3, color: string) => {
  const half = 0.16;
  const normal = new THREE.Vector3().crossVectors(dir, UP).normalize();
  const positions = [
    at.x - dir.x * half,
    at.y,
    at.z - dir.z * half,
    at.x + dir.x * half,
    at.y,
    at.z + dir.z * half,
    at.x,
    at.y - 0.38,
    at.z
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute([...normal.toArray(), ...normal.toArray(), ...normal.toArray()], 3)
  );
  geometry.setIndex([0, 1, 2]);
  painted(geometry, color);
  return swayed(geometry, (i) => (i === 2 ? [normal.x * 0.12, 0, normal.z * 0.12] : [0, 0, 0]));
};
