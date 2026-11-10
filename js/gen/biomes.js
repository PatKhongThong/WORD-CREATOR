// Biome definitions and Whittaker-style classification (temperature × moisture, with elevation, polar-ice,
// volcanic-rift, and user biome-weight overrides).

export const B = {
  DEEP_OCEAN: 0, OCEAN: 1, SHALLOW: 2, SEA_ICE: 3, LAKE: 4, BEACH: 5, ICE: 6, TUNDRA: 7, TAIGA: 8,
  TEMPERATE_FOREST: 9, TEMPERATE_RAINFOREST: 10, GRASSLAND: 11, SHRUBLAND: 12, DESERT: 13, SAVANNA: 14,
  TROPICAL_FOREST: 15, RAINFOREST: 16, WETLAND: 17, ALPINE: 18, SNOW: 19, VOLCANIC: 20,
};

// color = cartographic biome map colour, natural = satellite-like physical colour
export const BIOMES = [
  { id: 0,  name: 'Deep Ocean',           color: [18, 44, 86],    natural: [9, 30, 60],     water: true },
  { id: 1,  name: 'Ocean',                color: [30, 74, 128],   natural: [16, 56, 98],    water: true },
  { id: 2,  name: 'Shallow Sea',          color: [56, 126, 170],  natural: [38, 112, 146],  water: true },
  { id: 3,  name: 'Sea Ice',              color: [214, 228, 238], natural: [220, 232, 240], water: true },
  { id: 4,  name: 'Lake',                 color: [64, 140, 196],  natural: [44, 108, 150],  water: true },
  { id: 5,  name: 'Beach',                color: [232, 214, 160], natural: [214, 198, 150] },
  { id: 6,  name: 'Ice Sheet',            color: [240, 246, 250], natural: [236, 242, 247] },
  { id: 7,  name: 'Tundra',               color: [150, 168, 150], natural: [128, 136, 116] },
  { id: 8,  name: 'Boreal Taiga',         color: [64, 112, 94],   natural: [42, 74, 58] },
  { id: 9,  name: 'Temperate Forest',     color: [76, 140, 72],   natural: [56, 98, 48] },
  { id: 10, name: 'Temperate Rainforest', color: [44, 116, 84],   natural: [36, 84, 56] },
  { id: 11, name: 'Grassland',            color: [166, 190, 98],  natural: [126, 146, 76] },
  { id: 12, name: 'Shrubland',            color: [190, 176, 112], natural: [150, 140, 90] },
  { id: 13, name: 'Desert',               color: [232, 202, 130], natural: [210, 178, 122] },
  { id: 14, name: 'Savanna',              color: [206, 184, 94],  natural: [164, 150, 82] },
  { id: 15, name: 'Tropical Forest',      color: [96, 160, 60],   natural: [62, 110, 42] },
  { id: 16, name: 'Rainforest',           color: [34, 124, 54],   natural: [30, 84, 40] },
  { id: 17, name: 'Wetland',              color: [92, 140, 120],  natural: [66, 98, 78] },
  { id: 18, name: 'Alpine',               color: [150, 136, 120], natural: [118, 106, 94] },
  { id: 19, name: 'Snowcap',              color: [250, 250, 252], natural: [244, 246, 250] },
  { id: 20, name: 'Volcanic Basalt',      color: [98, 42, 34],    natural: [58, 36, 34] },
];

export const isWater = (b) => b <= 4;
export const isOceanBiome = (b) => b <= 3;

export function classifyBiomes(grid, height, temp, moist, lakeMask, coast, flow, riverT, maxElev, maxDepth, P = {}, volcanicMask = null) {
  const { W, N, sinLat } = grid;
  const biome = new Uint8Array(N);

  const polarIce = P.polarIce ?? 0.35;          // 0..1
  const wTrop = P.biomeTropical ?? 0.55;        // 0..1
  const wTemp = P.biomeTemperate ?? 0.55;       // 0..1
  const wGrass = P.biomeGrassland ?? 0.55;      // 0..1
  const wDesert = P.biomeDesert ?? 0.45;        // 0..1
  const wTundra = P.biomeTundra ?? 0.45;        // 0..1
  const wIce = P.biomeIce ?? 0.40;              // 0..1
  const wVolc = P.biomeVolcanic ?? 0.20;        // 0..1

  const seaIceTemp = -14 + polarIce * 16;
  const iceTemp = -18 + (polarIce * 0.6 + wIce * 0.4) * 20;
  const tundraTemp = iceTemp + 4 + wTundra * 9;
  const volcThresh = 1.02 - wVolc * 0.62;

  for (let i = 0; i < N; i++) {
    const y = (i / W) | 0;
    const absLat = Math.abs(sinLat[y]);
    const h = height[i], t = temp[i], m = moist[i];
    if (h <= 0) {
      const depth = -h * maxDepth;
      if (t < seaIceTemp || absLat > 1.04 - polarIce * 0.35) biome[i] = B.SEA_ICE;
      else if (depth < 260 || coast[i] <= 1) biome[i] = B.SHALLOW;
      else if (depth > 3200) biome[i] = B.DEEP_OCEAN;
      else biome[i] = B.OCEAN;
      continue;
    }
    if (lakeMask[i]) { biome[i] = B.LAKE; continue; }
    const elev = h * maxElev;

    // Volcanic basalt provinces & active cordilleras
    if (wVolc > 0.02 && volcanicMask && volcanicMask[i] > volcThresh && elev > 650) {
      biome[i] = B.VOLCANIC;
      continue;
    }

    const desertCutoff = 0.08 + wDesert * 0.24 - (wGrass + wTemp + wTrop) * 0.04;
    const forestCutoff = 0.58 - (wTemp + wTrop) * 0.22 + wGrass * 0.1;

    let b;
    if (elev > 4200 || (elev > 2600 && t < iceTemp + 2)) b = B.SNOW;
    else if (elev > 2700) b = B.ALPINE;
    else if (t < iceTemp || absLat > 1.05 - (polarIce * 0.5 + wIce * 0.25) * 0.45) b = B.ICE;
    else if (t < tundraTemp) b = B.TUNDRA;
    else if (t < tundraTemp + 6) b = m < desertCutoff ? B.TUNDRA : B.TAIGA;
    else if (t < 21 - wTrop * 5) {
      if (m < desertCutoff) b = B.DESERT;
      else if (m < forestCutoff * 0.72) b = t > 13 ? B.SHRUBLAND : B.GRASSLAND;
      else if (m < forestCutoff) b = B.GRASSLAND;
      else if (m < 0.74) b = B.TEMPERATE_FOREST;
      else b = B.TEMPERATE_RAINFOREST;
    } else {
      if (m < desertCutoff * 1.1) b = B.DESERT;
      else if (m < forestCutoff) b = B.SAVANNA;
      else if (m < 0.66 - wTrop * 0.12) b = B.TROPICAL_FOREST;
      else b = B.RAINFOREST;
    }
    if (b !== B.SNOW && b !== B.ALPINE && b !== B.ICE) {
      if (elev < 120 && m > 0.66 && t > 4 && flow[i] > riverT * 0.5) b = B.WETLAND;
      else if (coast[i] === 1 && elev < 45 && t > 2 && b !== B.TUNDRA) b = B.BEACH;
    }
    biome[i] = b;
  }
  return biome;
}
