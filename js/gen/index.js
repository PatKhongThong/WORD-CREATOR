// Top-level world generation orchestrator. Pure & deterministic: same settings + seed → identical World.

import { RNG, randomSeed } from '../core/rng.js';
import { resetNames, Language } from '../core/names.js';
import { uid, clamp } from '../core/utils.js';
import { makeGrid } from './grid.js';
import { generateTerrain, smoothLand } from './terrain.js';
import { generateClimate } from './climate.js';
import { coastDistance, generateHydrology, traceRivers } from './hydrology.js';
import { classifyBiomes } from './biomes.js';
import { extractFeatures, nameRivers } from './features.js';
import { generateCivilizations } from './civs.js';
import { generateHistory, generateLore } from './history.js';
import { computeStats, worldFingerprint } from './stats.js';

export const PLANET_SIZES = {
  dwarf:  { label: 'Dwarf (Mars-like)',   radius: 3400, maxElev: 9200, maxDepth: 6500 },
  small:  { label: 'Small Terrestrial',   radius: 4800, maxElev: 8800, maxDepth: 7500 },
  earth:  { label: 'Standard (Earth)',    radius: 6371, maxElev: 8850, maxDepth: 9500 },
  super:  { label: 'Super-Earth',         radius: 8200, maxElev: 7600, maxDepth: 10500 },
  giant:  { label: 'Mega-Terrestrial',    radius: 10200, maxElev: 6800, maxDepth: 11500 },
};

export const RESOLUTIONS = {
  fast:     { label: 'Fast (512 × 256)',      W: 512,  H: 256 },
  standard: { label: 'Standard (1024 × 512)', W: 1024, H: 512 },
  high:     { label: 'High (1536 × 768)',     W: 1536, H: 768 },
  ultra:    { label: 'Ultra (2048 × 1024)',   W: 2048, H: 1024 },
};

export const PRESETS = [
  { id: 'terran', name: 'Terran Standard', desc: 'Balanced Earth-like world with seven continents, clouds and temperate oceans.',
    settings: { size: 'earth', radiusKm: 6371, continents: 6, ocean: 0.70, mountains: 0.55, mountainIntensity: 0.65, terrainComplexity: 0.65, terrainRoughness: 0.55, craterFrequency: 0.12, elevationVariation: 0.65, islands: 0.45, climateVar: 0.55, globalTemp: 0, atmosphereDensity: 0.68, oceanColor: '#14497a', atmosphereColor: '#4cb8ff', cloudCoverage: 0.52, polarIce: 0.35, biomeTropical: 0.55, biomeTemperate: 0.55, biomeGrassland: 0.55, biomeDesert: 0.45, biomeTundra: 0.45, biomeIce: 0.40, biomeVolcanic: 0.18, distribution: 'scattered', countries: 16, historySpan: 3200 } },
  { id: 'pangaea', name: 'Grand Supercontinent', desc: 'One vast fused landmass ringed by a global Panthalassic ocean and deep interior deserts.',
    settings: { size: 'earth', radiusKm: 6600, continents: 5, ocean: 0.66, mountains: 0.70, mountainIntensity: 0.78, terrainComplexity: 0.70, terrainRoughness: 0.62, craterFrequency: 0.18, elevationVariation: 0.75, islands: 0.30, climateVar: 0.65, globalTemp: 1, atmosphereDensity: 0.65, oceanColor: '#103c68', atmosphereColor: '#56c2ff', cloudCoverage: 0.44, polarIce: 0.30, biomeTropical: 0.50, biomeTemperate: 0.50, biomeGrassland: 0.55, biomeDesert: 0.65, biomeTundra: 0.40, biomeIce: 0.35, biomeVolcanic: 0.28, distribution: 'supercontinent', countries: 18, historySpan: 3800 } },
  { id: 'thalassia', name: 'Thalassic Archipelago', desc: 'Pelagic world of island chains, volcanic arcs, atolls and maritime thalassocracies.',
    settings: { size: 'earth', radiusKm: 6100, continents: 7, ocean: 0.84, mountains: 0.50, mountainIntensity: 0.58, terrainComplexity: 0.75, terrainRoughness: 0.50, craterFrequency: 0.08, elevationVariation: 0.55, islands: 0.90, climateVar: 0.45, globalTemp: 3, atmosphereDensity: 0.78, oceanColor: '#0e5b88', atmosphereColor: '#42e0f5', cloudCoverage: 0.65, polarIce: 0.20, biomeTropical: 0.75, biomeTemperate: 0.55, biomeGrassland: 0.45, biomeDesert: 0.25, biomeTundra: 0.25, biomeIce: 0.20, biomeVolcanic: 0.35, distribution: 'archipelago', countries: 20, historySpan: 2800 } },
  { id: 'boreal', name: 'Frostbound Boreal', desc: 'Glaciated high-latitude continents, sea-ice shelves, taiga basins and hardy northern realms.',
    settings: { size: 'small', radiusKm: 4900, continents: 5, ocean: 0.64, mountains: 0.65, mountainIntensity: 0.70, terrainComplexity: 0.65, terrainRoughness: 0.60, craterFrequency: 0.22, elevationVariation: 0.68, islands: 0.40, climateVar: 0.75, globalTemp: -8, atmosphereDensity: 0.55, oceanColor: '#123254', atmosphereColor: '#8ad4ff', cloudCoverage: 0.48, polarIce: 0.75, biomeTropical: 0.15, biomeTemperate: 0.40, biomeGrassland: 0.40, biomeDesert: 0.25, biomeTundra: 0.82, biomeIce: 0.80, biomeVolcanic: 0.22, distribution: 'polar', countries: 12, historySpan: 2600 } },
  { id: 'xeric', name: 'Arid Dune & Crater World', desc: 'Sun-scorched super-continents, meteor impact basins, volcanic rifts and caravan empires.',
    settings: { size: 'dwarf', radiusKm: 3800, continents: 4, ocean: 0.36, mountains: 0.75, mountainIntensity: 0.82, terrainComplexity: 0.72, terrainRoughness: 0.72, craterFrequency: 0.68, elevationVariation: 0.80, islands: 0.20, climateVar: 0.80, globalTemp: 9, atmosphereDensity: 0.42, oceanColor: '#1d4f66', atmosphereColor: '#e89a54', cloudCoverage: 0.22, polarIce: 0.12, biomeTropical: 0.25, biomeTemperate: 0.25, biomeGrassland: 0.35, biomeDesert: 0.88, biomeTundra: 0.20, biomeIce: 0.12, biomeVolcanic: 0.62, distribution: 'equatorial', countries: 14, historySpan: 4200 } },
  { id: 'super', name: 'Verdant Super-Earth', desc: 'Massive warm world with nine continents, dense atmosphere, monsoon jungles and sprawling federations.',
    settings: { size: 'super', radiusKm: 8400, continents: 9, ocean: 0.72, mountains: 0.60, mountainIntensity: 0.65, terrainComplexity: 0.78, terrainRoughness: 0.58, craterFrequency: 0.14, elevationVariation: 0.65, islands: 0.60, climateVar: 0.50, globalTemp: 3, atmosphereDensity: 0.88, oceanColor: '#10547a', atmosphereColor: '#52c8ff', cloudCoverage: 0.62, polarIce: 0.28, biomeTropical: 0.78, biomeTemperate: 0.65, biomeGrassland: 0.60, biomeDesert: 0.38, biomeTundra: 0.35, biomeIce: 0.28, biomeVolcanic: 0.30, distribution: 'scattered', countries: 24, historySpan: 3600 } },
];

export function defaultSettings(overrides = {}) {
  return {
    name: '',
    seed: randomSeed(),
    resolution: 'standard',
    size: 'earth',
    radiusKm: 6371,
    terrainComplexity: 0.65,
    continents: 6,
    ocean: 0.70,
    mountains: 0.55,
    mountainIntensity: 0.65,
    terrainRoughness: 0.55,
    islands: 0.45,
    craterFrequency: 0.12,
    elevationVariation: 0.65,
    climateVar: 0.55,
    globalTemp: 0,
    atmosphereDensity: 0.68,
    oceanColor: '#14497a',
    atmosphereColor: '#4cb8ff',
    cloudCoverage: 0.52,
    polarIce: 0.35,
    biomeTropical: 0.55,
    biomeTemperate: 0.55,
    biomeGrassland: 0.55,
    biomeDesert: 0.45,
    biomeTundra: 0.45,
    biomeIce: 0.40,
    biomeVolcanic: 0.18,
    distribution: 'scattered',
    countries: 16,
    historySpan: 3200,
    ...overrides,
  };
}

export function normalizeSettings(s) {
  const d = defaultSettings(s);
  d.seed = String(d.seed || 'worldforge').trim() || 'worldforge';
  if (!PLANET_SIZES[d.size]) d.size = 'earth';
  d.radiusKm = clamp(Math.round(+d.radiusKm || PLANET_SIZES[d.size].radius), 2200, 12500);
  d.terrainComplexity = clamp(+d.terrainComplexity ?? 0.65, 0.1, 1);
  d.continents = clamp(Math.round(+d.continents || 6), 1, 14);
  d.ocean = clamp(+d.ocean || 0.7, 0.15, 0.90);
  d.mountains = clamp(+d.mountains ?? 0.55, 0.05, 1);
  d.mountainIntensity = clamp(+d.mountainIntensity ?? 0.65, 0.05, 1);
  d.terrainRoughness = clamp(+d.terrainRoughness ?? 0.55, 0.05, 1);
  d.islands = clamp(+d.islands ?? 0.45, 0, 1);
  d.craterFrequency = clamp(+d.craterFrequency ?? 0.12, 0, 1);
  d.elevationVariation = clamp(+d.elevationVariation ?? 0.65, 0.1, 1);
  d.climateVar = clamp(+d.climateVar ?? 0.55, 0.05, 1);
  d.globalTemp = clamp(+d.globalTemp || 0, -20, 20);
  d.atmosphereDensity = clamp(+d.atmosphereDensity ?? 0.68, 0, 1);
  d.cloudCoverage = clamp(+d.cloudCoverage ?? 0.52, 0, 1);
  d.polarIce = clamp(+d.polarIce ?? 0.35, 0, 1);
  d.biomeTropical = clamp(+d.biomeTropical ?? 0.55, 0, 1);
  d.biomeTemperate = clamp(+d.biomeTemperate ?? 0.55, 0, 1);
  d.biomeGrassland = clamp(+d.biomeGrassland ?? 0.55, 0, 1);
  d.biomeDesert = clamp(+d.biomeDesert ?? 0.45, 0, 1);
  d.biomeTundra = clamp(+d.biomeTundra ?? 0.45, 0, 1);
  d.biomeIce = clamp(+d.biomeIce ?? 0.40, 0, 1);
  d.biomeVolcanic = clamp(+d.biomeVolcanic ?? 0.18, 0, 1);
  d.oceanColor = /^#[0-9a-fA-F]{6}$/.test(d.oceanColor) ? d.oceanColor : '#14497a';
  d.atmosphereColor = /^#[0-9a-fA-F]{6}$/.test(d.atmosphereColor) ? d.atmosphereColor : '#4cb8ff';
  d.countries = clamp(Math.round(+d.countries || 16), 2, 36);
  d.historySpan = clamp(Math.round(+d.historySpan || 3200), 600, 8000);
  if (!RESOLUTIONS[d.resolution]) d.resolution = 'standard';
  if (!['scattered', 'supercontinent', 'archipelago', 'equatorial', 'polar'].includes(d.distribution)) d.distribution = 'scattered';
  return d;
}

/**
 * Generate a complete World object.
 * @param {object} rawSettings
 * @param {(pct:number, stage:string)=>void} [onProgress]
 */
export function generateWorld(rawSettings = {}, onProgress = () => {}) {
  const t0 = performance.now();
  resetNames();
  const S = normalizeSettings(rawSettings);
  const rng = new RNG(S.seed);
  const res = RESOLUTIONS[S.resolution];
  const sz = PLANET_SIZES[S.size];
  const radius = S.radiusKm || sz.radius;
  const maxElev = Math.round(sz.maxElev * (0.65 + S.elevationVariation * 0.55));
  const maxDepth = Math.round(sz.maxDepth * (0.7 + S.elevationVariation * 0.45));
  const grid = makeGrid(res.W, res.H, radius);

  const worldName = (S.name && S.name.trim()) ? S.name.trim() : new Language(rng.fork('world-name')).continent();

  onProgress(0.04, 'Synthesizing 3D spherical plates, craters & heightmap…');
  const { height, plateId, plateBoundary, volcanicMask, craterMask, plates } = generateTerrain(
    grid, S, rng.fork('terrain'),
    (p) => onProgress(0.04 + p * 0.34, 'Synthesizing 3D spherical plates, craters & heightmap…')
  );
  smoothLand(grid, height, 1);

  onProgress(0.42, 'Simulating atmospheric circulation & rain shadows…');
  const { temp, moist } = generateClimate(grid, S, rng.fork('climate'), height, maxElev);

  onProgress(0.52, 'Flood-filling basins & tracing river networks…');
  const coast = coastDistance(grid, height);
  const hyd = generateHydrology(grid, height, moist, temp, rng.fork('hydro'));
  const { rivers, riverId, isRiver } = traceRivers(grid, height, hyd);

  onProgress(0.66, 'Classifying Whittaker, polar & volcanic biomes…');
  const biome = classifyBiomes(grid, height, temp, moist, hyd.lakeMask, coast, hyd.flow, hyd.riverT, maxElev, maxDepth, S, volcanicMask);

  const world = {
    id: rawSettings.id || uid(),
    name: worldName,
    seed: S.seed,
    settings: { ...S, name: worldName },
    createdAt: rawSettings.createdAt || Date.now(),
    W: grid.W, H: grid.H, radius, maxElev, maxDepth,
    plates, riverT: hyd.riverT,
    grid,
    fields: {
      height, temp, moist, biome, coast,
      plateId, plateBoundary, volcanicMask, craterMask,
      flow: hyd.flow, recv: hyd.recv, lakeMask: hyd.lakeMask, riverId, isRiver,
      landmass: null, region: null, owner: null, pop: null, hab: null,
    },
    continents: [], islands: [], features: [], rivers,
    countries: [], cities: [], borders: [], history: [],
    stats: null, lore: null, fingerprint: '', generationMs: 0,
  };

  onProgress(0.73, 'Labelling continents, ranges & ecoregions…');
  const feat = extractFeatures(grid, world, rng.fork('features'));
  world.fields.landmass = feat.landmass;
  world.fields.region = feat.region;
  world.continents = feat.continents;
  world.islands = feat.islands;
  world.features = feat.features;
  nameRivers(grid, world, rivers, feat.langAt);

  onProgress(0.81, 'Expanding civilizations, borders & cities…');
  const civ = generateCivilizations(grid, world, rng.fork('civs'), S);
  world.fields.owner = civ.owner;
  world.fields.pop = civ.pop;
  world.countries = civ.countries;
  world.cities = civ.cities;
  world.borders = civ.borders;

  onProgress(0.90, 'Chronicling millennia of history & lore…');
  world.history = generateHistory(grid, world, rng.fork('history'), S.historySpan);
  onProgress(0.95, 'Computing planetary statistics…');
  world.stats = computeStats(grid, world);
  generateLore(grid, world, rng.fork('lore'));
  for (const c of world.continents) delete c.lang;
  for (const c of world.countries) { delete c._lang; delete c._rng; }

  world.fingerprint = worldFingerprint(world);
  world.generationMs = Math.round(performance.now() - t0);
  onProgress(1, 'Planet ready');
  return world;
}
