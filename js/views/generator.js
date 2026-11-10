// Section 2: World Generator Configuration Studio.
// Configures all planetary parameters, seed, presets, landmass distribution, and live preview.

import { store } from '../state.js';
import { PLANET_SIZES, RESOLUTIONS, PRESETS } from '../gen/index.js';
import { randomSeed } from '../core/rng.js';
import { getLayerCanvas } from '../render/layers.js';
import { escapeHtml, formatInt, formatCompact } from '../core/utils.js';
import { toast, navigate } from '../ui/widgets.js';

export function renderGenerator(root) {
  const S = { ...store.draftSettings };
  const w = store.world;

  root.innerHTML = `
    <div class="wf-page wf-generator-layout">
      <div class="wf-gen-form-card wf-card">
        <div class="wf-card-head">
          <div>
            <div class="wf-eyebrow">PLANETARY SYNTHESIS PARAMETERS</div>
            <h2>World Generator</h2>
          </div>
          <button class="wf-btn wf-btn-ghost" id="gen-reset-btn">Reset Defaults</button>
        </div>

        <!-- Archetype Presets -->
        <div class="wf-preset-strip">
          ${PRESETS.map((p) => `
            <button class="wf-preset-pill" data-preset="${p.id}" title="${escapeHtml(p.desc)}">
              <strong>${escapeHtml(p.name)}</strong>
              <span>${Math.round(p.settings.ocean * 100)}% ocean • ${p.settings.continents} cont.</span>
            </button>`).join('')}
        </div>

        <div class="wf-form-grid">
          <label class="wf-field">
            <span>World Name <small>(leave blank for procedural name)</small></span>
            <div class="wf-input-group">
              <input type="text" id="gen-name" class="wf-input" placeholder="Auto-generate linguistic name…" value="${escapeHtml(S.name || '')}" maxlength="40"/>
              <button class="wf-btn wf-btn-ghost" type="button" id="gen-clear-name" title="Clear so a procedural name is generated">Auto</button>
            </div>
          </label>

          <label class="wf-field">
            <span>Deterministic Generation Seed</span>
            <div class="wf-input-group">
              <input type="text" id="gen-seed" class="wf-input wf-mono" value="${escapeHtml(S.seed)}" maxlength="64"/>
              <button class="wf-btn wf-btn-ghost" type="button" id="gen-rand-seed">🎲 Randomize</button>
            </div>
          </label>

          <label class="wf-field">
            <span>Planet Size Class</span>
            <select id="gen-size" class="wf-select">
              ${Object.entries(PLANET_SIZES).map(([k, v]) => `<option value="${k}" ${S.size === k ? 'selected' : ''}>${escapeHtml(v.label)} — R=${v.radius} km</option>`).join('')}
            </select>
          </label>

          <label class="wf-field">
            <span>Landmass Distribution</span>
            <select id="gen-dist" class="wf-select">
              <option value="scattered" ${S.distribution === 'scattered' ? 'selected' : ''}>Scattered Continental Plates</option>
              <option value="supercontinent" ${S.distribution === 'supercontinent' ? 'selected' : ''}>Fused Supercontinent (Pangaea)</option>
              <option value="archipelago" ${S.distribution === 'archipelago' ? 'selected' : ''}>Pelagic Archipelago & Island Chains</option>
              <option value="equatorial" ${S.distribution === 'equatorial' ? 'selected' : ''}>Equatorial Belt Continents</option>
              <option value="polar" ${S.distribution === 'polar' ? 'selected' : ''}>High-Latitude / Polar Continents</option>
            </select>
          </label>

          <div class="wf-field">
            <div class="wf-slider-head"><span>Number of Continents</span><output id="out-continents">${S.continents}</output></div>
            <input type="range" id="gen-continents" min="1" max="12" step="1" value="${S.continents}" class="wf-range"/>
          </div>

          <div class="wf-field">
            <div class="wf-slider-head"><span>Ocean Coverage</span><output id="out-ocean">${Math.round(S.ocean * 100)}%</output></div>
            <input type="range" id="gen-ocean" min="20" max="88" step="1" value="${Math.round(S.ocean * 100)}" class="wf-range"/>
          </div>

          <div class="wf-field">
            <div class="wf-slider-head"><span>Mountain Frequency & Orogeny</span><output id="out-mountains">${Math.round(S.mountains * 100)}%</output></div>
            <input type="range" id="gen-mountains" min="10" max="100" step="1" value="${Math.round(S.mountains * 100)}" class="wf-range"/>
          </div>

          <div class="wf-field">
            <div class="wf-slider-head"><span>Island & Volcanic Arc Frequency</span><output id="out-islands">${Math.round(S.islands * 100)}%</output></div>
            <input type="range" id="gen-islands" min="0" max="100" step="1" value="${Math.round(S.islands * 100)}" class="wf-range"/>
          </div>

          <div class="wf-field">
            <div class="wf-slider-head"><span>Climate Variation (Pole–Equator Gradient)</span><output id="out-climate">${Math.round(S.climateVar * 100)}%</output></div>
            <input type="range" id="gen-climate" min="10" max="100" step="1" value="${Math.round(S.climateVar * 100)}" class="wf-range"/>
          </div>

          <div class="wf-field">
            <div class="wf-slider-head"><span>Global Temperature Offset</span><output id="out-temp">${S.globalTemp >= 0 ? '+' : ''}${S.globalTemp}°C</output></div>
            <input type="range" id="gen-temp" min="-12" max="12" step="1" value="${S.globalTemp}" class="wf-range"/>
          </div>

          <div class="wf-field">
            <div class="wf-slider-head"><span>Sovereign Civilizations</span><output id="out-countries">${S.countries}</output></div>
            <input type="range" id="gen-countries" min="3" max="32" step="1" value="${S.countries}" class="wf-range"/>
          </div>

          <div class="wf-field">
            <div class="wf-slider-head"><span>Recorded History Span</span><output id="out-history">${formatInt(S.historySpan)} yrs</output></div>
            <input type="range" id="gen-history" min="800" max="6000" step="200" value="${S.historySpan}" class="wf-range"/>
          </div>

          <div class="wf-field">
            <div class="wf-slider-head"><span>Impact Crater Frequency</span><output id="out-craters">${Math.round((S.craterFrequency ?? 0.12) * 100)}%</output></div>
            <input type="range" id="gen-craters" min="0" max="100" step="1" value="${Math.round((S.craterFrequency ?? 0.12) * 100)}" class="wf-range"/>
          </div>

          <div class="wf-field">
            <div class="wf-slider-head"><span>Atmosphere Density & Cloud Cover</span><output id="out-atmo">${Math.round((S.atmosphereDensity ?? 0.68) * 100)}%</output></div>
            <input type="range" id="gen-atmo" min="0" max="100" step="1" value="${Math.round((S.atmosphereDensity ?? 0.68) * 100)}" class="wf-range"/>
          </div>

          <label class="wf-field wf-col-span-2">
            <span>Grid Resolution</span>
            <select id="gen-res" class="wf-select">
              ${Object.entries(RESOLUTIONS).map(([k, v]) => `<option value="${k}" ${S.resolution === k ? 'selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="wf-gen-cta-bar">
          <button class="wf-btn wf-btn-generate" id="gen-submit-btn">
            <span class="wf-gen-spark">✦</span> GENERATE WORLD
          </button>
          <button class="wf-btn wf-btn-primary" id="gen-rand-all-btn">🎲 Surprise Me (New Seed & Parameters)</button>
        </div>
      </div>

      <!-- Right: Live Preview of Current World -->
      <div class="wf-gen-preview-card wf-card">
        <div class="wf-card-head">
          <div>
            <div class="wf-eyebrow">CURRENT GENERATED PLANET</div>
            <h3>${w ? escapeHtml(w.name) : 'No World'}</h3>
          </div>
          ${w ? `<span class="wf-badge">Fingerprint #${w.fingerprint}</span>` : ''}
        </div>
        <canvas id="gen-preview-canvas" width="520" height="260" class="wf-gen-canvas"></canvas>
        ${w ? `
          <div class="wf-gen-summary-grid">
            <div><span>Seed</span><strong>${escapeHtml(w.seed)}</strong></div>
            <div><span>Ocean</span><strong>${w.stats.oceanPct.toFixed(1)}%</strong></div>
            <div><span>Continents</span><strong>${w.stats.continentCount}</strong></div>
            <div><span>Countries</span><strong>${w.stats.countryCount}</strong></div>
            <div><span>Cities</span><strong>${w.stats.cityCount}</strong></div>
            <div><span>Population</span><strong>${formatCompact(w.stats.totalPopulation)}</strong></div>
          </div>
          <p class="wf-muted-note">Reproducibility guarantee: entering seed <code>${escapeHtml(w.seed)}</code> with identical sliders will always reconstruct fingerprint <code>#${w.fingerprint}</code>.</p>
          <div class="wf-row-gap">
            <button class="wf-btn wf-btn-gold" id="gen-open-explorer">Open in World Explorer →</button>
            <button class="wf-btn wf-btn-ghost" id="gen-reproduce-btn">Re-run Same Seed</button>
          </div>
        ` : ''}
      </div>
    </div>`;

  if (w) {
    const c = root.querySelector('#gen-preview-canvas');
    c.getContext('2d').drawImage(getLayerCanvas(w, 'physical'), 0, 0, c.width, c.height);
  }

  const readForm = () => ({
    ...store.draftSettings,
    name: root.querySelector('#gen-name').value.trim(),
    seed: root.querySelector('#gen-seed').value.trim() || randomSeed(),
    size: root.querySelector('#gen-size').value,
    distribution: root.querySelector('#gen-dist').value,
    continents: +root.querySelector('#gen-continents').value,
    ocean: +root.querySelector('#gen-ocean').value / 100,
    mountains: +root.querySelector('#gen-mountains').value / 100,
    islands: +root.querySelector('#gen-islands').value / 100,
    climateVar: +root.querySelector('#gen-climate').value / 100,
    globalTemp: +root.querySelector('#gen-temp').value,
    countries: +root.querySelector('#gen-countries').value,
    historySpan: +root.querySelector('#gen-history').value,
    craterFrequency: +root.querySelector('#gen-craters').value / 100,
    atmosphereDensity: +root.querySelector('#gen-atmo').value / 100,
    resolution: root.querySelector('#gen-res').value,
  });

  const bindRange = (id, outId, fmt) => {
    const el = root.querySelector(id), out = root.querySelector(outId);
    el.addEventListener('input', () => { out.textContent = fmt(el.value); store.draftSettings = readForm(); });
  };
  bindRange('#gen-continents', '#out-continents', (v) => v);
  bindRange('#gen-ocean', '#out-ocean', (v) => `${v}%`);
  bindRange('#gen-mountains', '#out-mountains', (v) => `${v}%`);
  bindRange('#gen-islands', '#out-islands', (v) => `${v}%`);
  bindRange('#gen-climate', '#out-climate', (v) => `${v}%`);
  bindRange('#gen-temp', '#out-temp', (v) => `${+v >= 0 ? '+' : ''}${v}°C`);
  bindRange('#gen-countries', '#out-countries', (v) => v);
  bindRange('#gen-history', '#out-history', (v) => `${formatInt(+v)} yrs`);
  bindRange('#gen-craters', '#out-craters', (v) => `${v}%`);
  bindRange('#gen-atmo', '#out-atmo', (v) => `${v}%`);

  root.querySelector('#gen-clear-name').addEventListener('click', () => {
    root.querySelector('#gen-name').value = '';
  });
  root.querySelector('#gen-rand-seed').addEventListener('click', () => {
    root.querySelector('#gen-seed').value = randomSeed();
    root.querySelector('#gen-name').value = '';
  });

  root.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = PRESETS.find((x) => x.id === btn.dataset.preset);
      if (!p) return;
      store.draftSettings = { ...store.draftSettings, ...p.settings, name: '', seed: randomSeed() };
      renderGenerator(root);
      toast(`Loaded "${p.name}" preset — click GENERATE WORLD to synthesize`, 'info');
    });
  });

  root.querySelector('#gen-reset-btn').addEventListener('click', () => {
    store.draftSettings = { ...PRESETS[0].settings, name: '', seed: randomSeed(), resolution: store.prefs.defaultResolution };
    renderGenerator(root);
  });

  root.querySelector('#gen-submit-btn').addEventListener('click', async () => {
    const cfg = readForm();
    // If user didn't change the seed or name from the existing world, clear the name when seed changed
    if (w && cfg.seed !== w.seed && cfg.name === w.name) cfg.name = '';
    await store.generate(cfg);
    renderGenerator(root);
    toast(`Generated "${store.world.name}" (#${store.world.fingerprint})`, 'success');
  });

  root.querySelector('#gen-rand-all-btn').addEventListener('click', async () => {
    const p = PRESETS[Math.floor(Math.random() * PRESETS.length)];
    const cfg = {
      ...p.settings,
      name: '',
      seed: randomSeed(),
      ocean: Math.round((0.35 + Math.random() * 0.48) * 100) / 100,
      continents: 2 + Math.floor(Math.random() * 8),
      mountains: Math.round((0.3 + Math.random() * 0.65) * 100) / 100,
      islands: Math.round((0.2 + Math.random() * 0.75) * 100) / 100,
      countries: 8 + Math.floor(Math.random() * 18),
      resolution: root.querySelector('#gen-res').value,
    };
    await store.generate(cfg);
    renderGenerator(root);
    toast(`Synthesized surprise world "${store.world.name}"`, 'success');
  });

  const openExp = root.querySelector('#gen-open-explorer');
  if (openExp) openExp.addEventListener('click', () => navigate('explorer'));
  const reproBtn = root.querySelector('#gen-reproduce-btn');
  if (reproBtn) reproBtn.addEventListener('click', async () => {
    const prevFp = store.world.fingerprint;
    await store.generate({ ...store.world.settings });
    renderGenerator(root);
    toast(`Reproduced seed "${store.world.seed}" → fingerprint #${store.world.fingerprint} (match: ${prevFp === store.world.fingerprint ? '100% identical' : 'diff'})`, 'success');
  });
}

