// Section 1: Planetary Information & Statistics Dashboard (+ World Comparison drawer).

import { store } from '../state.js';
import { formatInt, formatCompact, escapeHtml } from '../core/utils.js';
import { getLayerCanvas } from '../render/layers.js';
import { flagToSVG } from '../render/flags.js';
import { renderBiomeDonut, renderLatClimateChart, renderHypsometricCurve, renderCountryBars } from '../render/charts.js';
import { saveWorldRecord, serializeWorldJSON, downloadText } from '../storage/db.js';
import { toast, showModal, navigate } from '../ui/widgets.js';
import { randomSeed } from '../core/rng.js';
import { PRESETS } from '../gen/index.js';

export function renderDashboard(root) {
  const w = store.world;
  if (!w) {
    root.innerHTML = `<div class="wf-empty">Generating planetary telemetry…</div>`;
    return;
  }
  const S = w.stats;
  const topCountries = w.countries.slice().sort((a, b) => b.population - a.population).slice(0, 6);
  const recentEvents = w.history.filter((e) => e.significance >= 4).slice(-5).reverse();

  root.innerHTML = `
    <div class="wf-page wf-dashboard">
      <!-- Hero banner -->
      <section class="wf-hero-card">
        <div class="wf-hero-left">
          <div class="wf-eyebrow">ACTIVE PLANETARY SURVEY • SEED <code id="dash-seed">${escapeHtml(w.seed)}</code> • FINGERPRINT <code>#${w.fingerprint}</code></div>
          <div class="wf-hero-title-row">
            <h1 class="wf-world-title" id="dash-world-name">${escapeHtml(w.name)}</h1>
            <button class="wf-icon-btn" id="dash-rename-btn" title="Rename world">✎</button>
          </div>
          <p class="wf-lore-lead">${escapeHtml(w.lore.summary)}</p>
          <div class="wf-hero-actions">
            <button class="wf-btn wf-btn-gold" id="dash-explore-btn">Open Interactive Atlas →</button>
            <button class="wf-btn wf-btn-primary" id="dash-new-seed-btn">⟳ Quick New Planet</button>
            <button class="wf-btn wf-btn-ghost" id="dash-configure-btn">⚙ Configure Generator</button>
            <button class="wf-btn wf-btn-ghost" id="dash-save-btn">✦ Save World</button>
            <button class="wf-btn wf-btn-ghost" id="dash-export-json-btn">⤓ Export JSON</button>
            <button class="wf-btn wf-btn-ghost" id="dash-compare-btn">⇄ Compare Planets</button>
          </div>
        </div>
        <div class="wf-hero-preview" id="dash-map-card" title="Click to open in World Explorer">
          <canvas id="dash-mini-canvas" width="440" height="220"></canvas>
          <div class="wf-hero-preview-bar">
            <span>${w.W} × ${w.H} Grid • Generated in ${w.generationMs} ms</span>
            <span class="wf-link">Click to Explore →</span>
          </div>
        </div>
      </section>

      <!-- 9 Required KPI Cards -->
      <section class="wf-kpi-grid">
        <div class="wf-kpi">
          <span class="wf-kpi-label">Total Land Area</span>
          <strong class="wf-kpi-val">${formatInt(S.landArea)} <small>km²</small></strong>
          <span class="wf-kpi-sub">${S.landPct.toFixed(1)}% of ${formatCompact(S.totalArea)} km² globe</span>
        </div>
        <div class="wf-kpi">
          <span class="wf-kpi-label">Ocean Coverage</span>
          <strong class="wf-kpi-val">${S.oceanPct.toFixed(1)}<small>%</small></strong>
          <span class="wf-kpi-sub">${formatCompact(S.oceanArea)} km² • Max depth ${formatInt(S.deepestPoint.depth)} m</span>
        </div>
        <div class="wf-kpi">
          <span class="wf-kpi-label">Continents</span>
          <strong class="wf-kpi-val">${S.continentCount}</strong>
          <span class="wf-kpi-sub">+ ${formatInt(S.islandCount)} islands • ${w.plates} tectonic plates</span>
        </div>
        <div class="wf-kpi">
          <span class="wf-kpi-label">Sovereign Countries</span>
          <strong class="wf-kpi-val">${S.countryCount}</strong>
          <span class="wf-kpi-sub">${S.claimedPctOfLand.toFixed(1)}% of land under sovereignty</span>
        </div>
        <div class="wf-kpi">
          <span class="wf-kpi-label">Cities & Settlements</span>
          <strong class="wf-kpi-val">${S.cityCount}</strong>
          <span class="wf-kpi-sub">${S.urbanPct.toFixed(1)}% urbanized • ${S.riverCount} major rivers</span>
        </div>
        <div class="wf-kpi">
          <span class="wf-kpi-label">Estimated Population</span>
          <strong class="wf-kpi-val">${formatCompact(S.totalPopulation)}</strong>
          <span class="wf-kpi-sub">${formatInt(S.totalPopulation)} inhabitants</span>
        </div>
        <div class="wf-kpi">
          <span class="wf-kpi-label">Classified Biomes</span>
          <strong class="wf-kpi-val">${S.activeBiomes}</strong>
          <span class="wf-kpi-sub">${S.activeLandBiomes} terrestrial • ${S.lakeCount} major lakes</span>
        </div>
        <div class="wf-kpi">
          <span class="wf-kpi-label">Mean Temperature</span>
          <strong class="wf-kpi-val">${S.avgTemp >= 0 ? '+' : ''}${S.avgTemp.toFixed(1)}<small>°C</small></strong>
          <span class="wf-kpi-sub">Land mean ${S.avgLandTemp.toFixed(1)}°C • Moisture ${S.avgMoisture.toFixed(0)}%</span>
        </div>
        <div class="wf-kpi">
          <span class="wf-kpi-label">Mountain Coverage</span>
          <strong class="wf-kpi-val">${S.mountainPctOfLand.toFixed(1)}<small>% of land</small></strong>
          <span class="wf-kpi-sub">${S.mountainRangeCount} ranges • Peak ${formatInt(S.highestPoint.elevation)} m</span>
        </div>
      </section>

      <!-- Charts Row -->
      <section class="wf-dash-charts">
        <div class="wf-card">
          <div class="wf-card-head"><h3>Terrestrial Biome Distribution</h3><span>% of Land Area</span></div>
          ${renderBiomeDonut(S)}
        </div>
        <div class="wf-card">
          <div class="wf-card-head"><h3>Latitudinal Climate Profile</h3><span>90°N → 90°S</span></div>
          ${renderLatClimateChart(S)}
        </div>
        <div class="wf-card">
          <div class="wf-card-head"><h3>Planetary Hypsometric Curve</h3><span>Bathymetry & Elevation</span></div>
          ${renderHypsometricCurve(S)}
        </div>
      </section>

      <!-- Continents, Great Powers & Landmark Events -->
      <section class="wf-dash-bottom">
        <div class="wf-card">
          <div class="wf-card-head">
            <h3>Major Powers by Population</h3>
            <button class="wf-link-btn" data-nav="civilizations">All ${w.countries.length} Civilizations →</button>
          </div>
          <div class="wf-power-grid">
            ${topCountries.map((c) => `
              <div class="wf-power-item" data-jump-country="${c.id}">
                <div class="wf-power-flag">${flagToSVG(c.flag, 54, 34)}</div>
                <div class="wf-power-meta">
                  <strong>${escapeHtml(c.name)}</strong>
                  <span>${escapeHtml(c.government)} • ${formatCompact(c.population)}</span>
                  <small>Capital: ${escapeHtml(w.cities[c.capitalId].name)} • ${formatInt(c.area)} km²</small>
                </div>
              </div>`).join('')}
          </div>
        </div>

        <div class="wf-card">
          <div class="wf-card-head">
            <h3>Continental Survey</h3>
            <button class="wf-link-btn" data-nav="explorer">Inspect on Map →</button>
          </div>
          <div class="wf-cont-list">
            ${w.continents.map((c) => `
              <div class="wf-cont-row" data-jump-xy="${c.x},${c.y},${ escapeHtml(c.name) }">
                <div>
                  <strong>${escapeHtml(c.name)}</strong>
                  <p>${escapeHtml(c.lore)}</p>
                </div>
                <span class="wf-badge">${formatCompact(c.area)} km²</span>
              </div>`).join('')}
          </div>
        </div>

        <div class="wf-card">
          <div class="wf-card-head">
            <h3>Epochal Historical Turning Points</h3>
            <button class="wf-link-btn" data-nav="history">Full Timeline (${w.history.length}) →</button>
          </div>
          <div class="wf-mini-timeline">
            ${recentEvents.map((e) => `
              <div class="wf-mini-event" data-jump-event="${e.id}">
                <span class="wf-year-pill">Y${e.year}</span>
                <div>
                  <strong>${escapeHtml(e.title)}</strong>
                  <p>${escapeHtml(e.description)}</p>
                </div>
              </div>`).join('')}
          </div>
        </div>
      </section>

      <!-- Planet Comparison Drawer (Feature 11A) -->
      <section class="wf-card wf-compare-section" id="dash-compare-box" ${store.compareWorld ? '' : 'hidden'}>
        ${renderComparisonInner(w, store.compareWorld)}
      </section>
    </div>`;

  // Draw mini map preview
  const mini = root.querySelector('#dash-mini-canvas');
  if (mini) {
    const mctx = mini.getContext('2d');
    mctx.drawImage(getLayerCanvas(w, 'physical'), 0, 0, mini.width, mini.height);
  }

  // Wire buttons
  root.querySelector('#dash-explore-btn').addEventListener('click', () => navigate('explorer'));
  root.querySelector('#dash-map-card').addEventListener('click', () => navigate('explorer'));
  root.querySelector('#dash-configure-btn').addEventListener('click', () => navigate('generator'));
  root.querySelector('#dash-new-seed-btn').addEventListener('click', async () => {
    const next = { ...store.draftSettings, name: '', seed: randomSeed() };
    await store.generate(next);
    toast(`Generated new world "${store.world.name}"`, 'success');
  });
  root.querySelector('#dash-save-btn').addEventListener('click', async () => {
    await saveWorldRecord(w);
    await store.refreshSaved();
    toast(`Saved "${w.name}" to planetary archive`, 'success');
  });
  root.querySelector('#dash-export-json-btn').addEventListener('click', () => {
    downloadText(`${w.name.toLowerCase().replace(/\s+/g, '-')}-${w.seed}.json`, serializeWorldJSON(w));
    toast(`Exported ${w.name} JSON telemetry`, 'info');
  });
  root.querySelector('#dash-rename-btn').addEventListener('click', () => {
    showModal({
      title: 'Rename Planet',
      bodyHtml: `<label class="wf-field"><span>Planetary Designation</span><input type="text" id="wf-rename-input" class="wf-input" value="${escapeHtml(w.name)}" maxlength="40"/></label>`,
      confirmLabel: 'Save Name',
      onConfirm: (m) => {
        const val = m.querySelector('#wf-rename-input').value.trim();
        if (val) {
          w.name = val; w.settings.name = val;
          w.overrides = { ...(w.overrides || {}), name: val };
          renderDashboard(root);
          store.emit('world-renamed', w);
          toast(`Renamed world to "${val}"`, 'success');
        }
      },
    });
  });

  root.querySelector('#dash-compare-btn').addEventListener('click', async () => {
    const box = root.querySelector('#dash-compare-box');
    box.hidden = false;
    if (!store.compareWorld) {
      const preset = PRESETS[Math.floor(Math.random() * PRESETS.length)];
      await store.generate({ ...preset.settings, seed: randomSeed(), resolution: 'fast' }, { target: 'compare' });
    }
    box.innerHTML = renderComparisonInner(store.world, store.compareWorld);
    bindComparisonEvents(box, root);
    box.scrollIntoView({ behavior: 'smooth' });
  });

  if (store.compareWorld) bindComparisonEvents(root.querySelector('#dash-compare-box'), root);

  root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.nav)));
  root.querySelectorAll('[data-jump-country]').forEach((el) => el.addEventListener('click', () => {
    const c = w.countries[+el.dataset.jumpCountry];
    const cap = w.cities[c.capitalId];
    store.explorerFocus = { x: cap.x, y: cap.y, zoom: 4.0, label: c.formalName, select: { type: 'country', country: c } };
    navigate('explorer');
  }));
  root.querySelectorAll('[data-jump-xy]').forEach((el) => el.addEventListener('click', () => {
    const [x, y, label] = el.dataset.jumpXy.split(',');
    store.explorerFocus = { x: +x, y: +y, zoom: 2.6, label };
    navigate('explorer');
  }));
  root.querySelectorAll('[data-jump-event]').forEach((el) => el.addEventListener('click', () => {
    const ev = w.history[+el.dataset.jumpEvent];
    store.explorerFocus = { x: ev.x, y: ev.y, x2: ev.x2, y2: ev.y2, zoom: 4.5, label: `Y${ev.year}: ${ev.title}` };
    navigate('explorer');
  }));
}

function renderComparisonInner(A, B) {
  if (!B) return `<div class="wf-empty">Generating comparison world…</div>`;
  const rows = [
    ['Planetary Radius', `${formatInt(A.radius)} km`, `${formatInt(B.radius)} km`, A.radius, B.radius],
    ['Total Surface Area', `${formatCompact(A.stats.totalArea)} km²`, `${formatCompact(B.stats.totalArea)} km²`, A.stats.totalArea, B.stats.totalArea],
    ['Land Percentage', `${A.stats.landPct.toFixed(1)}% (${formatCompact(A.stats.landArea)} km²)`, `${B.stats.landPct.toFixed(1)}% (${formatCompact(B.stats.landArea)} km²)`, A.stats.landPct, B.stats.landPct],
    ['Ocean Percentage', `${A.stats.oceanPct.toFixed(1)}%`, `${B.stats.oceanPct.toFixed(1)}%`, A.stats.oceanPct, B.stats.oceanPct],
    ['Mean Surface Temp', `${A.stats.avgTemp.toFixed(1)} °C`, `${B.stats.avgTemp.toFixed(1)} °C`, A.stats.avgTemp + 50, B.stats.avgTemp + 50],
    ['Terrain Variation (σ)', `±${formatInt(A.stats.terrainVariation || 0)} m`, `±${formatInt(B.stats.terrainVariation || 0)} m`, A.stats.terrainVariation || 1, B.stats.terrainVariation || 1],
    ['Highest Summit', `${formatInt(A.stats.highestPoint.elevation)} m`, `${formatInt(B.stats.highestPoint.elevation)} m`, A.stats.highestPoint.elevation, B.stats.highestPoint.elevation],
    ['Continents / Islands', `${A.stats.continentCount} / ${A.stats.islandCount}`, `${B.stats.continentCount} / ${B.stats.islandCount}`, A.stats.continentCount, B.stats.continentCount],
    ['Active Biomes', `${A.stats.activeBiomes}`, `${B.stats.activeBiomes}`, A.stats.activeBiomes, B.stats.activeBiomes],
    ['Sovereign Countries', `${A.stats.countryCount}`, `${B.stats.countryCount}`, A.stats.countryCount, B.stats.countryCount],
    ['Cities & Settlements', `${A.stats.cityCount}`, `${B.stats.cityCount}`, A.stats.cityCount, B.stats.cityCount],
    ['Total Population', formatCompact(A.stats.totalPopulation), formatCompact(B.stats.totalPopulation), A.stats.totalPopulation, B.stats.totalPopulation],
  ];
  const savedOpts = store.savedWorlds.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.seed)})</option>`).join('');

  return `
    <div class="wf-card-head">
      <h3>⇄ Planetary Comparison Telemetry: ${escapeHtml(A.name)} vs. ${escapeHtml(B.name)}</h3>
      <div class="wf-row-gap">
        ${savedOpts ? `<select id="cmp-saved-select" class="wf-select"><option value="">Compare with Saved World…</option>${savedOpts}</select>` : ''}
        <button class="wf-btn wf-btn-ghost" id="cmp-reroll-btn">⟳ Roll Random Comparison World</button>
        <button class="wf-btn wf-btn-primary" id="cmp-swap-btn">Promote "${escapeHtml(B.name)}" to Active World</button>
      </div>
    </div>
    <div class="wf-cmp-table">
      <div class="wf-cmp-head">
        <span><strong>${escapeHtml(A.name)}</strong> <small>(${escapeHtml(A.seed)})</small></span>
        <span>METRIC</span>
        <span><strong>${escapeHtml(B.name)}</strong> <small>(${escapeHtml(B.seed)})</small></span>
      </div>
      ${rows.map(([label, va, vb, na, nb]) => {
        const tot = (Math.abs(na) + Math.abs(nb)) || 1;
        const pa = (Math.abs(na) / tot) * 100, pb = 100 - pa;
        return `
          <div class="wf-cmp-row">
            <div class="wf-cmp-cell wf-cmp-left"><span>${va}</span><div class="wf-cmp-bar"><i style="width:${pa.toFixed(1)}%"></i></div></div>
            <div class="wf-cmp-metric">${label}</div>
            <div class="wf-cmp-cell wf-cmp-right"><div class="wf-cmp-bar"><i style="width:${pb.toFixed(1)}%"></i></div><span>${vb}</span></div>
          </div>`;
      }).join('')}
    </div>`;
}

function bindComparisonEvents(box, root) {
  if (!box) return;
  const reroll = box.querySelector('#cmp-reroll-btn');
  if (reroll) reroll.addEventListener('click', async () => {
    const preset = PRESETS[Math.floor(Math.random() * PRESETS.length)];
    await store.generate({ ...preset.settings, seed: randomSeed(), resolution: 'fast' }, { target: 'compare' });
    box.innerHTML = renderComparisonInner(store.world, store.compareWorld);
    bindComparisonEvents(box, root);
  });
  const swap = box.querySelector('#cmp-swap-btn');
  if (swap) swap.addEventListener('click', () => {
    const prev = store.world;
    store.world = store.compareWorld;
    store.compareWorld = prev;
    store.emit('world-ready', store.world);
    renderDashboard(root);
  });
  const sel = box.querySelector('#cmp-saved-select');
  if (sel) sel.addEventListener('change', async () => {
    const rec = store.savedWorlds.find((s) => s.id === sel.value);
    if (rec) {
      await store.generate({ ...rec.settings, resolution: 'fast' }, { target: 'compare', overrides: rec.overrides });
      box.innerHTML = renderComparisonInner(store.world, store.compareWorld);
      bindComparisonEvents(box, root);
    }
  });
}

