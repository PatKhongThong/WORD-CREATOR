// Section 4: Civilizations, Sovereign Countries, Cities & Linguistic Naming Engine Explorer.

import { store } from '../state.js';
import { flagToSVG } from '../render/flags.js';
import { formatInt, formatCompact, escapeHtml } from '../core/utils.js';
import { cellLatLon, formatLatLon } from '../gen/grid.js';
import { Language } from '../core/names.js';
import { RNG, randomSeed } from '../core/rng.js';
import { navigate } from '../ui/widgets.js';

export function renderCivilizations(root) {
  const w = store.world;
  if (!w || !w.countries.length) {
    root.innerHTML = `<div class="wf-empty">No civilizations generated.</div>`;
    return;
  }

  let selectedId = w.countries[0].id;
  let search = '';
  let sortBy = 'population';

  root.innerHTML = `
    <div class="wf-page wf-civ-layout">
      <!-- Left: Filterable Sovereign Directory -->
      <div class="wf-civ-sidebar wf-card">
        <div class="wf-card-head">
          <div>
            <div class="wf-eyebrow">DIPLOMATIC REGISTER</div>
            <h3>Civilizations (${w.countries.length})</h3>
          </div>
          <select id="civ-sort" class="wf-select wf-select-sm">
            <option value="population">By Population</option>
            <option value="area">By Territory</option>
            <option value="founded">By Antiquity</option>
            <option value="name">Alphabetical</option>
          </select>
        </div>
        <input type="search" id="civ-search" class="wf-input" placeholder="Search country, government, language or city…"/>
        <div class="wf-civ-list" id="civ-list"></div>
      </div>

      <!-- Right: Selected Civilization Dossier + Naming Engine Studio -->
      <div class="wf-civ-main">
        <div class="wf-card" id="civ-detail"></div>

        <!-- Feature 11C: Interactive World Naming Engine Studio -->
        <div class="wf-card wf-naming-card">
          <div class="wf-card-head">
            <div>
              <div class="wf-eyebrow">PHONOLOGICAL CONLANG SYNTHESIZER</div>
              <h3>Procedural Naming Engine</h3>
            </div>
            <div class="wf-row-gap">
              <select id="name-lang-select" class="wf-select wf-select-sm">
                ${w.countries.map((c) => `<option value="${c.id}">${escapeHtml(c.language.name)} (${escapeHtml(c.name)})</option>`).join('')}
              </select>
              <button class="wf-btn wf-btn-primary wf-btn-sm" id="name-roll-btn">⟳ Synthesize New Batch</button>
            </div>
          </div>
          <div id="name-samples-box" class="wf-name-grid"></div>
        </div>
      </div>
    </div>`;

  const listEl = root.querySelector('#civ-list');
  const detailEl = root.querySelector('#civ-detail');
  const langSel = root.querySelector('#name-lang-select');

  const renderList = () => {
    const q = search.toLowerCase();
    const items = w.countries.filter((c) => {
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.formalName.toLowerCase().includes(q) || c.government.toLowerCase().includes(q) || c.language.name.toLowerCase().includes(q) || c.cities.some((id) => w.cities[id].name.toLowerCase().includes(q));
    }).sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'founded') return a.founded - b.founded;
      return b[sortBy] - a[sortBy];
    });

    listEl.innerHTML = items.map((c) => `
      <button class="wf-civ-item ${c.id === selectedId ? 'is-active' : ''}" data-cid="${c.id}">
        <div class="wf-civ-flag">${flagToSVG(c.flag, 56, 36)}</div>
        <div class="wf-civ-item-meta">
          <strong>${escapeHtml(c.name)}</strong>
          <span>${escapeHtml(c.government)} • ${escapeHtml(c.language.name)}</span>
          <small>${formatCompact(c.population)} pop • ${formatInt(c.area)} km² • ${c.cities.length} cities</small>
        </div>
      </button>`).join('');

    listEl.querySelectorAll('[data-cid]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedId = +btn.dataset.cid;
        langSel.value = String(selectedId);
        renderList();
        renderDetail();
        renderNameSamples();
      });
    });
  };

  const renderDetail = () => {
    const c = w.countries[selectedId];
    if (!c) return;
    const cap = w.cities[c.capitalId];
    const events = w.history.filter((e) => e.countryIds.includes(c.id));

    detailEl.innerHTML = `
      <div class="wf-dossier-banner">
        <div class="wf-dossier-flag">${flagToSVG(c.flag, 128, 80)}</div>
        <div class="wf-dossier-title">
          <div class="wf-eyebrow">${escapeHtml(c.government.toUpperCase())} • FOUNDED YEAR ${c.founded}</div>
          <h2>${escapeHtml(c.formalName)}</h2>
          <p class="wf-motto">“${escapeHtml(c.motto)}” — <em>${escapeHtml(c.mottoMeaning)}</em></p>
          <div class="wf-tag-row">
            ${c.culture.traits.map((t) => `<span class="wf-tag">${escapeHtml(t)}</span>`).join('')}
            <span class="wf-tag wf-tag-gold">${escapeHtml(c.culture.religion)}</span>
          </div>
        </div>
        <div class="wf-dossier-actions">
          <button class="wf-btn wf-btn-gold" id="civ-locate-btn">Locate on World Map →</button>
        </div>
      </div>

      <div class="wf-dossier-stats">
        <div><span>Capital City</span><strong>★ ${escapeHtml(cap.name)}</strong></div>
        <div><span>Population</span><strong>${formatInt(c.population)} (${Math.round(c.urbanization * 100)}% urban)</strong></div>
        <div><span>Territory</span><strong>${formatInt(c.area)} km²</strong></div>
        <div><span>Head of State</span><strong>${escapeHtml(c.ruler.title)} ${escapeHtml(c.ruler.name)}</strong></div>
        <div><span>Language</span><strong>${escapeHtml(c.language.name)} (${escapeHtml(c.language.family)} family)</strong></div>
        <div><span>Currency</span><strong>${escapeHtml(c.currency.name)} (${c.currency.symbol} / ${c.currency.code})</strong></div>
        <div><span>Annual Festival</span><strong>${escapeHtml(c.culture.festival)}</strong></div>
        <div><span>National Colors</span><strong>${c.colors.map((col) => `<i class="wf-swatch" style="background:${col}"></i>${col}`).join(' ')}</strong></div>
      </div>

      <div class="wf-dossier-lore-grid">
        <div>
          <h4>Historical & Geographical Overview</h4>
          <p>${escapeHtml(c.lore.overview)}</p>
          <p>${escapeHtml(c.lore.geopolitics)}</p>
        </div>
        <div>
          <h4>Culture, Traditions & Architecture</h4>
          <p>${escapeHtml(c.lore.culture)}</p>
          <p>${escapeHtml(c.lore.architecture)}</p>
        </div>
      </div>

      <!-- Lexicon strip -->
      <div class="wf-lexicon-bar">
        <span class="wf-lex-title">${escapeHtml(c.language.name)} Lexicon (${escapeHtml(c.language.feel)}):</span>
        ${Object.entries(c.language.lexicon).map(([eng, word]) => `<span class="wf-lex-chip"><em>${eng}:</em> <strong>${escapeHtml(word)}</strong></span>`).join('')}
      </div>

      <!-- Cities Table (Section 7) -->
      <div class="wf-subhead-row">
        <h4>Cities & Settlements of ${escapeHtml(c.name)} (${c.cities.length})</h4>
      </div>
      <div class="wf-table-wrap">
        <table class="wf-table">
          <thead>
            <tr>
              <th>City Name</th>
              <th>Category</th>
              <th>Importance</th>
              <th>Population</th>
              <th>Founded</th>
              <th>Coordinates</th>
              <th>Elevation</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${c.cities.map((id) => {
              const ct = w.cities[id];
              const ll = cellLatLon(w.grid, ct.x, ct.y);
              return `
                <tr>
                  <td><strong>${ct.type === 'capital' ? '★ ' : ''}${escapeHtml(ct.name)}</strong></td>
                  <td><span class="wf-city-badge wf-city-${ct.type}">${escapeHtml(ct.type)}</span></td>
                  <td>${escapeHtml(ct.region)} (Tier ${ct.importance})</td>
                  <td>${formatInt(ct.population)}</td>
                  <td>Year ${ct.founded}</td>
                  <td class="wf-mono">${formatLatLon(ll.lat, ll.lon)}</td>
                  <td>+${formatInt(ct.elevation)} m</td>
                  <td><button class="wf-link-btn" data-fly-city="${ct.id}">Inspect →</button></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <!-- Country Timeline -->
      <div class="wf-subhead-row">
        <h4>National Chronicle (${events.length} recorded events)</h4>
      </div>
      <div class="wf-mini-timeline">
        ${events.slice(0, 8).map((e) => `
          <div class="wf-mini-event" data-fly-ev="${e.id}">
            <span class="wf-year-pill">Y${e.year}</span>
            <div>
              <strong>${escapeHtml(e.title)}</strong>
              <p>${escapeHtml(e.description)}</p>
            </div>
          </div>`).join('')}
      </div>`;

    detailEl.querySelector('#civ-locate-btn').addEventListener('click', () => {
      store.explorerFocus = { x: cap.x, y: cap.y, zoom: 4.0, label: c.formalName, select: { type: 'country', country: c } };
      navigate('explorer');
    });
    detailEl.querySelectorAll('[data-fly-city]').forEach((b) => b.addEventListener('click', () => {
      const ct = w.cities[+b.dataset.flyCity];
      store.explorerFocus = { x: ct.x, y: ct.y, zoom: 6.5, label: ct.name, select: { type: 'city', city: ct, country: c } };
      navigate('explorer');
    }));
    detailEl.querySelectorAll('[data-fly-ev]').forEach((b) => b.addEventListener('click', () => {
      const ev = w.history[+b.dataset.flyEv];
      store.explorerFocus = { x: ev.x, y: ev.y, x2: ev.x2, y2: ev.y2, zoom: 5.0, label: `Y${ev.year}: ${ev.title}` };
      navigate('explorer');
    }));
  };

  let nameBatch = 0;
  const renderNameSamples = () => {
    const cid = +langSel.value || 0;
    const lang = new Language(new RNG(`${w.seed}::country-${cid}::lang::batch-${nameBatch++}`), cid);
    const box = root.querySelector('#name-samples-box');
    const cats = [
      ['Countries & Realms', Array.from({ length: 5 }, () => lang.countryRoot())],
      ['Cities & Ports', Array.from({ length: 5 }, () => lang.city())],
      ['Mountain Ranges', Array.from({ length: 4 }, () => lang.feature('mountain'))],
      ['Rivers & Lakes', [lang.feature('river'), lang.feature('river'), lang.feature('lake'), lang.feature('lake')]],
      ['Regions & Biomes', [lang.feature('desert'), lang.feature('forest'), lang.feature('grassland'), lang.feature('island')]],
      ['Historical Figures', Array.from({ length: 5 }, () => lang.person())],
    ];
    box.innerHTML = cats.map(([title, list]) => `
      <div class="wf-name-col">
        <h5>${title}</h5>
        <ul>${list.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
      </div>`).join('');
  };

  root.querySelector('#civ-search').addEventListener('input', (e) => { search = e.target.value; renderList(); });
  root.querySelector('#civ-sort').addEventListener('change', (e) => { sortBy = e.target.value; renderList(); });
  langSel.addEventListener('change', renderNameSamples);
  root.querySelector('#name-roll-btn').addEventListener('click', renderNameSamples);

  renderList();
  renderDetail();
  renderNameSamples();
}

