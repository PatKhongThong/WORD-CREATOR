// Section 5: Interactive Chronological World History Timeline + Synchronized Map Locator.

import { store } from '../state.js';
import { EVENT_CATEGORIES } from '../gen/history.js';
import { getLayerCanvas, getBorderCanvas } from '../render/layers.js';
import { cellLatLon, formatLatLon } from '../gen/grid.js';
import { escapeHtml } from '../core/utils.js';
import { navigate } from '../ui/widgets.js';

export function renderHistory(root) {
  const w = store.world;
  if (!w) {
    root.innerHTML = `<div class="wf-empty">No world loaded.</div>`;
    return;
  }

  let activeCat = 'all';
  let activeCountry = 'all';
  let minSig = 1;
  let query = '';
  let maxYear = w.settings.historySpan;
  let selectedEvent = w.history[0] || null;

  const catMeta = Object.fromEntries(EVENT_CATEGORIES.map((c) => [c.id, c]));

  root.innerHTML = `
    <div class="wf-page wf-history-layout">
      <!-- Top filter & scrubber bar -->
      <div class="wf-card wf-history-controls">
        <div class="wf-history-top-row">
          <div>
            <div class="wf-eyebrow">CHRONOLOGICAL ANNALS OF ${escapeHtml(w.name.toUpperCase())}</div>
            <h2>World History Timeline (${w.history.length} Events • Years 1 – ${w.settings.historySpan})</h2>
          </div>
          <div class="wf-row-gap">
            <input type="search" id="hist-search" class="wf-input" placeholder="Search event, city or treaty…"/>
            <select id="hist-country" class="wf-select wf-select-sm">
              <option value="all">All Civilizations</option>
              ${w.countries.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
            <select id="hist-sig" class="wf-select wf-select-sm">
              <option value="1">All Significance Levels</option>
              <option value="4">Major Turning Points (★★★★+)</option>
              <option value="5">Epochal Events Only (★★★★★)</option>
            </select>
          </div>
        </div>

        <div class="wf-cat-pills" id="hist-cats">
          <button class="wf-cat-pill is-active" data-cat="all">All Categories (${w.history.length})</button>
          ${EVENT_CATEGORIES.map((c) => {
            const count = w.history.filter((e) => e.category === c.id).length;
            return `<button class="wf-cat-pill" data-cat="${c.id}"><i style="background:${c.color}"></i>${escapeHtml(c.label)} (${count})</button>`;
          }).join('')}
        </div>

        <div class="wf-scrubber-row">
          <span>Chronicle Horizon: <strong>Year 1 → Year <output id="hist-year-out">${maxYear}</output></strong></span>
          <input type="range" id="hist-year-range" min="50" max="${w.settings.historySpan}" value="${maxYear}" class="wf-range"/>
        </div>
      </div>

      <div class="wf-history-body">
        <!-- Chronological Event Stream -->
        <div class="wf-card wf-timeline-stream" id="hist-stream"></div>

        <!-- Sticky Locator Map & Selected Event Dossier -->
        <div class="wf-card wf-history-locator">
          <div class="wf-card-head">
            <h3>Historical Event Locator</h3>
            <button class="wf-btn wf-btn-gold wf-btn-sm" id="hist-open-explorer">Fly to Site in World Explorer →</button>
          </div>
          <canvas id="hist-map-canvas" width="520" height="260" class="wf-hist-canvas"></canvas>
          <div id="hist-event-detail" class="wf-hist-detail"></div>
        </div>
      </div>
    </div>`;

  const streamEl = root.querySelector('#hist-stream');
  const detailEl = root.querySelector('#hist-event-detail');
  const mapCanvas = root.querySelector('#hist-map-canvas');

  const drawLocator = (ev) => {
    const ctx = mapCanvas.getContext('2d');
    const cw = mapCanvas.width, ch = mapCanvas.height;
    ctx.drawImage(getLayerCanvas(w, 'physical'), 0, 0, cw, ch);
    ctx.drawImage(getBorderCanvas(w), 0, 0, cw, ch);
    if (!ev) return;
    const sx = ((ev.x + 0.5) / w.W) * cw, sy = ((ev.y + 0.5) / w.H) * ch;
    if (ev.x2 != null && ev.y2 != null) {
      const sx2 = ((ev.x2 + 0.5) / w.W) * cw, sy2 = ((ev.y2 + 0.5) / w.H) * ch;
      ctx.strokeStyle = '#f2c95c'; ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx2, sy2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Crosshair + pulse rings
    ctx.strokeStyle = 'rgba(99, 212, 238, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, ch); ctx.moveTo(0, sy); ctx.lineTo(cw, sy); ctx.stroke();
    const col = catMeta[ev.category]?.color || '#63d4ee';
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(sx, sy, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
  };

  const renderDetail = (ev) => {
    if (!ev) {
      detailEl.innerHTML = `<p class="wf-muted-note">No events match current filters.</p>`;
      drawLocator(null);
      return;
    }
    const meta = catMeta[ev.category] || { label: ev.category, color: '#63d4ee' };
    const ll = cellLatLon(w.grid, ev.x, ev.y);
    const nations = ev.countryIds.map((id) => w.countries[id]?.formalName).filter(Boolean);
    detailEl.innerHTML = `
      <div class="wf-eyebrow" style="color:${meta.color}">YEAR ${ev.year} • ${escapeHtml(ev.era.toUpperCase())} • ${escapeHtml(meta.label.toUpperCase())}</div>
      <h3>${escapeHtml(ev.title)}</h3>
      <p class="wf-insp-prose">${escapeHtml(ev.description)}</p>
      <div class="wf-kv-grid">
        <div><span>Region / Site</span><strong>${escapeHtml(ev.regionName || 'Planetary')}</strong></div>
        <div><span>Coordinates</span><strong class="wf-mono">${formatLatLon(ll.lat, ll.lon)}</strong></div>
        <div><span>Significance</span><strong>${'★'.repeat(ev.significance)}${'☆'.repeat(5 - ev.significance)}</strong></div>
        <div><span>Involved Realms</span><strong>${nations.length ? escapeHtml(nations.join(', ')) : 'Unclaimed Frontier'}</strong></div>
      </div>`;
    drawLocator(ev);
  };

  const renderStream = () => {
    const q = query.toLowerCase();
    const filtered = w.history.filter((e) => {
      if (e.year > maxYear) return false;
      if (activeCat !== 'all' && e.category !== activeCat) return false;
      if (activeCountry !== 'all' && !e.countryIds.includes(+activeCountry)) return false;
      if (e.significance < minSig) return false;
      if (q && !e.title.toLowerCase().includes(q) && !e.description.toLowerCase().includes(q) && !(e.regionName || '').toLowerCase().includes(q)) return false;
      return true;
    });

    if (!filtered.includes(selectedEvent)) selectedEvent = filtered[0] || null;

    let lastEra = '';
    streamEl.innerHTML = filtered.length ? filtered.map((e) => {
      const meta = catMeta[e.category] || { label: e.category, color: '#63d4ee' };
      const eraHeader = e.era !== lastEra ? `<div class="wf-era-divider"><span>${escapeHtml(e.era)}</span></div>` : '';
      lastEra = e.era;
      return `
        ${eraHeader}
        <article class="wf-tl-card ${selectedEvent && selectedEvent.id === e.id ? 'is-selected' : ''}" data-ev-id="${e.id}">
          <div class="wf-tl-gutter">
            <span class="wf-tl-year">Y${e.year}</span>
            <span class="wf-tl-dot" style="background:${meta.color}"></span>
          </div>
          <div class="wf-tl-content">
            <div class="wf-tl-meta">
              <span class="wf-tl-cat" style="color:${meta.color}">${escapeHtml(meta.label)}</span>
              <span class="wf-tl-region">${escapeHtml(e.regionName || '')}</span>
              <span class="wf-tl-stars">${'★'.repeat(e.significance)}</span>
            </div>
            <h4>${escapeHtml(e.title)}</h4>
            <p>${escapeHtml(e.description)}</p>
          </div>
        </article>`;
    }).join('') : `<div class="wf-empty">No historical events match these filters.</div>`;

    streamEl.querySelectorAll('[data-ev-id]').forEach((card) => {
      card.addEventListener('click', () => {
        selectedEvent = w.history[+card.dataset.evId];
        streamEl.querySelectorAll('[data-ev-id]').forEach((c) => c.classList.toggle('is-selected', c === card));
        renderDetail(selectedEvent);
      });
    });

    renderDetail(selectedEvent);
  };

  root.querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCat = btn.dataset.cat;
      root.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderStream();
    });
  });

  root.querySelector('#hist-search').addEventListener('input', (e) => { query = e.target.value; renderStream(); });
  root.querySelector('#hist-country').addEventListener('change', (e) => { activeCountry = e.target.value; renderStream(); });
  root.querySelector('#hist-sig').addEventListener('change', (e) => { minSig = +e.target.value; renderStream(); });
  root.querySelector('#hist-year-range').addEventListener('input', (e) => {
    maxYear = +e.target.value;
    root.querySelector('#hist-year-out').textContent = maxYear;
    renderStream();
  });

  root.querySelector('#hist-open-explorer').addEventListener('click', () => {
    if (!selectedEvent) return;
    store.explorerFocus = {
      x: selectedEvent.x, y: selectedEvent.y, x2: selectedEvent.x2, y2: selectedEvent.y2,
      zoom: 5.0, label: `Y${selectedEvent.year}: ${selectedEvent.title}`,
    };
    navigate('explorer');
  });

  renderStream();
}

