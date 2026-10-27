import * as THREE from 'three';

import { beam, block, painted, pole, SINK_M } from './roadsideModels';

/**
 * Landmark set-pieces, built in code like the roadside props (see roadsideModels): indexed
 * geometries with `position`, `normal` and `color`, so every landmark merges into one draw call.
 * Local frames: +y up, origin on the ground at the footprint's centre, +z the front.
 */

/** A triangular prism along z, apex up: a pitched roof `width` wide at its eaves and `height` tall. */
const prism = (width: number, height: number, length: number, color: THREE.ColorRepresentation) => {
  // A three-sided cylinder has one vertex at the top, the base 0.5 below the axis, 0.866 to each side.
  const g = new THREE.CylinderGeometry(1, 1, length, 3).rotateX(-Math.PI / 2);
  return painted(g.scale(width / Math.sqrt(3), height / 1.5, 1).translate(0, height / 3, 0), color);
};

/** A pitched roof sitting on walls `top` m high: eaves at `top`, ridge at `top + height`. */
const roof = (width: number, height: number, length: number, top: number, color: THREE.ColorRepresentation, z = 0) =>
  prism(width, height, length, color).translate(0, top, z);

export type ChapelColors = { wall: string; roof: string; wood: string; stone: string; gold: string };

/** A small mountain chapel: whitewashed nave, slate roof, bell tower with a spire over the door. */
export const buildChapel = (c: ChapelColors) => {
  const parts = [
    block(7, 6 + SINK_M, 11, c.wall, 0, -SINK_M, 0),
    roof(8.2, 3.6, 12, 6, c.roof),
    // Bell tower at the front, its spire, and a cross on top.
    block(3.2, 10 + SINK_M, 3.2, c.wall, 0, -SINK_M, 5.6),
    block(3.5, 0.4, 3.5, c.stone, 0, 10, 5.6),
    painted(new THREE.ConeGeometry(2.4, 5.5, 4).rotateY(Math.PI / 4).translate(0, 10.4 + 2.75, 5.6), c.roof),
    block(0.16, 1.4, 0.16, c.gold, 0, 15.9, 5.6),
    block(0.8, 0.16, 0.16, c.gold, 0, 16.7, 5.6),
    // Belfry openings, the door, and slit windows down the nave.
    block(1, 1.4, 3.3, c.wood, 0, 8, 5.6),
    block(3.3, 1.4, 1, c.wood, 0, 8, 5.6),
    block(1.4, 2.4, 0.2, c.wood, 0, 0, 7.2),
    ...[-3, 0, 3].flatMap((z) => [-1, 1].map((side) => block(0.2, 1.6, 0.6, c.wood, side * 3.5, 2.6, z))),
    // A stone step and a few headstones round the back.
    block(2.4, 0.3, 1.2, c.stone, 0, -0.1, 7.6),
    ...[-3, -1, 1, 3].map((x, i) => block(0.6, 0.8 + (i % 2) * 0.2, 0.18, c.stone, x, -0.2, -8.5 - (i % 2)))
  ];
  return parts;
};

export type TowerColors = { stone: string; dark: string; ivy: string[] };

/** A ruined round keep: battered walls, a broken crown of merlons, a stub of curtain wall and ivy. */
export const buildRuinedTower = (c: TowerColors) => {
  const parts: THREE.BufferGeometry[] = [
    painted(new THREE.CylinderGeometry(4, 4.8, 13 + SINK_M, 9).translate(0, (13 + SINK_M) / 2 - SINK_M, 0), c.stone),
    // The doorway and two arrow slits, facing the front.
    block(1.6, 2.6, 0.6, c.dark, 0, 0, 4.3),
    block(0.35, 1.4, 0.4, c.dark, 1.6, 6, 3.7),
    block(0.35, 1.4, 0.4, c.dark, -1.3, 9, 3.8)
  ];
  // Merlons round the top; a few have fallen, and one side of the crown has crumbled lower.
  for (let k = 0; k < 12; k++) {
    if (k === 2 || k === 3 || k === 7) continue;
    const a = (k / 12) * Math.PI * 2;
    const low = k >= 8 && k <= 10 ? 1.4 : 0;
    parts.push(
      block(1.1, 1.3, 0.9, c.stone, 0, 0, 0)
        .rotateY(a)
        .translate(Math.sin(a) * 3.6, 13 - low, Math.cos(a) * 3.6)
    );
  }
  // A broken stretch of curtain wall running off the side, stepping down as it goes.
  [5.2, 3.8, 2.4].forEach((height, i) => {
    parts.push(block(3, height + SINK_M, 1.2, c.stone, 5.5 + i * 3, -SINK_M, -1));
  });
  // Rubble at the foot and ivy climbing the walls in the theme's leaf colours.
  [
    [6, 0.3],
    [-5, -2],
    [3, -5]
  ].forEach(([x, z], i) => {
    parts.push(block(1 + i * 0.3, 0.7, 0.9, c.stone, x, -0.2, z).rotateY(i));
  });
  // Ivy as clumps of small leaves stuck to the wall, thinning out as they climb.
  const ivy = [
    [0.7, 0.4],
    [2.3, 1.1],
    [-1.1, 0.2]
  ] as const;
  ivy.forEach(([angle, start], i) => {
    for (let k = 0; k < 7; k++) {
      const a = angle + Math.sin(k * 2.3 + i) * 0.18;
      const height = start + k * 1.15;
      const radius = 4.75 - (height / 13) * 0.75;
      const size = 1.1 - k * 0.09;
      const color = c.ivy[(i + k) % c.ivy.length] ?? c.stone;
      parts.push(
        block(size, size, 0.35, color, 0, 0, 0)
          .rotateY(a)
          .translate(Math.sin(a) * radius, height, Math.cos(a) * radius)
      );
    }
  });
  return parts;
};

export type BoathouseColors = { wood: string; roof: string; post: string; boat: string; lamp: string };

/**
 * A boathouse on the shore and a jetty running `jettyLength` m out along +z over the water.
 * `deck` is the jetty's height above the origin, `postDepth` how far below the deck its posts go.
 */
export const buildBoathouse = (c: BoathouseColors, jettyLength: number, deck: number, postDepth: number) => {
  const parts: THREE.BufferGeometry[] = [
    // The hut, set back on the bank to the left of the jetty, its doors facing the water.
    block(8, 4.4 + SINK_M, 9, c.wood, -7, -SINK_M, 1),
    roof(9.4, 3.2, 10.2, 4.4, c.roof).translate(-7, 0, 1),
    block(3.6, 3.2, 0.2, c.post, -7, 0, 5.6),
    block(0.9, 0.9, 0.2, c.lamp, -7, 5.2, 5.75)
  ];
  // Planked deck in short sections, on posts every 4 m.
  const width = 2.4;
  for (let z = 0; z < jettyLength; z += 4) {
    const length = Math.min(4, jettyLength - z);
    parts.push(block(width, 0.2, length - 0.05, c.wood, 0, deck, z + length / 2));
    for (const side of [-1, 1]) {
      parts.push(pole(0.12, postDepth + 0.9, c.post).translate((side * width) / 2, deck - postDepth, z + length));
    }
  }
  // A lamp at the end and a rowing boat tied alongside.
  parts.push(pole(0.06, 2.2, c.post).translate(width / 2 - 0.2, deck + 0.2, jettyLength - 0.4));
  parts.push(block(0.4, 0.4, 0.4, c.lamp, width / 2 - 0.2, deck + 2.4, jettyLength - 0.4));
  parts.push(block(1.3, 0.5, 3.6, c.boat, width / 2 + 1.2, deck - 0.75, jettyLength * 0.6));
  parts.push(block(1.1, 0.12, 0.3, c.wood, width / 2 + 1.2, deck - 0.3, jettyLength * 0.6));
  return parts;
};

export type GalleryColors = { concrete: string; snow: string; dark: string };

/** One length of avalanche gallery between two road-centre points `a` → `b` (road surface height). */
export type GallerySection = {
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** Unit vector across the road towards the uphill side (horizontal) */
  uphill: THREE.Vector3;
};

/** How far the gallery's wall and pillars stand from the centre line, and its clear height, m. */
export const GALLERY_HALF_WIDTH = 5.8;
const GALLERY_HEIGHT = 5.6;

/**
 * An avalanche gallery over the road, built section by section so it follows the bend: a solid
 * wall on the uphill side, square pillars on the downhill side, a slab roof with snow on it. In
 * world space (sections are already placed).
 */
export const buildGallery = (c: GalleryColors, sections: GallerySection[]) => {
  const parts: THREE.BufferGeometry[] = [];
  const offset = new THREE.Vector3();
  const lift = new THREE.Vector3(0, 0, 0);
  sections.forEach(({ a, b, uphill }, i) => {
    offset.copy(uphill).multiplyScalar(GALLERY_HALF_WIDTH);
    lift.set(0, GALLERY_HEIGHT / 2 - SINK_M / 2, 0);
    parts.push(
      beam(a.clone().add(offset).add(lift), b.clone().add(offset).add(lift), GALLERY_HEIGHT + SINK_M, 0.7, c.concrete)
    );
    lift.set(0, GALLERY_HEIGHT + 0.25, 0);
    parts.push(beam(a.clone().add(lift), b.clone().add(lift), 0.5, GALLERY_HALF_WIDTH * 2 + 1.2, c.concrete));
    lift.set(0, GALLERY_HEIGHT + 0.65, 0);
    parts.push(beam(a.clone().add(lift), b.clone().add(lift), 0.35, GALLERY_HALF_WIDTH * 2 + 1.6, c.snow));
    // A dark band under the roof edge on the open side reads as depth from outside.
    lift.set(0, GALLERY_HEIGHT - 0.3, 0);
    offset.copy(uphill).multiplyScalar(-GALLERY_HALF_WIDTH);
    parts.push(beam(a.clone().add(offset).add(lift), b.clone().add(offset).add(lift), 0.6, 0.75, c.dark));
    // Pillars at every section joint, including the far end of the last one.
    const joints = i === sections.length - 1 ? [a, b] : [a];
    for (const p of joints) {
      const base = p.clone().add(offset);
      parts.push(block(0.7, GALLERY_HEIGHT + SINK_M, 0.7, c.concrete, base.x, base.y - SINK_M, base.z));
    }
  });
  return parts;
};
