// Central reactive store + Web Worker generation dispatcher + Active Context (Region, Country, City, Label Filters).

import { generateWorld, defaultSettings } from './gen/index.js';
import { makeGrid } from './gen/grid.js';
import { loadPrefs, savePrefs, listSavedWorlds, saveWorldRecord, captureBaseSnapshot, applySavedOverridesToWorld } from './storage/db.js';
import { ensureWorldEditModel, defaultLabelFilters } from './worldModel.js';

class Store extends EventTarget {
  constructor() {
    super();
    this.prefs = loadPrefs();
    const initOverrides = { resolution: this.prefs.defaultResolution };
    if (typeof window !== 'undefined' && window.__INITIAL_SEED__) initOverrides.seed = window.__INITIAL_SEED__;
    this.draftSettings = defaultSettings(initOverrides);
    this.world = null;
    this.compareWorld = null;
    this.savedWorlds = [];
    this.generating = false;
    this.progress = { pct: 0, stage: '' };
    this.route = 'studio';
    this.explorerFocus = null; // { x, y, zoom, label, x2?, y2?, select? }
    this.explorationMode = false;
    this.globeOpen = false;

    // Connected Worldbuilding Context across Planet Studio, Land Editor, Civilization Editor, and City Builder
    this.activeRegion = null;    // { id, kind, name, x, y, spanW, spanH, continentId }
    this.activeCountryId = null; // number
    this.activeCityId = null;    // number
    this.labelFilters = defaultLabelFilters();

    this._jobId = 0;
    this._worker = null;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async refreshSaved() {
    this.savedWorlds = await listSavedWorlds();
    this.emit('saved-updated', this.savedWorlds);
    return this.savedWorlds;
  }

  updatePrefs(patch) {
    this.prefs = { ...this.prefs, ...patch };
    savePrefs(this.prefs);
    this.emit('prefs-updated', this.prefs);
  }

  setActiveRegion(region) {
    this.activeRegion = region;
    this.emit('context-updated', { region });
  }

  setActiveCountry(countryId) {
    this.activeCountryId = countryId;
    this.emit('context-updated', { countryId });
  }

  setActiveCity(cityId) {
    this.activeCityId = cityId;
    this.emit('context-updated', { cityId });
  }

  async generate(settings = this.draftSettings, opts = {}) {
    const jobId = ++this._jobId;
    this.generating = true;
    this.progress = { pct: 0.02, stage: 'Initializing planetary seed…' };
    this.emit('progress', this.progress);

    const finish = async (world) => {
      if (!world.grid) world.grid = makeGrid(world.W, world.H, world.radius);
      captureBaseSnapshot(world);
      ensureWorldEditModel(world);
      if (opts.overrides) {
        applySavedOverridesToWorld(world, { name: opts.overrides.name, overrides: opts.overrides, versions: opts.versions });
      }
      this.generating = false;
      if (opts.target === 'compare') {
        this.compareWorld = world;
        this.emit('compare-ready', world);
      } else {
        this.world = world;
        this.draftSettings = { ...world.settings };
        // Default active context to first continent / first country / first capital
        if (world.continents.length) {
          const c0 = world.continents[0];
          this.activeRegion = { id: c0.id, kind: 'continent', name: c0.name, x: c0.x, y: c0.y, spanW: Math.round(world.W * 0.24), spanH: Math.round(world.H * 0.28) };
        }
        this.activeCountryId = world.countries[0]?.id ?? null;
        this.activeCityId = world.cities[0]?.id ?? null;
        this.emit('world-ready', world);
        if (this.prefs.autoSaveOnGenerate) {
          await saveWorldRecord(world);
          await this.refreshSaved();
        }
      }
      return world;
    };

    const canUseWorker = this.prefs.useWorker && typeof Worker !== 'undefined' && typeof location !== 'undefined' && /^https?:$/i.test(location.protocol);
    if (canUseWorker) {
      try {
        if (!this._worker) {
          this._worker = new Worker(new URL('./gen/worker.js', import.meta.url), { type: 'module' });
        }
        return await new Promise((resolve, reject) => {
          const onMsg = (ev) => {
            const msg = ev.data;
            if (!msg || msg.jobId !== jobId) return;
            if (msg.type === 'progress') {
              this.progress = { pct: msg.pct, stage: msg.stage };
              this.emit('progress', this.progress);
            } else if (msg.type === 'done') {
              this._worker.removeEventListener('message', onMsg);
              finish(msg.world).then(resolve, reject);
            } else if (msg.type === 'error') {
              this._worker.removeEventListener('message', onMsg);
              reject(new Error(msg.message));
            }
          };
          const onErr = (err) => {
            this._worker.removeEventListener('error', onErr);
            reject(err);
          };
          this._worker.addEventListener('message', onMsg);
          this._worker.addEventListener('error', onErr, { once: true });
          this._worker.postMessage({ jobId, settings });
        });
      } catch {
        // Fallback to synchronous generation if Worker fails
      }
    }

    const world = generateWorld(settings, (pct, stage) => {
      this.progress = { pct, stage };
      this.emit('progress', this.progress);
    });
    return finish(world);
  }
}

export const store = new Store();
