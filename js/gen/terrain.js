// Terrain synthesis: continental caps on the sphere + domain-warped fBm + plate-boundary ridged mountains
// + oceanic islands, volcanic hotspot chains, bowl-shaped impact craters with raised ejecta rims,
// and volcanic rift/caldera terrain masks. Sea level is solved as the exact area-weighted percentile
// that yields the requested ocean coverage.

import { createNoise3D, fbm, ridged } from '../core/noise.js';
import { smoothstep, clamp } from '../core/utils.js';

function randomUnit(rng, yMin = -1, yMax = 1) {
  const y = rng.range(yMin, yMax), t = rng.range(0, Math.PI * 2), r = Math.sqrt(Math.max(0, 1 - y * y));
  return [r * Math.cos(t), y, r * Math.sin(t)];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => Math.acos(clamp(dot(a, b), -1, 1));

function placeContinents(rng, n, dist) {
  const pts = [];
  const anchor = randomUnit(rng, -0.5, 0.5);
  for (let k = 0; k < n; k++) {
    let best = null, bestScore = -Infinity;
    for (let t = 0; t < 40; t++) {
      let v;
      if (dist === 'supercontinent') {
        do { v = randomUnit(rng); } while (angle(v, anchor) > 0.75);
      } else if (dist === 'equatorial') v = randomUnit(rng, -0.42, 0.42);
      else if (dist === 'polar') v = rng.chance(0.5) ? randomUnit(rng, 0.45, 0.95) : randomUnit(rng, -0.95, -0.45);
      else v = randomUnit(rng, -0.85, 0.85);
      let minA = Math.PI;
      for (const p of pts) minA = Math.min(minA, angle(v, p));
      const score = dist === 'supercontinent' ? Math.min(minA, 0.45) + rng.next() * 0.1 : minA;
      if (score > bestScore) { bestScore = score; best = v; }
    }
    pts.push(best);
  }
  return pts;
}

/**
 * @returns {{height: Float32Array, plateId: Uint8Array, plateBoundary: Float32Array, volcanicMask: Float32Array, craterMask: Float32Array, plates:number}}
 */
export function generateTerrain(grid, P, rng, progress) {
  const { W, H, N, cosLat, sinLat, cosLon, sinLon, cellArea } = grid;
  const nBase = createNoise3D(rng.fork('noise-base'));
  const nWarp1 = createNoise3D(rng.fork('noise-warp1'));
  const nWarp2 = createNoise3D(rng.fork('noise-warp2'));
  const nWarp3 = createNoise3D(rng.fork('noise-warp3'));
  const nMtn = createNoise3D(rng.fork('noise-mountain'));
  const nIsl = createNoise3D(rng.fork('noise-island'));
  const nHill = createNoise3D(rng.fork('noise-hill'));

  const archipelago = P.distribution === 'archipelago';
  const landFrac = 1 - P.ocean;
  const complexity = P.terrainComplexity ?? 0.65;
  const baseOctaves = Math.round(4 + complexity * 3); // 4..7
  const roughness = P.terrainRoughness ?? 0.55;
  const gain = 0.44 + roughness * 0.16;
  const mtnIntensity = P.mountainIntensity ?? 0.65;
  const mtnF = P.mountains ?? 0.55;
  const islF = P.islands ?? 0.45;
  const craterF = P.craterFrequency ?? 0.15;
  const elevVar = P.elevationVariation ?? 0.65;

  // --- Continental caps -------------------------------------------------------
  const crng = rng.fork('continents');
  const centers = placeContinents(crng, P.continents, P.distribution);
  const weights = centers.map(() => crng.range(0.55, 1.45));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const capScale = archipelago ? 0.45 : P.distribution === 'supercontinent' ? 1.25 : 1.05;
  const radii = weights.map((w) => {
    const frac = clamp(landFrac * (w / wsum) * capScale, 0.002, 0.45);
    return Math.acos(1 - 2 * frac);
  });

  // --- Tectonic plates (independent from continents so ranges cross landmasses)
  const prng = rng.fork('plates');
  const nPlates = P.continents + 6 + prng.int(0, 4);
  const plates = [];
  for (let i = 0; i < nPlates; i++) plates.push(randomUnit(prng));
  const plateBoost = plates.map(() => prng.range(0.55, 1.25));

  // --- Volcanic hotspot chains -------------------------------------------------
  const hrng = rng.fork('hotspots');
  const bumps = [];
  const chains = Math.round(islF * 7 + (archipelago ? 6 : 0) + (P.biomeVolcanic ?? 0.2) * 5);
  for (let c = 0; c < chains; c++) {
    let p = randomUnit(hrng, -0.8, 0.8);
    let d = randomUnit(hrng);
    const pd = dot(p, d);
    d = [d[0] - pd * p[0], d[1] - pd * p[1], d[2] - pd * p[2]];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1; d = d.map((v) => v / dl);
    const len = hrng.int(5, 12), step = hrng.range(0.035, 0.06);
    for (let k = 0; k < len; k++) {
      const r = hrng.range(0.012, 0.028) * (1 - k / (len * 1.6));
      bumps.push({ p: p.slice(), r, cosR: Math.cos(r * 3), amp: hrng.range(0.9, 1.35) * (1 - k / (len * 1.3)) });
      const np = [p[0] * Math.cos(step) + d[0] * Math.sin(step), p[1] * Math.cos(step) + d[1] * Math.sin(step), p[2] * Math.cos(step) + d[2] * Math.sin(step)];
      const nd = [d[0] * Math.cos(step) - p[0] * Math.sin(step), d[1] * Math.cos(step) - p[1] * Math.sin(step), d[2] * Math.cos(step) - p[2] * Math.sin(step)];
      p = np; d = nd;
    }
  }

  // --- Impact Craters (3D spherical basins with raised rims & central peaks) ---
  const krng = rng.fork('craters');
  const craters = [];
  const nCraters = Math.round(craterF * 38);
  for (let c = 0; c < nCraters; c++) {
    const p = randomUnit(krng, -0.92, 0.92);
    const r = krng.range(0.018, 0.095) * (0.5 + craterF * 0.7);
    craters.push({ p, r, cosMax: Math.cos(r * 1.65), depth: krng.range(0.28, 0.62) * (0.6 + craterF * 0.6) });
  }

  const warpAmt = archipelago ? 0.5 : 0.32 + complexity * 0.1;
  const mtnFreqScale = 2.2 + mtnF * 2.2;
  const raw = new Float32Array(N);
  const plateId = new Uint8Array(N);
  const plateBoundary = new Float32Array(N);
  const volcanicMask = new Float32Array(N);
  const craterMask = new Float32Array(N);
  let hmin = Infinity, hmax = -Infinity;

  for (let y = 0; y < H; y++) {
    const cl = cosLat[y], sl = sinLat[y];
    for (let x = 0; x < W; x++) {
      const px = cl * cosLon[x], py = sl, pz = cl * sinLon[x];
      const wx = fbm(nWarp1, px * 1.7, py * 1.7, pz * 1.7, 3);
      const wy = fbm(nWarp2, px * 1.7, py * 1.7, pz * 1.7, 3);
      const wz = fbm(nWarp3, px * 1.7, py * 1.7, pz * 1.7, 3);
      let qx = px + wx * warpAmt, qy = py + wy * warpAmt, qz = pz + wz * warpAmt;
      const ql = Math.hypot(qx, qy, qz); qx /= ql; qy /= ql; qz /= ql;

      // continents
      let cont = -1;
      for (let i = 0; i < centers.length; i++) {
        const c = centers[i];
        const a = Math.acos(clamp(qx * c[0] + qy * c[1] + qz * c[2], -1, 1));
        const f = 1 - a / radii[i];
        if (f > cont) cont = f;
      }
      if (cont < -1) cont = -1;

      const base = fbm(nBase, qx * 2.3, qy * 2.3, qz * 2.3, baseOctaves, 2.02, gain);

      // plate boundaries
      let b1 = -2, b2 = -2, p1 = 0;
      for (let j = 0; j < nPlates; j++) {
        const pl = plates[j];
        const d = qx * pl[0] + qy * pl[1] + qz * pl[2];
        if (d > b1) { b2 = b1; b1 = d; p1 = j; } else if (d > b2) b2 = d;
      }
      const edge = 1 - smoothstep(0, 0.032 + 0.055 * mtnF, b1 - b2);
      const rid = ridged(nMtn, px * mtnFreqScale, py * mtnFreqScale, pz * mtnFreqScale, 5);
      const landish = smoothstep(-0.55, 0.05, cont) * 0.8 + 0.2;
      let mtn = edge * rid * rid * (0.25 + 1.05 * mtnIntensity) * plateBoost[p1] * landish;
      mtn += Math.pow(rid, 3) * 0.2 * mtnIntensity * landish;
      const hills = fbm(nHill, px * 9, py * 9, pz * 9, 3) * (0.04 + roughness * 0.07);

      // islands
      const oceanMask = 1 - smoothstep(-0.6, 0.0, cont);
      let isl = fbm(nIsl, px * 7, py * 7, pz * 7, 3) - (0.36 - 0.16 * islF);
      isl = isl > 0 ? isl * (1.6 + 1.6 * islF) * islF * oceanMask : 0;

      let hs = 0;
      for (let b = 0; b < bumps.length; b++) {
        const bp = bumps[b];
        const d = px * bp.p[0] + py * bp.p[1] + pz * bp.p[2];
        if (d > bp.cosR) {
          const a = Math.acos(Math.min(1, d)) / bp.r;
          hs += bp.amp * Math.exp(-a * a);
        }
      }

      // Impact crater profile: bowl inside r<1, raised ejecta rim around r=1, fading outside
      let craterDelta = 0, cMask = 0;
      for (let c = 0; c < craters.length; c++) {
        const cr = craters[c];
        const d = px * cr.p[0] + py * cr.p[1] + pz * cr.p[2];
        if (d > cr.cosMax) {
          const u = Math.acos(Math.min(1, d)) / cr.r;
          if (u < 1.0) {
            const bowl = -(1 - u * u) * cr.depth;
            const centralPeak = u < 0.28 ? (1 - (u / 0.28) ** 2) * cr.depth * 0.32 : 0;
            craterDelta += bowl + centralPeak;
            cMask = Math.max(cMask, 1 - u * 0.5);
          } else if (u < 1.6) {
            const t = (u - 1.0) / 0.6;
            const rim = Math.exp(-t * t * 5.5) * cr.depth * 0.42;
            craterDelta += rim;
            cMask = Math.max(cMask, (1 - t) * 0.7);
          }
        }
      }

      const i = y * W + x;
      plateId[i] = p1;
      plateBoundary[i] = edge;
      volcanicMask[i] = clamp(edge * rid * 0.85 + hs * 0.65, 0, 1);
      craterMask[i] = cMask;

      const h = cont * 0.95 + base * (0.48 + roughness * 0.16) + mtn * 0.92 + hills + isl + hs * (0.7 + 0.5 * islF) + craterDelta;
      raw[i] = h;
      if (h < hmin) hmin = h;
      if (h > hmax) hmax = h;
    }
    if ((y & 31) === 0) progress && progress(y / H);
  }

  // --- Sea level: area-weighted percentile via fine histogram ------------------
  const BINS = 65536;
  const hist = new Float64Array(BINS);
  const span = hmax - hmin || 1;
  let total = 0;
  for (let y = 0; y < H; y++) {
    const a = cellArea[y];
    for (let x = 0; x < W; x++) {
      const b = Math.min(BINS - 1, Math.floor(((raw[y * W + x] - hmin) / span) * BINS));
      hist[b] += a; total += a;
    }
  }
  const target = total * P.ocean;
  let acc = 0, bin = 0;
  for (; bin < BINS; bin++) { acc += hist[bin]; if (acc >= target) break; }
  const seaRaw = hmin + ((bin + 1) / BINS) * span;

  // --- Normalise to [-1,1] with hypsometric shaping ----------------------------
  const height = new Float32Array(N);
  const landSpan = hmax - seaRaw || 1, seaSpan = seaRaw - hmin || 1;
  const landExp = clamp(1.75 - elevVar * 0.55, 0.95, 1.85);
  for (let i = 0; i < N; i++) {
    const h = raw[i];
    if (h > seaRaw) height[i] = Math.max(0.0005, Math.pow((h - seaRaw) / landSpan, landExp));
    else height[i] = -Math.pow((seaRaw - h) / seaSpan, 0.62);
  }
  return { height, plateId, plateBoundary, volcanicMask, craterMask, plates: nPlates };
}

/** Light thermal smoothing on land to soften single-cell spikes (keeps coastlines). */
export function smoothLand(grid, height, passes = 1) {
  const { W, H, N } = grid;
  const tmp = new Float32Array(N);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      const yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
      for (let x = 0; x < W; x++) {
        const i = y * W + x, h = height[i];
        if (h <= 0) { tmp[i] = h; continue; }
        const xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1;
        const avg = (height[y * W + xl] + height[y * W + xr] + height[yu * W + x] + height[yd * W + x]) * 0.25;
        tmp[i] = Math.max(0.0005, h * 0.6 + Math.max(avg, 0.0005) * 0.4);
      }
    }
    height.set(tmp);
  }
}
