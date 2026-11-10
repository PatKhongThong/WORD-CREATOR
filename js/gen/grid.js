// Equirectangular planetary grid helpers. x wraps east-west, y is clamped at the poles.

export function makeGrid(W, H, R) {
  const N = W * H;
  const lat = new Float64Array(H), cosLat = new Float64Array(H), sinLat = new Float64Array(H);
  const cellArea = new Float64Array(H), cellW = new Float64Array(H);
  const lon = new Float64Array(W), cosLon = new Float64Array(W), sinLon = new Float64Array(W);
  for (let y = 0; y < H; y++) {
    const la = Math.PI / 2 - ((y + 0.5) / H) * Math.PI;
    lat[y] = la; cosLat[y] = Math.cos(la); sinLat[y] = Math.sin(la);
    const l1 = Math.PI / 2 - (y / H) * Math.PI, l2 = Math.PI / 2 - ((y + 1) / H) * Math.PI;
    cellArea[y] = R * R * ((2 * Math.PI) / W) * (Math.sin(l1) - Math.sin(l2));
    cellW[y] = ((2 * Math.PI * R) / W) * Math.cos(la);
  }
  for (let x = 0; x < W; x++) {
    const lo = ((x + 0.5) / W) * 2 * Math.PI - Math.PI;
    lon[x] = lo; cosLon[x] = Math.cos(lo); sinLon[x] = Math.sin(lo);
  }
  return { W, H, N, R, lat, cosLat, sinLat, lon, cosLon, sinLon, cellArea, cellW, cellH: (Math.PI * R) / H, totalArea: 4 * Math.PI * R * R };
}

/** Fills `out` with 8-neighbour indices. Order: L, R, UL, U, UR, DL, D, DR. Returns count. */
export function neighbors8(W, H, i, out) {
  const x = i % W, y = (i - x) / W;
  const xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1;
  const row = y * W;
  let n = 0;
  out[n++] = row + xl; out[n++] = row + xr;
  if (y > 0) { const r = row - W; out[n++] = r + xl; out[n++] = r + x; out[n++] = r + xr; }
  if (y < H - 1) { const r = row + W; out[n++] = r + xl; out[n++] = r + x; out[n++] = r + xr; }
  return n;
}

export function neighbors4(W, H, i, out) {
  const x = i % W, y = (i - x) / W;
  let n = 0;
  out[n++] = y * W + (x === 0 ? W - 1 : x - 1);
  out[n++] = y * W + (x === W - 1 ? 0 : x + 1);
  if (y > 0) out[n++] = i - W;
  if (y < H - 1) out[n++] = i + W;
  return n;
}

/** Great-circle distance in km between cell coordinates (fractional allowed). */
export function distKm(grid, x1, y1, x2, y2) {
  const { W, H, R } = grid;
  const la1 = Math.PI / 2 - ((y1 + 0.5) / H) * Math.PI, la2 = Math.PI / 2 - ((y2 + 0.5) / H) * Math.PI;
  const lo1 = ((x1 + 0.5) / W) * 2 * Math.PI, lo2 = ((x2 + 0.5) / W) * 2 * Math.PI;
  const dla = la2 - la1, dlo = lo2 - lo1;
  const a = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function cellLatLon(grid, x, y) {
  const lat = 90 - ((y + 0.5) / grid.H) * 180;
  const lon = ((x + 0.5) / grid.W) * 360 - 180;
  return { lat, lon };
}

export function formatLatLon(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns}  ${Math.abs(lon).toFixed(2)}°${ew}`;
}

/** Connected component labelling over a mask. Returns labels (-1 = not in mask) and component list. */
export function labelComponents(grid, mask, conn8 = true) {
  const { W, H, N } = grid;
  const labels = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  const nb = new Int32Array(8);
  const comps = [];
  for (let s = 0; s < N; s++) {
    if (!mask[s] || labels[s] !== -1) continue;
    const id = comps.length;
    let sp = 0; stack[sp++] = s; labels[s] = id;
    const cells = [];
    let area = 0;
    while (sp > 0) {
      const c = stack[--sp];
      cells.push(c);
      area += grid.cellArea[(c / W) | 0];
      const n = conn8 ? neighbors8(W, H, c, nb) : neighbors4(W, H, c, nb);
      for (let k = 0; k < n; k++) {
        const j = nb[k];
        if (mask[j] && labels[j] === -1) { labels[j] = id; stack[sp++] = j; }
      }
    }
    comps.push({ id, cells, area });
  }
  return { labels, comps };
}

/** Circular-mean centroid of a set of cells, snapped to the member cell nearest the centroid. */
export function centroidOf(grid, cells) {
  const { W } = grid;
  let sx = 0, sy = 0, syy = 0;
  for (const c of cells) {
    const x = c % W, y = (c - x) / W;
    const a = ((x + 0.5) / W) * Math.PI * 2;
    sx += Math.cos(a); sy += Math.sin(a); syy += y;
  }
  let ang = Math.atan2(sy, sx); if (ang < 0) ang += Math.PI * 2;
  const cx = (ang / (Math.PI * 2)) * W - 0.5, cy = syy / cells.length;
  let best = cells[0], bd = Infinity;
  const step = Math.max(1, Math.floor(cells.length / 4000));
  for (let k = 0; k < cells.length; k += step) {
    const c = cells[k];
    const x = c % W, y = (c - x) / W;
    let dx = Math.abs(x - cx); if (dx > W / 2) dx = W - dx;
    const d = dx * dx + (y - cy) * (y - cy);
    if (d < bd) { bd = d; best = c; }
  }
  return { x: best % W, y: Math.floor(best / W), cell: best };
}

