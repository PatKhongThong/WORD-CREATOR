// Raster base-layer synthesis for the 2D map and 3D planetary globe.
// Supports all 8 visualization modes (Realistic/Physical, Topographic, Biome, Political/Countries,
// Temperature/Climate, Elevation Heatmap, Geological, and Wireframe) plus Moisture & Population layers.

import { BIOMES, B } from '../gen/biomes.js';
import { hash2 } from '../core/noise.js';
import { clamp, lerp } from '../core/utils.js';

export const BASE_LAYERS = [
  { id: 'physical',    label: 'Realistic Planetary', short: 'Realistic',   desc: 'Natural satellite materials with custom ocean tint, relief & bathymetry' },
  { id: 'topographic', label: 'Topographic Contours',short: 'Topographic', desc: 'Hypsometric relief with stepped contour isolines & bathymetric shelves' },
  { id: 'biomes',      label: 'Biome Classification',short: 'Biome',       desc: 'Whittaker ecological & volcanic biome classification' },
  { id: 'countries',   label: 'Political Territories',short:'Political',   desc: 'Sovereign territories & borders blended over relief' },
  { id: 'climate',     label: 'Temperature',         short: 'Temperature', desc: 'Mean annual surface temperature distribution (°C)' },
  { id: 'elevation',   label: 'Elevation Heatmap',   short: 'Elevation',   desc: 'Thermal elevation & ocean trench depth heatmap' },
  { id: 'geological',  label: 'Geological & Plates', short: 'Geological',  desc: 'Tectonic plates, orogenic fault boundaries, volcanic rifts & impact craters' },
  { id: 'wireframe',   label: 'Planetary Wireframe', short: 'Wireframe',   desc: 'Geodesic mesh & terrain elevation grid visualization' },
  { id: 'moisture',    label: 'Precipitation',       short: 'Moisture',    desc: 'Wind-driven precipitation & rain shadows' },
  { id: 'population',  label: 'Population Density',  short: 'Population',  desc: 'Estimated inhabitants per km² & urban lights' },
];

export const OVERLAYS = [
  { id: 'rivers',    label: 'Rivers & Lakes',    default: true },
  { id: 'borders',   label: 'Political Borders', default: true },
  { id: 'cities',    label: 'Cities & Capitals', default: true },
  { id: 'labels',    label: 'Map Labels',        default: true },
  { id: 'graticule', label: 'Lat/Lon Grid',      default: false },
];

const TOPO_STOPS = [
  [-1.00, [8, 20, 46]],
  [-0.65, [15, 39, 78]],
  [-0.30, [28, 70, 120]],
  [-0.08, [54, 116, 160]],
  [0.00,  [84, 152, 182]],
  [0.0001,[108, 162, 98]],
  [0.08,  [148, 188, 112]],
  [0.20,  [208, 200, 132]],
  [0.36,  [200, 158, 106]],
  [0.56,  [164, 118, 86]],
  [0.78,  [142, 130, 124]],
  [1.00,  [248, 248, 252]],
];

const HEAT_ELEV_STOPS = [
  [-1.00, [10, 8, 36]],
  [-0.50, [26, 28, 92]],
  [-0.05, [32, 88, 154]],
  [0.00,  [42, 138, 168]],
  [0.0001,[46, 168, 122]],
  [0.14,  [142, 206, 72]],
  [0.32,  [242, 198, 48]],
  [0.55,  [236, 108, 38]],
  [0.78,  [188, 38, 62]],
  [1.00,  [252, 232, 246]],
];

const TEMP_STOPS = [
  [-30, [216, 236, 252]],
  [-15, [120, 178, 238]],
  [-2,  [58, 126, 210]],
  [6,   [72, 184, 156]],
  [15,  [164, 214, 96]],
  [23,  [244, 196, 72]],
  [30,  [234, 110, 52]],
  [38,  [158, 34, 42]],
];

const PLATE_PALETTE = [
  [82, 118, 158], [132, 104, 152], [96, 142, 124], [156, 122, 88],
  [112, 136, 92], [148, 96, 108], [88, 138, 152], [138, 132, 96],
  [104, 108, 156], [152, 112, 82], [92, 148, 108], [136, 98, 132],
];

function hexToRgb(hex, fallback = [20, 73, 122]) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function sampleRamp(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (v <= v1) {
      const [v0, c0] = stops[i - 1];
      const t = (v - v0) / (v1 - v0 || 1);
      return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
    }
  }
  return stops[stops.length - 1][1];
}

/** Precompute directional hillshade in [0.38, 1.32] for every cell. */
export function computeShade(world) {
  if (world._shade) return world._shade;
  const { W, H } = world;
  const h = world.fields.height;
  const shade = new Float32Array(W * H);
  const lx = -0.58, ly = -0.58, lz = 0.57;
  const zScale = 22 * (W / 1024);
  for (let y = 0; y < H; y++) {
    const yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1;
      const dzdx = (h[y * W + xr] - h[y * W + xl]) * zScale;
      const dzdy = (h[yd * W + x] - h[yu * W + x]) * zScale;
      const nx = -dzdx, ny = -dzdy, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const d = (nx * lx + ny * ly + nz * lz) * inv;
      shade[y * W + x] = clamp(0.42 + d * 0.9, 0.38, 1.32);
    }
  }
  world._shade = shade;
  return shade;
}

/** Build an offscreen canvas for `layerId`. Cached on `world._layerCache`. */
export function getLayerCanvas(world, layerId) {
  if (!world._layerCache) world._layerCache = new Map();
  if (world._layerCache.has(layerId)) return world._layerCache.get(layerId);

  const { W, H, fields, countries, settings } = world;
  const { height, temp, moist, biome, coast, lakeMask, owner, pop, plateId, plateBoundary, volcanicMask, craterMask, isRiver } = fields;
  const shade = computeShade(world);
  const oceanRgb = hexToRgb(settings?.oceanColor || '#14497a');

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const data = img.data;

  for (let y = 0; y < H; y++) {
    const yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const h = height[i], b = biome[i], sh = shade[i];
      const land = h > 0 && !lakeMask[i];
      const grain = (hash2(x, y) - 0.5) * 7;
      let r = 0, g = 0, bl = 0;

      if (layerId === 'physical') {
        if (!land) {
          if (lakeMask[i]) {
            r = oceanRgb[0] * 0.8 + 32; g = oceanRgb[1] * 0.85 + 48; bl = oceanRgb[2] * 0.85 + 54;
          } else if (b === B.SEA_ICE) {
            r = 216; g = 232; bl = 242;
          } else {
            const d = clamp(-h, 0, 1);
            const shelf = coast[i] <= 2 ? (3 - coast[i]) * 0.16 : 0;
            const step = Math.floor(d * 8) / 8;
            const mix = d * 0.75 + step * 0.25;
            r = lerp(oceanRgb[0] * 1.45 + 16, oceanRgb[0] * 0.28, mix) + shelf * 28;
            g = lerp(oceanRgb[1] * 1.45 + 32, oceanRgb[1] * 0.28, mix) + shelf * 54;
            bl = lerp(oceanRgb[2] * 1.35 + 36, oceanRgb[2] * 0.34, mix) + shelf * 48;
            const bsh = 0.86 + (sh - 0.85) * 0.32;
            r *= bsh; g *= bsh; bl *= bsh;
          }
        } else {
          // Smooth transitions between natural biome materials, rock slope, snowline and volcanic glow
          const nat = BIOMES[b].natural;
          const xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1;
          const n1 = BIOMES[biome[y * W + xl]].natural, n2 = BIOMES[biome[y * W + xr]].natural;
          const n3 = BIOMES[biome[yu * W + x]].natural, n4 = BIOMES[biome[yd * W + x]].natural;
          let br = nat[0] * 0.52 + (n1[0] + n2[0] + n3[0] + n4[0]) * 0.12;
          let bg = nat[1] * 0.52 + (n1[1] + n2[1] + n3[1] + n4[1]) * 0.12;
          let bb = nat[2] * 0.52 + (n1[2] + n2[2] + n3[2] + n4[2]) * 0.12;

          const elevTint = clamp(h * 1.15, 0, 1);
          r = lerp(br, 206, elevTint * 0.30) * sh + grain;
          g = lerp(bg, 196, elevTint * 0.28) * sh + grain;
          bl = lerp(bb, 184, elevTint * 0.26) * sh + grain;

          // Subtle incandescent lava fissures on high volcanic basalt cells
          if (b === B.VOLCANIC && volcanicMask && volcanicMask[i] > 0.62) {
            const lava = clamp((volcanicMask[i] - 0.62) * 2.8, 0, 1) * hash2(x * 3, y * 3);
            r = lerp(r, 255, lava * 0.75);
            g = lerp(g, 96, lava * 0.55);
            bl = lerp(bl, 24, lava * 0.55);
          }
          if (isRiver && isRiver[i]) {
            r = lerp(r, oceanRgb[0] + 24, 0.55);
            g = lerp(g, oceanRgb[1] + 54, 0.55);
            bl = lerp(bl, oceanRgb[2] + 64, 0.55);
          }
        }
      } else if (layerId === 'topographic') {
        const c = sampleRamp(TOPO_STOPS, lakeMask[i] ? -0.04 : h);
        const s = land ? sh : 0.9 + (sh - 0.85) * 0.28;
        r = c[0] * s; g = c[1] * s; bl = c[2] * s;
        // Stepped contour isolines every 10% elevation
        const band = Math.floor((h + 1) * 14);
        const xr = x === W - 1 ? 0 : x + 1;
        const bRight = Math.floor((height[y * W + xr] + 1) * 14);
        const bDown = Math.floor((height[yd * W + x] + 1) * 14);
        if (band !== bRight || band !== bDown) {
          r *= land ? 0.62 : 0.78;
          g *= land ? 0.62 : 0.78;
          bl *= land ? 0.62 : 0.78;
        }
      } else if (layerId === 'elevation') {
        const c = sampleRamp(HEAT_ELEV_STOPS, lakeMask[i] ? -0.02 : h);
        const s = land ? 0.76 + sh * 0.28 : 0.88;
        r = c[0] * s; g = c[1] * s; bl = c[2] * s;
      } else if (layerId === 'biomes') {
        const c = BIOMES[b].color;
        const s = land ? 0.72 + sh * 0.32 : 0.94;
        r = c[0] * s + grain * 0.5; g = c[1] * s + grain * 0.5; bl = c[2] * s + grain * 0.5;
      } else if (layerId === 'climate') {
        const c = sampleRamp(TEMP_STOPS, temp[i]);
        const s = land ? 0.78 + sh * 0.25 : 0.72;
        r = c[0] * s; g = c[1] * s; bl = c[2] * s;
      } else if (layerId === 'moisture') {
        if (!land) { r = 14; g = 30; bl = 54; }
        else {
          const m = moist[i];
          r = lerp(226, 28, m) * (0.75 + sh * 0.28);
          g = lerp(188, 148, m) * (0.75 + sh * 0.28);
          bl = lerp(112, 168, m) * (0.75 + sh * 0.28);
        }
      } else if (layerId === 'countries') {
        if (!land) {
          const d = clamp(-h, 0, 1);
          r = lerp(24, 10, d); g = lerp(52, 22, d); bl = lerp(84, 44, d);
        } else {
          const o = owner[i];
          const nat = BIOMES[b].natural;
          if (o >= 0 && countries[o]) {
            const mc = countries[o].mapColor;
            r = (mc[0] * 0.68 + nat[0] * 0.32) * (0.74 + sh * 0.3);
            g = (mc[1] * 0.68 + nat[1] * 0.32) * (0.74 + sh * 0.3);
            bl = (mc[2] * 0.68 + nat[2] * 0.32) * (0.74 + sh * 0.3);
          } else {
            const gray = (nat[0] + nat[1] + nat[2]) / 3;
            r = (gray * 0.6 + 45) * sh * 0.75;
            g = (gray * 0.6 + 48) * sh * 0.75;
            bl = (gray * 0.6 + 54) * sh * 0.75;
          }
        }
      } else if (layerId === 'geological') {
        const pid = plateId ? plateId[i] : 0;
        const pc = PLATE_PALETTE[pid % PLATE_PALETTE.length];
        const pb = plateBoundary ? plateBoundary[i] : 0;
        const vm = volcanicMask ? volcanicMask[i] : 0;
        const cm = craterMask ? craterMask[i] : 0;
        const baseFactor = land ? (0.68 + sh * 0.38) : (0.38 + sh * 0.18);
        r = pc[0] * baseFactor;
        g = pc[1] * baseFactor;
        bl = pc[2] * baseFactor;
        // Fault boundary amber glow
        if (pb > 0.25) {
          const t = clamp((pb - 0.25) / 0.75, 0, 1);
          r = lerp(r, 240, t * 0.75);
          g = lerp(g, 148, t * 0.65);
          bl = lerp(bl, 54, t * 0.65);
        }
        // Active volcanic/orogenic hotspot crimson
        if (vm > 0.45 && land) {
          const t = clamp((vm - 0.45) / 0.55, 0, 1);
          r = lerp(r, 255, t * 0.85);
          g = lerp(g, 68, t * 0.75);
          bl = lerp(bl, 42, t * 0.75);
        }
        // Impact crater cyan-violet ring
        if (cm > 0.15) {
          r = lerp(r, 98, cm * 0.6);
          g = lerp(g, 218, cm * 0.7);
          bl = lerp(bl, 255, cm * 0.8);
        }
      } else if (layerId === 'wireframe') {
        const gridLine = (x % 16 === 0) || (y % 16 === 0);
        const fineLine = (x % 4 === 0) || (y % 4 === 0);
        if (gridLine) {
          r = land ? 98 : 38; g = land ? 228 : 118; bl = land ? 255 : 186;
        } else if (fineLine) {
          r = land ? 28 + h * 90 : 12; g = land ? 78 + h * 110 : 32; bl = land ? 112 + h * 90 : 62;
        } else {
          r = land ? 10 : 5; g = land ? 22 : 10; bl = land ? 36 : 20;
        }
      } else if (layerId === 'population') {
        if (!land) { r = 8; g = 16; bl = 30; }
        else {
          const p = Math.min(1, Math.log10(pop[i] + 1) / 3.4);
          r = lerp(22, 255, Math.pow(p, 0.75));
          g = lerp(28, 214, Math.pow(p, 1.1));
          bl = lerp(44, 96, p < 0.5 ? p * 1.4 : 1 - (p - 0.5));
        }
      }

      if (land && coast[i] === 1 && layerId !== 'population' && layerId !== 'wireframe') {
        r *= 0.78; g *= 0.78; bl *= 0.78;
      }
      const idx = i * 4;
      data[idx] = clamp(r, 0, 255);
      data[idx + 1] = clamp(g, 0, 255);
      data[idx + 2] = clamp(bl, 0, 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  world._layerCache.set(layerId, canvas);
  return canvas;
}

/** Precomputed political border mask canvas (crisp interior + dark casing). */
export function getBorderCanvas(world) {
  if (world._borderCanvas) return world._borderCanvas;
  const { W, H, fields, countries } = world;
  const { owner, height } = fields;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (height[i] <= 0) continue;
      const o = owner[i];
      if (o < 0) continue;
      const xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1;
      const diff = owner[y * W + xl] !== o || owner[y * W + xr] !== o || owner[yu * W + x] !== o || owner[yd * W + x] !== o;
      if (diff) {
        const mc = countries[o]?.mapColor || [220, 190, 90];
        const k = i * 4;
        d[k] = Math.min(255, mc[0] * 0.55 + 115);
        d[k + 1] = Math.min(255, mc[1] * 0.55 + 100);
        d[k + 2] = Math.min(255, mc[2] * 0.55 + 60);
        d[k + 3] = 235;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  world._borderCanvas = c;
  return c;
}
