// Civilization generator: habitability, capital placement (best-candidate sampling), territory growth via
// multi-source Dijkstra with terrain costs (so borders follow mountains, rivers and deserts), countries with
// cultures/languages/flags, cities ranked by Zipf's law, and population density.

import { MinHeap, clamp } from '../core/utils.js';
import { neighbors8, distKm } from './grid.js';
import { B, isWater } from './biomes.js';
import { Language, STYLE_COUNT } from '../core/names.js';

const HAB = {
  [B.BEACH]: 0.8, [B.ICE]: 0, [B.TUNDRA]: 0.15, [B.TAIGA]: 0.42, [B.TEMPERATE_FOREST]: 0.9, [B.TEMPERATE_RAINFOREST]: 0.7,
  [B.GRASSLAND]: 1, [B.SHRUBLAND]: 0.72, [B.DESERT]: 0.12, [B.SAVANNA]: 0.7, [B.TROPICAL_FOREST]: 0.75, [B.RAINFOREST]: 0.5,
  [B.WETLAND]: 0.38, [B.ALPINE]: 0.1, [B.SNOW]: 0, [B.LAKE]: 0, [B.VOLCANIC]: 0.06,
};
const COST = {
  [B.BEACH]: 1, [B.ICE]: 7, [B.TUNDRA]: 2.4, [B.TAIGA]: 1.7, [B.TEMPERATE_FOREST]: 1.4, [B.TEMPERATE_RAINFOREST]: 1.8,
  [B.GRASSLAND]: 1, [B.SHRUBLAND]: 1.2, [B.DESERT]: 2.8, [B.SAVANNA]: 1.2, [B.TROPICAL_FOREST]: 1.6, [B.RAINFOREST]: 2.2,
  [B.WETLAND]: 2.3, [B.ALPINE]: 4.5, [B.SNOW]: 9, [B.LAKE]: 3, [B.VOLCANIC]: 5.2,
};

export const GOVERNMENTS = [
  { type: 'Absolute Monarchy', formal: (n) => `Kingdom of ${n}`, ruler: ['King', 'Queen'] },
  { type: 'Constitutional Monarchy', formal: (n) => `United Kingdom of ${n}`, ruler: ['Monarch', 'Sovereign'] },
  { type: 'Republic', formal: (n) => `Republic of ${n}`, ruler: ['President', 'Consul'] },
  { type: 'Federal Republic', formal: (n) => `Federation of ${n}`, ruler: ['Chancellor', 'First Minister'] },
  { type: 'Theocracy', formal: (n) => `Holy See of ${n}`, ruler: ['High Prophet', 'Hierophant'] },
  { type: 'Merchant Republic', formal: (n) => `Most Serene Republic of ${n}`, ruler: ['Doge', 'Guildmaster'] },
  { type: 'Empire', formal: (n) => `${n} Empire`, ruler: ['Emperor', 'Empress'] },
  { type: 'Tribal Confederation', formal: (n) => `${n} Confederacy`, ruler: ['High Chieftain', 'Elder Speaker'] },
  { type: 'Oligarchy', formal: (n) => `Directorate of ${n}`, ruler: ['Archon', 'Director'] },
  { type: 'Technocracy', formal: (n) => `${n} Technate`, ruler: ['Prime Engineer', 'Chief Savant'] },
  { type: 'Elective Monarchy', formal: (n) => `Grand Duchy of ${n}`, ruler: ['Grand Duke', 'Grand Duchess'] },
  { type: 'Council Democracy', formal: (n) => `Commonwealth of ${n}`, ruler: ['Speaker of the Council', 'First Delegate'] },
  { type: 'Military Junta', formal: (n) => `${n} Protectorate`, ruler: ['Lord Protector', 'Marshal'] },
];

const TRAITS = [
  { id: 'seafaring', label: 'Seafaring' }, { id: 'scholarly', label: 'Scholarly' }, { id: 'martial', label: 'Martial' },
  { id: 'mercantile', label: 'Mercantile' }, { id: 'pastoral', label: 'Pastoral' }, { id: 'mystical', label: 'Mystical' },
  { id: 'artisan', label: 'Artisan' }, { id: 'nomadic', label: 'Nomadic' }, { id: 'industrious', label: 'Industrious' },
  { id: 'isolationist', label: 'Isolationist' }, { id: 'diplomatic', label: 'Diplomatic' }, { id: 'agrarian', label: 'Agrarian' },
];
const CURRENCY_NOUNS = ['Crown', 'Mark', 'Talent', 'Florin', 'Sol', 'Dinar', 'Shell', 'Ducat', 'Sovereign', 'Ring', 'Reckon', 'Obol', 'Pearl', 'Thaler', 'Lune'];
const SYMBOLS = ['₳', '₴', '₰', '₯', '₣', '₲', '₵', '¤', '₦', '₭', '₮', '₱', '₸', '₼'];
const FLAG_PATTERNS = ['tricolor-h', 'tricolor-v', 'bicolor-h', 'bicolor-v', 'nordic', 'cross', 'saltire', 'canton', 'chevron', 'diagonal', 'bordered', 'quartered', 'pale', 'triband'];
const EMBLEMS = ['none', 'star', 'circle', 'sun', 'crescent', 'diamond', 'mountain', 'wave', 'ring', 'tree'];

function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

export function computeHabitability(grid, F, riverT) {
  const { N } = grid;
  const hab = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const b = F.biome[i];
    if (isWater(b)) continue;
    let h = HAB[b] ?? 0.3;
    const t = F.temp[i];
    h *= Math.exp(-((t - 16) * (t - 16)) / (2 * 14 * 14));
    if (F.flow[i] > riverT * 0.6) h += 0.25 * Math.min(1, Math.log10(F.flow[i] / (riverT * 0.6) + 1));
    if (F.coast[i] <= 2) h += 0.15;
    h -= Math.max(0, F.height[i] - 0.25) * 0.8;
    hab[i] = clamp(h, 0, 1.2);
  }
  return hab;
}

export function generateCivilizations(grid, world, rng, opts) {
  const { W, H, N, cellArea } = grid;
  const F = world.fields;
  const { height, biome, coast, landmass, flow } = F;
  const riverT = world.riverT;
  const hab = computeHabitability(grid, F, riverT);
  F.hab = hab;
  const span = opts.historySpan;

  // eligible land: landmasses bigger than a minimum size
  const lmArea = new Map();
  for (const c of world.continents) lmArea.set(c.id, c.area);
  for (const i of world.islands) lmArea.set(i.id, i.area);
  const minLm = grid.totalArea * 0.0006;
  const cand = [];
  let landArea = 0;
  for (let i = 0; i < N; i++) {
    if (height[i] <= 0 || F.lakeMask[i]) continue;
    landArea += cellArea[(i / W) | 0];
    if (hab[i] > 0.25 && (lmArea.get(landmass[i]) || 0) >= minLm) cand.push(i);
  }
  const nCountries = Math.min(opts.countries, Math.max(1, Math.floor(cand.length / 40)));
  const spacing = Math.sqrt(landArea / Math.max(1, nCountries)) * 0.85;

  // ---- capitals by best-candidate sampling ---------------------------------------
  const crng = rng.fork('capitals');
  const capitals = [];
  for (let k = 0; k < nCountries && cand.length; k++) {
    let best = -1, bs = -Infinity;
    for (let t = 0; t < 260; t++) {
      const c = cand[Math.floor(crng.next() * cand.length)];
      const x = c % W, y = (c / W) | 0;
      let dmin = Infinity;
      for (const cap of capitals) dmin = Math.min(dmin, distKm(grid, x, y, cap % W, (cap / W) | 0));
      const spread = capitals.length ? Math.min(1, dmin / spacing) : 1;
      const score = Math.pow(hab[c], 1.4) * spread * spread * (0.85 + crng.next() * 0.3);
      if (score > bs) { bs = score; best = c; }
    }
    if (best >= 0) capitals.push(best);
  }

  // ---- territory: multi-source Dijkstra ------------------------------------------
  const prng = rng.fork('power');
  const power = capitals.map(() => prng.range(0.75, 1.3));
  const owner = new Int16Array(N).fill(-1);
  const cost = new Float32Array(N).fill(Infinity);
  const heap = new MinHeap(1 << 16);
  capitals.forEach((c, k) => { owner[c] = k; cost[c] = 0; heap.push(c, 0); });
  const nb = new Int32Array(8);
  const maxReach = spacing * 2.4;
  const diag = new Float64Array(H);
  for (let y = 0; y < H; y++) diag[y] = Math.hypot(grid.cellW[y], grid.cellH);
  while (heap.size) {
    const c = heap.pop();
    if (heap.topPri > cost[c] + 1e-9) continue;
    const y = (c / W) | 0;
    const o = owner[c];
    const n = neighbors8(W, H, c, nb);
    for (let k = 0; k < n; k++) {
      const j = nb[k];
      const step = k < 2 ? grid.cellW[y] : (k === 3 || k === 6) ? grid.cellH : diag[y];
      let m;
      const bj = biome[j];
      if (height[j] <= 0) {
        if (height[j] < -0.22 || bj === B.SEA_ICE) continue;
        m = 9;
      } else {
        m = COST[bj] ?? 1.5;
        m *= 1 + Math.abs(height[j] - height[c]) * world.maxElev / 160;
        if (flow[j] > riverT * 1.5 && flow[c] <= riverT * 1.5) m *= 1.9;
      }
      const nc = cost[c] + (step * m) / power[o];
      if (nc < cost[j] && nc < maxReach) { cost[j] = nc; owner[j] = o; heap.push(j, nc); }
    }
  }
  for (let i = 0; i < N; i++) if (height[i] <= 0) owner[i] = -1;

  // ---- country identity ----------------------------------------------------------
  const countries = [];
  const goldenHue = rng.fork('hues').range(0, 360);
  const areas = new Float64Array(capitals.length), cellsOf = capitals.map(() => []);
  const biomeArea = capitals.map(() => ({}));
  for (let i = 0; i < N; i++) {
    const o = owner[i];
    if (o < 0) continue;
    const a = cellArea[(i / W) | 0];
    areas[o] += a; cellsOf[o].push(i);
    biomeArea[o][biome[i]] = (biomeArea[o][biome[i]] || 0) + a;
  }
  // founding order: most habitable capitals are oldest
  const order = capitals.map((c, k) => k).sort((a, b) => hab[capitals[b]] - hab[capitals[a]]);
  const frng = rng.fork('founding');
  const foundYears = new Array(capitals.length);
  order.forEach((k, rank) => {
    const t = (rank / Math.max(1, capitals.length - 1));
    foundYears[k] = Math.round(span * (0.06 + 0.5 * t * t + frng.range(0, 0.08)));
  });

  for (let k = 0; k < capitals.length; k++) {
    const r = rng.fork('country-' + k);
    const capCell = capitals[k];
    const cx = capCell % W, cy = (capCell / W) | 0;
    const lang = new Language(r.fork('lang'), r.int(0, STYLE_COUNT - 1));
    const root = lang.countryRoot();
    const area = areas[k];
    const sortedBiomes = Object.entries(biomeArea[k]).sort((a, b) => b[1] - a[1]).map(([b]) => +b);
    const domBiome = sortedBiomes[0] ?? B.GRASSLAND;
    const coastal = cellsOf[k].some((i) => coast[i] === 1);
    const mountainous = (biomeArea[k][B.ALPINE] || 0) + (biomeArea[k][B.SNOW] || 0) > area * 0.04;
    const desertShare = (biomeArea[k][B.DESERT] || 0) / Math.max(1, area);

    // government weighted by size & geography
    const sizeRel = area / (landArea / Math.max(1, capitals.length));
    const gw = GOVERNMENTS.map((g) => {
      let w = 1;
      if (g.type === 'Empire') w = sizeRel > 1.4 ? 3 : 0.3;
      if (g.type === 'Federal Republic') w = sizeRel > 1.2 ? 2 : 0.6;
      if (g.type === 'Merchant Republic') w = coastal && sizeRel < 0.9 ? 2.5 : 0.3;
      if (g.type === 'Tribal Confederation') w = desertShare > 0.25 || domBiome === B.TUNDRA || domBiome === B.SAVANNA ? 2.5 : 0.4;
      if (g.type === 'Technocracy' || g.type === 'Military Junta') w = 0.5;
      return w;
    });
    const gov = r.weighted(GOVERNMENTS, gw);

    // cultural traits shaped by geography
    const tw = TRAITS.map((t) => {
      switch (t.id) {
        case 'seafaring': return coastal ? 3 : 0.05;
        case 'nomadic': return desertShare > 0.2 || domBiome === B.SAVANNA || domBiome === B.TUNDRA ? 3 : 0.3;
        case 'industrious': return mountainous ? 2.5 : 0.8;
        case 'martial': return mountainous ? 1.8 : 1;
        case 'agrarian': return domBiome === B.GRASSLAND || domBiome === B.TEMPERATE_FOREST ? 2.5 : 0.7;
        case 'mystical': return domBiome === B.RAINFOREST || domBiome === B.TAIGA ? 2 : 0.8;
        case 'mercantile': return coastal ? 1.8 : 0.9;
        default: return 1;
      }
    });
    const traits = [];
    while (traits.length < 3) {
      const t = r.weighted(TRAITS, tw);
      if (!traits.includes(t.label)) traits.push(t.label);
    }

    const hue = (goldenHue + k * 137.508) % 360;
    const mapColor = hsl(hue, 48 + r.range(-6, 10), 52 + r.range(-6, 6));
    const accentHue = (hue + r.pick([150, 180, 200, 30, 0])) % 360;
    const colors = [hex(hsl(hue, 62, 38)), hex(r.chance(0.5) ? [240, 236, 222] : hsl(accentHue, 70, 52)), hex(hsl((hue + r.pick([60, 120, 210])) % 360, 66, r.pick([30, 55, 70])))];
    if (r.chance(0.4)) colors[2] = r.pick(['#d6b44a', '#1d1d24', '#f2efe6']);
    const emblem = r.weighted(EMBLEMS, EMBLEMS.map((e) => (e === 'wave' ? (coastal ? 3 : 0.1) : e === 'mountain' ? (mountainous ? 3 : 0.2) : e === 'tree' ? (domBiome === B.TEMPERATE_FOREST || domBiome === B.TAIGA ? 2 : 0.3) : 1)));
    const flag = { pattern: r.pick(FLAG_PATTERNS), colors, emblem, emblemColor: r.pick([colors[1], '#d6b44a', '#f2efe6', colors[2]]) };

    const demonym = lang.demonym(root);
    const currencyBase = r.chance(0.5) ? r.pick(CURRENCY_NOUNS) : lang.root();
    const currency = {
      name: `${root} ${currencyBase}`.length > 18 ? currencyBase : `${root} ${currencyBase}`,
      unit: currencyBase,
      symbol: r.pick(SYMBOLS),
      code: (root.replace(/[^a-z]/gi, '').slice(0, 2) + currencyBase.charAt(0)).toUpperCase(),
    };
    const lex = lang.lexicon();
    const rulerTitle = r.pick(gov.ruler);
    countries.push({
      id: k, name: root, formalName: gov.formal(root), demonym,
      government: gov.type, ruler: { title: rulerTitle, name: lang.person() },
      capitalCell: capCell, x: cx, y: cy,
      area, cellCount: cellsOf[k].length, coastal, mountainous,
      dominantBiomes: sortedBiomes.slice(0, 3),
      founded: foundYears[k],
      mapColor, colors, flag,
      culture: {
        traits,
        religion: r.weighted([`Faith of the ${lang.root()}`, `Way of ${lang.root()}`, `Cult of the ${r.pick(['Tide', 'Sun', 'Ash', 'Stars', 'Deep', 'Mountain', 'Moon', 'Hearth'])}`, `${lang.root()} Ancestor Veneration`], [2, 2, 2, 1]),
        festival: `${lang.root()} ${r.pick(['Festival', 'Rites', 'Jubilee', 'Vigil', 'Feast', 'Games'])}`,
      },
      language: { name: lang.root() + r.pick(['ic', 'ish', 'i', 'an', 'ese']), family: lang.family, feel: lang.feel, lexicon: lex, samples: [lang.city(), lang.person(), lang.root()] },
      currency,
      motto: lang.word(2, 3).charAt(0).toUpperCase() + lang.word(2, 3).slice(1) + ' ' + lang.word(1, 2),
      mottoMeaning: r.pick(['Through tide and stone', 'We endure', 'Light before the long night', 'From many, one hearth', 'The river remembers', 'Strength in the high places', 'Ever forward', 'By oath and harvest', 'The stars are our road', 'Honour the land']),
      _lang: lang, _rng: r,
    });
  }

  // ---- neighbours & shared borders -----------------------------------------------
  const border = new Map();
  for (let i = 0; i < N; i++) {
    const a = owner[i];
    if (a < 0) continue;
    const x = i % W;
    const right = (i - x) + (x === W - 1 ? 0 : x + 1);
    const down = i + W < N ? i + W : -1;
    for (const j of [right, down]) {
      if (j < 0) continue;
      const b = owner[j];
      if (b >= 0 && b !== a) {
        const key = a < b ? a * 1000 + b : b * 1000 + a;
        const e = border.get(key);
        if (e) e.len++; else border.set(key, { a: Math.min(a, b), b: Math.max(a, b), len: 1, cell: i });
      }
    }
  }
  const borders = [...border.values()].sort((p, q) => q.len - p.len);
  for (const c of countries) c.neighbors = [];
  for (const b of borders) { countries[b.a].neighbors.push(b.b); countries[b.b].neighbors.push(b.a); }

  // ---- cities -----------------------------------------------------------------
  const cities = [];
  const pop = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (height[i] <= 0 || F.lakeMask[i]) continue;
    const h = hab[i];
    pop[i] = owner[i] >= 0 ? Math.pow(h, 1.6) * 52 : h * 1.5;
  }
  for (const c of countries) {
    const r = c._rng.fork('cities');
    let rural = 0;
    for (const i of cellsOf[c.id]) rural += pop[i] * cellArea[(i / W) | 0];
    c.ruralPopulation = rural;
    const want = clamp(Math.round(c.area / 85000 * (6371 / grid.R) ** 0.3) + 2, 3, 22);
    const minD = Math.max(grid.cellH * 2.5, Math.sqrt(c.area / want) * 0.5);
    const scored = cellsOf[c.id].filter((i) => !F.lakeMask[i] && i !== c.capitalCell).map((i) => {
      const riv = flow[i] > riverT ? 0.3 : 0;
      return { i, s: hab[i] + (coast[i] === 1 ? 0.35 : 0) + riv + r.next() * 0.25 };
    }).sort((a, b) => b.s - a.s);
    const chosen = [{ i: c.capitalCell, s: 10 }];
    for (const cand of scored) {
      if (chosen.length >= want) break;
      const x = cand.i % W, y = (cand.i / W) | 0;
      let ok = true;
      for (const ch of chosen) if (distKm(grid, x, y, ch.i % W, (ch.i / W) | 0) < minD) { ok = false; break; }
      if (ok) for (const other of cities) if (distKm(grid, x, y, other.x, other.y) < minD * 0.7) { ok = false; break; }
      if (ok) chosen.push(cand);
    }
    const P1 = clamp(rural * r.range(0.05, 0.09), 30000, 30e6);
    c.cities = [];
    chosen.forEach((ch, rank) => {
      const i = ch.i, x = i % W, y = (i / W) | 0;
      const elev = height[i] * world.maxElev;
      let nearMtn = false;
      for (let dy = -3; dy <= 3 && !nearMtn; dy++) for (let dx = -3; dx <= 3; dx++) {
        const yy = clamp(y + dy, 0, H - 1), xx = (x + dx + W) % W;
        if (height[yy * W + xx] * world.maxElev > 1300) { nearMtn = true; break; }
      }
      const coastalCity = coast[i] === 1;
      const fertile = [B.GRASSLAND, B.TEMPERATE_FOREST, B.SAVANNA, B.SHRUBLAND, B.TROPICAL_FOREST, B.WETLAND].includes(biome[i]) && F.moist[i] > 0.3;
      let type;
      if (rank === 0) type = 'capital';
      else if (rank <= 2) type = coastalCity && r.chance(0.6) ? 'port' : 'major';
      else if (coastalCity && r.chance(0.75)) type = 'port';
      else if (nearMtn || elev > 900) type = 'industrial';
      else if (fertile && r.chance(0.7)) type = 'agricultural';
      else if (rank <= 5) type = 'major';
      else type = r.chance(0.5) ? 'town' : 'agricultural';
      const mult = { capital: 1, major: 1.15, port: 1.05, industrial: 0.85, agricultural: 0.4, town: 0.3 }[type];
      const population = Math.max(1500, Math.round((P1 / Math.pow(rank + 1, 1.05)) * mult * (rank === 0 ? 1 : r.range(0.75, 1.25))));
      const ageBias = type === 'industrial' ? 0.5 + 0.5 * r.next() : Math.pow(r.next(), 1.8) * (type === 'town' || type === 'agricultural' ? 0.9 : 0.55);
      const founded = rank === 0 ? c.founded : Math.round(c.founded + (span - c.founded) * ageBias);
      const name = type === 'port' && r.chance(0.25) ? `Port ${c._lang.city()}` : c._lang.city();
      const importance = type === 'capital' ? 5 : population > P1 / 4 ? 4 : population > P1 / 8 ? 3 : population > P1 / 20 ? 2 : 1;
      const city = {
        id: cities.length, name, countryId: c.id, x, y, cell: i, type, population, founded,
        importance, region: importance >= 5 ? 'National' : importance >= 3 ? 'Regional' : 'Local',
        elevation: Math.round(elev), coastal: coastalCity, onRiver: flow[i] > riverT,
      };
      cities.push(city); c.cities.push(city.id);
      pop[i] += population / cellArea[y];
    });
    c.capitalId = c.cities[0];
    c.population = Math.round(rural + c.cities.reduce((s, id) => s + cities[id].population, 0));
    c.urbanization = 1 - rural / c.population;
  }

  return { owner, pop, countries, cities, borders, landArea, hab };
}

