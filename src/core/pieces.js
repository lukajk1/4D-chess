import { allStepVectors, axisVectors, leaperVectors } from './geometry.js';

// `mode` decides how the vectors are consumed: slide repeats a vector until
// blocked, step takes it exactly once, pawn is handled separately in movegen.
export const PIECES = {
  k: { name: 'King',    mode: 'step',  vectors: (dims) => allStepVectors(dims) },
  q: { name: 'Queen',   mode: 'slide', vectors: (dims) => allStepVectors(dims) },
  r: { name: 'Rook',    mode: 'slide', vectors: (dims) => axisVectors(dims, 1) },
  b: { name: 'Bishop',  mode: 'slide', vectors: (dims) => axisVectors(dims, 2) },
  n: { name: 'Knight',  mode: 'step',  vectors: (dims) => leaperVectors(dims, [1, 2]) },
  p: { name: 'Pawn',    mode: 'pawn',  vectors: () => [] },
  // Only meaningful once there are enough axes to move along.
  u: { name: 'Unicorn', mode: 'slide', vectors: (dims) => axisVectors(dims, 3) },
  a: { name: 'Balloon', mode: 'slide', vectors: (dims) => axisVectors(dims, 4) },
};

const cache = new Map();

export function vectorsFor(type, dims) {
  const key = type + dims;
  if (!cache.has(key)) cache.set(key, PIECES[type].vectors(dims));
  return cache.get(key);
}

export const modeOf = (type) => PIECES[type].mode;
export const nameOf = (type) => PIECES[type].name;
