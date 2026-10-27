export type QualitySettings = {
  /** Terrain grid cells per side */
  terrainCells: number;
  /** Segments around the mountain ring */
  mountainSegments: number;
  trees: number;
  bushes: number;
  rocks: number;
  clouds: number;
  spectators: number;
  /** Weather particles around the camera (the theme's `weather.density` takes a share of these) */
  weather: number;
  /** Camera far plane / how far scenery is drawn, m */
  drawDistance: number;
};

/** For the original Bike's older GPU. */
export const LOW: QualitySettings = {
  terrainCells: 120,
  mountainSegments: 96,
  trees: 600,
  bushes: 250,
  rocks: 120,
  clouds: 8,
  spectators: 60,
  weather: 700,
  drawDistance: 2200
};

export const HIGH: QualitySettings = {
  terrainCells: 200,
  mountainSegments: 160,
  trees: 1400,
  bushes: 600,
  rocks: 260,
  clouds: 16,
  spectators: 160,
  weather: 1600,
  drawDistance: 2600
};
