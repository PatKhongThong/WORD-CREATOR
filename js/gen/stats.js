// Planetary statistics calculator. Every value is computed directly from the generated arrays and entities.

import { BIOMES, isWater } from './biomes.js';
import { fnv1a, hashString } from '../core/utils.js';

export function computeStats(grid, world) {
  const { W, H, N, cellArea, totalArea } = grid;
  const { height, temp, moist, biome, lakeMask, owner } = world.fields;
  const maxElev = world.maxElev, maxDepth = world.maxDepth;
  const mtnThresh = 1700 / maxElev;

  let landArea = 0, oceanArea = 0, lakeArea = 0, mountainArea = 0, claimedArea = 0;
  let tempSum = 0, landTempSum = 0, moistSum = 0, elevSum = 0, elevSqSum = 0;
  let highestCell = 0, lowestCell = 0;
  const biomeAreas = new Float64Array(BIOMES.length);
  const latBands = Array.from({ length: 18 }, (_, k) => ({ lat: 85 - k * 10, temp: 0, landTemp: 0, moist: 0, area: 0, landArea: 0 }));
  const hypso = new Float64Array(24); // -6000..+6000m in 500m bins

  for (let y = 0; y < H; y++) {
    const a = cellArea[y];
    const band = Math.min(17, Math.floor((y / H) * 18));
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const h = height[i], t = temp[i], m = moist[i], b = biome[i];
      biomeAreas[b] += a;
      tempSum += t * a;
      latBands[band].temp += t * a; latBands[band].area += a;
      if (h > height[highestCell]) highestCell = i;
      if (h < height[lowestCell]) lowestCell = i;
      const mElev = h > 0 ? h * maxElev : h * maxDepth;
      const hBin = Math.max(0, Math.min(23, Math.floor((mElev + 6000) / 500)));
      hypso[hBin] += a;
      if (h > 0) {
        landArea += a;
        landTempSum += t * a; moistSum += m * a; elevSum += mElev * a; elevSqSum += mElev * mElev * a;
        latBands[band].landTemp += t * a; latBands[band].moist += m * a; latBands[band].landArea += a;
        if (lakeMask[i]) lakeArea += a;
        if (h > mtnThresh) mountainArea += a;
        if (owner[i] >= 0) claimedArea += a;
      } else oceanArea += a;
    }
  }
  for (const b of latBands) {
    b.temp = b.area ? b.temp / b.area : 0;
    b.landTemp = b.landArea ? b.landTemp / b.landArea : b.temp;
    b.moist = b.landArea ? b.moist / b.landArea : 0;
  }

  let activeBiomes = 0, activeLandBiomes = 0;
  const biomeBreakdown = [];
  for (let b = 0; b < BIOMES.length; b++) {
    const area = biomeAreas[b];
    if (area > totalArea * 0.0002) { activeBiomes++; if (!isWater(b)) activeLandBiomes++; }
    if (area > 0) biomeBreakdown.push({
      id: b, name: BIOMES[b].name, color: BIOMES[b].color, water: !!BIOMES[b].water,
      area, pctTotal: (area / totalArea) * 100, pctLand: !BIOMES[b].water && landArea ? (area / landArea) * 100 : 0,
    });
  }
  biomeBreakdown.sort((a, b) => b.area - a.area);

  const totalPop = world.countries.reduce((s, c) => s + c.population, 0);
  const urbanPop = world.cities.reduce((s, c) => s + c.population, 0);

  return {
    totalArea, landArea, oceanArea, lakeArea, mountainArea, claimedArea,
    landFraction: landArea / totalArea,
    oceanPct: (oceanArea / totalArea) * 100,
    landPct: (landArea / totalArea) * 100,
    mountainPctOfLand: landArea ? (mountainArea / landArea) * 100 : 0,
    mountainPctOfWorld: (mountainArea / totalArea) * 100,
    claimedPctOfLand: landArea ? (claimedArea / landArea) * 100 : 0,
    avgTemp: tempSum / totalArea,
    avgLandTemp: landArea ? landTempSum / landArea : 0,
    avgMoisture: landArea ? (moistSum / landArea) * 100 : 0,
    avgElevation: landArea ? elevSum / landArea : 0,
    terrainVariation: landArea ? Math.sqrt(Math.max(0, elevSqSum / landArea - (elevSum / landArea) ** 2)) : 0,
    highestPoint: { x: highestCell % W, y: (highestCell / W) | 0, elevation: Math.round(height[highestCell] * maxElev) },
    deepestPoint: { x: lowestCell % W, y: (lowestCell / W) | 0, depth: Math.round(-height[lowestCell] * maxDepth) },
    continentCount: world.continents.length,
    islandCount: world.islands.length,
    countryCount: world.countries.length,
    cityCount: world.cities.length,
    riverCount: world.rivers.filter((r) => r.length >= 120).length,
    lakeCount: world.features.filter((f) => f.kind === 'lake').length,
    mountainRangeCount: world.features.filter((f) => f.kind === 'mountain').length,
    eventCount: world.history.length,
    totalPopulation: totalPop,
    urbanPopulation: urbanPop,
    urbanPct: totalPop ? (urbanPop / totalPop) * 100 : 0,
    activeBiomes, activeLandBiomes,
    biomeBreakdown,
    latBands,
    hypsography: Array.from(hypso, (a) => (a / totalArea) * 100),
  };
}

/** Deterministic 32-bit fingerprint of a generated world (for reproducibility verification). */
export function worldFingerprint(world) {
  let h = 0x811c9dc5;
  h = fnv1a(new Uint8Array(world.fields.height.buffer), h);
  h = fnv1a(world.fields.biome, h);
  h = fnv1a(new Uint8Array(world.fields.owner.buffer), h);
  for (const c of world.countries) h = hashString(`${c.name}:${c.population}:${c.capitalId}`, h);
  for (const ct of world.cities) h = hashString(`${ct.name}:${ct.population}:${ct.x},${ct.y}`, h);
  for (const ev of world.history) h = hashString(`${ev.year}:${ev.title}`, h);
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

