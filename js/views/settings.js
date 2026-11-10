// Section 7: Application Settings & Determinism Verification Suite.

import { store } from '../state.js';
import { RESOLUTIONS, generateWorld } from '../gen/index.js';
import { clearAllSavedWorlds } from '../storage/db.js';
import { escapeHtml } from '../core/utils.js';
import { toast, showModal } from '../ui/widgets.js';

export function renderSettings(root) {
  const P = store.prefs;

  root.innerHTML = `
    <div class="wf-page wf-settings-layout">
      <div class="wf-card">
        <div class="wf-card-head">
          <div>
            <div class="wf-eyebrow">SYSTEM CONFIGURATION</div>
            <h2>Application Settings</h2>
          </div>
        </div>

        <div class="wf-settings-list">
          <div class="wf-setting-row">
            <div>
              <strong>Default Generation Grid Resolution</strong>
              <p>Higher resolutions produce finer coastlines and river networks.</p>
            </div>
            <select id="set-res" class="wf-select wf-select-sm">
              ${Object.entries(RESOLUTIONS).map(([k, v]) => `<option value="${k}" ${P.defaultResolution === k ? 'selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}
            </select>
          </div>

          <div class="wf-setting-row">
            <div>
              <strong>Multi-Threaded Web Worker Synthesis</strong>
              <p>Run procedural terrain, hydrology and civilization algorithms in a background worker thread.</p>
            </div>
            <label class="wf-switch"><input type="checkbox" id="set-worker" ${P.useWorker ? 'checked' : ''}/><span></span></label>
          </div>

          <div class="wf-setting-row">
            <div>
              <strong>Auto-Save Generated Worlds</strong>
              <p>Automatically store every newly generated planet in the IndexedDB archive.</p>
            </div>
            <label class="wf-switch"><input type="checkbox" id="set-autosave" ${P.autoSaveOnGenerate ? 'checked' : ''}/><span></span></label>
          </div>

          <div class="wf-setting-row">
            <div>
              <strong>Show Latitude / Longitude Graticule by Default</strong>
              <p>Display 30° coordinate parallels and meridians on the 2D World Explorer map.</p>
            </div>
            <label class="wf-switch"><input type="checkbox" id="set-grat" ${P.showGraticule ? 'checked' : ''}/><span></span></label>
          </div>
        </div>
      </div>

      <!-- Determinism & Engine Diagnostic Card -->
      <div class="wf-card">
        <div class="wf-card-head">
          <div>
            <div class="wf-eyebrow">PROCEDURAL ENGINE DIAGNOSTICS</div>
            <h3>Reproducibility & Storage Controls</h3>
          </div>
        </div>
        <p class="wf-muted-note">Verify that the seeded PRNG (<code>cyrb128 → sfc32</code>), spherical Simplex noise, priority-flood hydrology, Dijkstra borders and historical chronicle produce bit-identical worlds for identical seeds.</p>
        <div class="wf-row-gap">
          <button class="wf-btn wf-btn-primary" id="set-test-det">✓ Run Determinism Self-Test</button>
          <button class="wf-btn wf-btn-danger" id="set-clear-db">Purge All Saved Worlds</button>
        </div>
        <div id="set-test-out" class="wf-diag-box" hidden></div>
      </div>
    </div>`;

  root.querySelector('#set-res').addEventListener('change', (e) => {
    store.updatePrefs({ defaultResolution: e.target.value });
    store.draftSettings.resolution = e.target.value;
    toast('Updated default resolution', 'info');
  });
  root.querySelector('#set-worker').addEventListener('change', (e) => {
    store.updatePrefs({ useWorker: e.target.checked });
    toast(`Web Worker synthesis ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
  });
  root.querySelector('#set-autosave').addEventListener('change', (e) => {
    store.updatePrefs({ autoSaveOnGenerate: e.target.checked });
    toast(`Auto-save ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
  });
  root.querySelector('#set-grat').addEventListener('change', (e) => {
    store.updatePrefs({ showGraticule: e.target.checked });
    toast('Updated graticule preference', 'info');
  });

  root.querySelector('#set-test-det').addEventListener('click', () => {
    const out = root.querySelector('#set-test-out');
    out.hidden = false;
    out.textContent = 'Running two independent generations of seed "veritas-atlas-4040" + one control seed…';
    setTimeout(() => {
      const w1 = generateWorld({ seed: 'veritas-atlas-4040', resolution: 'fast', ocean: 0.68, continents: 5, countries: 10 });
      const w2 = generateWorld({ seed: 'veritas-atlas-4040', resolution: 'fast', ocean: 0.68, continents: 5, countries: 10 });
      const w3 = generateWorld({ seed: 'umbra-delta-9090', resolution: 'fast', ocean: 0.68, continents: 5, countries: 10 });
      const sameMatch = w1.fingerprint === w2.fingerprint;
      const diffMatch = w1.fingerprint !== w3.fingerprint;
      out.innerHTML = `
        <div>Run A (seed <code>veritas-atlas-4040</code>): Fingerprint <strong>#${w1.fingerprint}</strong> — Name: ${escapeHtml(w1.name)} — Pop: ${w1.stats.totalPopulation.toLocaleString()}</div>
        <div>Run B (seed <code>veritas-atlas-4040</code>): Fingerprint <strong>#${w2.fingerprint}</strong> — Name: ${escapeHtml(w2.name)} — Pop: ${w2.stats.totalPopulation.toLocaleString()}</div>
        <div>Control (seed <code>umbra-delta-9090</code>): Fingerprint <strong>#${w3.fingerprint}</strong> — Name: ${escapeHtml(w3.name)} — Pop: ${w3.stats.totalPopulation.toLocaleString()}</div>
        <div style="margin-top:8px;color:${sameMatch && diffMatch ? '#46c98e' : '#e06458'}"><strong>${sameMatch && diffMatch ? '✓ PASS — Same seed produced bit-identical worlds; different seed produced a distinct world.' : '✗ FAIL'}</strong></div>`;
    }, 20);
  });

  root.querySelector('#set-clear-db').addEventListener('click', () => {
    showModal({
      title: 'Purge All Saved Worlds',
      bodyHtml: `<p>Delete all saved worlds from IndexedDB and LocalStorage? This cannot be undone.</p>`,
      confirmLabel: 'Purge Archive',
      danger: true,
      onConfirm: async () => {
        await clearAllSavedWorlds();
        await store.refreshSaved();
        toast('Cleared saved worlds archive', 'info');
      },
    });
  });
}

