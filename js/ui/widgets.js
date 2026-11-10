// Toast notifications, modal dialog, and navigation helper.

import { escapeHtml } from '../core/utils.js';

export function toast(message, kind = 'info', duration = 3200) {
  let host = document.getElementById('wf-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'wf-toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `wf-toast wf-toast-${kind}`;
  el.innerHTML = `<span class="wf-toast-dot"></span><span>${escapeHtml(message)}</span>`;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 260);
  }, duration);
}

export function showModal({ title, bodyHtml, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm }) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.id = 'wf-modal-backdrop';
  wrap.className = 'wf-modal-backdrop';
  wrap.innerHTML = `
    <div class="wf-modal" role="dialog" aria-modal="true">
      <div class="wf-modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="wf-icon-btn" data-modal-close aria-label="Close">✕</button>
      </div>
      <div class="wf-modal-body">${bodyHtml}</div>
      <div class="wf-modal-foot">
        <button class="wf-btn wf-btn-ghost" data-modal-close>${escapeHtml(cancelLabel)}</button>
        ${confirmLabel ? `<button class="wf-btn ${danger ? 'wf-btn-danger' : 'wf-btn-primary'}" data-modal-confirm>${escapeHtml(confirmLabel)}</button>` : ''}
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-modal-close]').forEach((b) => b.addEventListener('click', closeModal));
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeModal(); });
  const cBtn = wrap.querySelector('[data-modal-confirm]');
  if (cBtn) {
    cBtn.addEventListener('click', async () => {
      const res = onConfirm ? await onConfirm(wrap) : true;
      if (res !== false) closeModal();
    });
  }
  const input = wrap.querySelector('input, select, textarea');
  if (input) setTimeout(() => input.focus(), 30);
  return wrap;
}

export function closeModal() {
  const m = document.getElementById('wf-modal-backdrop');
  if (m) m.remove();
}

export function navigate(route) {
  window.location.hash = '#/' + route;
}

