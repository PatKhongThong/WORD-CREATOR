export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** FNV-1a 32-bit hash over bytes. */
export function fnv1a(bytes, h = 0x811c9dc5) {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
export function hashString(str, h = 0x811c9dc5) {
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Binary min-heap of integer ids keyed by float priority (typed arrays for speed). */
export class MinHeap {
  constructor(capacity = 1024) {
    this.ids = new Int32Array(capacity);
    this.pri = new Float64Array(capacity);
    this.size = 0;
    this.topPri = 0;
  }
  push(id, p) {
    if (this.size >= this.ids.length) this._grow();
    const ids = this.ids, pri = this.pri;
    let n = this.size++;
    while (n > 0) {
      const parent = (n - 1) >> 1;
      if (pri[parent] <= p) break;
      ids[n] = ids[parent]; pri[n] = pri[parent]; n = parent;
    }
    ids[n] = id; pri[n] = p;
  }
  pop() {
    const ids = this.ids, pri = this.pri;
    const top = ids[0];
    this.topPri = pri[0];
    const last = --this.size;
    if (last > 0) {
      const li = ids[last], lp = pri[last];
      let n = 0;
      for (;;) {
        let c = 2 * n + 1;
        if (c >= last) break;
        if (c + 1 < last && pri[c + 1] < pri[c]) c++;
        if (pri[c] >= lp) break;
        ids[n] = ids[c]; pri[n] = pri[c]; n = c;
      }
      ids[n] = li; pri[n] = lp;
    }
    return top;
  }
  _grow() {
    const ni = new Int32Array(this.ids.length * 2); ni.set(this.ids); this.ids = ni;
    const np = new Float64Array(this.pri.length * 2); np.set(this.pri); this.pri = np;
  }
}

export function formatInt(n) {
  return Math.round(n).toLocaleString('en-US');
}
export function formatCompact(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(0) + 'K';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toString();
}
export function uid() {
  return 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

