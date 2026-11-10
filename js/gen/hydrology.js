// Hydrology: coastal distance fields, priority-flood depression filling (Barnes et al.) which directly yields
// a drainage tree, lake detection in filled basins, rain-weighted flow accumulation and river tracing.

import { MinHeap } from '../core/utils.js';
import { neighbors8, labelComponents } from './grid.js';

/** Distance (in cells, capped at 255) from each land cell to the ocean and each ocean cell to land. */
export function coastDistance(grid, height) {
  const { W, H, N } = grid;
  const dist = new Uint8Array(N).fill(255);
  const queue = new Int32Array(N);
  const nb = new Int32Array(8);
  let qh = 0, qt = 0;
  // seeds: cells adjacent to the opposite type get 1
  for (let i = 0; i < N; i++) {
    const land = height[i] > 0;
    const n = neighbors8(W, H, i, nb);
    for (let k = 0; k < n; k++) {
      if ((height[nb[k]] > 0) !== land) { dist[i] = 1; queue[qt++] = i; break; }
    }
  }
  while (qh < qt) {
    const c = queue[qh++];
    const land = height[c] > 0;
    const d = dist[c];
    if (d >= 254) continue;
    const n = neighbors8(W, H, c, nb);
    for (let k = 0; k < n; k++) {
      const j = nb[k];
      if ((height[j] > 0) === land && dist[j] > d + 1) { dist[j] = d + 1; queue[qt++] = j; }
    }
  }
  return dist;
}

export function generateHydrology(grid, height, moist, temp, rng) {
  const { W, H, N, cellArea } = grid;
  const nb = new Int32Array(8);
  const filled = Float32Array.from(height);
  const recv = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const order = new Int32Array(N);
  let oc = 0;
  const heap = new MinHeap(1 << 16);
  for (let i = 0; i < N; i++) {
    if (height[i] > 0) continue;
    closed[i] = 1;
    const n = neighbors8(W, H, i, nb);
    for (let k = 0; k < n; k++) if (height[nb[k]] > 0) { heap.push(i, height[i]); break; }
  }
  const eps = 1e-5;
  while (heap.size > 0) {
    const c = heap.pop();
    const n = neighbors8(W, H, c, nb);
    for (let k = 0; k < n; k++) {
      const j = nb[k];
      if (closed[j]) continue;
      closed[j] = 1;
      if (filled[j] <= filled[c]) filled[j] = filled[c] + eps;
      recv[j] = c;
      order[oc++] = j;
      heap.push(j, filled[j]);
    }
  }

  // Lakes: filled depressions deep enough in non-arid climates.
  const lakeCand = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (height[i] > 0 && filled[i] - height[i] > 0.006 && moist[i] > 0.22 && temp[i] > -12) lakeCand[i] = 1;
  }
  const { comps } = labelComponents(grid, lakeCand, true);
  const lakeMask = new Uint8Array(N);
  const minLake = 2;
  const maxLake = Math.max(60, N / 900);
  for (const c of comps) {
    if (c.cells.length < minLake) continue;
    if (c.cells.length > maxLake) {
      // giant basin: only keep the deepest core as the lake
      const depthOf = (i) => filled[i] - height[i];
      const sorted = c.cells.slice().sort((a, b) => depthOf(b) - depthOf(a)).slice(0, Math.floor(maxLake));
      for (const i of sorted) lakeMask[i] = 1;
    } else for (const i of c.cells) lakeMask[i] = 1;
  }

  // Flow accumulation weighted by precipitation and cell area.
  const flow = new Float32Array(N);
  const eqArea = cellArea[(H / 2) | 0];
  for (let i = 0; i < N; i++) {
    if (height[i] > 0) {
      const y = (i / W) | 0;
      const m = moist[i];
      const melt = temp[i] < -5 ? 0.3 : 1;
      flow[i] = (0.15 + m * m * 1.6) * melt * (cellArea[y] / eqArea);
    }
  }
  for (let k = oc - 1; k >= 0; k--) {
    const i = order[k];
    const r = recv[i];
    if (r >= 0) flow[r] += flow[i];
  }

  const riverT = 70 * Math.pow(W / 1024, 2);
  return { filled, recv, order, orderCount: oc, lakeMask, flow, riverT };
}

/** Trace river polylines (source → mouth) from the drainage tree. */
export function traceRivers(grid, height, hyd) {
  const { W, H, N } = grid;
  const { recv, flow, riverT, lakeMask } = hyd;
  const isRiver = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (height[i] > 0 && !lakeMask[i] && flow[i] >= riverT) isRiver[i] = 1;

  // CSR children lists (river cells only)
  const childCount = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) {
    if (!isRiver[i]) continue;
    const r = recv[i];
    if (r >= 0 && isRiver[r]) childCount[r + 1]++;
  }
  for (let i = 0; i < N; i++) childCount[i + 1] += childCount[i];
  const childStart = childCount;
  const fillPos = childStart.slice(0, N);
  const children = new Int32Array(childStart[N]);
  for (let i = 0; i < N; i++) {
    if (!isRiver[i]) continue;
    const r = recv[i];
    if (r >= 0 && isRiver[r]) children[fillPos[r]++] = i;
  }

  const rivers = [];
  const riverId = new Int32Array(N).fill(-1);
  const stack = [];
  for (let i = 0; i < N; i++) {
    if (!isRiver[i]) continue;
    const r = recv[i];
    if (r < 0 || !isRiver[r]) stack.push({ mouth: i, into: r, parent: -1 });
  }
  while (stack.length) {
    const { mouth, into, parent } = stack.pop();
    const path = [mouth];
    let cur = mouth;
    for (;;) {
      const s = childStart[cur], e = childStart[cur + 1];
      if (s === e) break;
      let best = -1, bf = -1;
      for (let k = s; k < e; k++) { const c = children[k]; if (flow[c] > bf) { bf = flow[c]; best = c; } }
      for (let k = s; k < e; k++) {
        const c = children[k];
        if (c !== best) stack.push({ mouth: c, into: cur, parent: rivers.length });
      }
      path.push(best);
      cur = best;
    }
    path.reverse(); // source → mouth
    if (into >= 0) path.push(into);
    const id = rivers.length;
    for (const c of path) if (riverId[c] === -1 && height[c] > 0 && !lakeMask[c]) riverId[c] = id;
    rivers.push({ id, cells: path, parent, mouthFlow: flow[mouth], endsIn: into >= 0 ? (height[into] <= 0 ? 'ocean' : lakeMask[into] ? 'lake' : 'river') : 'ocean' });
  }
  return { rivers, riverId, isRiver };
}

