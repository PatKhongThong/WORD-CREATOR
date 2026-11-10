//Persistence (IndexedDB with LocalStorage fallback), Version Snapshots, Duplicate, and v2.0 JSON / Legacy Migration utilities.

import { getLayerCanvas } from '../render/layers.js';
import { ensureWorldEditModel, recomputeDerivedWorldState, WORLD_SCHEMA_VERSION } from '../worldModel.js';
import { uid } from '../core/utils.js';

const DB_NAME = 'worldforge_db_v1';
const STORE = 'worlds';
const LS_FALLBACK = 'worldforge_saved_worlds_v1';
const LS_PREFS = 'worldforge_prefs_v1';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('No IndexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function makeThumbnail(world) {
  try {
    const src = getLayerCanvas(world, 'physical');
    const c = document.createElement('canvas');
    c.width = 240; c.height = 120;
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } catch {
    return '';
  }
}

/** Extract compact cell edits relative to `world._initialHeight` / `world._initialBiome` / `world._initialOwner` if present. */
export function extractCompactCellEdits(world) {
  if (!world || !world._baseSnapshot) return [];
  const edits = [];
  const { height, biome, lakeMask, isRiver, owner } = world.fields;
  const B0 = world._baseSnapshot;
  const N = world.W * world.H;
  for (let i = 0; i < N; i++) {
    if (
      Math.abs(height[i] - B0.height[i]) > 1e-4 ||
      biome[i] !== B0.biome[i] ||
      lakeMask[i] !== B0.lakeMask[i] ||
      isRiver[i] !== B0.isRiver[i] ||
      owner[i] !== B0.owner[i]
    ) {
      edits.push([i, Number(height[i].toFixed(4)), biome[i], lakeMask[i], isRiver[i], owner[i]]);
    }
  }
  return edits;
}

export function captureBaseSnapshot(world) {
  if (!world || world._baseSnapshot) return;
  world._baseSnapshot = {
    height: new Float32Array(world.fields.height),
    biome: new Uint8Array(world.fields.biome),
    lakeMask: new Uint8Array(world.fields.lakeMask),
    isRiver: new Uint8Array(world.fields.isRiver),
    owner: new Int16Array(world.fields.owner),
  };
}

export function applySavedOverridesToWorld(world, rec) {
  if (!world || !rec) return world;
  ensureWorldEditModel(world);
  const ov = rec.overrides || {};
  if (rec.name) {
    world.name = rec.name;
    world.settings.name = rec.name;
  }
  let mutated = false;
  if (Array.isArray(ov.cellEdits) && ov.cellEdits.length) {
    for (const [idx, h, b, lk, rv, ow] of ov.cellEdits) {
      if (idx >= 0 && idx < world.W * world.H) {
        world.fields.height[idx] = h;
        world.fields.biome[idx] = b;
        world.fields.lakeMask[idx] = lk;
        world.fields.isRiver[idx] = rv;
        world.fields.owner[idx] = ow;
      }
    }
    mutated = true;
  }
  if (Array.isArray(ov.countries) && ov.countries.length) { world.countries = ov.countries; mutated = true; }
  if (Array.isArray(ov.cities) && ov.cities.length) { world.cities = ov.cities; mutated = true; }
  if (Array.isArray(ov.history) && ov.history.length) { world.history = ov.history; mutated = true; }
  if (Array.isArray(ov.rivers) && ov.rivers.length) { world.rivers = ov.rivers; mutated = true; }
  if (Array.isArray(ov.roads)) { world.roads = ov.roads; mutated = true; }
  if (Array.isArray(ov.landmarks)) { world.landmarks = ov.landmarks; mutated = true; }
  if (Array.isArray(ov.customLabels)) { world.customLabels = ov.customLabels; mutated = true; }
  if (Array.isArray(ov.savedFlags)) { world.savedFlags = ov.savedFlags; }
  if (Array.isArray(rec.versions)) { world.versions = rec.versions; }
  ensureWorldEditModel(world);
  if (mutated) recomputeDerivedWorldState(world, { light: true });
  return world;
}

export function buildSaveRecord(world, { saveVersionLabel = null } = {}) {
  ensureWorldEditModel(world);
  const cellEdits = extractCompactCellEdits(world);
  const hasEdits = cellEdits.length > 0 || (world.roads?.length > 0) || (world.landmarks?.length > 0) || (world.customLabels?.length > 0) || !!world._entitiesEdited;
  const overrides = {
    ...(world.overrides || {}),
    name: world.name,
  };
  if (hasEdits) {
    overrides.cellEdits = cellEdits;
    overrides.countries = world.countries;
    overrides.cities = world.cities;
    overrides.history = world.history;
    overrides.rivers = world.rivers;
    overrides.roads = world.roads;
    overrides.landmarks = world.landmarks;
    overrides.customLabels = world.customLabels;
    overrides.savedFlags = world.savedFlags;
  }
  const versions = Array.isArray(world.versions) ? world.versions.slice(0, 12) : [];
  if (saveVersionLabel) {
    versions.unshift({
      versionId: uid(),
      label: saveVersionLabel,
      savedAt: Date.now(),
      fingerprint: world.fingerprint,
      settings: { ...world.settings, name: world.name },
      overrides: JSON.parse(JSON.stringify(overrides)),
    });
    world.versions = versions.slice(0, 12);
  }
  return {
    id: world.id,
    schemaVersion: WORLD_SCHEMA_VERSION,
    name: world.name,
    seed: world.seed,
    createdAt: world.createdAt || Date.now(),
    updatedAt: Date.now(),
    fingerprint: world.fingerprint,
    settings: { ...world.settings, name: world.name },
    overrides,
    versions: world.versions,
    thumbnail: makeThumbnail(world),
    summary: {
      oceanPct: world.stats.oceanPct,
      landArea: world.stats.landArea,
      continents: world.stats.continentCount,
      countries: world.stats.countryCount,
      cities: world.stats.cityCount,
      population: world.stats.totalPopulation,
      avgTemp: world.stats.avgTemp,
      biomes: world.stats.activeBiomes,
      terrainVariation: world.stats.terrainVariation,
    },
  };
}

export async function saveWorldRecord(world, opts = {}) {
  const rec = buildSaveRecord(world, opts);
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    const list = readLSList().filter((x) => x.id !== rec.id);
    list.unshift(rec);
    try { localStorage.setItem(LS_FALLBACK, JSON.stringify(list)); } catch {}
  }
  const list = readLSList().filter((x) => x.id !== rec.id);
  list.unshift(rec);
  try { localStorage.setItem(LS_FALLBACK, JSON.stringify(list.slice(0, 50))); } catch {}
  return rec;
}

export async function duplicateSavedWorld(id) {
  const all = await listSavedWorlds();
  const src = all.find((w) => w.id === id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  copy.name = `${src.name} (Copy)`;
  if (copy.settings) copy.settings.name = copy.name;
  if (copy.overrides) copy.overrides.name = copy.name;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(copy);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {}
  const list = readLSList();
  list.unshift(copy);
  try { localStorage.setItem(LS_FALLBACK, JSON.stringify(list.slice(0, 50))); } catch {}
  return copy;
}

export async function listSavedWorlds() {
  try {
    const db = await openDB();
    const rows = await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
    if (rows.length) return rows.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  } catch {}
  return readLSList().sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
}

export async function deleteSavedWorld(id) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {}
  const list = readLSList().filter((x) => x.id !== id);
  try { localStorage.setItem(LS_FALLBACK, JSON.stringify(list)); } catch {}
}

export async function renameSavedWorld(id, newName) {
  const all = await listSavedWorlds();
  const rec = all.find((w) => w.id === id);
  if (!rec) return null;
  rec.name = newName;
  rec.settings.name = newName;
  if (rec.overrides) rec.overrides.name = newName;
  rec.updatedAt = Date.now();
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {}
  const list = readLSList().map((x) => (x.id === id ? rec : x));
  try { localStorage.setItem(LS_FALLBACK, JSON.stringify(list)); } catch {}
  return rec;
}

export async function clearAllSavedWorlds() {
  try {
    const db = await openDB();
    await new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => res();
    });
  } catch {}
  try { localStorage.removeItem(LS_FALLBACK); } catch {}
}

function readLSList() {
  try { return JSON.parse(localStorage.getItem(LS_FALLBACK) || '[]'); } catch { return []; }
}

export function loadPrefs() {
  const defaults = {
    defaultResolution: 'standard',
    units: 'metric',
    useWorker: true,
    autoSaveOnGenerate: false,
    showGraticule: false,
    globeAutoRotate: true,
    sidebarCollapsed: false,
  };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(LS_PREFS) || '{}') }; } catch { return defaults; }
}

export function savePrefs(prefs) {
  try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch {}
}

/** Export complete world metadata, civilizations, cities, features, timeline, custom user edits, and statistics as JSON. */
export function serializeWorldJSON(world) {
  ensureWorldEditModel(world);
  const cellEdits = extractCompactCellEdits(world);
  return JSON.stringify({
    generator: 'WorldForge Planetary Worldbuilding & Civilization Platform v2.0',
    schemaVersion: WORLD_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    id: world.id,
    name: world.name,
    seed: world.seed,
    fingerprint: world.fingerprint,
    dimensions: { width: world.W, height: world.H, radiusKm: world.radius, maxElevationM: world.maxElev, maxDepthM: world.maxDepth },
    settings: world.settings,
    lore: world.lore,
    statistics: world.stats,
    continents: world.continents,
    islands: world.islands.filter((i) => i.name),
    features: world.features,
    rivers: world.rivers.filter((r) => r.name || r.custom).map((r) => ({ id: r.id, name: r.name, lengthKm: r.length, endsIn: r.endsIn, cells: r.custom ? r.cells : undefined, custom: r.custom })),
    countries: world.countries,
    cities: world.cities,
    history: world.history,
    roads: world.roads,
    landmarks: world.landmarks,
    customLabels: world.customLabels,
    savedFlags: world.savedFlags,
    cellEdits,
  }, null, 2);
}

export function triggerDownload(filename, href) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 250);
}

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  triggerDownload(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
