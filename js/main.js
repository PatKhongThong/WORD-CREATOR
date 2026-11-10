// Application bootstrap, hash router, top header bar, and generation progress overlay.

import { store } from './state.js';
import { renderDashboard } from './views/dashboard.js';
import { renderGenerator } from './views/generator.js';
import { renderExplorer } from './views/explorer.js';
import { renderCivilizations } from './views/civilizations.js';
import { renderHistory } from './views/history.js';
import { renderSaved } from './views/saved.js';
import { renderSettings } from './views/settings.js';
import { randomSeed } from './core/rng.js';
import { saveWorldRecord } from './storage/db.js';
import { toast, navigate } from './ui/widgets.js';

const ROUTES = {
  dashboard:     { label: 'Dashboard',       render: renderDashboard },
  generator:     { label: 'World Generator', render: renderGenerator },
  explorer:      { label: 'World Explorer',  render: renderExplorer },
  civilizations: { label: 'Civilizations',   render: renderCivilizations },
  history:       { label: 'World History',   render: renderHistory },
  saved:         { label: 'Saved Worlds',    render: renderSaved },
  settings:      { label: 'Settings',        render: renderSettings },
};

function currentRoute() {
  if (typeof window !== 'undefined' && window.__INITIAL_ROUTE__ && !window.location.hash) return window.__INITIAL_ROUTE__;
  const qp = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('route') : null;
  if (qp && ROUTES[qp]) return qp;
  const raw = (window.location.hash || '#/explorer').replace(/^#\/?/, '').split('?')[0];
  return ROUTES[raw] ? raw : 'explorer';
}

function updateHeader() {
  const w = store.world;
  const nameEl = document.getElementById('hdr-world-name');
  const metaEl = document.getElementById('hdr-world-meta');
  const savedBadge = document.getElementById('nav-saved-count');
  if (w && nameEl) {
    nameEl.textContent = w.name;
    metaEl.textContent = `Seed: ${w.seed} • ${w.stats.continentCount} Continents • ${w.stats.countryCount} Realms • ${w.stats.cityCount} Cities`;
  }
  if (savedBadge) savedBadge.textContent = store.savedWorlds.length || '';
}

function renderActiveRoute() {
  const r = currentRoute();
  store.route = r;
  document.querySelectorAll('[data-route]').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.route === r);
  });
  const mount = document.getElementById('wf-view-mount');
  if (!mount) return;
  ROUTES[r].render(mount);
  updateHeader();
}

async function init() {
  // Progress overlay listener
  const overlay = document.getElementById('wf-gen-overlay');
  const bar = document.getElementById('wf-gen-bar');
  const stage = document.getElementById('wf-gen-stage');
  store.addEventListener('progress', (e) => {
    if (!overlay) return;
    overlay.hidden = false;
    bar.style.width = `${Math.round(e.detail.pct * 100)}%`;
    stage.textContent = e.detail.stage;
  });
  store.addEventListener('world-ready', () => {
    if (overlay) overlay.hidden = true;
    updateHeader();
  });
  store.addEventListener('compare-ready', () => {
    if (overlay) overlay.hidden = true;
  });
  store.addEventListener('world-renamed', updateHeader);
  store.addEventListener('saved-updated', updateHeader);

  // Header quick buttons
  document.getElementById('hdr-generate-btn')?.addEventListener('click', async () => {
    const next = { ...store.draftSettings, name: '', seed: randomSeed() };
    await store.generate(next);
    renderActiveRoute();
    toast(`Synthesized new world "${store.world.name}"`, 'success');
  });
  document.getElementById('hdr-save-btn')?.addEventListener('click', async () => {
    if (!store.world) return;
    await saveWorldRecord(store.world);
    await store.refreshSaved();
    toast(`Saved "${store.world.name}"`, 'success');
  });

  window.addEventListener('hashchange', renderActiveRoute);

  await store.generate(store.draftSettings);
  renderActiveRoute();
  await store.refreshSaved();
}

init();

