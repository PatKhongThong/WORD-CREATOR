// Procedural naming engine.
// Each Language is derived from one of several phonological "styles", then mutated by its own RNG:
// phoneme subsets, biased frequencies, syllable shapes and suffix sets. Names inside one culture
// therefore sound consistent while different cultures sound distinct.

import { RNG } from './rng.js';

const STYLES = [
  { id: 'northern', feel: 'harsh and consonant-heavy',
    C: ['k', 'r', 't', 's', 'v', 'g', 'h', 'l', 'n', 'm', 'd', 'b', 'f', 'th', 'sk', 'st', 'gr', 'br', 'j', 'kn'],
    V: ['a', 'e', 'i', 'o', 'u', 'y', 'ae', 'ei', 'au', 'ø'.replace('ø', 'o')],
    P: ['CV', 'CVC', 'CVC', 'CVCC', 'VC'],
    country: ['heim', 'mark', 'gard', 'land', 'rike', 'vik', ''], city: ['by', 'stad', 'vik', 'holm', 'fjord', 'borg', 'havn', ''],
    family: 'Skarn' },
  { id: 'imperial', feel: 'flowing and formal',
    C: ['c', 'v', 'r', 't', 'l', 'n', 'm', 's', 'p', 'd', 'qu', 'tr', 'pr', 'g', 'f'],
    V: ['a', 'e', 'i', 'o', 'u', 'ia', 'ae', 'io', 'au'],
    P: ['CV', 'CV', 'CVC', 'V', 'CVV'],
    country: ['ia', 'ium', 'ora', 'ana', 'esia', 'ania', 'ica'], city: ['polis', 'ium', 'ona', 'ara', 'enza', 'ano', ''],
    family: 'Valerian' },
  { id: 'steppe', feel: 'guttural with long vowels',
    C: ['k', 'kh', 'g', 't', 'd', 'b', 'z', 'zh', 'sh', 'r', 'l', 'n', 'm', 'ch', 'y', 'q'],
    V: ['a', 'o', 'u', 'i', 'e', 'aa', 'uu', 'ai'],
    P: ['CVC', 'CV', 'CVC', 'VC'],
    country: ['stan', 'ur', 'akh', 'orda', 'gai', 'an'], city: ['kent', 'abad', 'tash', 'gol', 'khan', 'dar', ''],
    family: 'Qoruk' },
  { id: 'desert', feel: 'rich in sibilants and doubled sounds',
    C: ['s', 'sh', 'z', 'q', 'r', 'm', 'n', 'h', 'd', 'b', 'k', 'l', 't', 'j', 'f'],
    V: ['a', 'i', 'u', 'aa', 'ai', 'ou', 'e'],
    P: ['CV', 'CVC', 'CVC', 'V', 'CVCC'],
    country: ['ar', 'ah', 'ir', 'esh', 'un', 'ia'], city: ['ar', 'ad', 'esh', 'iya', 'oum', 'ra', ''],
    family: 'Sahirun' },
  { id: 'island', feel: 'soft and vowel-rich',
    C: ['k', 'm', 'n', 't', 'h', 'l', 'p', 'w', 'r', 'v', 'ng'],
    V: ['a', 'e', 'i', 'o', 'u', 'ai', 'ao', 'ua', 'ei'],
    P: ['CV', 'CV', 'V', 'CVV', 'CV'],
    country: ['nui', 'iki', 'awa', 'oa', 'ani', ''], city: ['ua', 'ola', 'aki', 'nau', 'ma', ''],
    family: 'Malu' },
  { id: 'sylvan', feel: 'lyrical and liquid',
    C: ['l', 'th', 'r', 'n', 's', 'v', 'f', 'm', 'el', 'gl', 'd', 'c', 'ph'],
    V: ['a', 'e', 'i', 'ae', 'ia', 'ie', 'y', 'o', 'ea'],
    P: ['CV', 'CVC', 'V', 'CVV', 'VC'],
    country: ['dor', 'wen', 'ion', 'thas', 'ella', 'iel'], city: ['ost', 'ras', 'ion', 'iath', 'wyn', 'eth', ''],
    family: 'Ithral' },
  { id: 'eastern', feel: 'crisp and syllabic',
    C: ['k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'sh', 'ch', 'ts', 'g', 'z', 'd', 'b'],
    V: ['a', 'i', 'u', 'e', 'o', 'ō'.replace('ō', 'o')],
    P: ['CV', 'CV', 'CV', 'CVn'],
    country: ['koku', 'shu', 'ra', 'to', 'ma', ''], city: ['machi', 'ura', 'shima', 'zaki', 'kawa', ''],
    family: 'Kaiyo' },
  { id: 'highland', feel: 'rolling with clustered consonants',
    C: ['br', 'dr', 'gw', 'll', 'c', 'd', 'b', 'm', 'n', 'r', 't', 'g', 'f', 'w', 'h', 'rh', 'ff'],
    V: ['a', 'e', 'i', 'o', 'y', 'w', 'ae', 'ai'],
    P: ['CVC', 'CV', 'CVC', 'VC'],
    country: ['wyr', 'land', 'mor', 'eth', 'yn', 'ain'], city: ['dun', 'caer', 'llan', 'by', 'mouth', 'ford', ''],
    family: 'Brythric' },
  { id: 'jungle', feel: 'percussive and layered',
    C: ['tl', 'x', 'k', 'ch', 'p', 't', 'm', 'n', 'z', 'y', 'w', 'qu', 'h', 'tz'],
    V: ['a', 'o', 'i', 'e', 'u', 'oa', 'ia'],
    P: ['CV', 'CVC', 'CV', 'V'],
    country: ['tlan', 'pan', 'co', 'ca', 'ztl', 'xa'], city: ['tlan', 'pec', 'co', 'tepe', 'mal', ''],
    family: 'Tlaxic' },
];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export class Language {
  /** @param {RNG} rng */
  constructor(rng, styleHint) {
    this.rng = rng;
    const style = styleHint != null ? STYLES[styleHint % STYLES.length] : rng.pick(STYLES);
    this.style = style;
    // Mutate the phoneme inventory: keep 65-100% of each set, shuffled so each language prefers different sounds.
    const keep = (arr, min) => {
      const a = rng.shuffle(arr.slice());
      return a.slice(0, Math.max(min, Math.round(a.length * rng.range(0.65, 1))));
    };
    this.C = keep(style.C, 6);
    this.V = keep(style.V, 3);
    this.P = style.P.slice();
    this.minSyl = 1 + (rng.next() < 0.5 ? 1 : 0);
    this.maxSyl = this.minSyl + rng.int(1, 2);
    this.apostrophe = style.id === 'sylvan' || style.id === 'desert' ? 0.08 : 0.02;
    this.countrySuffix = keep(style.country, 2);
    this.citySuffix = keep(style.city, 3);
    this.family = style.family;
    this.feel = style.feel;
    this.used = new Set();
  }

  syllable(first) {
    const r = this.rng;
    const pat = r.pickBiased(this.P, 1.2);
    let s = '';
    for (const ch of pat) {
      if (ch === 'C') s += r.pickBiased(this.C, 1.5);
      else if (ch === 'V') s += r.pickBiased(this.V, 1.5);
      else s += ch;
    }
    if (first && s.length > 1 && /^[^aeiouy]{3}/.test(s)) s = s.slice(1);
    return s;
  }

  /** Raw word root. */
  word(minS = this.minSyl, maxS = this.maxSyl) {
    const r = this.rng;
    for (let attempt = 0; attempt < 20; attempt++) {
      const n = r.int(minS, maxS);
      let w = '';
      for (let i = 0; i < n; i++) {
        if (i > 0 && r.chance(this.apostrophe)) w += "'";
        w += this.syllable(i === 0);
      }
      w = w.replace(/(.)\1\1+/g, '$1$1').replace(/([^aeiouy'])([^aeiouy'])([^aeiouy'])([^aeiouy'])/g, '$1$2$3');
      if (w.length >= 3 && w.length <= 10) return w;
    }
    return this.syllable(true) + this.syllable(false);
  }

  unique(fn) {
    for (let i = 0; i < 25; i++) {
      const name = fn();
      if (!this.used.has(name) && !GLOBAL_USED.has(name)) { this.used.add(name); GLOBAL_USED.add(name); return name; }
    }
    const name = fn() + ' ' + ['Minor', 'Prime', 'Novus', 'Alta'][this.rng.int(0, 3)];
    this.used.add(name); GLOBAL_USED.add(name);
    return name;
  }

  root() { return cap(this.word()); }

  countryRoot() {
    return this.unique(() => {
      const w = this.word(1, 2);
      const suf = this.rng.pick(this.countrySuffix);
      return cap(joinSuffix(w, suf));
    });
  }
  city() {
    return this.unique(() => {
      const w = this.word(1, 3);
      const suf = this.rng.chance(0.45) ? this.rng.pick(this.citySuffix) : '';
      return cap(joinSuffix(w, suf));
    });
  }
  demonym(root) {
    const base = root.replace(/[aeiouy]+$/i, '');
    const suf = this.rng.pick(['ian', 'ese', 'i', 'ish', 'ari', 'en', 'ic', 'ite']);
    return cap(base + suf);
  }
  person() {
    return cap(this.word(2, 3));
  }
  continent() {
    return this.unique(() => cap(joinSuffix(this.word(1, 2), this.rng.pick(['ia', 'a', 'ea', 'os', 'ar', 'is', 'eth', 'ura', 'on', 'ae']))));
  }
  feature(kind) {
    const r = this.rng;
    return this.unique(() => {
      const w = cap(this.word(1, 2));
      switch (kind) {
        case 'mountain': return r.weighted([`${w} Mountains`, `${w} Range`, `The ${w} Spine`, `${w} Peaks`, `${w} Highlands`], [4, 3, 1, 2, 1]);
        case 'peak': return r.weighted([`Mount ${w}`, `${w} Peak`, `${w}horn`], [5, 2, 1]);
        case 'river': return `${w} River`;
        case 'lake': return r.weighted([`Lake ${w}`, `${w} Lake`, `${w}mere`], [5, 2, 1]);
        case 'desert': return r.weighted([`${w} Desert`, `The ${w} Wastes`, `Great ${w} Desert`, `${w} Dunes`], [4, 2, 1, 1]);
        case 'forest': return r.weighted([`${w} Forest`, `${w}wood`, `The ${w} Weald`], [4, 2, 1]);
        case 'jungle': return r.weighted([`${w} Jungle`, `${w} Rainforest`, `The ${w} Verdance`], [3, 3, 1]);
        case 'taiga': return r.weighted([`${w} Taiga`, `${w} Pinelands`, `The ${w} Boreal`], [3, 2, 1]);
        case 'grassland': return r.weighted([`${w} Plains`, `${w} Steppe`, `${w} Prairie`, `${w} Downs`], [4, 3, 2, 1]);
        case 'savanna': return r.weighted([`${w} Savanna`, `${w} Grasslands`], [3, 1]);
        case 'tundra': return r.weighted([`${w} Tundra`, `${w} Barrens`, `The ${w} Frostlands`], [3, 2, 1]);
        case 'ice': return r.weighted([`${w} Icefield`, `${w} Glacier`, `The ${w} Ice Shelf`], [3, 2, 1]);
        case 'wetland': return r.weighted([`${w} Marshes`, `${w} Fens`, `${w} Mire`, `${w} Wetlands`], [3, 2, 1, 2]);
        case 'volcanic': return r.weighted([`${w} Caldera`, `${w} Lava Fields`, `The ${w} Basalts`, `${w} Volcanic Rift`], [3, 3, 2, 2]);
        case 'island': return r.weighted([`${w} Island`, `Isle of ${w}`, `${w}`], [3, 2, 1]);
        case 'ocean': return `${w} Ocean`;
        case 'sea': return r.weighted([`Sea of ${w}`, `${w} Sea`], [1, 1]);
        default: return w;
      }
    });
  }
  /** A small lexicon so each culture has "real" words. */
  lexicon() {
    const out = {};
    for (const key of ['hello', 'water', 'sun', 'mountain', 'home', 'ruler', 'peace', 'star']) out[key] = this.word(1, 2);
    return out;
  }
}

function joinSuffix(w, suf) {
  if (!suf) return w;
  const endV = /[aeiouy]$/.test(w), startV = /^[aeiouy]/.test(suf);
  if (endV && startV) return w.slice(0, -1) + suf;
  return w + suf;
}

const GLOBAL_USED = new Set();
/** Reset name uniqueness tracking (call at the start of every world generation). */
export function resetNames() { GLOBAL_USED.clear(); }
export const STYLE_COUNT = STYLES.length;
export { RNG };

