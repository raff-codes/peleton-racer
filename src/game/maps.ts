import { buildCircuit, buildLoop, HILL_LOOP, lapClimb, type Track } from './track';
import type { Landmark } from './world/landmarks';
import { THEMES, type Theme } from './world/theme';

/**
 * Map ids name a course, not a look: saved rides, bests and ghosts are keyed by them. Changing a
 * map's track means a new id (and retiring the old map below), never editing a track in place.
 */
export type MapId = 'alpine-2' | 'winter-3' | 'autumn-2' | 'golden-2' | RetiredMapId;
type RetiredMapId = 'alpine' | 'winter' | 'autumn' | 'golden' | 'winter-2';

export type GameMap = {
  id: MapId;
  name: string;
  tagline: string;
  track: Track;
  theme: Theme;
  /** Set-pieces along the course, so each lap has something to recognise */
  landmarks: Landmark[];
};

const map = (
  id: MapId,
  name: string,
  tagline: string,
  track: Track,
  theme: Theme,
  landmarks: Landmark[] = []
): GameMap => ({
  id,
  name,
  tagline,
  track,
  theme,
  landmarks
});

/** A control point `deg` round from +x and `r` m out, at height `y` m. */
const polar = (deg: number, r: number, y: number): [number, number, number] => {
  const a = (deg * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a), y];
};

/**
 * The inside of a hairpin joining a leg ending at (deg, rIn) to the next leg starting at
 * (deg, rOut): a half circle of radius |rOut − rIn| / 2 bulging round the loop (`side` 1) or
 * back (`side` −1). The legs' own end points aren't included.
 */
const hairpin = (deg: number, rIn: number, rOut: number, yIn: number, yOut: number, side: 1 | -1) => {
  const a = (deg * Math.PI) / 180;
  const radius = (rOut - rIn) / 2;
  const mid = (rIn + rOut) / 2;
  return [0.25, 0.5, 0.75].map((f): [number, number, number] => {
    const phi = f * Math.PI;
    const out = mid - radius * Math.cos(phi);
    const along = Math.abs(radius) * Math.sin(phi) * side;
    return [out * Math.cos(a) - along * Math.sin(a), out * Math.sin(a) + along * Math.cos(a), yIn + (yOut - yIn) * f];
  });
};

/** Every map pairs a circuit shape with a look. Circuits differ in character, not just scenery. */
export const MAPS: GameMap[] = [
  map(
    'alpine-2',
    'Alpine Valley',
    'A lakeside sprint and two punchy climbs towards the peaks',
    buildCircuit({
      name: 'Alpine Valley',
      path: [
        // The line, on the flat valley floor beside the lake.
        polar(0, 250, 0),
        polar(18, 246, 0),
        polar(36, 258, 0),
        // First climb, out towards the foothills.
        polar(54, 296, 3),
        polar(68, 344, 8),
        polar(82, 386, 13),
        polar(100, 400, 17),
        polar(118, 362, 11),
        polar(136, 304, 6),
        polar(156, 266, 3),
        polar(178, 254, 2),
        polar(200, 272, 2),
        // Second climb: shorter and steeper.
        polar(218, 322, 6),
        polar(231, 372, 13),
        polar(245, 414, 20),
        polar(262, 410, 23),
        // Down off it and onto the flat for the sprint.
        polar(280, 362, 15),
        polar(300, 310, 8),
        polar(320, 274, 3),
        polar(340, 254, 0)
      ]
    }),
    THEMES.alpine,
    // On the high ground at the top of the first climb, door to the road.
    [{ kind: 'chapel', at: 540, lateral: -30, yaw: -Math.PI / 2 }]
  ),
  map(
    'winter-3',
    'Winter Pass',
    'Four hairpins up the pass, then a long, fast descent',
    buildCircuit({
      name: 'Winter Pass',
      // Two pairs of hairpins, each pair's legs 60 m apart: closer than that and the terrain grid
      // (17 m cells on Low) can't fit the bank between them, so the slope spans over the road.
      path: [
        polar(0, 300, 0),
        polar(20, 292, 0),
        polar(38, 280, 2),
        // First pair, climbing outwards towards the mountains. The hairpins themselves are flat
        // (as real ones are), which also keeps the ground inside them level enough for the grid.
        polar(50, 270, 3),
        polar(65, 270, 7),
        polar(80, 270, 11),
        ...hairpin(80, 270, 330, 11, 11, 1),
        polar(80, 330, 11),
        polar(65, 330, 15.5),
        polar(50, 330, 20),
        ...hairpin(50, 330, 390, 20, 20, -1),
        polar(50, 390, 20),
        polar(65, 390, 25),
        polar(85, 395, 31),
        // Along under the peaks: the gallery is here.
        polar(105, 402, 35),
        polar(125, 408, 39),
        polar(145, 410, 42.5),
        polar(160, 410, 45),
        // Second pair, climbing back in towards the lake.
        ...hairpin(160, 410, 350, 45, 45, 1),
        polar(160, 350, 45),
        polar(145, 350, 50),
        polar(130, 350, 55),
        ...hairpin(130, 350, 290, 55, 55, -1),
        polar(130, 290, 55),
        polar(145, 290, 58.5),
        // Over the top and the long way down.
        polar(165, 290, 61),
        polar(185, 292, 60),
        polar(210, 296, 53),
        polar(240, 300, 42),
        polar(270, 302, 30),
        polar(300, 302, 17),
        polar(325, 302, 7),
        polar(345, 301, 1)
      ]
    }),
    THEMES.winter,
    // Over the road along under the peaks, between the two pairs of hairpins.
    [{ kind: 'snowGallery', at: 1150, lateral: 0 }]
  ),
  map(
    'autumn-2',
    'Autumn Forest',
    'Twisting lanes, short steep kickers and an uphill finish',
    buildCircuit({
      name: 'Autumn Forest',
      // Radius swings every 15° for the esses. Each kicker rises 5 m in one 15° step; the last
      // one climbs to the line.
      path: (
        [
          [264, 9],
          [229, 10],
          [257, 8],
          [306, 5],
          [278, 4],
          [236, 9],
          [215, 9],
          [250, 6],
          [306, 3],
          [348, 2],
          [320, 7],
          [278, 8],
          [306, 5],
          [355, 3],
          [334, 3],
          [285, 8],
          [250, 9],
          [222, 6],
          [243, 4],
          [292, 2],
          [334, 2],
          [306, 3],
          [271, 4],
          [257, 4]
        ] as const
      ).map(([r, y], i) => polar(i * 15, r, y))
    }),
    THEMES.autumn,
    // Above the last flat before the final kicker, facing the riders as they come up to it.
    [{ kind: 'ruinedTower', at: -120, lateral: -34, yaw: Math.PI }]
  ),
  map(
    'golden-2',
    'Golden Hour Lakes',
    'Fast and flat, with a long lakeside straight for the sprint',
    buildCircuit({
      name: 'Golden Hour Lakes',
      path: [
        // The line, at the end of the lakeside straight.
        [140, -235, 0],
        [300, -215, 0],
        [390, -80, 1],
        [410, 80, 3],
        [350, 250, 5],
        [200, 360, 6],
        [0, 400, 5],
        [-200, 360, 4],
        [-340, 250, 3],
        [-400, 80, 2],
        [-380, -100, 1],
        [-300, -220, 0],
        [-120, -238, 0]
      ]
    }),
    THEMES.golden,
    // On the lake shore halfway down the finishing straight, the jetty running out over the water.
    [{ kind: 'boathouse', at: -140, lateral: 84, yaw: -Math.PI / 2 }]
  )
];

/** Courses that have been redrawn. Kept so saved rides on them still resolve, but not offered on the menu. */
const RETIRED_MAPS: GameMap[] = [
  map(
    'winter-2',
    'Winter Pass (stacked hairpins)',
    'Four hairpins up the pass, then a long, fast descent',
    buildCircuit({
      name: 'Winter Pass',
      path: [
        polar(0, 300, 0),
        polar(20, 296, 0),
        polar(40, 290, 1),
        polar(55, 286, 3),
        // Five legs up the hillside, each further out and higher, joined by four hairpins.
        polar(65, 285, 4),
        polar(80, 285, 8.5),
        polar(95, 285, 13),
        ...hairpin(95, 285, 320, 13, 15, 1),
        polar(95, 320, 15),
        polar(80, 320, 19.5),
        polar(65, 320, 24),
        ...hairpin(65, 320, 355, 24, 26, -1),
        polar(65, 355, 26),
        polar(80, 355, 30.5),
        polar(95, 355, 35),
        ...hairpin(95, 355, 390, 35, 37, 1),
        polar(95, 390, 37),
        polar(80, 390, 41.5),
        polar(65, 390, 46),
        ...hairpin(65, 390, 425, 46, 48, -1),
        polar(65, 425, 48),
        polar(80, 428, 51),
        // Over the top of the pass and down the long way round.
        polar(95, 430, 53),
        polar(110, 428, 54),
        polar(125, 418, 53),
        polar(150, 385, 45),
        polar(175, 345, 36),
        polar(200, 315, 27),
        polar(230, 295, 17),
        polar(260, 288, 9),
        polar(290, 290, 4),
        polar(320, 298, 1),
        polar(340, 300, 0)
      ]
    }),
    THEMES.winter
  ),
  map('alpine', 'Alpine Valley (original course)', 'Two punchy climbs under the peaks', HILL_LOOP, THEMES.alpine),
  map(
    'winter',
    'Winter Pass (original course)',
    'One long drag up the pass, then a fast descent',
    buildLoop({
      name: 'Winter Pass',
      radius: 330,
      bends: [
        { amp: 45, freq: 2, phase: 0.4 },
        { amp: 30, freq: 4, phase: 1.1 }
      ],
      hills: [
        { amp: 15, freq: 1, phase: 0.3 },
        { amp: 3, freq: 3 }
      ]
    }),
    THEMES.winter
  ),
  map(
    'autumn',
    'Autumn Forest (original course)',
    'Twisting lanes and short, steep kickers',
    buildLoop({
      name: 'Autumn Forest',
      radius: 285,
      bends: [
        { amp: 45, freq: 4 },
        { amp: 20, freq: 6, phase: 0.7 }
      ],
      hills: [
        { amp: 4, freq: 3 },
        { amp: 2, freq: 5, phase: 1.2 }
      ]
    }),
    THEMES.autumn
  ),
  map(
    'golden',
    'Golden Hour Lakes (original course)',
    'A fast lakeside loop in the evening sun',
    buildLoop({
      name: 'Golden Hour Lakes',
      radius: 360,
      bends: [
        { amp: 40, freq: 2, phase: 0.8 },
        { amp: 15, freq: 3 }
      ],
      hills: [
        { amp: 3, freq: 2 },
        { amp: 1.5, freq: 4, phase: 0.5 }
      ]
    }),
    THEMES.golden
  )
];

export const mapById = (id: MapId) =>
  MAPS.find((m) => m.id === id) ?? RETIRED_MAPS.find((m) => m.id === id) ?? (MAPS[0] as GameMap);

/** Headline numbers for one lap of a map. */
export const lapStats = (m: GameMap) => ({
  lapKm: m.track.length / 1000,
  climbM: lapClimb(m.track),
  maxGradePct: Math.max(...m.track.points.map((p) => p.grade)) * 100
});
