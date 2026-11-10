// Module Web Worker that runs generateWorld off the main thread and transfers typed-array buffers back.

import { generateWorld } from './index.js';

self.onmessage = (ev) => {
  const { jobId, settings } = ev.data;
  try {
    const world = generateWorld(settings, (pct, stage) => {
      self.postMessage({ type: 'progress', jobId, pct, stage });
    });
    const transfer = [];
    for (const v of Object.values(world.fields)) if (v && v.buffer) transfer.push(v.buffer);
    delete world.grid; // rebuilt cheaply on the main thread
    self.postMessage({ type: 'done', jobId, world }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', jobId, message: err?.message || String(err), stack: err?.stack });
  }
};

