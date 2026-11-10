// Climate model: latitude/elevation temperature with noise, and a prevailing-wind moisture sweep
// (trade winds / westerlies / polar easterlies) that produces orographic rain and rain shadows.

import { createNoise3D, fbm } from '../core/noise.js';
import { clamp } from '../core/utils.js';

export function generateClimate(grid, P, rng, height, maxElev) {
  const { W, H, N, cosLat, sinLat, cosLon, sinLon, lat } = grid;
  const nT = createNoise3D(rng.fork('temp'));
  const nM = createNoise3D(rng.fork('moist'));
  const v = P.climateVar;
  const temp = new Float32Array(N), moist = new Float32Array(N);
  const contrast = 46 + 22 * v; // equator→pole difference °C
  const tAmp = 2.5 + 9 * v;
  const offset = P.globalTemp;

  for (let y = 0; y < H; y++) {
    const al = Math.abs(sinLat[y]);
    const baseT = 27 + offset - contrast * Math.pow(al, 1.25);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const px = cosLat[y] * cosLon[x], py = sinLat[y], pz = cosLat[y] * sinLon[x];
      let t = baseT + fbm(nT, px * 2.2, py * 2.2, pz * 2.2, 3) * tAmp;
      const h = height[i];
      if (h > 0) t -= (h * maxElev / 1000) * 6.5; // lapse rate
      else t = t * 0.85 + 2; // oceans are moderated
      temp[i] = t;
    }
  }

  // Moisture sweep along each latitude row in the prevailing wind direction.
  const step = 1024 / W;
  const elevKm = (i) => (height[i] > 0 ? height[i] * maxElev / 1000 : 0);
  for (let y = 0; y < H; y++) {
    const latDeg = Math.abs(lat[y]) * 180 / Math.PI;
    const dir = latDeg < 30 ? -1 : latDeg < 60 ? 1 : -1;
    // ITCZ wet / horse-latitude dry / mid-latitude wet / polar dry
    const band = 0.5 + 0.5 * Math.cos(6 * lat[y]);
    const latFactor = 0.42 + 0.58 * band;
    let carry = 0.6, prevE = 0;
    for (let k = 0; k < 2 * W; k++) {
      const x = dir > 0 ? k % W : W - 1 - (k % W);
      const i = y * W + x;
      const record = k >= W;
      if (height[i] <= 0) {
        const target = clamp(0.45 + temp[i] / 45, 0.15, 1);
        carry += (target - carry) * Math.min(1, 0.09 * step);
        prevE = 0;
        if (record) moist[i] = carry * latFactor;
      } else {
        const e = elevKm(i);
        const rise = Math.max(0, e - prevE);
        const before = carry;
        const loss = 0.016 * step + rise * 0.55;
        carry = carry * (1 - Math.min(0.75, loss));
        prevE = e;
        if (record) moist[i] = (before * 0.85 + (before - carry) * 2.2) * latFactor;
      }
    }
  }
  // noise + blur
  const mAmp = 0.08 + 0.14 * v;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const px = cosLat[y] * cosLon[x], py = sinLat[y], pz = cosLat[y] * sinLon[x];
      moist[i] = moist[i] + fbm(nM, px * 3, py * 3, pz * 3, 3) * mAmp;
    }
  }
  blur(grid, moist, 2);
  for (let i = 0; i < N; i++) moist[i] = clamp(moist[i] * 1.15, 0, 1);
  return { temp, moist };
}

export function blur(grid, arr, passes) {
  const { W, H, N } = grid;
  const tmp = new Float32Array(N);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1;
        tmp[y * W + x] = (arr[y * W + xl] + arr[y * W + x] * 2 + arr[y * W + xr]) * 0.25;
      }
    }
    for (let y = 0; y < H; y++) {
      const yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
      for (let x = 0; x < W; x++) arr[y * W + x] = (tmp[yu * W + x] + tmp[y * W + x] * 2 + tmp[yd * W + x]) * 0.25;
    }
  }
}

