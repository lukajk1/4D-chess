// Step vectors are derived from the number of board dimensions, so one set of
// piece definitions covers a 1x8 strip, an 8x8 board and a 4x4x4x4 hypercube.

export function combinations(n, k) {
  const out = [];
  if (k < 0 || k > n) return out;
  const pick = (start, acc) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < n; i++) { acc.push(i); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  return out;
}

export function permutations(items) {
  if (items.length <= 1) return [items.slice()];
  const out = [];
  items.forEach((item, i) => {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

// Every combination of +1/-1 of length k.
export function signVectors(k) {
  const out = [];
  for (let mask = 0; mask < (1 << k); mask++) {
    const v = [];
    for (let i = 0; i < k; i++) v.push(mask & (1 << i) ? -1 : 1);
    out.push(v);
  }
  return out;
}

// Vectors with exactly `k` axes set to +/-1 and the rest 0.
// k=1 gives rook rays, k=2 bishop rays, k=3 the 3D unicorn, k=4 the 4D balloon.
export function axisVectors(dims, k) {
  const out = [];
  for (const axes of combinations(dims, k)) {
    for (const signs of signVectors(k)) {
      const v = new Array(dims).fill(0);
      axes.forEach((axis, i) => { v[axis] = signs[i]; });
      out.push(v);
    }
  }
  return out;
}

// Every vector with components in {-1,0,1} except the zero vector.
export function allStepVectors(dims) {
  const out = [];
  for (let k = 1; k <= dims; k++) out.push(...axisVectors(dims, k));
  return out;
}

// A leaper pattern such as [1,2] laid on distinct axes, in every order and sign.
export function leaperVectors(dims, pattern) {
  if (pattern.length > dims) return [];
  const seen = new Set();
  const out = [];
  for (const axes of combinations(dims, pattern.length)) {
    for (const order of permutations(pattern)) {
      for (const signs of signVectors(pattern.length)) {
        const v = new Array(dims).fill(0);
        axes.forEach((axis, i) => { v[axis] = order[i] * signs[i]; });
        const key = v.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(v);
      }
    }
  }
  return out;
}
