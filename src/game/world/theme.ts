/**
 * Art direction for a world: palette, lighting and how the landscape is shaped. Every layer
 * reads its colours and parameters from here, so a new look (coastal, autumn, night) is a new
 * Theme object rather than new code.
 */
export type Theme = {
  name: string;
  seed: number;
  sky: {
    zenith: string;
    horizon: string;
    sunColor: string;
    /** Direction towards the sun (normalised by consumers) */
    sunDirection: [number, number, number];
    /** Halo around the sun: `size` widens it (1 = the default), `strength` scales how bright it is */
    glow: { size: number; strength: number };
  };
  fog: { color: string; near: number; far: number };
  light: { hemiSky: string; hemiGround: string; hemiIntensity: number; sunColor: string; sunIntensity: number };
  terrain: {
    /** Half-size of the square terrain, m (centred on the origin) */
    extent: number;
    /** Rolling hills: amplitude (m) and feature size (m) */
    hillAmplitude: number;
    hillScale: number;
    /** Land rises into foothills between these radii from the origin, by `height` m */
    edgeRise: { start: number; end: number; height: number };
    /** Colours by height above the lowest road point, lerped between bands */
    bands: { height: number; color: string }[];
    /** Colour on steep slopes (slope > ~35°) */
    rock: string;
    /** Height above the lowest road point where snow starts */
    snowLine: number;
    snow: string;
  };
  water: {
    /** Lake centre and radius, m. Must sit well inside every track loop (the shore bank reaches 2× radius). */
    x: number;
    z: number;
    radius: number;
    depth: number;
    color: string;
    shallow: string;
    /** Ice: matte surface with no glint or shimmer (and no per-frame update) */
    frozen: boolean;
  } | null;
  mountains: {
    /** Ring radius and how deep the ring is, m */
    radius: number;
    depth: number;
    /** Peak height above the lowest road point, m */
    height: number;
    base: string;
    snow: string;
    /** Fraction of peak height where snow starts */
    snowLine: number;
    /** Distant haze blended over the far ring so it sits behind the fog */
    haze: string;
  };
  clouds: { color: string; shadow: string; height: number };
  vegetation: {
    pine: string[];
    leafy: string[];
    birchBark: string;
    birchLeaf: string[];
    trunk: string;
    bush: string[];
    rock: string[];
    /** Forest noise: feature size (m) and threshold (0–1) above which trees cluster */
    forestScale: number;
    forestThreshold: number;
    /** Height above the lowest road point where trees stop, m */
    treeline: number;
    /**
     * Species weights multiplying the natural mix (pines up high, broadleaf by the lake): 1 each
     * keeps it. The total stays `quality.trees`.
     */
    species: { pine: number; leafy: number; birch: number };
    /** Multipliers on `quality.bushes` and `quality.rocks` */
    bushDensity: number;
    rockDensity: number;
    /** Snow lying on upward-facing foliage (and rock tops): its colour and how much (0–1), or none */
    snow: { color: string; amount: number } | null;
  };
  roadside: {
    road: string;
    verge: string;
    lines: string;
    fence: string;
    marker: string;
    barrier: string[];
    flags: string[];
    shirts: string[];
    skin: string[];
    hay: string;
    /** Multiplier on the number of hay bales out in the meadows (0 = none) */
    hayBales: number;
  };
  /** Falling particles around the camera, or none */
  weather: Weather | null;
};

/**
 * Particles in a box that follows the camera. `snow` and `pollen` are round flakes; `leaves`
 * are flat ellipses that spin and tumble edge-on as they fall.
 */
export type Weather = {
  kind: 'snow' | 'leaves' | 'pollen';
  /** Particle colours, picked at random per particle */
  colors: string[];
  /** Fraction of `quality.weather` particles to use (0–1) */
  density: number;
  /** Particle size, m */
  size: number;
  /** Fall speed, m/s (each particle varies ±30%); negative rises */
  fallSpeed: number;
  /** Side-to-side sway amplitude, m */
  sway: number;
  /** Steady drift (x, z), m/s */
  wind: [number, number];
};

export const ALPINE: Theme = {
  name: 'Alpine',
  seed: 1337,
  sky: {
    zenith: '#4f8fdc',
    horizon: '#cfe6f7',
    sunColor: '#fff3d6',
    sunDirection: [0.45, 0.55, 0.7],
    glow: { size: 1, strength: 1 }
  },
  fog: { color: '#c4dcef', near: 120, far: 1500 },
  light: { hemiSky: '#e8f2ff', hemiGround: '#5c7a45', hemiIntensity: 1.05, sunColor: '#fff1d8', sunIntensity: 1.6 },
  terrain: {
    extent: 1000,
    hillAmplitude: 14,
    hillScale: 260,
    edgeRise: { start: 520, end: 980, height: 70 },
    bands: [
      { height: -12, color: '#6f9b4a' },
      { height: 0, color: '#7fb04f' },
      { height: 18, color: '#8fb85a' },
      { height: 40, color: '#7a9a55' },
      { height: 60, color: '#8c8a6e' }
    ],
    rock: '#8a8478',
    snowLine: 70,
    snow: '#f4f7fb'
  },
  water: { x: 0, z: 0, radius: 120, depth: 6, color: '#3f86b8', shallow: '#6fb3cf', frozen: false },
  mountains: {
    radius: 1250,
    depth: 350,
    height: 420,
    base: '#62717f',
    snow: '#f2f6fb',
    snowLine: 0.48,
    haze: '#b9d2e6'
  },
  clouds: { color: '#ffffff', shadow: '#d7e3ef', height: 260 },
  vegetation: {
    pine: ['#1f5a36', '#24643c', '#2c6e44', '#1b4f31'],
    leafy: ['#4f8f3a', '#5c9c40', '#6aa845', '#7fae4a'],
    birchBark: '#e9e6dc',
    birchLeaf: ['#8dbb4f', '#a3c95a', '#b8cf5e'],
    trunk: '#6b4a32',
    bush: ['#3f7a35', '#4c8a3b', '#5a9442'],
    rock: ['#8d8a83', '#9b978f', '#7f7b74'],
    forestScale: 180,
    forestThreshold: 0.52,
    treeline: 55,
    species: { pine: 1, leafy: 1, birch: 1 },
    bushDensity: 1,
    rockDensity: 1,
    snow: null
  },
  roadside: {
    road: '#3b3d42',
    verge: '#a9a48f',
    lines: '#f2f2ee',
    fence: '#8a6a48',
    marker: '#f7f7f7',
    barrier: ['#ffffff', '#d7262e'],
    flags: ['#ff5a1f', '#ffd23f', '#2d7ff9', '#18b26b', '#b44dff', '#e63946'],
    shirts: ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#ffd23f', '#ffffff', '#457b9d', '#ff5a1f'],
    skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'],
    hay: '#d9b45a',
    hayBales: 1
  },
  weather: null
};

/** Snowbound pass under an overcast sky: dark snow-laden pines, a frozen lake, falling snow. */
export const WINTER: Theme = {
  name: 'Winter Pass',
  seed: 2207,
  sky: {
    zenith: '#9fb2c6',
    horizon: '#dde4ec',
    sunColor: '#f4f6fa',
    sunDirection: [-0.35, 0.32, 0.8],
    // The sun is a bright smear behind the cloud deck rather than a crisp halo.
    glow: { size: 2.4, strength: 0.6 }
  },
  fog: { color: '#d3dbe5', near: 60, far: 1050 },
  light: { hemiSky: '#e2eaf4', hemiGround: '#8b97aa', hemiIntensity: 1.0, sunColor: '#dce6f5', sunIntensity: 0.9 },
  terrain: {
    extent: 1000,
    hillAmplitude: 18,
    hillScale: 220,
    edgeRise: { start: 520, end: 980, height: 85 },
    // Mostly hidden under the snow; they show in the snow's blend into rock on steep ground.
    bands: [
      { height: -12, color: '#dfe7ef' },
      { height: 0, color: '#e6ecf3' },
      { height: 20, color: '#d9e2ec' },
      { height: 45, color: '#cbd5e1' },
      { height: 70, color: '#bfcad8' }
    ],
    rock: '#5d6470',
    // Well below the lowest ground, so every gentle slope is snow and only steep faces show rock.
    snowLine: -40,
    snow: '#eef3f8'
  },
  water: { x: 20, z: -15, radius: 105, depth: 5, color: '#a9c6da', shallow: '#dce9f2', frozen: true },
  mountains: {
    radius: 1250,
    depth: 350,
    height: 460,
    base: '#7b8695',
    snow: '#f4f7fb',
    snowLine: 0.2,
    haze: '#cfd8e2'
  },
  clouds: { color: '#eef1f5', shadow: '#b4bfcb', height: 220 },
  vegetation: {
    pine: ['#173d2c', '#1c4632', '#20503a', '#14382a'],
    leafy: ['#6b5a45', '#7a6650'],
    birchBark: '#e4e2dc',
    // Bare twigs rather than leaves.
    birchLeaf: ['#8b7f70', '#9a8e7e', '#7d7466'],
    trunk: '#4a3628',
    bush: ['#2f4a3a', '#3a5444', '#34503f'],
    rock: ['#6d727b', '#7b8089', '#5f646c'],
    forestScale: 160,
    forestThreshold: 0.48,
    treeline: 75,
    species: { pine: 4, leafy: 0.05, birch: 0.6 },
    bushDensity: 0.4,
    rockDensity: 0.8,
    snow: { color: '#f4f7fb', amount: 0.85 }
  },
  roadside: {
    road: '#45484e',
    // Ploughed snow banks either side of the tarmac.
    verge: '#eef2f6',
    lines: '#f2f2ee',
    fence: '#4a3426',
    marker: '#f7f7f7',
    barrier: ['#ffffff', '#d7262e'],
    flags: ['#ff5a1f', '#ffd23f', '#2d7ff9', '#18b26b', '#b44dff', '#e63946'],
    shirts: ['#d62828', '#f77f00', '#fcbf49', '#e63946', '#9d0208', '#ff6b35', '#c1121f', '#f4a261'],
    skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'],
    hay: '#d9b45a',
    hayBales: 0
  },
  weather: {
    kind: 'snow',
    colors: ['#ffffff', '#eef4fb'],
    density: 1,
    size: 0.09,
    fallSpeed: 1.1,
    sway: 0.6,
    wind: [0.8, 0.3]
  }
};

/** Red and gold woods under a low warm sun, an amber haze and leaves on the wind. */
export const AUTUMN: Theme = {
  name: 'Autumn Forest',
  seed: 4721,
  sky: {
    zenith: '#5b8fc9',
    horizon: '#f0dcb8',
    sunColor: '#ffe2a8',
    sunDirection: [-0.6, 0.32, 0.55],
    glow: { size: 1.5, strength: 1.2 }
  },
  fog: { color: '#e6cfa4', near: 100, far: 1300 },
  light: { hemiSky: '#ffeccc', hemiGround: '#6b5532', hemiIntensity: 1.0, sunColor: '#ffd28f', sunIntensity: 1.7 },
  terrain: {
    extent: 1000,
    hillAmplitude: 16,
    hillScale: 240,
    edgeRise: { start: 520, end: 980, height: 75 },
    bands: [
      { height: -12, color: '#76863d' },
      { height: 0, color: '#8a8e44' },
      { height: 18, color: '#9a8a45' },
      { height: 40, color: '#8f7349' },
      { height: 60, color: '#7f6a52' }
    ],
    rock: '#8a7b6a',
    // Above the highest ground: no snow on the land, only on the far peaks.
    snowLine: 200,
    snow: '#f4f1ea'
  },
  water: { x: -25, z: 10, radius: 95, depth: 6, color: '#3b6f78', shallow: '#7da59a', frozen: false },
  mountains: {
    radius: 1250,
    depth: 350,
    height: 440,
    base: '#6e6150',
    snow: '#f3efe8',
    snowLine: 0.72,
    haze: '#d9c3a0'
  },
  clouds: { color: '#fff6e8', shadow: '#e2cfb5', height: 280 },
  vegetation: {
    pine: ['#1e4a30', '#244f35', '#1a4029'],
    leafy: ['#c0392b', '#d35400', '#e67e22', '#f39c12', '#b8461b', '#d9a21b'],
    birchBark: '#e9e6dc',
    birchLeaf: ['#f2c230', '#e8b020', '#f5d04a', '#d99a1c'],
    trunk: '#5a3c28',
    bush: ['#a0522d', '#b5651d', '#8b5a2b', '#9c7a2a'],
    rock: ['#8d8a83', '#9b978f', '#7f7b74'],
    forestScale: 170,
    forestThreshold: 0.47,
    treeline: 75,
    species: { pine: 0.3, leafy: 1.6, birch: 1.3 },
    bushDensity: 1,
    rockDensity: 0.9,
    snow: null
  },
  roadside: {
    road: '#3b3d42',
    verge: '#a89a78',
    lines: '#f2f2ee',
    fence: '#6e5038',
    marker: '#f7f7f7',
    barrier: ['#ffffff', '#d7262e'],
    flags: ['#ff5a1f', '#ffd23f', '#2d7ff9', '#18b26b', '#b44dff', '#e63946'],
    shirts: ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#ffd23f', '#ffffff', '#457b9d', '#ff5a1f'],
    skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'],
    hay: '#d9b45a',
    hayBales: 1.6
  },
  weather: {
    kind: 'leaves',
    colors: ['#d35400', '#c0392b', '#e67e22', '#f1c40f', '#b8461b'],
    density: 0.35,
    size: 0.16,
    fallSpeed: 0.9,
    sway: 1.4,
    wind: [1.2, 0.5]
  }
};

/** Evening: a low sun on the horizon, violet sky, lavender peaks and a big lake catching the glow. */
export const GOLDEN_HOUR: Theme = {
  name: 'Golden Hour Lakes',
  seed: 9103,
  sky: {
    zenith: '#3a3f7a',
    horizon: '#f6a96c',
    sunColor: '#ffcf8a',
    // Low, but high enough that the ground still catches light; any lower and the meadows go black.
    sunDirection: [0.75, 0.2, -0.6],
    glow: { size: 3, strength: 1.8 }
  },
  fog: { color: '#e7a07c', near: 150, far: 1600 },
  // Strong orange key from the low sun, cool purple fill from the sky and ground.
  light: { hemiSky: '#c2b2e8', hemiGround: '#7d5c74', hemiIntensity: 1.35, sunColor: '#ffaa66', sunIntensity: 2.2 },
  terrain: {
    extent: 1000,
    hillAmplitude: 12,
    hillScale: 280,
    edgeRise: { start: 520, end: 980, height: 60 },
    bands: [
      { height: -12, color: '#6f9440' },
      { height: 0, color: '#80a447' },
      { height: 18, color: '#93ad4d' },
      { height: 40, color: '#8a9a52' },
      { height: 60, color: '#8e8670' }
    ],
    rock: '#8a7a72',
    snowLine: 120,
    snow: '#fbe9de'
  },
  // Deep water reflects the violet zenith; the grazing shallows catch the horizon's peach.
  water: { x: 0, z: 0, radius: 125, depth: 7, color: '#8a6f9e', shallow: '#e9a47c', frozen: false },
  mountains: {
    radius: 1250,
    depth: 350,
    height: 400,
    base: '#6c5b8a',
    // Alpenglow.
    snow: '#f4c9c0',
    snowLine: 0.55,
    haze: '#c99aa8'
  },
  clouds: { color: '#ffc59a', shadow: '#9a7aa4', height: 300 },
  vegetation: {
    pine: ['#2a5a3a', '#2f6640', '#24503a'],
    leafy: ['#5f8f35', '#6e9c3a', '#7da844', '#8aa840'],
    birchBark: '#efe6da',
    birchLeaf: ['#9cbf4f', '#b0c95a', '#a8c255'],
    trunk: '#5e4030',
    bush: ['#4a7d33', '#588a39', '#517f36'],
    rock: ['#9a8a84', '#a69690', '#8a7c78'],
    forestScale: 200,
    forestThreshold: 0.55,
    treeline: 70,
    species: { pine: 0.8, leafy: 1.2, birch: 1.1 },
    bushDensity: 1,
    rockDensity: 1,
    snow: null
  },
  roadside: {
    road: '#55505e',
    verge: '#b8a184',
    lines: '#f2f2ee',
    fence: '#7a5a40',
    marker: '#f7f7f7',
    barrier: ['#ffffff', '#d7262e'],
    flags: ['#ff5a1f', '#ffd23f', '#2d7ff9', '#18b26b', '#b44dff', '#e63946'],
    shirts: ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#ffd23f', '#ffffff', '#457b9d', '#ff5a1f'],
    skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'],
    hay: '#e0b25a',
    hayBales: 1.3
  },
  // A few motes of pollen drifting in the low sunlight.
  weather: {
    kind: 'pollen',
    colors: ['#ffe2a0', '#fff0c8', '#ffd27a'],
    density: 0.15,
    size: 0.05,
    fallSpeed: 0.08,
    sway: 0.8,
    wind: [0.4, 0.2]
  }
};

/** Every theme by id (the ids match the map ids). */
export const THEMES = {
  alpine: ALPINE,
  winter: WINTER,
  autumn: AUTUMN,
  golden: GOLDEN_HOUR
} as const satisfies Record<string, Theme>;

export type ThemeId = keyof typeof THEMES;
