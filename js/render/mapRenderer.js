// Interactive 2D World Map Renderer.
// Supports smooth wheel zoom around cursor (1× – 28×), drag pan with seamless east-west wrapping,
// hover inspection, click selection, vector river/border/city/label overlays with collision avoidance,
// animated event/discovery markers, and clean high-res PNG export.

import { getLayerCanvas, getBorderCanvas } from './layers.js';
import { BIOMES } from '../gen/biomes.js';
import { cellLatLon, formatLatLon } from '../gen/grid.js';
import { clamp } from '../core/utils.js';

export class MapViewport {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} callbacks { onHover, onSelect, onCamera }
   */
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = callbacks;
    this.world = null;
    this.baseLayer = 'physical';
    this.overlays = { rivers: true, borders: true, cities: true, labels: true, graticule: false };
    this.labelFilters = {
      continents: true,
      countries: true,
      capitals: true,
      cities: true,
      mountains: true,
      rivers: true,
      oceans: true,
    };
    this.brushMode = false; // when true, left-drag invokes cb.onBrushStart / cb.onBrushMove / cb.onBrushEnd
    this.brushRadius = 6;
    this.highlightedRegion = null;
    // Camera in world-grid coordinates: center (cx, cy) and zoom (1 = fit map inside viewport)
    this.cx = 512; this.cy = 256; this.zoom = 1;
    this.targetCamera = null;
    this.selected = null; // { type:'cell'|'country'|'city'|'continent'|'feature'|'event', ... }
    this.pulse = null;    // { x, y, x2?, y2?, label?, start }
    this.hoverCell = null;
    this._dragging = false;
    this._dragMoved = false;
    this._raf = 0;
    this._bindEvents();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement || canvas);
    this.resize();
  }

  setWorld(world, resetCamera = true) {
    this.world = world;
    if (world && resetCamera) {
      this.cx = world.W / 2;
      this.cy = world.H / 2;
      this.zoom = 1.05;
      this.targetCamera = null;
      this.selected = null;
      this.pulse = null;
    }
    this.requestDraw();
  }

  setLayer(id) {
    this.baseLayer = id;
    this.requestDraw();
  }

  setOverlay(id, val) {
    this.overlays[id] = val;
    this.requestDraw();
  }

  flyTo(x, y, zoom = 4.2, pulseLabel = null, second = null) {
    if (!this.world) return;
    this.targetCamera = { x: ((x % this.world.W) + this.world.W) % this.world.W, y: clamp(y, 0, this.world.H), zoom: clamp(zoom, 1, 24) };
    this.pulse = { x, y, x2: second?.x, y2: second?.y, label: pulseLabel, start: performance.now() };
    this.requestDraw();
  }

  resetView() {
    if (!this.world) return;
    this.targetCamera = { x: this.world.W / 2, y: this.world.H / 2, zoom: 1.05 };
    this.requestDraw();
  }

  resize() {
    const rect = (this.canvas.parentElement || this.canvas).getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(200, Math.floor(rect.width));
    const h = Math.max(160, Math.floor(rect.height));
    if (this.canvas.width !== Math.floor(w * dpr) || this.canvas.height !== Math.floor(h * dpr)) {
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
    }
    this.vw = w; this.vh = h; this.dpr = dpr;
    this.requestDraw();
  }

  /** Scale (screen px per world cell) at current zoom. */
  scale() {
    if (!this.world) return 1;
    const fit = Math.min(this.vw / this.world.W, this.vh / this.world.H);
    return fit * this.zoom;
  }

  worldToScreen(wx, wy) {
    const s = this.scale();
    const W = this.world.W;
    let dx = wx - this.cx;
    if (dx > W / 2) dx -= W;
    if (dx < -W / 2) dx += W;
    return { x: this.vw / 2 + dx * s, y: this.vh / 2 + (wy - this.cy) * s };
  }

  screenToWorld(sx, sy) {
    if (!this.world) return { x: 0, y: 0, inside: false };
    const s = this.scale();
    const W = this.world.W, H = this.world.H;
    const rawX = this.cx + (sx - this.vw / 2) / s;
    const rawY = this.cy + (sy - this.vh / 2) / s;
    const x = ((rawX % W) + W) % W;
    const inside = rawY >= 0 && rawY < H;
    const y = clamp(rawY, 0, H - 0.001);
    return { x, y, ix: Math.floor(x) % W, iy: clamp(Math.floor(y), 0, H - 1), inside };
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => {
      if (!this.world) return;
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const before = this.screenToWorld(sx, sy);
      const factor = Math.exp(-e.deltaY * 0.0016);
      this.zoom = clamp(this.zoom * factor, 0.95, 28);
      this.targetCamera = null;
      const s = this.scale();
      this.cx = ((before.x - (sx - this.vw / 2) / s) % this.world.W + this.world.W) % this.world.W;
      this.cy = clamp(before.y - (sy - this.vh / 2) / s, 0, this.world.H);
      this.cb.onCamera && this.cb.onCamera(this);
      this.requestDraw();
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.world) return;
      this._dragging = true;
      this._dragMoved = false;
      this._downX = e.clientX; this._downY = e.clientY;
      this._startCx = this.cx; this._startCy = this.cy;
      this.targetCamera = null;
      c.setPointerCapture(e.pointerId);
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.world) return;
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (this._dragging) {
        const dx = e.clientX - this._downX, dy = e.clientY - this._downY;
        if (Math.hypot(dx, dy) > 4) this._dragMoved = true;
        const s = this.scale();
        this.cx = ((this._startCx - dx / s) % this.world.W + this.world.W) % this.world.W;
        this.cy = clamp(this._startCy - dy / s, 0, this.world.H);
        this.cb.onCamera && this.cb.onCamera(this);
        this.requestDraw();
      } else {
        const w = this.screenToWorld(sx, sy);
        this.hoverCell = w.inside ? w : null;
        this.cb.onHover && this.cb.onHover(this.hoverCell ? this.inspectAt(w.ix, w.iy, sx, sy) : null);
      }
    });

    const endDrag = (e) => {
      if (!this._dragging) return;
      this._dragging = false;
      if (!this._dragMoved && this.world) {
        const rect = c.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const w = this.screenToWorld(sx, sy);
        if (w.inside) {
          const hit = this.pickEntity(w.x, w.y, sx, sy);
          this.selected = hit;
          this.cb.onSelect && this.cb.onSelect(hit);
          this.requestDraw();
        }
      }
    };
    c.addEventListener('pointerup', endDrag);
    c.addEventListener('pointercancel', endDrag);
    c.addEventListener('pointerleave', () => {
      this.hoverCell = null;
      this.cb.onHover && this.cb.onHover(null);
    });
  }

  /** Rich inspection payload at cell (ix, iy). */
  inspectAt(ix, iy, sx = 0, sy = 0) {
    const w = this.world;
    const i = iy * w.W + ix;
    const F = w.fields;
    const h = F.height[i];
    const elev = Math.round(h > 0 ? h * w.maxElev : h * w.maxDepth);
    const { lat, lon } = cellLatLon(w.grid, ix, iy);
    const country = F.owner[i] >= 0 ? w.countries[F.owner[i]] : null;
    const lm = F.landmass[i];
    const continent = lm >= 0 ? (w.continents.find((c) => c.id === lm) || w.islands.find((c) => c.id === lm)) : null;
    const feat = F.region[i] >= 0 ? w.features[F.region[i]] : null;
    const river = F.riverId[i] >= 0 ? w.rivers[F.riverId[i]] : null;
    // check if cursor is near a city
    let nearCity = null, bestD = 12 / this.scale();
    for (const ct of w.cities) {
      const d = Math.hypot(ct.x - ix, ct.y - iy);
      if (d < bestD) { bestD = d; nearCity = ct; }
    }
    return {
      ix, iy, i, sx, sy, lat, lon, coordStr: formatLatLon(lat, lon),
      land: h > 0 && !F.lakeMask[i],
      elevation: elev, temp: F.temp[i], moist: F.moist[i],
      biome: BIOMES[F.biome[i]], popDensity: F.pop[i],
      country, continent, feature: feat, river, city: nearCity,
    };
  }

  pickEntity(wx, wy, sx, sy) {
    const info = this.inspectAt(Math.floor(wx) % this.world.W, clamp(Math.floor(wy), 0, this.world.H - 1), sx, sy);
    if (info.city) return { type: 'city', city: info.city, country: this.world.countries[info.city.countryId], info };
    if (info.country && (this.baseLayer === 'countries' || this.overlays.borders)) {
      return { type: 'country', country: info.country, info };
    }
    if (info.feature) return { type: 'feature', feature: info.feature, info };
    if (info.continent && info.continent.kind === 'continent') return { type: 'continent', continent: info.continent, info };
    return { type: 'cell', info };
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame((ts) => {
      this._raf = 0;
      this.draw(ts);
    });
  }

  draw(ts = performance.now()) {
    const ctx = this.ctx;
    const { vw, vh, dpr, world } = this;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, vw, vh);
    if (!world) { ctx.restore(); return; }

    // animate camera flight
    let keepAnimating = false;
    if (this.targetCamera) {
      const tc = this.targetCamera;
      let dx = tc.x - this.cx;
      if (dx > world.W / 2) dx -= world.W;
      if (dx < -world.W / 2) dx += world.W;
      this.cx = ((this.cx + dx * 0.18) % world.W + world.W) % world.W;
      this.cy += (tc.y - this.cy) * 0.18;
      this.zoom += (tc.zoom - this.zoom) * 0.18;
      if (Math.abs(dx) < 0.15 && Math.abs(tc.y - this.cy) < 0.15 && Math.abs(tc.zoom - this.zoom) < 0.01) {
        this.cx = tc.x; this.cy = tc.y; this.zoom = tc.zoom; this.targetCamera = null;
      } else keepAnimating = true;
    }

    const s = this.scale();
    const W = world.W, H = world.H;
    const mapW = W * s, mapH = H * s;
    const topY = vh / 2 - this.cy * s;
    const base = getLayerCanvas(world, this.baseLayer);
    const borderC = (this.overlays.borders || this.baseLayer === 'countries') ? getBorderCanvas(world) : null;

    ctx.imageSmoothingEnabled = s < 3.2;
    ctx.imageSmoothingQuality = 'high';

    // Determine horizontal wrap copies visible in viewport
    const centerX = vw / 2 - this.cx * s;
    const kMin = Math.floor(-centerX / mapW) - 1;
    const kMax = Math.ceil((vw - centerX) / mapW);

    for (let k = kMin; k <= kMax; k++) {
      const ox = centerX + k * mapW;
      if (ox + mapW < 0 || ox > vw) continue;
      ctx.drawImage(base, ox, topY, mapW, mapH);
      if (borderC) ctx.drawImage(borderC, ox, topY, mapW, mapH);
    }

    // Clip to vertical map bounds for vector overlays
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, Math.max(0, topY), vw, Math.min(vh, mapH));
    ctx.clip();

    if (this.overlays.graticule) this._drawGraticule(ctx, centerX, topY, mapW, mapH, kMin, kMax);
    if (this.overlays.rivers) this._drawRivers(ctx, centerX, topY, s, kMin, kMax);
    if (this.selected?.type === 'country') this._drawCountryHighlight(ctx, this.selected.country, centerX, topY, s, kMin, kMax);
    if (this.overlays.cities) this._drawCities(ctx, centerX, topY, s, kMin, kMax);
    if (this.overlays.labels) this._drawLabels(ctx, centerX, topY, s, kMin, kMax);
    if (this.pulse) {
      if (this._drawPulse(ctx, ts, centerX, topY, s)) keepAnimating = true;
    }

    ctx.restore();
    // Subtle top/bottom polar frame line
    ctx.strokeStyle = 'rgba(214, 180, 74, 0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, topY, vw, mapH);
    ctx.restore();

    if (keepAnimating) this.requestDraw();
  }

  _drawGraticule(ctx, centerX, topY, mapW, mapH, kMin, kMax) {
    ctx.strokeStyle = 'rgba(180, 210, 240, 0.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = topY + ((90 - lat) / 180) * mapH;
      ctx.moveTo(0, y); ctx.lineTo(this.vw, y);
    }
    for (let k = kMin; k <= kMax; k++) {
      const ox = centerX + k * mapW;
      for (let lon = -150; lon <= 180; lon += 30) {
        const x = ox + ((lon + 180) / 360) * mapW;
        if (x >= 0 && x <= this.vw) { ctx.moveTo(x, topY); ctx.lineTo(x, topY + mapH); }
      }
    }
    ctx.stroke();
    // Equator emphasis
    ctx.strokeStyle = 'rgba(230, 184, 76, 0.25)';
    ctx.beginPath();
    ctx.moveTo(0, topY + mapH / 2); ctx.lineTo(this.vw, topY + mapH / 2);
    ctx.stroke();
  }

  _drawRivers(ctx, centerX, topY, s, kMin, kMax) {
    const { W, rivers, fields, riverT } = this.world;
    const flow = fields.flow;
    const dark = this.baseLayer === 'population';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const minLen = this.zoom < 1.8 ? 8 : this.zoom < 3.5 ? 4 : 2;
    for (let k = kMin; k <= kMax; k++) {
      const ox = centerX + k * W * s;
      if (ox + W * s < 0 || ox > this.vw) continue;
      for (const r of rivers) {
        if (r.cells.length < minLen) continue;
        const w = clamp(Math.log10(r.mouthFlow / riverT + 1) * (0.65 + Math.sqrt(this.zoom) * 0.45), 0.55, 3.8);
        ctx.strokeStyle = dark ? 'rgba(66, 184, 224, 0.7)' : 'rgba(28, 108, 162, 0.85)';
        ctx.lineWidth = w;
        ctx.beginPath();
        let px = -999;
        for (let m = 0; m < r.cells.length; m++) {
          const c = r.cells[m];
          const x = (c % W) + 0.5, y = ((c / W) | 0) + 0.5;
          const sx = ox + x * s, sy = topY + y * s;
          if (m === 0 || Math.abs((c % W) - px) > W / 2) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
          px = c % W;
        }
        ctx.stroke();
      }
    }
  }

  _drawCountryHighlight(ctx, country, centerX, topY, s, kMin, kMax) {
    const cap = this.world.cities[country.capitalId];
    if (!cap) return;
    for (let k = kMin; k <= kMax; k++) {
      const ox = centerX + k * this.world.W * s;
      const sx = ox + (cap.x + 0.5) * s, sy = topY + (cap.y + 0.5) * s;
      if (sx < -50 || sx > this.vw + 50) continue;
      ctx.strokeStyle = '#e6b84c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 10 + Math.min(8, this.zoom * 1.5), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawCities(ctx, centerX, topY, s, kMin, kMax) {
    const { W, cities } = this.world;
    const minImp = this.zoom < 1.5 ? 4 : this.zoom < 2.6 ? 3 : this.zoom < 4.5 ? 2 : 1;
    for (let k = kMin; k <= kMax; k++) {
      const ox = centerX + k * W * s;
      if (ox + W * s < 0 || ox > this.vw) continue;
      for (const ct of cities) {
        if (ct.importance < minImp) continue;
        const sx = ox + (ct.x + 0.5) * s, sy = topY + (ct.y + 0.5) * s;
        if (sx < -20 || sx > this.vw + 20 || sy < -20 || sy > this.vh + 20) continue;
        const isSel = this.selected?.type === 'city' && this.selected.city.id === ct.id;
        if (ct.type === 'capital') {
          const r = 4.6 + Math.min(3, Math.sqrt(this.zoom));
          ctx.fillStyle = '#0b101d';
          ctx.beginPath(); ctx.arc(sx, sy, r + 2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#f2c95c';
          drawStar(ctx, sx, sy, 5, r + 0.8, r * 0.44);
          ctx.fill();
        } else {
          const r = (ct.importance >= 4 ? 3.4 : ct.importance === 3 ? 2.6 : 2.0) * (0.85 + Math.min(0.6, this.zoom * 0.08));
          ctx.fillStyle = '#0b101d';
          ctx.beginPath(); ctx.arc(sx, sy, r + 1.3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = ct.type === 'port' ? '#63d4ee' : ct.type === 'industrial' ? '#f09a54' : '#f4efe2';
          ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
        }
        if (isSel) {
          ctx.strokeStyle = '#63d4ee'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sx, sy, 11, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
  }

  _drawLabels(ctx, centerX, topY, s, kMin, kMax) {
    const { W, continents, countries, cities, features, rivers } = this.world;
    const boxes = [];
    const place = (text, sx, sy, font, fill, stroke, tracking = 0, sub = null) => {
      ctx.font = font;
      const w = ctx.measureText(text).width + tracking * text.length + 10;
      const h = sub ? 26 : 16;
      const box = { x0: sx - w / 2, y0: sy - h / 2, x1: sx + w / 2, y1: sy + h / 2 };
      if (box.x0 < 6 || box.x1 > this.vw - 6 || box.y0 < 6 || box.y1 > this.vh - 6) return false;
      for (const b of boxes) if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) return false;
      boxes.push(box);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.miterLimit = 2;
      ctx.lineWidth = 3.2; ctx.strokeStyle = stroke;
      ctx.fillStyle = fill;
      ctx.strokeText(text, sx, sy);
      ctx.fillText(text, sx, sy);
      if (sub) {
        ctx.font = '500 9.5px "Inter", system-ui, sans-serif';
        ctx.lineWidth = 2.6;
        ctx.strokeText(sub, sx, sy + 12);
        ctx.fillStyle = 'rgba(215, 226, 240, 0.85)';
        ctx.fillText(sub, sx, sy + 12);
      }
      return true;
    };

    for (let k = kMin; k <= kMax; k++) {
      const ox = centerX + k * W * s;
      if (ox + W * s < 0 || ox > this.vw) continue;

      // Oceans (always, muted italic)
      if (this.zoom < 5.5) {
        for (const f of features) {
          if (f.kind !== 'ocean' && f.kind !== 'sea') continue;
          if (f.kind === 'sea' && this.zoom < 1.6) continue;
          place(f.name.toUpperCase(), ox + f.x * s, topY + f.y * s,
            `italic 600 ${f.kind === 'ocean' ? 12 : 10}px "Cinzel", Georgia, serif`,
            'rgba(148, 198, 232, 0.62)', 'rgba(6, 14, 28, 0.85)');
        }
      }

      // Continents (low–mid zoom, when not in country mode)
      if (this.zoom < 3.4 && this.baseLayer !== 'countries') {
        for (const c of continents) {
          const sz = clamp(Math.round(12 + Math.sqrt(c.area / this.world.grid.totalArea) * 26), 12, 20);
          place(c.name.toUpperCase(), ox + c.x * s, topY + c.y * s,
            `700 ${sz}px "Cinzel", Georgia, serif`, 'rgba(244, 232, 198, 0.92)', 'rgba(8, 12, 22, 0.92)');
        }
      }

      // Countries
      if (this.baseLayer === 'countries' || (this.overlays.borders && this.zoom >= 1.25)) {
        for (const c of countries) {
          const cap = cities[c.capitalId];
          const sz = clamp(Math.round(10 + Math.sqrt(c.area / this.world.grid.totalArea) * 32 * Math.min(1.6, this.zoom * 0.5)), 10, 17);
          place(c.name.toUpperCase(), ox + cap.x * s, topY + (cap.y - 6 / Math.max(1, this.zoom * 0.4)) * s - 14,
            `700 ${sz}px "Cinzel", Georgia, serif`, '#f6ecd2', 'rgba(8, 12, 22, 0.92)');
        }
      }

      // Cities
      const cityMinImp = this.zoom < 1.6 ? 5 : this.zoom < 2.6 ? 4 : this.zoom < 4.5 ? 3 : this.zoom < 8 ? 2 : 1;
      for (const ct of cities) {
        if (ct.importance < cityMinImp) continue;
        const sx = ox + (ct.x + 0.5) * s, sy = topY + (ct.y + 0.5) * s - (ct.type === 'capital' ? 11 : 9);
        const font = ct.type === 'capital' ? '600 11.5px "Inter", system-ui, sans-serif' : '500 10.5px "Inter", system-ui, sans-serif';
        place(ct.name, sx, sy, font, ct.type === 'capital' ? '#ffe083' : '#e9eff8', 'rgba(7, 11, 20, 0.92)');
      }

      // Physical regions (mountains, deserts, forests, lakes) when zoomed in
      if (this.zoom >= 2.0) {
        for (const f of features) {
          if (f.kind === 'ocean' || f.kind === 'sea') continue;
          if (f.cellCount < (this.zoom < 3.5 ? 180 : 40)) continue;
          const sub = f.peak ? `▲ ${f.peak.name} (${f.peak.elevation}m)` : null;
          place(f.name, ox + f.x * s, topY + f.y * s,
            'italic 600 10.5px "Cinzel", Georgia, serif', 'rgba(232, 220, 186, 0.85)', 'rgba(8, 12, 20, 0.9)', 0, sub);
        }
      }
      if (this.zoom >= 3.2 && this.overlays.rivers) {
        for (const r of rivers) {
          if (!r.name) continue;
          const mid = r.cells[Math.floor(r.cells.length / 2)];
          place(r.name, ox + (mid % W) * s, topY + ((mid / W) | 0) * s,
            'italic 500 10px "Inter", sans-serif', 'rgba(130, 212, 246, 0.9)', 'rgba(6, 12, 22, 0.9)');
        }
      }
    }
  }

  _drawPulse(ctx, ts, centerX, topY, s) {
    const p = this.pulse;
    const elapsed = (ts - p.start) / 1000;
    if (elapsed > 6.5) { this.pulse = null; return false; }
    const W = this.world.W;
    const pt = this.worldToScreen(p.x + 0.5, p.y + 0.5);
    if (p.x2 != null && p.y2 != null) {
      const pt2 = this.worldToScreen(p.x2 + 0.5, p.y2 + 0.5);
      ctx.save();
      ctx.strokeStyle = 'rgba(230, 184, 76, 0.85)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -elapsed * 24;
      ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(pt2.x, pt2.y); ctx.stroke();
      ctx.restore();
    }
    for (let ring = 0; ring < 2; ring++) {
      const t = (elapsed * 0.9 + ring * 0.5) % 1;
      const rad = 6 + t * 38;
      ctx.strokeStyle = `rgba(99, 212, 238, ${(1 - t) * 0.9})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, rad, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#63d4ee';
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2); ctx.fill();
    if (p.label) {
      ctx.font = '600 12px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(6,10,18,0.95)'; ctx.lineWidth = 3.5;
      ctx.strokeText(p.label, pt.x, pt.y - 16);
      ctx.fillStyle = '#63d4ee';
      ctx.fillText(p.label, pt.x, pt.y - 16);
    }
    return true;
  }

  /** Export a full-resolution annotated PNG of the entire equirectangular map. */
  exportPNG() {
    const w = this.world;
    if (!w) return null;
    const out = document.createElement('canvas');
    out.width = w.W; out.height = w.H;
    const ctx = out.getContext('2d');
    ctx.drawImage(getLayerCanvas(w, this.baseLayer), 0, 0);
    if (this.overlays.borders || this.baseLayer === 'countries') ctx.drawImage(getBorderCanvas(w), 0, 0);
    if (this.overlays.rivers) {
      ctx.strokeStyle = 'rgba(28, 108, 162, 0.85)';
      ctx.lineCap = 'round';
      for (const r of w.rivers) {
        if (r.cells.length < 4) continue;
        ctx.lineWidth = clamp(Math.log10(r.mouthFlow / w.riverT + 1) * 0.9, 0.6, 2.8);
        ctx.beginPath();
        let px = -999;
        for (let m = 0; m < r.cells.length; m++) {
          const c = r.cells[m], x = (c % w.W) + 0.5, y = ((c / w.W) | 0) + 0.5;
          if (m === 0 || Math.abs(x - px) > w.W / 2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          px = x;
        }
        ctx.stroke();
      }
    }
    if (this.overlays.cities) {
      for (const ct of w.cities) {
        if (ct.importance < 3) continue;
        ctx.fillStyle = ct.type === 'capital' ? '#f2c95c' : '#ffffff';
        ctx.beginPath(); ctx.arc(ct.x + 0.5, ct.y + 0.5, ct.type === 'capital' ? 3.5 : 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Cartographic title cartouche
    ctx.fillStyle = 'rgba(7, 11, 20, 0.78)';
    ctx.fillRect(16, w.H - 54, 340, 38);
    ctx.strokeStyle = 'rgba(230, 184, 76, 0.6)';
    ctx.strokeRect(16, w.H - 54, 340, 38);
    ctx.fillStyle = '#f4e8c6';
    ctx.font = '700 15px "Cinzel", Georgia, serif';
    ctx.fillText(w.name.toUpperCase(), 28, w.H - 34);
    ctx.fillStyle = '#9bb0cc';
    ctx.font = '500 11px "Inter", sans-serif';
    ctx.fillText(`Seed: ${w.seed}  •  WorldForge Cartographic Archive`, 28, w.H - 21);
    return out.toDataURL('image/png');
  }
}

function drawStar(ctx, cx, cy, n, R, r) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n - Math.PI / 2;
    const rad = i % 2 === 0 ? R : r;
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

