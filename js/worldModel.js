// Unified World Data Architecture, In-Place Editing & Undo/Redo Engine, and Legacy World Import/Migration Layer.
// Connects Planet Studio, Land Editor, Civilization Editor, City Builder, Flag Designer, World History, and Saved Worlds
// to the same live `store.world` instance and persists all user edits across saves, reloads, and JSON exports.

import { clamp, uid } from './core/utils.js';
import { B, BIOMES, classifyBiomes } from './gen/biomes.js';
import { coastDistance, generateHydrology, traceRivers } from './gen/hydrology.js';
import { generateClimate } from './gen/climate.js';
import { extractFeatures, nameRivers } from './gen/features.js';
import { computeStats, worldFingerprint } from './gen/stats.js';
import { generateLore, EVENT_CATEGORIES } from './gen/history.js';
import { generateCivilizations, GOVERNMENTS } from './gen/civs.js';
import { RNG } from './core/rng.js';
import { Language, STYLE_COUNT } from './core/names.js';
import { distKm, cellLatLon } from './gen/grid.js';

export const WORLD_SCHEMA_VERSION = '2.0';

export const LABEL_CATEGORIES = [
  { id: 'continents', label: 'Regions & Continents', default: true },
  { id: 'countries',  label: 'Countries',            default: true },
  { id: 'capitals',   label: 'Capitals',             default: true },
  { id: 'cities',     label: 'Cities & Towns',       default: true },
  { id: 'mountains',  label: 'Mountains & Landmarks',default: true },
  { id: 'rivers',     label: 'Rivers & Lakes',       default: true },
  { id: 'oceans',     label: 'Oceans & Seas',        default: true },
];

export function defaultLabelFilters() {
  return {
    continents: true,
    countries: true,
    capitals: true,
    cities: true,
    mountains: true,
    rivers: true,
    oceans: true,
  };
}

/** Ensure a generated or reopened `world` has all v2 editing arrays, undo/redo stacks, and metadata initialized. */
export function ensureWorldEditModel(world) {
  if (!world) return null;
  if (!world.schemaVersion) world.schemaVersion = WORLD_SCHEMA_VERSION;
  if (!Array.isArray(world.roads)) world.roads = [];
  if (!Array.isArray(world.landmarks)) world.landmarks = [];
  if (!Array.isArray(world.customLabels)) world.customLabels = [];
  if (!Array.isArray(world.savedFlags)) world.savedFlags = [];
  if (!Array.isArray(world.editOps)) world.editOps = [];
  if (!Array.isArray(world.versions)) world.versions = [];
  if (!world._undoStack) world._undoStack = [];
  if (!world._redoStack) world._redoStack = [];

  // Normalize countries for full editing (officialName, description, nationalColors, flag structure)
  for (const c of world.countries) {
    if (!c) continue;
    if (!c.formalName) c.formalName = `Republic of ${c.name}`;
    if (!c.description) c.description = c.lore?.overview || `Sovereign realm of ${c.formalName}, founded in Year ${c.founded || 100}.`;
    if (!c.colors || !c.colors.length) c.colors = ['#2158b8', '#f2efe6', '#d6b44a'];
    if (!c.flag) {
      c.flag = {
        pattern: 'tricolor-h',
        colors: c.colors.slice(0, 3),
        emblem: 'star',
        emblemColor: '#d6b44a',
        emblemX: 0.5,
        emblemY: 0.5,
        emblemScale: 1,
        proportion: '3:2',
        customText: '',
        textColor: '#ffffff',
      };
    } else {
      c.flag.emblemX = c.flag.emblemX ?? 0.5;
      c.flag.emblemY = c.flag.emblemY ?? 0.5;
      c.flag.emblemScale = c.flag.emblemScale ?? 1;
      c.flag.proportion = c.flag.proportion || '3:2';
      c.flag.customText = c.flag.customText ?? '';
      c.flag.textColor = c.flag.textColor || '#ffffff';
    }
    if (!c.language || typeof c.language === 'string') {
      const lName = typeof c.language === 'string' ? c.language : `${c.name}ic`;
      c.language = { name: lName, family: 'Common', feel: 'melodic', lexicon: { water: 'aqa', stone: 'kar', sun: 'sol', city: 'pol' }, samples: [c.name] };
    }
    if (!c.currency || typeof c.currency === 'string') {
      const cName = typeof c.currency === 'string' ? c.currency : `${c.name} Crown`;
      c.currency = { name: cName, unit: 'Crown', symbol: '₳', code: (c.name.slice(0, 2) + 'C').toUpperCase() };
    }
    if (!c.ruler) c.ruler = { title: 'Sovereign', name: `${c.name} I` };
    if (!c.culture) c.culture = { traits: ['Mercantile', 'Diplomatic'], religion: `Way of ${c.name}`, festival: 'Founder Jubilee' };
    if (!c.lore) c.lore = { overview: c.description, geopolitics: '', culture: '', architecture: '' };
  }

  // Normalize cities for City Builder (description, developmentLevel, layout elements)
  for (const ct of world.cities) {
    if (!ct) continue;
    if (ct.developmentLevel == null) {
      ct.developmentLevel = ct.type === 'capital' ? 5 : ct.importance >= 4 ? 4 : ct.importance === 3 ? 3 : ct.type === 'village' ? 1 : 2;
    }
    if (!ct.description) {
      const cName = world.countries[ct.countryId]?.formalName || 'Independent Frontier';
      ct.description = `${ct.name} is a ${ct.type} settlement in ${cName} with ${ct.population.toLocaleString()} inhabitants, established in Year ${ct.founded}.`;
    }
    if (!ct.layout) {
      ct.layout = generateDefaultCityLayout(world, ct);
    }
  }
  return world;
}

/** Deterministically build a starter local city layout (districts, roads, parks, port/airport) for the 2D City Map Editor. */
export function generateDefaultCityLayout(world, city) {
  const rng = new RNG(`${world.seed}::city-layout-${city.id}-${city.name}`);
  const zones = [];
  const roads = [];
  const tier = city.developmentLevel || city.importance || 2;
  const ringCount = clamp(tier + 2, 3, 8);

  // Radial & arterial roads from city center (0.5, 0.5)
  for (let k = 0; k < ringCount; k++) {
    const ang = (k / ringCount) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const len = rng.range(0.28, 0.44);
    roads.push({
      id: `rd-${k}`,
      kind: k < 2 ? 'highway' : 'avenue',
      points: [
        [0.5, 0.5],
        [clamp(0.5 + Math.cos(ang) * len * 0.5, 0.06, 0.94), clamp(0.5 + Math.sin(ang) * len * 0.5, 0.06, 0.94)],
        [clamp(0.5 + Math.cos(ang) * len, 0.05, 0.95), clamp(0.5 + Math.sin(ang) * len, 0.05, 0.95)],
      ],
    });
  }

  // Central civic/commercial core
  zones.push({ id: 'z-core', type: 'commercial', name: 'Civic Plaza & Market', x: 0.44, y: 0.44, w: 0.12, h: 0.12 });
  zones.push({ id: 'z-res-1', type: 'residential', name: 'Old Quarter', x: 0.30, y: 0.36, w: 0.13, h: 0.14 });
  zones.push({ id: 'z-res-2', type: 'residential', name: 'Eastgate Ward', x: 0.57, y: 0.40, w: 0.14, h: 0.13 });
  zones.push({ id: 'z-park-1', type: 'park', name: `${city.name} Botanical Commons`, x: 0.42, y: 0.27, w: 0.14, h: 0.11 });

  if (city.type === 'industrial' || tier >= 3) {
    zones.push({ id: 'z-ind-1', type: 'industrial', name: 'Foundry & Manufactory District', x: 0.24, y: 0.58, w: 0.16, h: 0.13 });
  }
  if (city.coastal || city.type === 'port') {
    zones.push({ id: 'z-port-1', type: 'port', name: `Harbor & Maritime Docks`, x: 0.62, y: 0.62, w: 0.18, h: 0.14 });
  }
  if (city.type === 'capital' || tier >= 4) {
    zones.push({ id: 'z-air-1', type: 'airport', name: `${city.name} Aerodrome`, x: 0.16, y: 0.18, w: 0.16, h: 0.10 });
  }
  return { zones, roads };
}

/** Clear cached layer & material canvases after any terrain/biome/political modification. */
export function invalidateWorldRenderCaches(world, { terrainChanged = false, bordersChanged = false } = {}) {
  if (!world) return;
  world._layerCache = new Map();
  if (terrainChanged) {
    world._shade = null;
    world._matMaps = null;
  }
  if (bordersChanged || terrainChanged) {
    world._borderCanvas = null;
  }
}

/** Push a reversible snapshot onto `world._undoStack` before a terrain/biome/territory edit stroke. */
export function pushWorldUndo(world, label = 'Edit') {
  if (!world) return;
  ensureWorldEditModel(world);
  const snap = {
    label,
    timestamp: Date.now(),
    height: new Float32Array(world.fields.height),
    biome: new Uint8Array(world.fields.biome),
    lakeMask: new Uint8Array(world.fields.lakeMask),
    isRiver: new Uint8Array(world.fields.isRiver),
    owner: new Int16Array(world.fields.owner),
    rivers: JSON.parse(JSON.stringify(world.rivers)),
    roads: JSON.parse(JSON.stringify(world.roads)),
    landmarks: JSON.parse(JSON.stringify(world.landmarks)),
    customLabels: JSON.parse(JSON.stringify(world.customLabels)),
    cities: JSON.parse(JSON.stringify(world.cities)),
    countries: JSON.parse(JSON.stringify(world.countries)),
  };
  world._undoStack.push(snap);
  if (world._undoStack.length > 25) world._undoStack.shift();
  world._redoStack = [];
}

function captureCurrentSnapshot(world, label) {
  return {
    label,
    timestamp: Date.now(),
    height: new Float32Array(world.fields.height),
    biome: new Uint8Array(world.fields.biome),
    lakeMask: new Uint8Array(world.fields.lakeMask),
    isRiver: new Uint8Array(world.fields.isRiver),
    owner: new Int16Array(world.fields.owner),
    rivers: JSON.parse(JSON.stringify(world.rivers)),
    roads: JSON.parse(JSON.stringify(world.roads)),
    landmarks: JSON.parse(JSON.stringify(world.landmarks)),
    customLabels: JSON.parse(JSON.stringify(world.customLabels)),
    cities: JSON.parse(JSON.stringify(world.cities)),
    countries: JSON.parse(JSON.stringify(world.countries)),
  };
}

function applySnapshot(world, snap) {
  world.fields.height.set(snap.height);
  world.fields.biome.set(snap.biome);
  world.fields.lakeMask.set(snap.lakeMask);
  world.fields.isRiver.set(snap.isRiver);
  world.fields.owner.set(snap.owner);
  world.rivers = JSON.parse(JSON.stringify(snap.rivers));
  world.roads = JSON.parse(JSON.stringify(snap.roads));
  world.landmarks = JSON.parse(JSON.stringify(snap.landmarks));
  world.customLabels = JSON.parse(JSON.stringify(snap.customLabels));
  world.cities = JSON.parse(JSON.stringify(snap.cities));
  world.countries = JSON.parse(JSON.stringify(snap.countries));
  recomputeDerivedWorldState(world, { light: true });
}

export function undoWorldEdit(world) {
  if (!world || !world._undoStack?.length) return null;
  const prev = world._undoStack.pop();
  world._redoStack.push(captureCurrentSnapshot(world, prev.label));
  applySnapshot(world, prev);
  return prev.label;
}

export function redoWorldEdit(world) {
  if (!world || !world._redoStack?.length) return null;
  const next = world._redoStack.pop();
  world._undoStack.push(captureCurrentSnapshot(world, next.label));
  applySnapshot(world, next);
  return next.label;
}

/**
 * Apply a terrain or biome brush operation around cell `(cx, cy)` with radius `radiusCells` and strength `strength` (0..1).
 * Tools:
 *  - 'raise' | 'lower' | 'smooth' | 'flatten' | 'mountain' | 'lake' | 'forest' | 'desert' | 'grassland' | 'snow' | 'eraser'
 */
export function applyTerrainBrush(world, { cx, cy, radiusCells = 6, strength = 0.45, tool = 'raise', targetElev = null }) {
  const { W, H, fields } = world;
  const { height, biome, lakeMask, isRiver, temp, moist, volcanicMask } = fields;
  const R = Math.max(1, Math.round(radiusCells));
  const R2 = R * R;
  const centerIdx = clamp(Math.floor(cy), 0, H - 1) * W + (((Math.floor(cx) % W) + W) % W);
  const flatH = targetElev != null ? targetElev : height[centerIdx];

  // For smooth tool, sample a copy of the region first
  let sumNeighbors = null;
  if (tool === 'smooth') {
    sumNeighbors = new Float32Array((2 * R + 1) * (2 * R + 1));
    for (let dy = -R; dy <= R; dy++) {
      const y = clamp(Math.floor(cy) + dy, 0, H - 1);
      const yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
      for (let dx = -R; dx <= R; dx++) {
        const x = ((Math.floor(cx) + dx) % W + W) % W;
        const xl = (x - 1 + W) % W, xr = (x + 1) % W;
        const avg = (
          height[y * W + x] * 2 +
          height[y * W + xl] + height[y * W + xr] +
          height[yu * W + x] + height[yd * W + x]
        ) / 6;
        sumNeighbors[(dy + R) * (2 * R + 1) + (dx + R)] = avg;
      }
    }
  }

  for (let dy = -R; dy <= R; dy++) {
    const y = Math.floor(cy) + dy;
    if (y < 0 || y >= H) continue;
    for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      const x = ((Math.floor(cx) + dx) % W + W) % W;
      const i = y * W + x;
      const falloff = Math.pow(1 - Math.sqrt(d2) / (R + 0.5), 1.6) * strength;

      if (tool === 'raise') {
        height[i] = clamp(height[i] + falloff * 0.14, -0.98, 0.99);
        if (height[i] > 0.01) lakeMask[i] = 0;
        reclassifySingleCellBiome(world, i);
      } else if (tool === 'lower') {
        height[i] = clamp(height[i] - falloff * 0.14, -0.98, 0.99);
        if (height[i] <= 0) {
          lakeMask[i] = 0;
          fields.owner[i] = -1;
        }
        reclassifySingleCellBiome(world, i);
      } else if (tool === 'smooth') {
        const avg = sumNeighbors[(dy + R) * (2 * R + 1) + (dx + R)];
        height[i] = clamp(height[i] + (avg - height[i]) * Math.min(1, falloff * 1.4), -0.98, 0.99);
        reclassifySingleCellBiome(world, i);
      } else if (tool === 'flatten') {
        height[i] = clamp(height[i] + (flatH - height[i]) * Math.min(1, falloff * 1.3), -0.98, 0.99);
        reclassifySingleCellBiome(world, i);
      } else if (tool === 'mountain') {
        const ridge = ((Math.sin(x * 0.45 + y * 0.31) + Math.cos(x * 0.27 - y * 0.52)) * 0.5 + 1) * 0.5;
        height[i] = clamp(Math.max(height[i], 0.05) + falloff * (0.16 + ridge * 0.16), 0.04, 0.99);
        lakeMask[i] = 0;
        biome[i] = height[i] > 0.62 ? B.SNOW : height[i] > 0.36 ? B.ALPINE : biome[i];
      } else if (tool === 'lake') {
        if (height[i] <= 0.02) height[i] = 0.04;
        lakeMask[i] = 1;
        biome[i] = B.LAKE;
      } else if (tool === 'forest') {
        if (height[i] <= 0) height[i] = 0.05;
        lakeMask[i] = 0;
        moist[i] = clamp(Math.max(moist[i], 0.62), 0, 1);
        biome[i] = temp[i] > 20 ? B.TROPICAL_FOREST : temp[i] < 4 ? B.TAIGA : B.TEMPERATE_FOREST;
      } else if (tool === 'desert') {
        if (height[i] <= 0) height[i] = 0.05;
        lakeMask[i] = 0;
        moist[i] = clamp(Math.min(moist[i], 0.14), 0, 1);
        biome[i] = B.DESERT;
      } else if (tool === 'grassland') {
        if (height[i] <= 0) height[i] = 0.05;
        lakeMask[i] = 0;
        moist[i] = clamp(0.45, 0, 1);
        biome[i] = temp[i] > 21 ? B.SAVANNA : B.GRASSLAND;
      } else if (tool === 'snow') {
        if (height[i] <= 0) {
          biome[i] = B.SEA_ICE;
        } else {
          lakeMask[i] = 0;
          biome[i] = height[i] > 0.32 ? B.SNOW : B.ICE;
        }
      } else if (tool === 'volcanic') {
        if (height[i] <= 0) height[i] = 0.18;
        lakeMask[i] = 0;
        if (volcanicMask) volcanicMask[i] = clamp(Math.max(volcanicMask[i], 0.82), 0, 1);
        biome[i] = B.VOLCANIC;
      } else if (tool === 'eraser') {
        lakeMask[i] = 0;
        isRiver[i] = 0;
        reclassifySingleCellBiome(world, i);
      }
    }
  }

  invalidateWorldRenderCaches(world, { terrainChanged: true });
}

export function reclassifySingleCellBiome(world, i) {
  const { fields, maxElev, maxDepth } = world;
  const h = fields.height[i];
  const t = fields.temp[i];
  const m = fields.moist[i];
  if (fields.lakeMask[i] && h > 0) { fields.biome[i] = B.LAKE; return; }
  if (h <= 0) {
    const d = -h * maxDepth;
    if (t < -1.8) fields.biome[i] = B.SEA_ICE;
    else if (d < 220) fields.biome[i] = B.COASTAL;
    else if (d < 3600) fields.biome[i] = B.OCEAN;
    else fields.biome[i] = B.DEEP_OCEAN;
    return;
  }
  const elev = h * maxElev;
  if (elev > 4400 || (elev > 2600 && t < -3)) { fields.biome[i] = B.SNOW; return; }
  if (elev > 2600) { fields.biome[i] = B.ALPINE; return; }
  if (t < -8) { fields.biome[i] = B.ICE; return; }
  if (t < 0) { fields.biome[i] = m > 0.35 ? B.TAIGA : B.TUNDRA; return; }
  if (m < 0.18) { fields.biome[i] = B.DESERT; return; }
  if (t > 21) {
    fields.biome[i] = m > 0.68 ? B.RAINFOREST : m > 0.44 ? B.TROPICAL_FOREST : B.SAVANNA;
    return;
  }
  if (t > 8) {
    fields.biome[i] = m > 0.68 ? B.TEMPERATE_RAINFOREST : m > 0.45 ? B.TEMPERATE_FOREST : m > 0.28 ? B.GRASSLAND : B.SHRUBLAND;
    return;
  }
  fields.biome[i] = m > 0.4 ? B.TAIGA : B.GRASSLAND;
}

/** Add a custom drawn river polyline (array of `{x, y}` cells) onto the planet. */
export function addCustomRiverPath(world, points, customName = null) {
  if (!world || !points || points.length < 2) return null;
  const { W, H, fields } = world;
  const cells = [];
  for (let k = 0; k < points.length; k++) {
    const x = ((Math.round(points[k].x) % W) + W) % W;
    const y = clamp(Math.round(points[k].y), 0, H - 1);
    const cell = y * W + x;
    if (!cells.length || cells[cells.length - 1] !== cell) {
      cells.push(cell);
      fields.isRiver[cell] = 1;
      if (fields.height[cell] <= 0) fields.height[cell] = 0.02;
    }
  }
  const id = world.rivers.length;
  const lang = new Language(new RNG(`${world.seed}::custom-river-${id}`));
  const river = {
    id,
    name: customName || lang.feature('river'),
    cells,
    mouthFlow: (world.riverT || 10) * 3.2,
    length: Math.max(80, Math.round(cells.length * (world.grid?.cellH || 35))),
    endsIn: 'ocean',
    custom: true,
  };
  for (const c of cells) fields.riverId[c] = id;
  world.rivers.push(river);
  invalidateWorldRenderCaches(world, { terrainChanged: true });
  return river;
}

/** Add a road polyline connecting points across a region. */
export function addCustomRoadPath(world, points, name = '') {
  if (!world || !points || points.length < 2) return null;
  ensureWorldEditModel(world);
  const road = {
    id: `road-${uid()}`,
    name: name || `Imperial Route ${world.roads.length + 1}`,
    points: points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
  };
  world.roads.push(road);
  return road;
}

/** Paint or erase sovereign country territory in a brush radius around `(cx, cy)`. */
export function paintCountryTerritory(world, { cx, cy, radiusCells = 6, countryId = 0 }) {
  const { W, H, fields } = world;
  const R = Math.max(1, Math.round(radiusCells));
  const R2 = R * R;
  for (let dy = -R; dy <= R; dy++) {
    const y = Math.floor(cy) + dy;
    if (y < 0 || y >= H) continue;
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R2) continue;
      const x = ((Math.floor(cx) + dx) % W + W) % W;
      const i = y * W + x;
      if (fields.height[i] > 0 && !fields.lakeMask[i]) {
        fields.owner[i] = countryId; // -1 erases sovereignty
      }
    }
  }
  recalculateCountryMetrics(world);
  invalidateWorldRenderCaches(world, { bordersChanged: true });
}

/** Recalculate each country's area, cellCount, coastal status, city membership, and population after edits. */
export function recalculateCountryMetrics(world) {
  const { W, N } = world.grid;
  const { owner, coast } = world.fields;
  const cellArea = world.grid.cellArea;
  for (const c of world.countries) {
    c.area = 0;
    c.cellCount = 0;
    c.coastal = false;
  }
  for (let i = 0; i < N; i++) {
    const o = owner[i];
    if (o >= 0 && world.countries[o]) {
      const c = world.countries[o];
      c.area += cellArea[(i / W) | 0];
      c.cellCount++;
      if (coast[i] === 1) c.coastal = true;
    }
  }
  for (const c of world.countries) {
    c.cities = world.cities.filter((ct) => ct.countryId === c.id).map((ct) => ct.id);
    const cityPop = c.cities.reduce((s, cid) => s + (world.cities[cid]?.population || 0), 0);
    if (!c.customPopulation) {
      c.population = Math.max(cityPop, Math.round((c.ruralPopulation || c.area * 12) + cityPop));
    }
    c.urbanization = c.population > 0 ? clamp(cityPop / c.population, 0.05, 0.98) : 0.35;
  }
  world.stats = computeStats(world.grid, world);
}

/** Recompute planetary statistics, landmass/biome features, and render caches after an editing session. */
export function recomputeDerivedWorldState(world, { light = false } = {}) {
  if (!world) return;
  if (!light) {
    world.fields.coast = coastDistance(world.grid, world.fields.height);
  }
  recalculateCountryMetrics(world);
  world.fingerprint = worldFingerprint(world);
  invalidateWorldRenderCaches(world, { terrainChanged: true, bordersChanged: true });
}

function hexToRgbArray(hex, fallback = [66, 184, 224]) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Create a new sovereign country with automatic territory around its capital `(x, y)`, initial heraldic flag, and capital city. */
export function createCountryOnWorld(world, data) {
  ensureWorldEditModel(world);
  const { W, H, fields } = world;
  const x = ((Math.round(data.x ?? W / 2) % W) + W) % W;
  const y = clamp(Math.round(data.y ?? H / 2), 0, H - 1);
  const cell = y * W + x;
  if (fields.height[cell] <= 0) fields.height[cell] = 0.14;
  fields.lakeMask[cell] = 0;

  const id = world.countries.length;
  const rng = new RNG(`${world.seed}::user-country-${id}-${Date.now()}`);
  const lang = new Language(rng, id % STYLE_COUNT);
  const name = (data.name || '').trim() || lang.countryRoot();
  const govType = data.government || 'Republic';
  const govObj = GOVERNMENTS.find((g) => g.type === govType) || GOVERNMENTS[2];
  const formalName = (data.formalName || '').trim() || govObj.formal(name);
  const primaryColor = data.color || '#3b7cf5';
  const secondaryColor = data.color2 || '#f2efe6';
  const tertiaryColor = data.color3 || '#e6b84c';
  const mapColor = hexToRgbArray(primaryColor);

  const flag = data.flag ? { ...data.flag } : {
    pattern: 'tricolor-h',
    colors: [primaryColor, secondaryColor, tertiaryColor],
    emblem: 'star',
    emblemColor: tertiaryColor,
    emblemX: 0.5,
    emblemY: 0.5,
    emblemScale: 1,
    proportion: '3:2',
    customText: '',
    textColor: '#ffffff',
  };

  const capName = (data.capitalName || '').trim() || lang.city();
  const founded = Number.isFinite(+data.founded) ? +data.founded : 450;
  const capPop = Number.isFinite(+data.capitalPopulation) ? +data.capitalPopulation : 420000;

  const capCity = {
    id: world.cities.length,
    name: capName,
    countryId: id,
    x,
    y,
    cell,
    type: 'capital',
    population: capPop,
    founded,
    importance: 5,
    developmentLevel: 5,
    region: 'National',
    elevation: Math.round(Math.max(10, fields.height[cell] * world.maxElev)),
    coastal: fields.coast[cell] === 1,
    onRiver: fields.isRiver[cell] === 1,
    description: `${capName} is the sovereign capital of ${formalName}, founded in Year ${founded}.`,
  };
  capCity.layout = generateDefaultCityLayout(world, capCity);
  world.cities.push(capCity);

  const country = {
    id,
    name,
    formalName,
    demonym: lang.demonym(name),
    government: govType,
    ruler: { title: govObj.ruler[0], name: data.rulerName || lang.person() },
    capitalCell: cell,
    capitalId: capCity.id,
    x,
    y,
    area: 0,
    cellCount: 0,
    coastal: capCity.coastal,
    mountainous: false,
    dominantBiomes: [fields.biome[cell]],
    founded,
    mapColor,
    colors: [primaryColor, secondaryColor, tertiaryColor],
    flag,
    population: Number.isFinite(+data.population) ? +data.population : capPop * 4,
    customPopulation: Number.isFinite(+data.population),
    urbanization: 0.42,
    culture: {
      traits: data.traits || ['Mercantile', 'Scholarly', 'Diplomatic'],
      religion: data.religion || `Order of ${name}`,
      festival: `${name} Founding Day`,
    },
    language: {
      name: (data.languageName || '').trim() || `${name}an`,
      family: lang.family,
      feel: lang.feel,
      lexicon: lang.lexicon(),
      samples: [capName, name],
    },
    currency: {
      name: (data.currencyName || '').trim() || `${name} Crown`,
      unit: 'Crown',
      symbol: data.currencySymbol || '₳',
      code: (name.replace(/[^a-z]/gi, '').slice(0, 2) + 'C').toUpperCase(),
    },
    motto: data.motto || 'Per Aspera Ad Astra',
    mottoMeaning: 'Through hardship to the stars',
    description: (data.description || '').trim() || `${formalName} is a sovereign ${govType.toLowerCase()} centered on its capital ${capName}.`,
    lore: {
      overview: (data.description || '').trim() || `${formalName} is a sovereign ${govType.toLowerCase()} centered on its capital ${capName}.`,
      geopolitics: `Governed from ${capName} as a ${govType}, maintaining territorial sovereignty across its heartland.`,
      culture: `Renowned for its ${(data.languageName || `${name}an`)} heritage and civic traditions.`,
      architecture: `Monuments and civic halls built in the classic style of ${capName}.`,
    },
    cities: [capCity.id],
    neighbors: [],
  };
  world.countries.push(country);

  // Claim initial territory radius around the capital
  paintCountryTerritory(world, { cx: x, cy: y, radiusCells: data.initialRadius || 14, countryId: id });

  // Add founding event to World History
  world.history.push({
    id: world.history.length,
    year: founded,
    era: founded < 900 ? 'Dawn Era' : founded < 2000 ? 'Classical Age' : 'Modern Era',
    category: 'founding',
    title: `Founding of ${formalName}`,
    description: `${formalName} is proclaimed at ${capName}, establishing the ${govType.toLowerCase()} and its national banner.`,
    countryIds: [id],
    regionName: capName,
    x,
    y,
    significance: 5,
  });
  world.history.sort((a, b) => a.year - b.year);
  world.history.forEach((ev, idx) => { ev.id = idx; });

  recalculateCountryMetrics(world);
  return country;
}

/** Regenerate a single country's identity (name, language, flag, government, lore) without regenerating the planet. */
export function regenerateSingleCountry(world, countryId) {
  const c = world.countries[countryId];
  if (!c) return null;
  const rng = new RNG(`${world.seed}::regen-country-${countryId}-${Date.now()}`);
  const lang = new Language(rng, rng.int(0, STYLE_COUNT - 1));
  const root = lang.countryRoot();
  const gov = rng.pick(GOVERNMENTS);
  c.name = root;
  c.formalName = gov.formal(root);
  c.demonym = lang.demonym(root);
  c.government = gov.type;
  c.ruler = { title: rng.pick(gov.ruler), name: lang.person() };
  c.language = {
    name: root + rng.pick(['ic', 'an', 'ish', 'i']),
    family: lang.family,
    feel: lang.feel,
    lexicon: lang.lexicon(),
    samples: [lang.city(), lang.person(), lang.root()],
  };
  c.currency = {
    name: `${root} ${rng.pick(['Crown', 'Sovereign', 'Mark', 'Florin', 'Sol', 'Ducat'])}`,
    unit: 'Crown',
    symbol: rng.pick(['₳', '₴', '₣', '₲', '₵', '₮']),
    code: (root.slice(0, 2) + 'C').toUpperCase(),
  };
  const cap = world.cities[c.capitalId];
  if (cap) cap.name = lang.city();
  c.description = `${c.formalName} is a ${c.government.toLowerCase()} governed from ${cap ? cap.name : 'its capital'}, speaking ${c.language.name}.`;
  c.lore.overview = c.description;
  invalidateWorldRenderCaches(world, { bordersChanged: true });
  return c;
}

/** Create or update a city on land at `(x, y)` and attach it to a country and geographical region. */
export function createCityOnWorld(world, data) {
  ensureWorldEditModel(world);
  const { W, H, fields } = world;
  const x = ((Math.round(data.x) % W) + W) % W;
  const y = clamp(Math.round(data.y), 0, H - 1);
  const cell = y * W + x;

  // Ensure city is placed on land
  if (fields.height[cell] <= 0) {
    fields.height[cell] = 0.06;
    fields.lakeMask[cell] = 0;
    reclassifySingleCellBiome(world, cell);
    invalidateWorldRenderCaches(world, { terrainChanged: true });
  }

  let countryId = data.countryId != null ? +data.countryId : fields.owner[cell];
  if ((countryId < 0 || !world.countries[countryId]) && world.countries.length > 0) {
    // Find nearest country if cell is unclaimed
    let best = 0, bestD = Infinity;
    for (const c of world.countries) {
      const d = distKm(world.grid, x, y, c.x, c.y);
      if (d < bestD) { bestD = d; best = c.id; }
    }
    countryId = best;
  }

  const country = world.countries[countryId];
  const rng = new RNG(`${world.seed}::city-${world.cities.length}-${Date.now()}`);
  const lang = new Language(rng, (countryId >= 0 ? countryId : 0) % STYLE_COUNT);
  const name = (data.name || '').trim() || lang.city();
  const type = data.type || 'major';
  const devLevel = clamp(+(data.developmentLevel ?? (type === 'capital' ? 5 : type === 'major' ? 4 : type === 'port' || type === 'industrial' ? 3 : type === 'town' ? 2 : 1)), 1, 5);
  const popDefault = { capital: 650000, major: 280000, port: 210000, industrial: 175000, agricultural: 48000, town: 22000, village: 4500 }[type] || 65000;
  const population = Math.max(250, Math.round(+(data.population || popDefault)));
  const founded = Math.max(1, Math.round(+(data.founded || (country ? country.founded + 120 : 600))));

  const city = {
    id: world.cities.length,
    name,
    countryId: country ? country.id : 0,
    x,
    y,
    cell,
    type,
    population,
    founded,
    importance: devLevel,
    developmentLevel: devLevel,
    region: devLevel >= 5 ? 'National' : devLevel >= 3 ? 'Regional' : 'Local',
    elevation: Math.round(Math.max(5, fields.height[cell] * world.maxElev)),
    coastal: fields.coast[cell] <= 1,
    onRiver: fields.isRiver[cell] === 1,
    description: (data.description || '').trim() || `${name} is a ${type} settlement in ${country ? country.formalName : 'the frontier'}, founded in Year ${founded}.`,
  };
  city.layout = generateDefaultCityLayout(world, city);
  world.cities.push(city);

  if (country) {
    if (!country.cities.includes(city.id)) country.cities.push(city.id);
    if (type === 'capital') {
      const oldCap = world.cities[country.capitalId];
      if (oldCap && oldCap.id !== city.id) oldCap.type = 'major';
      country.capitalId = city.id;
      country.capitalCell = cell;
      country.x = x;
      country.y = y;
    }
    // Claim immediate surroundings for this country
    paintCountryTerritory(world, { cx: x, cy: y, radiusCells: 4, countryId: country.id });
  }
  recalculateCountryMetrics(world);
  return city;
}

/** Add a manual historical event to `world.history` and sort chronologically. */
export function addManualHistoryEvent(world, data) {
  ensureWorldEditModel(world);
  const year = Math.max(1, Math.round(+data.year || 1000));
  const span = Math.max(world.settings.historySpan || 3200, year);
  world.settings.historySpan = span;
  const era = year < span * 0.25 ? 'Dawn Era' : year < span * 0.55 ? 'Classical Age' : year < span * 0.82 ? 'Age of Sail & Steam' : 'Modern Era';
  const ev = {
    id: world.history.length,
    year,
    era,
    category: data.category || 'political',
    title: (data.title || 'Historical Milestone').trim(),
    description: (data.description || '').trim() || 'Recorded in the planetary annals.',
    countryIds: Array.isArray(data.countryIds) ? data.countryIds.map(Number) : [],
    regionName: (data.regionName || 'Planetary Sector').trim(),
    x: clamp(Math.round(+(data.x ?? world.W / 2)), 0, world.W - 1),
    y: clamp(Math.round(+(data.y ?? world.H / 2)), 0, world.H - 1),
    significance: clamp(Math.round(+(data.significance || 4)), 1, 5),
    manual: true,
  };
  world.history.push(ev);
  world.history.sort((a, b) => a.year - b.year);
  world.history.forEach((e, idx) => { e.id = idx; });
  world.stats = computeStats(world.grid, world);
  return ev;
}

// ============================================================================
// SECTION 10: OLD WORLD DOWNLOAD IMPORT & MIGRATION ENGINE
// ============================================================================

/**
 * Inspect a parsed JSON object from any version of WorldForge (v1.0, 3D Upgrade v1.5, v2.0, or minimal seed/settings file)
 * and return a detailed compatibility & preview report without mutating state.
 */
export function inspectImportedWorldJSON(rawObj) {
  if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) {
    return {
      valid: false,
      reason: 'The selected file does not contain a valid JSON object.',
    };
  }

  const seed = rawObj.seed || rawObj.settings?.seed || rawObj.world?.seed;
  const name = rawObj.name || rawObj.settings?.name || rawObj.world?.name || 'Imported Planet';
  if (!seed && !rawObj.settings && !rawObj.countries && !rawObj.continents) {
    return {
      valid: false,
      reason: 'Missing required planetary seed, settings, and geographical arrays. This JSON file does not appear to be a WorldForge export.',
    };
  }

  let detectedVersion = 'v1.0 Legacy WorldForge Export';
  if (rawObj.schemaVersion === '2.0' || Array.isArray(rawObj.roads) || Array.isArray(rawObj.landmarks)) {
    detectedVersion = 'v2.0 WorldForge Studio Archive';
  } else if (rawObj.settings?.terrainComplexity != null || rawObj.settings?.craterFrequency != null || rawObj.settings?.biomeVolcanic != null) {
    detectedVersion = 'v1.5 3D Planet Generator Export';
  } else if (rawObj.generator && String(rawObj.generator).includes('v1.0')) {
    detectedVersion = 'v1.0 Legacy WorldForge Export';
  }

  const continentsCount = Array.isArray(rawObj.continents)
    ? rawObj.continents.length
    : (rawObj.statistics?.continentCount ?? rawObj.summary?.continents ?? rawObj.settings?.continents ?? 'Auto');
  const countriesCount = Array.isArray(rawObj.countries)
    ? rawObj.countries.length
    : (rawObj.statistics?.countryCount ?? rawObj.summary?.countries ?? rawObj.settings?.countries ?? 'Auto');
  const citiesCount = Array.isArray(rawObj.cities)
    ? rawObj.cities.length
    : (rawObj.statistics?.cityCount ?? rawObj.summary?.cities ?? 'Auto');
  const historyCount = Array.isArray(rawObj.history)
    ? rawObj.history.length
    : (rawObj.statistics?.eventCount ?? 'Auto');

  const missingFields = [];
  if (!rawObj.settings?.terrainComplexity) missingFields.push('3D terrain complexity & roughness');
  if (!rawObj.settings?.atmosphereDensity) missingFields.push('atmospheric scattering parameters');
  if (!Array.isArray(rawObj.roads)) missingFields.push('regional road & landmark layers');

  return {
    valid: true,
    name: String(name),
    seed: String(seed || 'legacy-seed'),
    detectedVersion,
    fingerprint: rawObj.fingerprint || 'Legacy',
    dimensions: rawObj.dimensions || { width: 1024, height: 512, radiusKm: rawObj.settings?.radiusKm || 6371 },
    continentsCount,
    countriesCount,
    citiesCount,
    historyCount,
    needsMigration: detectedVersion !== 'v2.0 WorldForge Studio Archive' || missingFields.length > 0,
    missingFields,
    compatibilityStatus: missingFields.length
      ? `Compatible (${detectedVersion} → auto-migrates ${missingFields.join(', ')})`
      : `Fully Compatible (${detectedVersion})`,
  };
}

/**
 * Migrate and reconstruct a full live `world` from any v1.0 / v1.5 / v2.0 JSON export.
 * - Preserves planet name, seed, custom settings, countries, flags, cities, geographical features, and history.
 * - Stores a backup of the original raw JSON under `localStorage['worldforge_import_backups_v1']`.
 * - Never overwrites existing saved worlds (assigns a fresh unique ID if a collision exists).
 */
export function migrateAndReconstructWorld(rawObj, generateWorldFn, existingIds = new Set()) {
  const report = inspectImportedWorldJSON(rawObj);
  if (!report.valid) throw new Error(report.reason);

  // 1. Save backup of original imported JSON before migration
  try {
    const backups = JSON.parse(localStorage.getItem('worldforge_import_backups_v1') || '[]');
    backups.unshift({
      backedUpAt: new Date().toISOString(),
      originalName: report.name,
      originalSeed: report.seed,
      detectedVersion: report.detectedVersion,
      rawPayload: rawObj,
    });
    localStorage.setItem('worldforge_import_backups_v1', JSON.stringify(backups.slice(0, 10)));
  } catch {}

  // 2. Normalize settings with safe defaults for any missing v1.5 / v2.0 parameters
  const rawSettings = rawObj.settings || {};
  const mergedSettings = {
    ...rawSettings,
    name: report.name,
    seed: report.seed,
    radiusKm: rawObj.dimensions?.radiusKm || rawSettings.radiusKm || 6371,
  };

  // Ensure we never overwrite an existing world ID
  let targetId = rawObj.id || uid();
  if (existingIds.has(targetId)) {
    targetId = `${targetId}-imported-${uid().slice(0, 5)}`;
  }

  // 3. Deterministically synthesize the base spherical terrain/hydrology/biome grid from seed & settings
  const world = generateWorldFn({ ...mergedSettings, id: targetId });
  world.name = report.name;
  world.settings.name = report.name;
  ensureWorldEditModel(world);

  // 4. Restore compact raster edits if present (v2.0 delta format)
  if (Array.isArray(rawObj.cellEdits)) {
    for (const [idx, h, b, lk, rv, ow] of rawObj.cellEdits) {
      if (idx >= 0 && idx < world.W * world.H) {
        if (h != null) world.fields.height[idx] = h;
        if (b != null) world.fields.biome[idx] = b;
        if (lk != null) world.fields.lakeMask[idx] = lk;
        if (rv != null) world.fields.isRiver[idx] = rv;
        if (ow != null) world.fields.owner[idx] = ow;
      }
    }
  }

  // 5. Preserve imported continents & geographical feature names/coordinates if present
  if (Array.isArray(rawObj.continents) && rawObj.continents.length) {
    rawObj.continents.forEach((ic, idx) => {
      if (world.continents[idx] && ic.name) {
        world.continents[idx].name = ic.name;
        if (ic.lore) world.continents[idx].lore = ic.lore;
      }
    });
  }
  if (Array.isArray(rawObj.features) && rawObj.features.length) {
    rawObj.features.forEach((f, idx) => {
      if (world.features[idx] && f.name) {
        world.features[idx].name = f.name;
      }
    });
  }

  // 6. Preserve imported countries, flags, languages, currencies, and cities if present
  if (Array.isArray(rawObj.countries) && rawObj.countries.length) {
    world.countries = rawObj.countries.map((c, idx) => ({
      ...c,
      id: idx,
      mapColor: Array.isArray(c.mapColor) ? c.mapColor : [66, 152, 224],
      colors: Array.isArray(c.colors) && c.colors.length ? c.colors : ['#2158b8', '#f2efe6', '#d6b44a'],
    }));
  }
  if (Array.isArray(rawObj.cities) && rawObj.cities.length) {
    world.cities = rawObj.cities.map((ct, idx) => ({
      ...ct,
      id: idx,
      x: clamp(Math.round(ct.x ?? 0), 0, world.W - 1),
      y: clamp(Math.round(ct.y ?? 0), 0, world.H - 1),
    }));
  }
  if (Array.isArray(rawObj.history) && rawObj.history.length) {
    world.history = rawObj.history.map((ev, idx) => ({ ...ev, id: idx }));
  }
  if (Array.isArray(rawObj.roads)) world.roads = rawObj.roads;
  if (Array.isArray(rawObj.landmarks)) world.landmarks = rawObj.landmarks;
  if (Array.isArray(rawObj.customLabels)) world.customLabels = rawObj.customLabels;
  if (Array.isArray(rawObj.savedFlags)) world.savedFlags = rawObj.savedFlags;
  if (rawObj.lore) world.lore = { ...world.lore, ...rawObj.lore };

  ensureWorldEditModel(world);
  recomputeDerivedWorldState(world, { light: true });
  world.migrationReport = report;
  return world;
}
