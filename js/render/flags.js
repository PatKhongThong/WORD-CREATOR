// Procedural & Custom Flag Renderer + Interactive Flag Designer Studio (Section 6).
// Supports horizontal/vertical/diagonal stripes, solid, nordic, cross, saltire, canton, chevron, bordered,
// quartered, pale, triband, sunburst, plus stars, circles, emblems, geometric symbols, custom text,
// symbol X/Y/scale positioning, and flag proportions (3:2, 2:1, 5:3, 1:1).

import { escapeHtml } from '../core/utils.js';

export const FLAG_LAYOUTS = [
  { id: 'tricolor-h', label: 'Horizontal Tricolor' },
  { id: 'tricolor-v', label: 'Vertical Tricolor' },
  { id: 'bicolor-h',  label: 'Horizontal Bicolor' },
  { id: 'bicolor-v',  label: 'Vertical Bicolor' },
  { id: 'diagonal',   label: 'Diagonal Bend' },
  { id: 'solid',      label: 'Solid Field' },
  { id: 'nordic',     label: 'Nordic Cross' },
  { id: 'cross',      label: 'Symmetric Cross' },
  { id: 'saltire',    label: 'Diagonal Saltire' },
  { id: 'canton',     label: 'Canton & Stripes' },
  { id: 'chevron',    label: 'Hoist Triangle' },
  { id: 'bordered',   label: 'Royal Border' },
  { id: 'quartered',  label: 'Quartered Arms' },
  { id: 'pale',       label: 'Canadian Pale' },
  { id: 'triband',    label: 'Fimbriated Triband' },
];

export const FLAG_EMBLEMS = [
  { id: 'none',       label: 'None' },
  { id: 'star',       label: 'Single Star (★)' },
  { id: 'stars-3',    label: 'Three Stars (★★★)' },
  { id: 'stars-ring', label: 'Constellation Ring' },
  { id: 'circle',     label: 'Solar Disc (●)' },
  { id: 'ring',       label: 'Annulus Ring (◯)' },
  { id: 'sun',        label: 'Radiant Sun (☀)' },
  { id: 'crescent',   label: 'Star & Crescent (☪)' },
  { id: 'diamond',    label: 'Lozenge Diamond (◆)' },
  { id: 'shield',     label: 'Heraldic Escutcheon' },
  { id: 'mountain',   label: 'Twin Peaks (▲)' },
  { id: 'wave',       label: 'Maritime Wave (≈)' },
  { id: 'tree',       label: 'World Tree (♠)' },
  { id: 'compass',    label: 'Astral Compass (✦)' },
];

export const FLAG_PROPORTIONS = [
  { id: '3:2', label: '3:2 Standard', ratio: 1.5 },
  { id: '2:1', label: '2:1 Maritime', ratio: 2.0 },
  { id: '5:3', label: '5:3 Imperial', ratio: 1.667 },
  { id: '1:1', label: '1:1 Square',   ratio: 1.0 },
];

export function flagToSVG(flag = {}, w = 96, h = 60) {
  const colors = Array.isArray(flag.colors) && flag.colors.length >= 3 ? flag.colors : ['#1d4f91', '#f2efe6', '#d6b44a'];
  const [c0, c1, c2] = colors;
  const p = flag.pattern || 'tricolor-h';

  let body = `<rect width="${w}" height="${h}" fill="${c0}"/>`;
  if (p === 'tricolor-h') {
    body += `<rect y="${h / 3}" width="${w}" height="${h / 3}" fill="${c1}"/><rect y="${(2 * h) / 3}" width="${w}" height="${h / 3}" fill="${c2}"/>`;
  } else if (p === 'tricolor-v') {
    body += `<rect x="${w / 3}" width="${w / 3}" height="${h}" fill="${c1}"/><rect x="${(2 * w) / 3}" width="${w / 3}" height="${h}" fill="${c2}"/>`;
  } else if (p === 'bicolor-h') {
    body += `<rect y="${h / 2}" width="${w}" height="${h / 2}" fill="${c1}"/>`;
  } else if (p === 'bicolor-v') {
    body += `<rect x="${w / 2}" width="${w / 2}" height="${h}" fill="${c1}"/>`;
  } else if (p === 'solid') {
    // solid field uses c0
  } else if (p === 'nordic') {
    const t = h * 0.2, x = w * 0.34;
    body += `<rect x="${x - t * 0.7}" width="${t * 1.4}" height="${h}" fill="${c2}"/><rect y="${(h - t * 1.4) / 2}" width="${w}" height="${t * 1.4}" fill="${c2}"/>`;
    body += `<rect x="${x - t * 0.45}" width="${t * 0.9}" height="${h}" fill="${c1}"/><rect y="${(h - t * 0.9) / 2}" width="${w}" height="${t * 0.9}" fill="${c1}"/>`;
  } else if (p === 'cross') {
    const t = h * 0.22;
    body += `<rect x="${(w - t) / 2}" width="${t}" height="${h}" fill="${c1}"/><rect y="${(h - t) / 2}" width="${w}" height="${t}" fill="${c1}"/>`;
  } else if (p === 'saltire') {
    body += `<line x1="0" y1="0" x2="${w}" y2="${h}" stroke="${c2}" stroke-width="${h * 0.26}"/><line x1="${w}" y1="0" x2="0" y2="${h}" stroke="${c2}" stroke-width="${h * 0.26}"/>`;
    body += `<line x1="0" y1="0" x2="${w}" y2="${h}" stroke="${c1}" stroke-width="${h * 0.16}"/><line x1="${w}" y1="0" x2="0" y2="${h}" stroke="${c1}" stroke-width="${h * 0.16}"/>`;
  } else if (p === 'canton') {
    body += `<rect y="${h / 2}" width="${w}" height="${h / 2}" fill="${c1}"/><rect width="${w * 0.46}" height="${h * 0.54}" fill="${c2}"/>`;
  } else if (p === 'chevron') {
    body += `<rect y="${h / 2}" width="${w}" height="${h / 2}" fill="${c1}"/><polygon points="0,0 ${w * 0.46},${h / 2} 0,${h}" fill="${c2}"/>`;
  } else if (p === 'diagonal') {
    body += `<polygon points="0,${h} ${w},0 ${w},${h}" fill="${c1}"/><line x1="0" y1="${h}" x2="${w}" y2="0" stroke="${c2}" stroke-width="${h * 0.18}"/>`;
  } else if (p === 'bordered') {
    const b = h * 0.14;
    body += `<rect x="${b}" y="${b}" width="${w - 2 * b}" height="${h - 2 * b}" fill="${c1}"/>`;
  } else if (p === 'quartered') {
    body += `<rect x="${w / 2}" width="${w / 2}" height="${h / 2}" fill="${c1}"/><rect y="${h / 2}" width="${w / 2}" height="${h / 2}" fill="${c1}"/>`;
  } else if (p === 'pale') {
    body += `<rect x="${w * 0.25}" width="${w * 0.5}" height="${h}" fill="${c1}"/>`;
  } else if (p === 'triband') {
    body += `<rect y="${h * 0.22}" width="${w}" height="${h * 0.56}" fill="${c2}"/><rect y="${h * 0.28}" width="${w}" height="${h * 0.44}" fill="${c1}"/>`;
  }

  const defaultCx = p === 'canton' ? 0.23 : p === 'chevron' ? 0.18 : 0.5;
  const defaultCy = p === 'canton' ? 0.27 : 0.5;
  const ex = flag.emblemX != null && flag.emblemX !== 0.5 ? flag.emblemX : defaultCx;
  const ey = flag.emblemY != null && flag.emblemY !== 0.5 ? flag.emblemY : defaultCy;
  const scale = flag.emblemScale ?? 1;
  const cx = w * ex;
  const cy = h * ey;
  const r = Math.min(w, h) * (p === 'canton' || p === 'chevron' ? 0.16 : 0.22) * scale;
  const ec = flag.emblemColor || c2;

  body += emblemSVG(flag.emblem, cx, cy, r, ec, c0);

  if (flag.customText && String(flag.customText).trim()) {
    const txt = escapeHtml(String(flag.customText).trim().slice(0, 22));
    const tc = flag.textColor || '#ffffff';
    const fontSz = Math.max(8, Math.round(h * 0.15));
    body += `<text x="${w / 2}" y="${h * 0.88}" text-anchor="middle" fill="${tc}" font-family="Cinzel, Georgia, serif" font-weight="700" font-size="${fontSz}" letter-spacing="1.2">${txt}</text>`;
  }

  body += `<rect width="${w}" height="${h}" fill="url(#wfFlagSheen)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="wf-flag"><defs><linearGradient id="wfFlagSheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fff" stop-opacity="0.15"/><stop offset="50%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.22"/></linearGradient></defs>${body}</svg>`;
}

function emblemSVG(e, cx, cy, r, col, bg) {
  if (!e || e === 'none') return '';
  if (e === 'circle') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}"/>`;
  if (e === 'ring') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="${r * 0.32}"/>`;
  if (e === 'diamond') return `<polygon points="${cx},${cy - r * 1.15} ${cx + r},${cy} ${cx},${cy + r * 1.15} ${cx - r},${cy}" fill="${col}"/>`;
  if (e === 'star') return `<polygon points="${starPts(cx, cy, 5, r * 1.15, r * 0.45)}" fill="${col}"/>`;
  if (e === 'stars-3') {
    const s = r * 0.65;
    return `<polygon points="${starPts(cx - r * 1.3, cy, 5, s, s * 0.44)}" fill="${col}"/>` +
           `<polygon points="${starPts(cx, cy, 5, s * 1.15, s * 0.46)}" fill="${col}"/>` +
           `<polygon points="${starPts(cx + r * 1.3, cy, 5, s, s * 0.44)}" fill="${col}"/>`;
  }
  if (e === 'stars-ring') {
    let out = '';
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const sx = cx + Math.cos(a) * r * 1.05;
      const sy = cy + Math.sin(a) * r * 1.05;
      out += `<polygon points="${starPts(sx, sy, 5, r * 0.32, r * 0.14)}" fill="${col}"/>`;
    }
    return out;
  }
  if (e === 'sun') return `<polygon points="${starPts(cx, cy, 12, r * 1.2, r * 0.65)}" fill="${col}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="${col}"/>`;
  if (e === 'crescent') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}"/><circle cx="${cx + r * 0.35}" cy="${cy - r * 0.08}" r="${r * 0.8}" fill="${bg}"/><polygon points="${starPts(cx + r * 0.55, cy - r * 0.05, 5, r * 0.36, r * 0.15)}" fill="${col}"/>`;
  if (e === 'shield') {
    return `<path d="M ${cx - r * 0.85} ${cy - r * 0.9} L ${cx + r * 0.85} ${cy - r * 0.9} L ${cx + r * 0.85} ${cy + r * 0.1} Q ${cx + r * 0.85} ${cy + r * 0.95} ${cx} ${cy + r * 1.2} Q ${cx - r * 0.85} ${cy + r * 0.95} ${cx - r * 0.85} ${cy + r * 0.1} Z" fill="${col}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/>`;
  }
  if (e === 'mountain') return `<polygon points="${cx - r * 1.2},${cy + r * 0.85} ${cx - r * 0.25},${cy - r * 0.9} ${cx + r * 0.55},${cy + r * 0.85}" fill="${col}"/><polygon points="${cx - r * 0.2},${cy + r * 0.85} ${cx + r * 0.45},${cy - r * 0.55} ${cx + r * 1.2},${cy + r * 0.85}" fill="${col}"/>`;
  if (e === 'wave') return `<path d="M ${cx - r * 1.2} ${cy} Q ${cx - r * 0.6} ${cy - r * 0.6} ${cx} ${cy} T ${cx + r * 1.2} ${cy}" fill="none" stroke="${col}" stroke-width="${r * 0.34}" stroke-linecap="round"/>`;
  if (e === 'tree') return `<polygon points="${cx},${cy - r * 1.1} ${cx + r * 0.85},${cy + r * 0.45} ${cx - r * 0.85},${cy + r * 0.45}" fill="${col}"/><rect x="${cx - r * 0.18}" y="${cy + r * 0.35}" width="${r * 0.36}" height="${r * 0.65}" fill="${col}"/>`;
  if (e === 'compass') return `<polygon points="${starPts(cx, cy, 4, r * 1.25, r * 0.32)}" fill="${col}"/><polygon points="${starPts(cx, cy, 4, r * 0.75, r * 0.22)}" transform="rotate(45 ${cx} ${cy})" fill="${col}"/>`;
  return '';
}

function starPts(cx, cy, n, R, r) {
  const out = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    out.push(`${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`);
  }
  return out.join(' ');
}
