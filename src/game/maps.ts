import { buildLoop, HILL_LOOP, lapClimb, type Track } from './track';
import { THEMES, type Theme } from './world/theme';

export type MapId = 'alpine' | 'winter' | 'autumn' | 'golden';

export type GameMap = {
  id: MapId;
  name: string;
  tagline: string;
  track: Track;
  theme: Theme;
};

const map = (id: MapId, name: string, tagline: string, track: Track, theme: Theme): GameMap => ({
  id,
  name,
  tagline,
  track,
  theme
});

/** Every map pairs a circuit shape with a look. Circuits differ in character, not just scenery. */
export const MAPS: GameMap[] = [
  map('alpine', 'Alpine Valley', 'Two punchy climbs under the peaks', HILL_LOOP, THEMES.alpine),
  map(
    'winter',
    'Winter Pass',
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
    'Autumn Forest',
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
    'Golden Hour Lakes',
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

export const mapById = (id: MapId) => MAPS.find((m) => m.id === id) ?? (MAPS[0] as GameMap);

/** Headline numbers for one lap of a map. */
export const lapStats = (m: GameMap) => ({
  lapKm: m.track.length / 1000,
  climbM: lapClimb(m.track),
  maxGradePct: Math.max(...m.track.points.map((p) => p.grade)) * 100
});
