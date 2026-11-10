// Section 6: Saved Worlds Archive — Save, Rename, Delete, Reopen, Re-generate Same Seed, Import/Export JSON & PNG.

import { store } from '../state.js';
import { saveWorldRecord, deleteSavedWorld, renameSavedWorld, serializeWorldJSON, downloadText, triggerDownload } from '../storage/db.js';
import { getLayerCanvas, getBorderCanvas } from '../render/layers.js';
import { formatInt, formatCompact, escapeHtml } from '../core/utils.js';
import { toast, showModal, navigate } from '../ui/widgets.js';

export async function renderSaved(root) {
  await store.refreshSaved();
  const list = store.savedWorlds;
  const w = store.world;

  root.innerHTML = `
    <div class="wf-page wf-saved-layout">
      <!-- Active world save/export banner -->
      <div class="wf-card wf-saved-banner">
        <div>
          <div class="wf-eyebrow">PLANETARY ARCHIVE & TELEMETRY EXPORT</div>
          <h2>Saved Worlds (${list.length})</h2>
          <p class="wf-muted-note">Saved worlds persist in IndexedDB across browser restarts. Reopening a record deterministically reconstructs the exact planet from its seed and parameters.</p>
        </div>
        <div class="wf-row-gap">
          ${w ? `
            <button class="wf-btn wf-btn-gold" id="sv-save-current">✦ Save Active World (“${escapeHtml(w.name)}”)</button>
            <button class="wf-btn wf-btn-primary" id="sv-export-json">⤓ Export Active JSON</button>
            <button class="wf-btn wf-btn-ghost" id="sv-export-png">⤓ Export Active PNG</button>
          ` : ''}
          <label class="wf-btn wf-btn-ghost">
            ⤒ Import World JSON
            <input type="file" id="sv-import-file" accept=".json,application/json" hidden/>
          </label>
        </div>
      </div>

      ${list.length === 0 ? `
        <div class="wf-card wf-empty-archive">
          <h3>No Saved Worlds Yet</h3>
          <p>Click <strong>Save Active World</strong> above to store "${w ? escapeHtml(w.name) : 'your current planet'}" in the persistent archive.</p>
        </div>
      ` : `
        <div class="wf-saved-grid">
          ${list.map((rec) => {
            const isActive = w && w.id === rec.id;
            const dateStr = new Date(rec.updatedAt || rec.createdAt).toLocaleString();
            const S = rec.summary || {};
            return `
              <article class="wf-card wf-saved-card ${isActive ? 'is-active-world' : ''}" data-rec-id="${escapeHtml(rec.id)}">
                <div class="wf-saved-thumb">
                  ${rec.thumbnail ? `<img src="${rec.thumbnail}" alt="${escapeHtml(rec.name)} map"/>` : `<div class="wf-thumb-placeholder"></div>`}
                  ${isActive ? `<span class="wf-active-pill">ACTIVE WORLD</span>` : ''}
                  <span class="wf-fp-pill">#${escapeHtml(rec.fingerprint || '—')}</span>
                </div>
                <div class="wf-saved-body">
                  <div class="wf-saved-title-row">
                    <h3>${escapeHtml(rec.name)}</h3>
                    <button class="wf-icon-btn" data-rename="${escapeHtml(rec.id)}" title="Rename world">✎</button>
                  </div>
                  <div class="wf-saved-seed">Seed: <code>${escapeHtml(rec.seed)}</code> • Saved ${escapeHtml(dateStr)}</div>
                  <div class="wf-saved-stats">
                    <span><strong>${(S.oceanPct ?? 70).toFixed(0)}%</strong> Ocean</span>
                    <span><strong>${S.continents ?? '—'}</strong> Continents</span>
                    <span><strong>${S.countries ?? '—'}</strong> Countries</span>
                    <span><strong>${S.cities ?? '—'}</strong> Cities</span>
                    <span><strong>${formatCompact(S.population ?? 0)}</strong> Pop</span>
                    <span><strong>${(S.avgTemp ?? 14).toFixed(1)}°C</strong> Mean</span>
                  </div>
                  <div class="wf-saved-actions">
                    <button class="wf-btn wf-btn-gold wf-btn-sm" data-open="${escapeHtml(rec.id)}">Reopen World</button>
                    <button class="wf-btn wf-btn-ghost wf-btn-sm" data-regen="${escapeHtml(rec.id)}" title="Re-run generator with this exact seed">⟳ Same Seed</button>
                    <button class="wf-btn wf-btn-ghost wf-btn-sm" data-compare="${escapeHtml(rec.id)}">⇄ Compare</button>
                    <button class="wf-btn wf-btn-danger wf-btn-sm" data-delete="${escapeHtml(rec.id)}">Delete</button>
                  </div>
                </div>
              </article>`;
          }).join('')}
        </div>
      `}
    </div>`;

  const saveBtn = root.querySelector('#sv-save-current');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    await saveWorldRecord(store.world);
    toast(`Saved "${store.world.name}" to archive`, 'success');
    renderSaved(root);
  });

  const expJson = root.querySelector('#sv-export-json');
  if (expJson) expJson.addEventListener('click', () => {
    downloadText(`${w.name.toLowerCase().replace(/\s+/g, '-')}-${w.seed}.json`, serializeWorldJSON(w));
    toast(`Exported ${w.name} JSON`, 'info');
  });

  const expPng = root.querySelector('#sv-export-png');
  if (expPng) expPng.addEventListener('click', () => {
    const out = document.createElement('canvas');
    out.width = w.W; out.height = w.H;
    const ctx = out.getContext('2d');
    ctx.drawImage(getLayerCanvas(w, 'physical'), 0, 0);
    ctx.drawImage(getBorderCanvas(w), 0, 0);
    triggerDownload(`${w.name.toLowerCase().replace(/\s+/g, '-')}-map.png`, out.toDataURL('image/png'));
    toast(`Exported ${w.W}×${w.H} PNG map`, 'success');
  });

  const fileIn = root.querySelector('#sv-import-file');
  if (fileIn) fileIn.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const parsed = JSON.parse(txt);
      const settings = parsed.settings || { seed: parsed.seed, name: parsed.name };
      await store.generate({ ...settings, id: parsed.id || undefined, name: parsed.name });
      await saveWorldRecord(store.world);
      toast(`Imported & reconstructed "${store.world.name}"`, 'success');
      renderSaved(root);
    } catch (err) {
      toast(`Import failed: ${err.message}`, 'danger');
    }
  });

  root.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const rec = list.find((r) => r.id === btn.dataset.open);
      if (!rec) return;
      await store.generate({ ...rec.settings, id: rec.id, createdAt: rec.createdAt }, { overrides: rec.overrides });
      toast(`Reopened "${store.world.name}" (#${store.world.fingerprint})`, 'success');
      navigate('dashboard');
    });
  });

  root.querySelectorAll('[data-regen]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const rec = list.find((r) => r.id === btn.dataset.regen);
      if (!rec) return;
      await store.generate({ ...rec.settings }, { overrides: rec.overrides });
      toast(`Regenerated seed "${rec.seed}" → #${store.world.fingerprint}`, 'success');
      renderSaved(root);
    });
  });

  root.querySelectorAll('[data-compare]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const rec = list.find((r) => r.id === btn.dataset.compare);
      if (!rec) return;
      await store.generate({ ...rec.settings, resolution: 'fast' }, { target: 'compare', overrides: rec.overrides });
      toast(`Loaded "${rec.name}" into Planetary Comparison`, 'info');
      navigate('dashboard');
    });
  });

  root.querySelectorAll('[data-rename]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rec = list.find((r) => r.id === btn.dataset.rename);
      if (!rec) return;
      showModal({
        title: `Rename "${rec.name}"`,
        bodyHtml: `<label class="wf-field"><span>New Planet Name</span><input type="text" id="sv-rename-in" class="wf-input" value="${escapeHtml(rec.name)}" maxlength="40"/></label>`,
        confirmLabel: 'Rename',
        onConfirm: async (m) => {
          const v = m.querySelector('#sv-rename-in').value.trim();
          if (!v) return false;
          await renameSavedWorld(rec.id, v);
          if (store.world && store.world.id === rec.id) {
            store.world.name = v;
            store.world.settings.name = v;
            store.emit('world-renamed', store.world);
          }
          toast(`Renamed to "${v}"`, 'success');
          renderSaved(root);
        },
      });
    });
  });

  root.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rec = list.find((r) => r.id === btn.dataset.delete);
      if (!rec) return;
      showModal({
        title: 'Delete Saved World',
        bodyHtml: `<p>Are you sure you want to permanently remove <strong>${escapeHtml(rec.name)}</strong> (seed <code>${escapeHtml(rec.seed)}</code>) from the archive?</p>`,
        confirmLabel: 'Delete World',
        danger: true,
        onConfirm: async () => {
          await deleteSavedWorld(rec.id);
          toast(`Deleted "${rec.name}"`, 'info');
          renderSaved(root);
        },
      });
    });
  });
}

