// Section 3: Advanced 3D Planetary Exploration & Configuration Platform (+ 2D Atlas & Solar System modes).
// Implements:
//  - Central 3D Planet Viewport (default experience on launch) with 2D Atlas & Solar System switchers
//  - 8 Visualization Modes: Realistic, Topographic, Biome, Political, Temperature, Elevation, Geological, Wireframe
//  - Collapsible Right Planet Configuration Panel (GENERAL, TERRAIN, ENVIRONMENT, BIOMES) + GENERATE PLANET CTA
//  - Floating Location & Feature Inspector + Gazetteer
//  - Bottom Telemetry & Time-of-Day / Camera / Quality Control Bar

import { store } from '../state.js';
import { BASE_LAYERS, OVERLAYS } from '../render/layers.js';
import { PRESETS } from '../gen/index.js';
import { MapViewport } from '../render/mapRenderer.js';
import { GlobeViewer } from '../render/globe.js';
import { flagToSVG } from '../render/flags.js';
import { randomSeed } from '../core/rng.js';
import { formatInt, formatCompact, escapeHtml } from '../core/utils.js';
import { saveWorldRecord, serializeWorldJSON, downloadText, triggerDownload } from '../storage/db.js';
import { toast } from '../ui/widgets.js';

let activeViewport = null;
let activeGlobe = null;

const VIS_MODES = [
  { id: 'physical',    label: 'Realistic',   desc: 'Natural planetary surface, ocean glint, clouds & atmospheric scattering' },
  { id: 'topographic', label: 'Topographic', desc: 'Stepped contour isolines & hypsometric relief' },
  { id: 'biomes',      label: 'Biome',       desc: 'Whittaker ecological & volcanic biome regions' },
  { id: 'countries',   label: 'Political',   desc: 'Sovereign territories, capitals & borders' },
  { id: 'climate',     label: 'Temperature', desc: 'Surface temperature distribution (°C)' },
  { id: 'elevation',   label: 'Elevation',   desc: 'Thermal elevation & trench depth heatmap' },
  { id: 'geological',  label: 'Geological',  desc: 'Tectonic plates, fault boundaries, volcanic rifts & impact craters' },
  { id: 'wireframe',   label: 'Wireframe',   desc: 'Planetary geodesic mesh visualization' },
];

export function getActiveViewport() { return activeViewport; }
export function getActiveGlobe() { return activeGlobe; }

export function renderExplorer(root) {
  const w = store.world;
  if (!w) {
    root.innerHTML = `<div class="wf-empty">Synthesizing planetary environment…</div>`;
    return;
  }
  if (activeGlobe) { activeGlobe.dispose(); activeGlobe = null; }
  const S = { ...w.settings };
  const viewMode = store.explorerViewMode || '3d'; // '3d' | '2d' | 'system'

  root.innerHTML = `
    <div class="wf-planet-studio ${store.explorationMode ? 'is-clean-mode' : ''}" id="exp-shell">
      <!-- Top Visualization Mode & Viewport Switcher Bar -->
      <div class="wf-map-toolbar" id="exp-toolbar">
        <div class="wf-view-mode-switch" role="tablist" aria-label="Viewport Mode">
          <button class="wf-vmode-btn ${viewMode === '3d' ? 'is-active' : ''}" data-vmode="3d" title="Interactive 3D Planet">🌐 3D Planet</button>
          <button class="wf-vmode-btn ${viewMode === '2d' ? 'is-active' : ''}" data-vmode="2d" title="2D Cartographic Map">🗺 2D Atlas</button>
          <button class="wf-vmode-btn ${viewMode === 'system' ? 'is-active' : ''}" data-vmode="system" title="Miniature Planetary System">☀ Solar System</button>
        </div>

        <div class="wf-layer-group" role="tablist" aria-label="Visualization Modes">
          ${VIS_MODES.map((m, i) => `
            <button class="wf-layer-btn ${i === 0 ? 'is-active' : ''}" data-layer="${m.id}" title="${escapeHtml(m.desc)}">${escapeHtml(m.label)}</button>
          `).join('')}
        </div>

        <div class="wf-map-actions">
          <button class="wf-btn wf-btn-ghost wf-btn-sm" id="exp-discover-btn" title="Fly to a random geographical landmark or settlement">✦ Discover</button>
          <button class="wf-btn wf-btn-ghost wf-btn-sm" id="exp-png-btn" title="Export 3D planet screenshot or 2D map as PNG">⤓ PNG</button>
          <button class="wf-btn wf-btn-ghost wf-btn-sm" id="exp-json-btn" title="Export planet configuration & telemetry as JSON">⤓ JSON</button>
          <button class="wf-btn wf-btn-ghost wf-btn-sm" id="exp-clean-btn" title="Fullscreen exploration mode">⛶ Fullscreen</button>
          <button class="wf-btn wf-btn-ghost wf-btn-sm" id="exp-toggle-cfg" title="Toggle right configuration panel">⚙ Panel</button>
        </div>
      </div>

      <button class="wf-clean-exit-btn" id="exp-clean-exit">✕ Exit Fullscreen Exploration</button>

      <!-- Central 3D & 2D Viewport Stage -->
      <div class="wf-map-stage" id="exp-stage">
        <!-- 3D Planet & Solar System Mount (Default visible) -->
        <div class="wf-globe-stage" id="exp-globe-stage" ${viewMode === '2d' ? 'hidden' : ''}>
          <div class="wf-globe-canvas-wrap" id="exp-globe-mount"></div>
        </div>

        <!-- 2D Equirectangular Atlas Canvas -->
        <canvas id="exp-canvas" ${viewMode === '2d' ? '' : 'hidden'}></canvas>

        <!-- Floating Location Information & Gazetteer Card (Left side of viewport) -->
        <aside class="wf-floating-inspector" id="exp-inspector">
          ${renderDefaultInspector(w)}
        </aside>

        <!-- Zoom, Camera Reset & Auto-Rotate Pod -->
        <div class="wf-zoom-pod">
          <button id="exp-zoom-in" title="Zoom in">+</button>
          <span id="exp-zoom-readout">1.0×</span>
          <button id="exp-zoom-out" title="Zoom out">−</button>
          <button id="exp-zoom-reset" title="Reset camera">⌂</button>
        </div>

        <!-- Bottom Information & Environmental Simulation Bar -->
        <div class="wf-map-hud">
          <div class="wf-sim-controls-bar">
            <label class="wf-sim-chip"><input type="checkbox" id="sim-autorotate" checked/> <span>Auto-Rotate</span></label>
            <label class="wf-sim-chip"><input type="checkbox" id="sim-clouds" checked/> <span>Clouds</span></label>
            <label class="wf-sim-chip"><input type="checkbox" id="sim-atmo" checked/> <span>Atmosphere</span></label>
            <label class="wf-sim-chip"><input type="checkbox" id="sim-borders" checked/> <span>Borders</span></label>
            <label class="wf-sim-chip"><input type="checkbox" id="sim-labels" checked/> <span>Labels</span></label>
            <div class="wf-sim-slider" title="Change solar lighting direction (Time of Day)">
              <span>☀ Sun Angle</span>
              <input type="range" id="sim-sun" min="0" max="6.28" step="0.05" value="0.65"/>
              <button class="wf-mini-btn" id="sim-daycycle" title="Animate day/night cycle">▶</button>
            </div>
            <div class="wf-sim-slider" title="3D Terrain vertical relief exaggeration">
              <span>▲ Relief</span>
              <input type="range" id="sim-exag" min="0" max="3" step="0.1" value="1.25"/>
            </div>
            <div class="wf-sim-slider" title="Adaptive 3D rendering quality">
              <span>Quality</span>
              <select id="sim-quality" class="wf-select-inline">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high" selected>High</option>
              </select>
            </div>
          </div>

          <div class="wf-telemetry-bar" id="exp-telemetry">
            <span id="exp-coord">00.00°N  00.00°E</span>
            <span id="exp-hover-biome">Drag to rotate • Scroll to zoom • Double-click to focus</span>
            <span id="exp-hover-elev">Radius ${formatInt(w.radius)} km</span>
            <span id="exp-hover-temp">Mean ${w.stats.avgTemp.toFixed(1)}°C</span>
            <span id="exp-hover-owner">${escapeHtml(w.name)} (#${w.fingerprint})</span>
          </div>
        </div>
      </div>

      <!-- Right Collapsible Planet Configuration Panel (Section 4) -->
      <aside class="wf-config-dock" id="exp-config-dock">
        <div class="wf-cfg-header">
          <div>
            <div class="wf-eyebrow">PLANETARY SYNTHESIS</div>
            <h3>Planet Configuration</h3>
          </div>
          <button class="wf-btn wf-btn-ghost wf-btn-sm" id="cfg-random-preset" title="Roll a random planetary archetype">🎲 Preset</button>
        </div>

        <div class="wf-cfg-scroll">
          <!-- 1. GENERAL -->
          <details class="wf-cfg-group" open>
            <summary><span>01 • GENERAL</span></summary>
            <div class="wf-cfg-body">
              <label class="wf-cfg-field">
                <span>Planet Name</span>
                <div class="wf-input-group">
                  <input type="text" id="cfg-name" class="wf-input" placeholder="Auto-generate…" value="${escapeHtml(S.name || '')}" maxlength="40"/>
                  <button type="button" class="wf-btn wf-btn-ghost wf-btn-sm" id="cfg-clear-name">Auto</button>
                </div>
              </label>
              <label class="wf-cfg-field">
                <span>Random Seed</span>
                <div class="wf-input-group">
                  <input type="text" id="cfg-seed" class="wf-input wf-mono" value="${escapeHtml(S.seed)}" maxlength="64"/>
                  <button type="button" class="wf-btn wf-btn-ghost wf-btn-sm" id="cfg-rand-seed" title="Generate new seed">🎲</button>
                </div>
              </label>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Planet Radius</span><output id="out-cfg-radius">${formatInt(S.radiusKm)} km</output></div>
                <input type="range" id="cfg-radius" min="2400" max="11500" step="100" value="${S.radiusKm}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Terrain Complexity</span><output id="out-cfg-comp">${Math.round(S.terrainComplexity * 100)}%</output></div>
                <input type="range" id="cfg-comp" min="15" max="100" step="1" value="${Math.round(S.terrainComplexity * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Number of Continents</span><output id="out-cfg-cont">${S.continents}</output></div>
                <input type="range" id="cfg-cont" min="1" max="12" step="1" value="${S.continents}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Land-to-Ocean Ratio</span><output id="out-cfg-land">${Math.round((1 - S.ocean) * 100)}% Land / ${Math.round(S.ocean * 100)}% Ocean</output></div>
                <input type="range" id="cfg-land" min="12" max="82" step="1" value="${Math.round((1 - S.ocean) * 100)}" class="wf-range"/>
              </div>
            </div>
          </details>

          <!-- 2. TERRAIN -->
          <details class="wf-cfg-group" open>
            <summary><span>02 • TERRAIN & GEOLOGY</span></summary>
            <div class="wf-cfg-body">
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Mountain Intensity</span><output id="out-cfg-mint">${Math.round(S.mountainIntensity * 100)}%</output></div>
                <input type="range" id="cfg-mint" min="10" max="100" step="1" value="${Math.round(S.mountainIntensity * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Mountain Frequency</span><output id="out-cfg-mfreq">${Math.round(S.mountains * 100)}%</output></div>
                <input type="range" id="cfg-mfreq" min="10" max="100" step="1" value="${Math.round(S.mountains * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Terrain Roughness</span><output id="out-cfg-rough">${Math.round(S.terrainRoughness * 100)}%</output></div>
                <input type="range" id="cfg-rough" min="10" max="100" step="1" value="${Math.round(S.terrainRoughness * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Island Frequency</span><output id="out-cfg-isl">${Math.round(S.islands * 100)}%</output></div>
                <input type="range" id="cfg-isl" min="0" max="100" step="1" value="${Math.round(S.islands * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Crater Frequency</span><output id="out-cfg-crater">${Math.round(S.craterFrequency * 100)}%</output></div>
                <input type="range" id="cfg-crater" min="0" max="100" step="1" value="${Math.round(S.craterFrequency * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Elevation Variation</span><output id="out-cfg-elev">${Math.round(S.elevationVariation * 100)}%</output></div>
                <input type="range" id="cfg-elev" min="15" max="100" step="1" value="${Math.round(S.elevationVariation * 100)}" class="wf-range"/>
              </div>
            </div>
          </details>

          <!-- 3. ENVIRONMENT & ATMOSPHERE -->
          <details class="wf-cfg-group" open>
            <summary><span>03 • ENVIRONMENT & ATMOSPHERE</span></summary>
            <div class="wf-cfg-body">
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Average Temperature Offset</span><output id="out-cfg-temp">${S.globalTemp >= 0 ? '+' : ''}${S.globalTemp}°C</output></div>
                <input type="range" id="cfg-temp" min="-18" max="18" step="1" value="${S.globalTemp}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Atmosphere Density</span><output id="out-cfg-atmo">${Math.round(S.atmosphereDensity * 100)}%</output></div>
                <input type="range" id="cfg-atmo" min="0" max="100" step="1" value="${Math.round(S.atmosphereDensity * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-row-2">
                <label class="wf-cfg-field">
                  <span>Ocean Color</span>
                  <input type="color" id="cfg-ocean-col" value="${escapeHtml(S.oceanColor)}" class="wf-color-in"/>
                </label>
                <label class="wf-cfg-field">
                  <span>Atmosphere Color</span>
                  <input type="color" id="cfg-atmo-col" value="${escapeHtml(S.atmosphereColor)}" class="wf-color-in"/>
                </label>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Cloud Coverage</span><output id="out-cfg-cloud">${Math.round(S.cloudCoverage * 100)}%</output></div>
                <input type="range" id="cfg-cloud" min="0" max="100" step="1" value="${Math.round(S.cloudCoverage * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Polar Ice Coverage</span><output id="out-cfg-polar">${Math.round(S.polarIce * 100)}%</output></div>
                <input type="range" id="cfg-polar" min="0" max="100" step="1" value="${Math.round(S.polarIce * 100)}" class="wf-range"/>
              </div>
            </div>
          </details>

          <!-- 4. BIOMES -->
          <details class="wf-cfg-group">
            <summary><span>04 • BIOME WEIGHTS</span></summary>
            <div class="wf-cfg-body">
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Tropical Forest</span><output id="out-cfg-btrop">${Math.round(S.biomeTropical * 100)}%</output></div>
                <input type="range" id="cfg-btrop" min="0" max="100" step="1" value="${Math.round(S.biomeTropical * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Temperate Forest</span><output id="out-cfg-btemp">${Math.round(S.biomeTemperate * 100)}%</output></div>
                <input type="range" id="cfg-btemp" min="0" max="100" step="1" value="${Math.round(S.biomeTemperate * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Grassland & Savanna</span><output id="out-cfg-bgrass">${Math.round(S.biomeGrassland * 100)}%</output></div>
                <input type="range" id="cfg-bgrass" min="0" max="100" step="1" value="${Math.round(S.biomeGrassland * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Desert & Dune Basins</span><output id="out-cfg-bdes">${Math.round(S.biomeDesert * 100)}%</output></div>
                <input type="range" id="cfg-bdes" min="0" max="100" step="1" value="${Math.round(S.biomeDesert * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Tundra & Boreal</span><output id="out-cfg-btun">${Math.round(S.biomeTundra * 100)}%</output></div>
                <input type="range" id="cfg-btun" min="0" max="100" step="1" value="${Math.round(S.biomeTundra * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Glacial Ice Sheets</span><output id="out-cfg-bice">${Math.round(S.biomeIce * 100)}%</output></div>
                <input type="range" id="cfg-bice" min="0" max="100" step="1" value="${Math.round(S.biomeIce * 100)}" class="wf-range"/>
              </div>
              <div class="wf-cfg-field">
                <div class="wf-slider-head"><span>Volcanic Basalt & Rifts</span><output id="out-cfg-bvolc">${Math.round(S.biomeVolcanic * 100)}%</output></div>
                <input type="range" id="cfg-bvolc" min="0" max="100" step="1" value="${Math.round(S.biomeVolcanic * 100)}" class="wf-range"/>
              </div>
            </div>
          </details>
        </div>

        <div class="wf-cfg-footer">
          <button class="wf-btn wf-btn-generate wf-btn-block" id="cfg-generate-btn">✦ GENERATE PLANET</button>
          <div class="wf-cfg-subbtns">
            <button class="wf-btn wf-btn-primary wf-btn-sm" id="cfg-new-planet-btn">🎲 New Random Planet</button>
            <button class="wf-btn wf-btn-ghost wf-btn-sm" id="cfg-save-planet-btn">✦ Save Planet</button>
          </div>
        </div>
      </aside>
    </div>`;

  // Initialize both 2D MapViewport and 3D GlobeViewer so switching is instantaneous
  const canvas = root.querySelector('#exp-canvas');
  const inspectorEl = root.querySelector('#exp-inspector');

  const vp = new MapViewport(canvas, {
    onHover: (info) => updateHoverHUD(root, info),
    onSelect: (sel) => renderSelectionInspector(inspectorEl, w, sel, vp, globe),
    onCamera: (v) => {
      const zr = root.querySelector('#exp-zoom-readout');
      if (zr) zr.textContent = `${v.zoom.toFixed(1)}×`;
    },
  });
  activeViewport = vp;
  vp.setWorld(w, true);

  const globe = new GlobeViewer(root.querySelector('#exp-globe-mount'), {
    onHover: (info) => updateHoverHUD(root, info),
    onSelect: (sel) => renderSelectionInspector(inspectorEl, w, sel, vp, globe),
    onCamera: (g) => {
      const zr = root.querySelector('#exp-zoom-readout');
      if (zr) zr.textContent = `${(2.45 / g.target.distance).toFixed(1)}×`;
    },
  });
  activeGlobe = globe;
  globe.setWorld(w);

  if (viewMode === 'system') {
    ensureSystemPlanets().then((sysWorlds) => globe.setSystemMode(true, sysWorlds));
  }

  // Viewport Mode Switcher (3D Planet / 2D Atlas / Solar System)
  const globeStage = root.querySelector('#exp-globe-stage');
  root.querySelectorAll('[data-vmode]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const m = btn.dataset.vmode;
      store.explorerViewMode = m;
      root.querySelectorAll('[data-vmode]').forEach((b) => b.classList.toggle('is-active', b === btn));
      if (m === '2d') {
        globeStage.hidden = true;
        canvas.hidden = false;
        vp.resize();
      } else if (m === 'system') {
        canvas.hidden = true;
        globeStage.hidden = false;
        const sysWorlds = await ensureSystemPlanets();
        globe.setSystemMode(true, sysWorlds);
        toast(`Displaying ${sysWorlds.length}-planet Keplerian system`, 'info');
      } else {
        canvas.hidden = true;
        globeStage.hidden = false;
        globe.setSystemMode(false);
      }
    });
  });

  // 8 Visualization Mode Buttons
  root.querySelectorAll('[data-layer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('[data-layer]').forEach((b) => b.classList.toggle('is-active', b === btn));
      const lid = btn.dataset.layer;
      vp.setLayer(lid);
      globe.setLayer(lid);
    });
  });

  // Bottom Simulation & Environment Controls
  root.querySelector('#sim-autorotate').addEventListener('change', (e) => { globe.autoRotate = e.target.checked; });
  root.querySelector('#sim-clouds').addEventListener('change', (e) => { globe.showClouds = e.target.checked; globe._swTex = null; });
  root.querySelector('#sim-atmo').addEventListener('change', (e) => { globe.showAtmosphere = e.target.checked; globe._swTex = null; });
  root.querySelector('#sim-borders').addEventListener('change', (e) => {
    vp.setOverlay('borders', e.target.checked);
    globe.setBorders(e.target.checked);
  });
  root.querySelector('#sim-labels').addEventListener('change', (e) => {
    vp.setOverlay('labels', e.target.checked);
    globe.showLabels = e.target.checked;
  });
  root.querySelector('#sim-sun').addEventListener('input', (e) => {
    globe.sunAngle = +e.target.value;
  });
  const dayBtn = root.querySelector('#sim-daycycle');
  dayBtn.addEventListener('click', () => {
    globe.timeSpeed = globe.timeSpeed > 0 ? 0 : 0.65;
    dayBtn.textContent = globe.timeSpeed > 0 ? '⏸' : '▶';
    dayBtn.classList.toggle('is-active', globe.timeSpeed > 0);
  });
  root.querySelector('#sim-exag').addEventListener('input', (e) => {
    globe.setExaggeration(+e.target.value);
  });
  root.querySelector('#sim-quality').addEventListener('change', (e) => {
    globe.setQuality(e.target.value);
    toast(`Rendering quality set to ${e.target.value.toUpperCase()}`, 'info');
  });

  // Zoom Pod
  root.querySelector('#exp-zoom-in').addEventListener('click', () => {
    if (store.explorerViewMode === '2d') {
      vp.zoom = Math.min(28, vp.zoom * 1.4);
      vp.requestDraw();
    } else {
      globe.target.distance = Math.max(1.18, globe.target.distance * 0.78);
    }
  });
  root.querySelector('#exp-zoom-out').addEventListener('click', () => {
    if (store.explorerViewMode === '2d') {
      vp.zoom = Math.max(0.95, vp.zoom / 1.4);
      vp.requestDraw();
    } else {
      globe.target.distance = Math.min(5.2, globe.target.distance * 1.28);
    }
  });
  root.querySelector('#exp-zoom-reset').addEventListener('click', () => {
    vp.resetView();
    globe.resetCamera();
  });

  // Random Discovery
  root.querySelector('#exp-discover-btn').addEventListener('click', () => {
    const spot = pickRandomDiscovery(w, globe);
    if (!spot) return;
    vp.flyTo(spot.x, spot.y, spot.zoom, spot.label);
    globe.flyToCell(spot.x, spot.y, 1.45, spot.label);
    vp.selected = spot.select;
    globe.selected = spot.select;
    renderSelectionInspector(inspectorEl, w, spot.select, vp, globe);
    toast(`Focused on ${spot.label}`, 'info');
  });

  // PNG & JSON Export
  root.querySelector('#exp-png-btn').addEventListener('click', () => {
    const dataUrl = store.explorerViewMode === '2d' ? vp.exportPNG() : globe.exportScreenshotPNG();
    if (dataUrl) {
      triggerDownload(`${w.name.toLowerCase().replace(/\s+/g, '-')}-${globe.layer}.png`, dataUrl);
      toast(`Exported PNG image of ${w.name}`, 'success');
    }
  });
  root.querySelector('#exp-json-btn').addEventListener('click', () => {
    downloadText(`${w.name.toLowerCase().replace(/\s+/g, '-')}-${w.seed}.json`, serializeWorldJSON(w));
    toast(`Exported ${w.name} JSON configuration & telemetry`, 'info');
  });

  // Fullscreen & Panel toggles
  const shell = root.querySelector('#exp-shell');
  const setClean = (on) => {
    store.explorationMode = on;
    shell.classList.toggle('is-clean-mode', on);
    setTimeout(() => vp.resize(), 40);
  };
  root.querySelector('#exp-clean-btn').addEventListener('click', () => setClean(!store.explorationMode));
  root.querySelector('#exp-clean-exit').addEventListener('click', () => setClean(false));
  root.querySelector('#exp-toggle-cfg').addEventListener('click', () => {
    shell.classList.toggle('is-cfg-collapsed');
    setTimeout(() => vp.resize(), 40);
  });

  // Wire Right Configuration Panel Controls
  bindConfigPanel(root, w, globe, vp);
  bindDefaultInspectorLinks(inspectorEl, w, vp, globe);

  // Apply queued focus from Dashboard / Civilizations / History
  if (store.explorerFocus) {
    const f = store.explorerFocus;
    store.explorerFocus = null;
    vp.flyTo(f.x, f.y, f.zoom || 4.2, f.label, f.x2 != null ? { x: f.x2, y: f.y2 } : null);
    globe.flyToCell(f.x, f.y, 1.55, f.label);
    if (f.select) {
      vp.selected = f.select;
      globe.selected = f.select;
      renderSelectionInspector(inspectorEl, w, f.select, vp, globe);
    }
  }
}

async function ensureSystemPlanets() {
  if (store.systemPlanets && store.systemPlanets.length >= 3) {
    store.systemPlanets[0] = store.world;
    return store.systemPlanets;
  }
  const { generateWorld } = await import('../gen/index.js');
  const p2 = generateWorld({ ...PRESETS[3].settings, seed: store.world.seed + '-II', resolution: 'fast' });
  const p3 = generateWorld({ ...PRESETS[4].settings, seed: store.world.seed + '-III', resolution: 'fast' });
  const p4 = generateWorld({ ...PRESETS[2].settings, seed: store.world.seed + '-IV', resolution: 'fast' });
  store.systemPlanets = [store.world, p2, p3, p4];
  return store.systemPlanets;
}

function bindConfigPanel(root, w, globe, vp) {
  const bindSlider = (id, outId, fmt) => {
    const el = root.querySelector(id), out = root.querySelector(outId);
    if (!el || !out) return;
    el.addEventListener('input', () => { out.textContent = fmt(el.value); });
  };
  bindSlider('#cfg-radius', '#out-cfg-radius', (v) => `${formatInt(+v)} km`);
  bindSlider('#cfg-comp',   '#out-cfg-comp',   (v) => `${v}%`);
  bindSlider('#cfg-cont',   '#out-cfg-cont',   (v) => v);
  bindSlider('#cfg-land',   '#out-cfg-land',   (v) => `${v}% Land / ${100 - v}% Ocean`);
  bindSlider('#cfg-mint',   '#out-cfg-mint',   (v) => `${v}%`);
  bindSlider('#cfg-mfreq',  '#out-cfg-mfreq',  (v) => `${v}%`);
  bindSlider('#cfg-rough',  '#out-cfg-rough',  (v) => `${v}%`);
  bindSlider('#cfg-isl',    '#out-cfg-isl',    (v) => `${v}%`);
  bindSlider('#cfg-crater', '#out-cfg-crater', (v) => `${v}%`);
  bindSlider('#cfg-elev',   '#out-cfg-elev',   (v) => `${v}%`);
  bindSlider('#cfg-temp',   '#out-cfg-temp',   (v) => `${+v >= 0 ? '+' : ''}${v}°C`);
  bindSlider('#cfg-atmo',   '#out-cfg-atmo',   (v) => `${v}%`);
  bindSlider('#cfg-cloud',  '#out-cfg-cloud',  (v) => `${v}%`);
  bindSlider('#cfg-polar',  '#out-cfg-polar',  (v) => `${v}%`);
  bindSlider('#cfg-btrop',  '#out-cfg-btrop',  (v) => `${v}%`);
  bindSlider('#cfg-btemp',  '#out-cfg-btemp',  (v) => `${v}%`);
  bindSlider('#cfg-bgrass', '#out-cfg-bgrass', (v) => `${v}%`);
  bindSlider('#cfg-bdes',   '#out-cfg-bdes',   (v) => `${v}%`);
  bindSlider('#cfg-btun',   '#out-cfg-btun',   (v) => `${v}%`);
  bindSlider('#cfg-bice',   '#out-cfg-bice',   (v) => `${v}%`);
  bindSlider('#cfg-bvolc',  '#out-cfg-bvolc',  (v) => `${v}%`);

  // Instant visual feedback for atmosphere/ocean/cloud tweaks before full regeneration
  root.querySelector('#cfg-atmo-col').addEventListener('input', (e) => {
    w.settings.atmosphereColor = e.target.value;
    globe.setWorld(w);
  });
  root.querySelector('#cfg-atmo').addEventListener('change', (e) => {
    w.settings.atmosphereDensity = +e.target.value / 100;
    globe.setWorld(w);
  });
  root.querySelector('#cfg-ocean-col').addEventListener('change', (e) => {
    w.settings.oceanColor = e.target.value;
    w._layerCache?.delete('physical');
    globe.setWorld(w);
    vp.requestDraw();
  });
  root.querySelector('#cfg-cloud').addEventListener('change', (e) => {
    w.settings.cloudCoverage = +e.target.value / 100;
    globe.setWorld(w);
  });

  root.querySelector('#cfg-clear-name').addEventListener('click', () => {
    root.querySelector('#cfg-name').value = '';
  });
  root.querySelector('#cfg-rand-seed').addEventListener('click', () => {
    root.querySelector('#cfg-seed').value = randomSeed();
    root.querySelector('#cfg-name').value = '';
  });

  const readConfig = () => {
    const landPct = +root.querySelector('#cfg-land').value;
    let nameVal = root.querySelector('#cfg-name').value.trim();
    const seedVal = root.querySelector('#cfg-seed').value.trim() || randomSeed();
    if (w && seedVal !== w.seed && nameVal === w.name) nameVal = '';
    return {
      ...store.draftSettings,
      name: nameVal,
      seed: seedVal,
      radiusKm: +root.querySelector('#cfg-radius').value,
      terrainComplexity: +root.querySelector('#cfg-comp').value / 100,
      continents: +root.querySelector('#cfg-cont').value,
      ocean: (100 - landPct) / 100,
      mountainIntensity: +root.querySelector('#cfg-mint').value / 100,
      mountains: +root.querySelector('#cfg-mfreq').value / 100,
      terrainRoughness: +root.querySelector('#cfg-rough').value / 100,
      islands: +root.querySelector('#cfg-isl').value / 100,
      craterFrequency: +root.querySelector('#cfg-crater').value / 100,
      elevationVariation: +root.querySelector('#cfg-elev').value / 100,
      globalTemp: +root.querySelector('#cfg-temp').value,
      atmosphereDensity: +root.querySelector('#cfg-atmo').value / 100,
      oceanColor: root.querySelector('#cfg-ocean-col').value,
      atmosphereColor: root.querySelector('#cfg-atmo-col').value,
      cloudCoverage: +root.querySelector('#cfg-cloud').value / 100,
      polarIce: +root.querySelector('#cfg-polar').value / 100,
      biomeTropical: +root.querySelector('#cfg-btrop').value / 100,
      biomeTemperate: +root.querySelector('#cfg-btemp').value / 100,
      biomeGrassland: +root.querySelector('#cfg-bgrass').value / 100,
      biomeDesert: +root.querySelector('#cfg-bdes').value / 100,
      biomeTundra: +root.querySelector('#cfg-btun').value / 100,
      biomeIce: +root.querySelector('#cfg-bice').value / 100,
      biomeVolcanic: +root.querySelector('#cfg-bvolc').value / 100,
    };
  };

  root.querySelector('#cfg-generate-btn').addEventListener('click', async () => {
    const cfg = readConfig();
    store.systemPlanets = null;
    await store.generate(cfg);
    renderExplorer(root);
    toast(`Generated planet "${store.world.name}" (#${store.world.fingerprint})`, 'success');
  });

  root.querySelector('#cfg-new-planet-btn').addEventListener('click', async () => {
    const preset = PRESETS[Math.floor(Math.random() * PRESETS.length)];
    store.systemPlanets = null;
    await store.generate({ ...preset.settings, name: '', seed: randomSeed() });
    renderExplorer(root);
    toast(`Generated "${store.world.name}" (${preset.name})`, 'success');
  });

  root.querySelector('#cfg-random-preset').addEventListener('click', async () => {
    const preset = PRESETS[Math.floor(Math.random() * PRESETS.length)];
    store.systemPlanets = null;
    await store.generate({ ...preset.settings, name: '', seed: randomSeed() });
    renderExplorer(root);
    toast(`Applied "${preset.name}" preset`, 'info');
  });

  root.querySelector('#cfg-save-planet-btn').addEventListener('click', async () => {
    await saveWorldRecord(store.world);
    await store.refreshSaved();
    toast(`Saved "${store.world.name}" to archive`, 'success');
  });
}

function updateHoverHUD(root, info) {
  const coord = root.querySelector('#exp-coord');
  const bm = root.querySelector('#exp-hover-biome');
  const el = root.querySelector('#exp-hover-elev');
  const tp = root.querySelector('#exp-hover-temp');
  const ow = root.querySelector('#exp-hover-owner');
  if (!coord || !info) return;
  coord.textContent = info.coordStr;
  bm.textContent = info.city ? `★ ${info.city.name} (${info.biome.name})` : info.biome.name;
  el.textContent = info.land ? `Elev +${formatInt(info.elevation)} m` : `Depth -${formatInt(Math.abs(info.elevation))} m`;
  tp.textContent = `${info.temp >= 0 ? '+' : ''}${info.temp.toFixed(1)}°C • Moist ${Math.round(info.moist * 100)}%`;
  ow.textContent = info.country ? info.country.name : info.continent ? info.continent.name : (info.feature ? info.feature.name : 'Marine Basin');
}

function renderDefaultInspector(w) {
  return `
    <div class="wf-insp-pad">
      <div class="wf-eyebrow">PLANETARY GAZETTEER</div>
      <h3>${escapeHtml(w.name)}</h3>
      <p class="wf-muted-note">Click any region on the 3D globe or double-click to focus camera.</p>

      <div class="wf-insp-section">
        <h4>Continents (${w.continents.length})</h4>
        <div class="wf-insp-list">
          ${w.continents.map((c) => `
            <button class="wf-insp-row" data-fly="${c.x},${c.y},2.5" data-sel-cont="${c.id}">
              <span>${escapeHtml(c.name)}</span>
              <small>${formatCompact(c.area)} km²</small>
            </button>`).join('')}
        </div>
      </div>

      <div class="wf-insp-section">
        <h4>Notable Landmarks</h4>
        <div class="wf-insp-list">
          ${w.features.filter((f) => ['mountain', 'desert', 'volcanic', 'lake', 'ocean'].includes(f.kind)).slice(0, 7).map((f) => `
            <button class="wf-insp-row" data-fly="${f.x},${f.y},4.0" data-sel-feat="${f.id}">
              <span>${escapeHtml(f.name)}</span>
              <small>${escapeHtml(f.kind)}</small>
            </button>`).join('')}
        </div>
      </div>

      <div class="wf-insp-section">
        <h4>Sovereign Realms (${w.countries.length})</h4>
        <div class="wf-insp-list">
          ${w.countries.slice(0, 6).map((c) => {
            const cap = w.cities[c.capitalId];
            return `
              <button class="wf-insp-row" data-fly="${cap.x},${cap.y},3.8" data-sel-country="${c.id}">
                <span><i class="wf-dot" style="background:rgb(${c.mapColor.join(',')})"></i>${escapeHtml(c.name)}</span>
                <small>${formatCompact(c.population)}</small>
              </button>`;
          }).join('')}
        </div>
      </div>
    </div>`;
}

function bindDefaultInspectorLinks(panel, w, vp, globe) {
  panel.querySelectorAll('[data-fly]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [x, y, z] = btn.dataset.fly.split(',').map(Number);
      let sel = null;
      if (btn.dataset.selCont != null) {
        const continent = w.continents.find((c) => c.id === +btn.dataset.selCont);
        sel = { type: 'continent', continent, info: globe.inspectAt(continent.x, continent.y) };
      } else if (btn.dataset.selCountry != null) {
        const country = w.countries[+btn.dataset.selCountry];
        const cap = w.cities[country.capitalId];
        sel = { type: 'country', country, info: globe.inspectAt(cap.x, cap.y) };
      } else if (btn.dataset.selFeat != null) {
        const feature = w.features[+btn.dataset.selFeat];
        sel = { type: 'feature', feature, info: globe.inspectAt(feature.x, feature.y) };
      }
      const label = sel?.country?.name || sel?.continent?.name || sel?.feature?.name;
      vp.selected = sel;
      globe.selected = sel;
      vp.flyTo(x, y, z, label);
      globe.flyToCell(x, y, 1.55, label);
      if (sel) renderSelectionInspector(panel, w, sel, vp, globe);
    });
  });
}

function renderSelectionInspector(panel, w, sel, vp, globe) {
  if (!sel) {
    panel.innerHTML = renderDefaultInspector(w);
    bindDefaultInspectorLinks(panel, w, vp, globe);
    return;
  }
  const info = sel.info;
  const regionName = sel.city?.name || sel.feature?.name || sel.continent?.name || sel.country?.formalName || 'Uncharted Sector';
  const climateBand = Math.abs(info.lat) < 23.5 ? 'Tropical' : Math.abs(info.lat) < 38 ? 'Subtropical' : Math.abs(info.lat) < 60 ? 'Temperate' : 'Polar';
  const aridity = info.moist < 0.22 ? 'Arid' : info.moist < 0.48 ? 'Semi-Arid' : info.moist < 0.72 ? 'Humid' : 'Perhumid';

  if (sel.type === 'country') {
    const c = sel.country;
    const cap = w.cities[c.capitalId];
    panel.innerHTML = `
      <div class="wf-insp-pad">
        <button class="wf-back-link" id="insp-back">← Gazetteer Index</button>
        <div class="wf-insp-flag-head">
          ${flagToSVG(c.flag, 72, 46)}
          <div>
            <div class="wf-eyebrow">${escapeHtml(c.government.toUpperCase())}</div>
            <h3>${escapeHtml(c.formalName)}</h3>
          </div>
        </div>
        <div class="wf-kv-grid">
          <div><span>Region / Capital</span><strong>★ ${escapeHtml(cap.name)}</strong></div>
          <div><span>Biome</span><strong>${escapeHtml(info.biome.name)}</strong></div>
          <div><span>Elevation</span><strong>+${formatInt(info.elevation)} m</strong></div>
          <div><span>Temperature</span><strong>${info.temp.toFixed(1)} °C</strong></div>
          <div><span>Climate</span><strong>${aridity} ${climateBand}</strong></div>
          <div><span>Coordinates</span><strong class="wf-mono">${info.coordStr}</strong></div>
        </div>
        <p class="wf-insp-prose">${escapeHtml(c.lore.overview)}</p>
        <button class="wf-btn wf-btn-gold wf-btn-sm" id="insp-focus-loc">◎ Focus Camera on ${escapeHtml(cap.name)}</button>
      </div>`;
    panel.querySelector('#insp-focus-loc')?.addEventListener('click', () => {
      globe.flyToCell(cap.x, cap.y, 1.38, cap.name);
      vp.flyTo(cap.x, cap.y, 5.5, cap.name);
    });
  } else {
    const desc = sel.city
      ? `${sel.city.name} is a ${sel.city.type} settlement of ${sel.country.formalName} (population ${formatInt(sel.city.population)}), founded in Year ${sel.city.founded}.`
      : sel.feature?.lore || sel.continent?.lore || `Planetary surface sector on Tectonic Plate #${info.plateId + 1}, characterized by ${info.biome.name.toLowerCase()} terrain and ${aridity.toLowerCase()} ${climateBand.toLowerCase()} conditions.`;

    panel.innerHTML = `
      <div class="wf-insp-pad">
        <button class="wf-back-link" id="insp-back">← Gazetteer Index</button>
        <div class="wf-eyebrow">SELECTED LOCATION TELEMETRY</div>
        <h3>${escapeHtml(regionName)}</h3>
        <div class="wf-kv-grid">
          <div><span>Region Name</span><strong>${escapeHtml(regionName)}</strong></div>
          <div><span>Biome</span><strong>${escapeHtml(info.biome.name)}</strong></div>
          <div><span>${info.land ? 'Elevation' : 'Ocean Depth'}</span><strong>${info.land ? '+' : '-'}${formatInt(Math.abs(info.elevation))} m</strong></div>
          <div><span>Temperature</span><strong>${info.temp.toFixed(1)} °C</strong></div>
          <div><span>Climate</span><strong>${aridity} ${climateBand} (${Math.round(info.moist * 100)}% moist)</strong></div>
          <div><span>Coordinates</span><strong class="wf-mono">${info.coordStr}</strong></div>
        </div>
        <p class="wf-insp-prose">${escapeHtml(desc)}</p>
        <button class="wf-btn wf-btn-gold wf-btn-sm" id="insp-focus-loc">◎ Zoom Camera to Location</button>
      </div>`;
    panel.querySelector('#insp-focus-loc')?.addEventListener('click', () => {
      globe.flyToCell(info.ix, info.iy, 1.35, regionName);
      vp.flyTo(info.ix, info.iy, 5.5, regionName);
    });
  }

  panel.querySelector('#insp-back')?.addEventListener('click', () => {
    vp.selected = null; globe.selected = null;
    renderSelectionInspector(panel, w, null, vp, globe);
  });
}

function pickRandomDiscovery(w, globe) {
  const pool = [];
  for (const c of w.cities) if (c.importance >= 4) pool.push({ x: c.x, y: c.y, zoom: 6, label: `${c.name} (${w.countries[c.countryId].name})`, select: { type: 'city', city: c, country: w.countries[c.countryId], info: globe.inspectAt(c.x, c.y) } });
  for (const f of w.features) if (f.kind !== 'ocean') pool.push({ x: f.x, y: f.y, zoom: 4.2, label: f.name, select: { type: 'feature', feature: f, info: globe.inspectAt(f.x, f.y) } });
  for (const c of w.continents) pool.push({ x: c.x, y: c.y, zoom: 2.5, label: c.name, select: { type: 'continent', continent: c, info: globe.inspectAt(c.x, c.y) } });
  return pool[Math.floor(Math.random() * pool.length)];
}
