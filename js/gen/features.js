// Geographic feature extraction and naming: continents & islands, mountain ranges & peaks,
// lakes, biome regions (deserts, forests, ...), oceans & seas and named rivers.

import { labelComponents, centroidOf, distKm } from './grid.js';
import { B } from './biomes.js';
import { Language } from '../core/names.js';

const REGION_GROUPS = [
  { kind: 'desert', biomes: [B.DESERT] },
  { kind: 'forest', biomes: [B.TEMPERATE_FOREST, B.TEMPERATE_RAINFOREST] },
  { kind: 'jungle', biomes: [B.RAINFOREST, B.TROPICAL_FOREST] },
  { kind: 'taiga', biomes: [B.TAIGA] },
  { kind: 'grassland', biomes: [B.GRASSLAND, B.SHRUBLAND] },
  { kind: 'savanna', biomes: [B.SAVANNA] },
  { kind: 'tundra', biomes: [B.TUNDRA] },
  { kind: 'ice', biomes: [B.ICE] },
  { kind: 'wetland', biomes: [B.WETLAND] },
  { kind: 'volcanic', biomes: [B.VOLCANIC] },
];

export function extractFeatures(grid, world, rng) {
  const { W, H, N, totalArea } = grid;
  const { height, biome, lakeMask, coast } = world.fields;
  const maxElev = world.maxElev;

  // ---- Landmasses --------------------------------------------------------------
  const landMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) landMask[i] = height[i] > 0 ? 1 : 0;
  const lm = labelComponents(grid, landMask, true);
  lm.comps.sort((a, b) => b.area - a.area);
  const landmass = new Int32Array(N).fill(-1);
  const continentThreshold = totalArea * 0.0075;
  const continents = [], islands = [];
  const globalLang = new Language(rng.fork('lang-global'), null);
  lm.comps.forEach((c, idx) => {
    for (const cell of c.cells) landmass[cell] = idx;
    const isCont = idx === 0 || c.area >= continentThreshold;
    const cen = centroidOf(grid, c.cells);
    if (isCont) {
      const lang = new Language(rng.fork('lang-cont-' + idx), idx);
      const name = lang.continent();
      continents.push({ id: idx, kind: 'continent', name, area: c.area, cellCount: c.cells.length, x: cen.x, y: cen.y, lang, biomeArea: {} });
    } else {
      islands.push({ id: idx, kind: 'island', name: null, area: c.area, cellCount: c.cells.length, x: cen.x, y: cen.y });
    }
  });
  const contById = new Map(continents.map((c) => [c.id, c]));
  // name the larger islands, using the language of the nearest continent
  const nearestContLang = (x, y) => {
    let best = continents[0], bd = Infinity;
    for (const c of continents) { const d = distKm(grid, x, y, c.x, c.y); if (d < bd) { bd = d; best = c; } }
    return best.lang;
  };
  const namedIslands = Math.min(islands.length, 70);
  for (let k = 0; k < namedIslands; k++) {
    const isl = islands[k];
    if (isl.cellCount < 3) break;
    isl.name = nearestContLang(isl.x, isl.y).feature('island');
  }
  const langAt = (cell) => {
    const l = landmass[cell];
    if (l >= 0 && contById.has(l)) return contById.get(l).lang;
    const x = cell % W, y = (cell / W) | 0;
    return nearestContLang(x, y);
  };

  // biome composition per continent
  for (let i = 0; i < N; i++) {
    const l = landmass[i];
    if (l < 0) continue;
    const c = contById.get(l);
    if (!c) continue;
    const a = grid.cellArea[(i / W) | 0];
    c.biomeArea[biome[i]] = (c.biomeArea[biome[i]] || 0) + a;
  }

  const features = [];
  const region = new Int32Array(N).fill(-1);
  const minRegion = Math.max(14, Math.round(N / 3500));

  // ---- Biome regions -------------------------------------------------------------
  for (const g of REGION_GROUPS) {
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (g.biomes.includes(biome[i])) mask[i] = 1;
    const { comps } = labelComponents(grid, mask, true);
    comps.sort((a, b) => b.area - a.area);
    for (const c of comps) {
      if (c.cells.length < minRegion) break;
      const cen = centroidOf(grid, c.cells);
      const id = features.length;
      features.push({ id, kind: g.kind, name: langAt(cen.cell).feature(g.kind), area: c.area, cellCount: c.cells.length, x: cen.x, y: cen.y, continent: landmass[cen.cell] });
      for (const cell of c.cells) region[cell] = id;
    }
  }

  // ---- Lakes ---------------------------------------------------------------------
  {
    const { comps } = labelComponents(grid, lakeMask, true);
    comps.sort((a, b) => b.area - a.area);
    for (const c of comps) {
      const cen = centroidOf(grid, c.cells);
      const id = features.length;
      features.push({ id, kind: 'lake', name: langAt(cen.cell).feature('lake'), area: c.area, cellCount: c.cells.length, x: cen.x, y: cen.y, continent: landmass[cen.cell] });
      for (const cell of c.cells) region[cell] = id;
    }
  }

  // ---- Mountain ranges & peaks ---------------------------------------------------
  {
    const thr = 1700 / maxElev;
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (height[i] > thr && !lakeMask[i]) mask[i] = 1;
    const { comps } = labelComponents(grid, mask, true);
    comps.sort((a, b) => b.area - a.area);
    const minMtn = Math.max(6, Math.round(N / 14000));
    for (const c of comps) {
      if (c.cells.length < minMtn) break;
      let peak = c.cells[0];
      for (const cell of c.cells) if (height[cell] > height[peak]) peak = cell;
      const cen = centroidOf(grid, c.cells);
      const lang = langAt(cen.cell);
      const id = features.length;
      features.push({
        id, kind: 'mountain', name: lang.feature('mountain'), area: c.area, cellCount: c.cells.length, x: cen.x, y: cen.y,
        continent: landmass[cen.cell],
        peak: { name: lang.feature('peak'), x: peak % W, y: (peak / W) | 0, elevation: Math.round(height[peak] * maxElev) },
      });
      for (const cell of c.cells) region[cell] = id;
    }
  }

  // ---- Oceans & seas ---------------------------------------------------------------
  {
    const oceanPts = [];
    const cand = [];
    for (let i = 0; i < N; i++) if (height[i] <= 0 && coast[i] >= 6) cand.push(i);
    cand.sort((a, b) => coast[b] - coast[a] || a - b);
    const minSep = grid.R * 1.1;
    for (const c of cand) {
      if (oceanPts.length >= 7) break;
      const x = c % W, y = (c / W) | 0;
      if (y < H * 0.08 || y > H * 0.92) continue;
      let ok = true;
      for (const p of oceanPts) if (distKm(grid, x, y, p.x, p.y) < minSep) { ok = false; break; }
      if (ok) oceanPts.push({ x, y, depth: coast[c] });
    }
    const oceanFeatIds = oceanPts.map((p, k) => {
      const id = features.length;
      const kind = k < 4 && p.depth > 14 ? 'ocean' : 'sea';
      features.push({ id, kind, name: globalLang.feature(kind), area: 0, cellCount: 0, x: p.x, y: p.y });
      return id;
    });
    if (oceanPts.length) {
      // Voronoi assignment of ocean cells (unit vectors for speed)
      const vec = oceanPts.map((p) => {
        const la = grid.lat[p.y], lo = grid.lon[p.x];
        return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
      });
      for (let y = 0; y < H; y++) {
        const cl = grid.cosLat[y], sl = grid.sinLat[y];
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (height[i] > 0) continue;
          const px = cl * grid.cosLon[x], pz = cl * grid.sinLon[x];
          let best = 0, bd = -2;
          for (let k = 0; k < vec.length; k++) {
            const d = px * vec[k][0] + sl * vec[k][1] + pz * vec[k][2];
            if (d > bd) { bd = d; best = k; }
          }
          const fid = oceanFeatIds[best];
          region[i] = fid;
          features[fid].area += grid.cellArea[y];
          features[fid].cellCount++;
        }
      }
    }
  }

  // continent → mountains, highest point
  for (const c of continents) {
    c.mountains = features.filter((f) => f.kind === 'mountain' && f.continent === c.id).map((f) => f.id);
    let hi = null;
    for (const fid of c.mountains) if (!hi || features[fid].peak.elevation > hi.elevation) hi = features[fid].peak;
    c.highest = hi;
  }

  return { landmass, region, continents, islands, features, langAt, globalLang, landCompCount: lm.comps.length };
}

/** Name significant rivers and compute their lengths. */
export function nameRivers(grid, world, rivers, langAt) {
  const { W } = grid;
  for (const r of rivers) {
    let len = 0;
    for (let k = 1; k < r.cells.length; k++) {
      const a = r.cells[k - 1], b = r.cells[k];
      len += distKm(grid, a % W, (a / W) | 0, b % W, (b / W) | 0);
    }
    r.length = Math.round(len);
  }
  const ranked = rivers.slice().sort((a, b) => b.length - a.length);
  const nameCount = Math.min(ranked.length, 60);
  for (let k = 0; k < nameCount; k++) {
    const r = ranked[k];
    if (r.length < 250) break;
    const mid = r.cells[Math.floor(r.cells.length / 2)];
    r.name = langAt(mid).feature('river');
  }
}

