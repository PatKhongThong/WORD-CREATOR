// Seeded pseudo-random number generation.
// cyrb128 hashes an arbitrary seed string into 128 bits of state, sfc32 generates the stream.
// Every subsystem forks its own stream so that changing one system never shifts another.

export function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export class RNG {
  /** @param {string|number} seed */
  constructor(seed) {
    this.seedStr = String(seed);
    const s = cyrb128(this.seedStr);
    this.a = s[0]; this.b = s[1]; this.c = s[2]; this.d = s[3];
    for (let i = 0; i < 15; i++) this.next();
  }
  /** @returns {number} float in [0,1) */
  next() {
    let a = this.a >>> 0, b = this.b >>> 0, c = this.c >>> 0, d = this.d >>> 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return (t >>> 0) / 4294967296;
  }
  /** Independent child stream identified by a label. */
  fork(label) { return new RNG(this.seedStr + '::' + label); }
  range(min, max) { return min + (max - min) * this.next(); }
  int(min, max) { return Math.floor(min + (max - min + 1) * this.next()); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** Biased pick favouring early elements (gives languages characteristic sounds). */
  pickBiased(arr, bias = 1.7) { return arr[Math.floor(Math.pow(this.next(), bias) * arr.length)]; }
  weighted(items, weights) {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  gauss(mean = 0, sd = 1) {
    const u = 1 - this.next(), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

const SEED_A = ['amber', 'azure', 'cobalt', 'crimson', 'ember', 'frost', 'gilded', 'hollow', 'iron', 'jade', 'lunar', 'misty', 'nova', 'obsidian', 'pale', 'quiet', 'rust', 'silver', 'solar', 'tidal', 'umbral', 'verdant', 'wild', 'zenith'];
const SEED_B = ['atlas', 'basin', 'cairn', 'delta', 'expanse', 'fjord', 'glacier', 'harbor', 'isle', 'mesa', 'nadir', 'orbit', 'peak', 'reach', 'shelf', 'steppe', 'strait', 'tundra', 'vale', 'weald'];

/** Human-friendly random seed (not part of deterministic generation). */
export function randomSeed() {
  const r = () => Math.floor(Math.random() * 1e9);
  return `${SEED_A[r() % SEED_A.length]}-${SEED_B[r() % SEED_B.length]}-${(r() % 9000) + 1000}`;
}

