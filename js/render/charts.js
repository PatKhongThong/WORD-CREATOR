// SVG data-visualization helpers for the Dashboard and Planet Comparison views.
// Every chart renders directly from the world's computed statistics.

import { formatCompact, formatInt, escapeHtml } from '../core/utils.js';

export function renderBiomeDonut(stats) {
  const landBiomes = stats.biomeBreakdown.filter((b) => !b.water).slice(0, 8);
  const r = 56, cx = 72, cy = 72, circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = landBiomes.map((b) => {
    const frac = b.pctLand / 100;
    const len = frac * circ;
    const col = `rgb(${b.color.join(',')})`;
    const svg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="18" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${escapeHtml(b.name)}: ${b.pctLand.toFixed(1)}% of land</title></circle>`;
    offset += len;
    return svg;
  }).join('');

  const legend = landBiomes.map((b) => `
    <div class="wf-chart-leg-row">
      <span class="wf-swatch" style="background:rgb(${b.color.join(',')})"></span>
      <span class="wf-chart-leg-name">${escapeHtml(b.name)}</span>
      <span class="wf-chart-leg-val">${b.pctLand.toFixed(1)}%</span>
    </div>`).join('');

  return `
    <div class="wf-donut-wrap">
      <svg viewBox="0 0 144 144" width="144" height="144" class="wf-donut">
        <g transform="rotate(-90 72 72)">${arcs}</g>
        <text x="72" y="68" text-anchor="middle" class="wf-donut-big">${stats.activeLandBiomes}</text>
        <text x="72" y="84" text-anchor="middle" class="wf-donut-sub">LAND BIOMES</text>
      </svg>
      <div class="wf-chart-leg">${legend}</div>
    </div>`;
}

export function renderLatClimateChart(stats) {
  const bands = stats.latBands;
  const W = 420, H = 156, padL = 36, padR = 28, padT = 14, padB = 26;
  const pw = W - padL - padR, ph = H - padT - padB;
  const xOf = (i) => padL + (i / (bands.length - 1)) * pw;
  const yTemp = (t) => padT + ((35 - t) / 70) * ph;
  const yMoist = (m) => padT + (1 - m) * ph;

  const tempPts = bands.map((b, i) => `${xOf(i).toFixed(1)},${yTemp(b.temp).toFixed(1)}`).join(' ');
  const moistPts = bands.map((b, i) => `${xOf(i).toFixed(1)},${yMoist(b.moist).toFixed(1)}`).join(' ');
  const moistArea = `${padL},${padT + ph} ${moistPts} ${padL + pw},${padT + ph}`;
  const zeroY = yTemp(0).toFixed(1);

  return `
    <svg viewBox="0 0 ${W} ${H}" class="wf-svg-chart">
      <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="rgba(255,255,255,0.14)" stroke-dasharray="3,3"/>
      <polygon points="${moistArea}" fill="rgba(66, 184, 224, 0.16)"/>
      <polyline points="${moistPts}" fill="none" stroke="#42b8e0" stroke-width="2"/>
      <polyline points="${tempPts}" fill="none" stroke="#f0a84c" stroke-width="2.4"/>
      <text x="${padL - 5}" y="${padT + 8}" text-anchor="end" class="wf-axis">+35°C</text>
      <text x="${padL - 5}" y="${zeroY}" text-anchor="end" class="wf-axis">0°C</text>
      <text x="${padL - 5}" y="${padT + ph}" text-anchor="end" class="wf-axis">-35°C</text>
      <text x="${padL}" y="${H - 6}" class="wf-axis">90°N</text>
      <text x="${padL + pw / 2}" y="${H - 6}" text-anchor="middle" class="wf-axis">Equator</text>
      <text x="${padL + pw}" y="${H - 6}" text-anchor="end" class="wf-axis">90°S</text>
    </svg>
    <div class="wf-chart-caption">
      <span><i style="background:#f0a84c"></i> Mean Temperature (°C)</span>
      <span><i style="background:#42b8e0"></i> Land Moisture</span>
    </div>`;
}

export function renderHypsometricCurve(stats) {
  const bins = stats.hypsography;
  const max = Math.max(...bins, 1);
  const W = 420, H = 148, padL = 32, padB = 22, padT = 10, padR = 10;
  const pw = W - padL - padR, ph = H - padT - padB;
  const bw = pw / bins.length;
  const bars = bins.map((v, i) => {
    const h = (v / max) * ph;
    const x = padL + i * bw;
    const y = padT + ph - h;
    const isLand = i >= 12;
    const col = isLand ? (i >= 16 ? '#c89b6e' : '#6cb478') : '#2f7ab8';
    const elevLabel = `${(i - 12) * 500}m to ${(i - 11) * 500}m: ${v.toFixed(1)}%`;
    return `<rect x="${(x + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(2, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${col}" rx="1.5"><title>${elevLabel}</title></rect>`;
  }).join('');
  const seaX = (padL + 12 * bw).toFixed(1);
  return `
    <svg viewBox="0 0 ${W} ${H}" class="wf-svg-chart">
      ${bars}
      <line x1="${seaX}" y1="${padT}" x2="${seaX}" y2="${padT + ph}" stroke="#e6b84c" stroke-width="1.4" stroke-dasharray="3,2"/>
      <text x="${seaX}" y="${padT + 9}" text-anchor="middle" class="wf-axis" fill="#e6b84c">Sea Level</text>
      <text x="${padL}" y="${H - 5}" class="wf-axis">-6,000m</text>
      <text x="${W - padR}" y="${H - 5}" text-anchor="end" class="wf-axis">+6,000m</text>
    </svg>`;
}

export function renderCountryBars(world, metric = 'population') {
  const list = world.countries.slice().sort((a, b) => b[metric] - a[metric]).slice(0, 8);
  const max = Math.max(...list.map((c) => c[metric]), 1);
  return list.map((c) => {
    const pct = (c[metric] / max) * 100;
    const col = `rgb(${c.mapColor.join(',')})`;
    const val = metric === 'population' ? formatCompact(c.population) : `${formatInt(c.area)} km²`;
    return `
      <div class="wf-bar-row" data-country-id="${c.id}">
        <div class="wf-bar-head">
          <span class="wf-swatch" style="background:${col}"></span>
          <span class="wf-bar-name">${escapeHtml(c.name)}</span>
          <span class="wf-bar-sub">${escapeHtml(c.government)}</span>
          <span class="wf-bar-val">${val}</span>
        </div>
        <div class="wf-bar-track"><div class="wf-bar-fill" style="width:${pct.toFixed(1)}%;background:${col}"></div></div>
      </div>`;
  }).join('');
}

