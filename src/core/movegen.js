import { WHITE, BLACK, colorOf, typeOf, opposite, withColor, toCoord, toIndex, step } from './position.js';
import { vectorsFor, modeOf } from './pieces.js';

const forwardAxisOf = (pos) => pos.variant?.forwardAxis ?? (pos.dims >= 2 ? 1 : 0);
const promotionsOf = (pos) => pos.variant?.promotions ?? ['q', 'r', 'b', 'n'];

function slide(pos, from, vectors, out, color) {
  const coord = toCoord(pos.shape, from);
  for (const vector of vectors) {
    for (let distance = 1; ; distance++) {
      const to = step(pos.shape, coord, vector, distance);
      if (to === -1) break;
      const target = pos.get(to);
      if (target === null) { out.push({ from, to, captured: null }); continue; }
      if (colorOf(target) !== color) out.push({ from, to, captured: target });
      break;
    }
  }
}

function leap(pos, from, vectors, out, color) {
  const coord = toCoord(pos.shape, from);
  for (const vector of vectors) {
    const to = step(pos.shape, coord, vector);
    if (to === -1) continue;
    const target = pos.get(to);
    if (target !== null && colorOf(target) === color) continue;
    out.push({ from, to, captured: target });
  }
}

// A pawn advances one square along the forward axis, and captures one square
// forward diagonally across files (axis 0), optionally shifting to a higher, lower
// or same layer (axis 2: z) in 3D/4D.
function pawnCaptureVectors(dims, axis, direction) {
  if (dims < 2) return [];
  if (dims === 2) {
    const v1 = new Array(2).fill(0); v1[axis] = direction; v1[1 - axis] = -1;
    const v2 = new Array(2).fill(0); v2[axis] = direction; v2[1 - axis] = 1;
    return [v1, v2];
  }
  const vectors = [];
  const zDeltas = dims >= 3 && axis !== 2 ? [-1, 0, 1] : [0];
  for (const dx of [-1, 1]) {
    for (const dz of zDeltas) {
      const v = new Array(dims).fill(0);
      v[axis] = direction;
      v[0] = dx;
      if (dims >= 3 && axis !== 2) v[2] = dz;
      vectors.push(v);
    }
  }
  return vectors;
}

function pawnMoves(pos, from, color, out) {
  const axis = forwardAxisOf(pos);
  const direction = color === WHITE ? 1 : -1;
  const coord = toCoord(pos.shape, from);
  const lastRank = color === WHITE ? pos.shape[axis] - 1 : 0;
  const startRank = pos.variant?.pawnRank?.[color]
    ?? (color === WHITE ? 1 : pos.shape[axis] - 2);

  const forward = new Array(pos.dims).fill(0);
  forward[axis] = direction;

  const push = (to, captured, extra = {}) => {
    if (toCoord(pos.shape, to)[axis] === lastRank) {
      for (const promotion of promotionsOf(pos)) out.push({ from, to, captured, promotion, ...extra });
    } else {
      out.push({ from, to, captured, ...extra });
    }
  };

  const one = step(pos.shape, coord, forward);
  if (one !== -1 && pos.get(one) === null) {
    push(one, null);
    if (coord[axis] === startRank) {
      const two = step(pos.shape, coord, forward, 2);
      if (two !== -1 && pos.get(two) === null) out.push({ from, to: two, captured: null, double: true });
    }
  }

  for (const vector of pawnCaptureVectors(pos.dims, axis, direction)) {
    const to = step(pos.shape, coord, vector);
    if (to === -1) continue;
    const target = pos.get(to);
    if (target !== null && colorOf(target) !== color) push(to, target);
    else if (target === null && to === pos.ep) push(to, withColor('p', opposite(color)), { ep: true });
  }
}

function castlingMoves(pos, color, out) {
  for (const right of pos.variant?.castling ?? []) {
    if (right.color !== color || !pos.castling.includes(right.id)) continue;
    if (pos.get(right.kingFrom) !== withColor('k', color)) continue;
    if (pos.get(right.rookFrom) !== withColor('r', color)) continue;
    if (right.empty.some((index) => pos.get(index) !== null)) continue;
    if (right.safe.some((index) => isAttacked(pos, index, opposite(color)))) continue;
    out.push({ from: right.kingFrom, to: right.kingTo, captured: null, castle: right.id });
  }
}

// Computes reachable squares for a piece, validating collisions and obstacles:
// Friendly pieces block that square and terminate the ray; enemy pieces can be captured
// and terminate the ray. If `ignoreOccupancy` is true, rays run unconstrained to the edge.
export function envelope(pos, from, { ignoreOccupancy = false } = {}) {
  const piece = pos.get(from);
  if (piece === null) return [];
  const type = typeOf(piece);
  const color = colorOf(piece);
  const coord = toCoord(pos.shape, from);
  const reached = new Set();
  if (type === 'p') {
    const axis = forwardAxisOf(pos);
    const direction = color === WHITE ? 1 : -1;
    const forward = new Array(pos.dims).fill(0);
    forward[axis] = direction;

    if (ignoreOccupancy) {
      for (const vector of [forward, ...pawnCaptureVectors(pos.dims, axis, direction)]) {
        const to = step(pos.shape, coord, vector);
        if (to !== -1) reached.add(to);
      }
      return [...reached];
    }

    // Push forward: blocked by any piece in front
    const one = step(pos.shape, coord, forward);
    if (one !== -1 && pos.get(one) === null) {
      reached.add(one);
      const startRank = pos.variant?.pawnRank?.[color]
        ?? (color === WHITE ? 1 : pos.shape[axis] - 2);
      if (coord[axis] === startRank) {
        const two = step(pos.shape, coord, forward, 2);
        if (two !== -1 && pos.get(two) === null) reached.add(two);
      }
    }

    // Diagonal captures: only onto enemy pieces (or en passant)
    for (const vector of pawnCaptureVectors(pos.dims, axis, direction)) {
      const to = step(pos.shape, coord, vector);
      if (to === -1) continue;
      const target = pos.get(to);
      if (target !== null && colorOf(target) !== color) reached.add(to);
      else if (target === null && to === pos.ep) reached.add(to);
    }
    return [...reached];
  }

  const sliding = modeOf(type) === 'slide';
  for (const vector of vectorsFor(type, pos.dims)) {
    for (let distance = 1; ; distance++) {
      const to = step(pos.shape, coord, vector, distance);
      if (to === -1) break;
      if (ignoreOccupancy) {
        reached.add(to);
        if (!sliding) break;
        continue;
      }
      const target = pos.get(to);
      if (target === null) {
        reached.add(to);
        if (!sliding) break;
        continue;
      }
      if (colorOf(target) !== color) {
        // Enemy piece can be captured, but blocks sliding past
        reached.add(to);
      }
      // Friendly piece blocks destination and ray; enemy piece terminates ray
      break;
    }
  }
  return [...reached];
}

// Pseudo-legal: does not yet test whether the mover leaves their own king exposed.
export function pseudoMoves(pos, color = pos.turn) {
  const out = [];
  for (let from = 0; from < pos.squares.length; from++) {
    const piece = pos.get(from);
    if (piece === null || colorOf(piece) !== color) continue;
    const type = typeOf(piece);
    const mode = modeOf(type);
    if (mode === 'pawn') pawnMoves(pos, from, color, out);
    else if (mode === 'slide') slide(pos, from, vectorsFor(type, pos.dims), out, color);
    else leap(pos, from, vectorsFor(type, pos.dims), out, color);
  }
  castlingMoves(pos, color, out);
  return out.map((move) => ({
    promotion: null, ep: false, double: false, castle: null,
    piece: pos.get(move.from), ...move,
  }));
}

export function isAttacked(pos, index, byColor) {
  for (let from = 0; from < pos.squares.length; from++) {
    const piece = pos.get(from);
    if (piece === null || colorOf(piece) !== byColor) continue;
    const type = typeOf(piece);
    const coord = toCoord(pos.shape, from);

    if (type === 'p') {
      const axis = forwardAxisOf(pos);
      const direction = byColor === WHITE ? 1 : -1;
      for (const vector of pawnCaptureVectors(pos.dims, axis, direction)) {
        if (step(pos.shape, coord, vector) === index) return true;
      }
      continue;
    }

    const vectors = vectorsFor(type, pos.dims);
    if (modeOf(type) === 'slide') {
      for (const vector of vectors) {
        for (let distance = 1; ; distance++) {
          const to = step(pos.shape, coord, vector, distance);
          if (to === -1) break;
          if (to === index) return true;
          if (pos.get(to) !== null) break;
        }
      }
    } else {
      for (const vector of vectors) {
        if (step(pos.shape, coord, vector) === index) return true;
      }
    }
  }
  return false;
}

export function inCheck(pos, color = pos.turn) {
  const king = pos.kingIndex(color);
  return king === -1 ? false : isAttacked(pos, king, opposite(color));
}

function midpoint(pos, move) {
  const axis = forwardAxisOf(pos);
  const from = toCoord(pos.shape, move.from);
  const to = toCoord(pos.shape, move.to);
  const mid = from.slice();
  mid[axis] = (from[axis] + to[axis]) / 2;
  return toIndex(pos.shape, mid);
}

export function makeMove(pos, move) {
  const next = pos.clone();
  const color = colorOf(move.piece);
  const type = typeOf(move.piece);

  next.set(move.from, null);
  if (move.ep) {
    const captureCoord = toCoord(pos.shape, move.to);
    captureCoord[forwardAxisOf(pos)] -= color === WHITE ? 1 : -1;
    next.set(toIndex(pos.shape, captureCoord), null);
  }
  next.set(move.to, move.promotion ? withColor(move.promotion, color) : move.piece);

  if (move.castle) {
    const right = pos.variant.castling.find((r) => r.id === move.castle);
    next.set(right.rookFrom, null);
    next.set(right.rookTo, withColor('r', color));
  }

  // Any move touching a king or rook home square spends the matching right.
  next.castling = pos.castling.filter((id) => {
    const right = pos.variant.castling.find((r) => r.id === id);
    return ![right.kingFrom, right.rookFrom].some((sq) => sq === move.from || sq === move.to);
  });

  next.ep = move.double ? midpoint(pos, move) : null;
  next.halfmove = type === 'p' || move.captured ? 0 : pos.halfmove + 1;
  next.fullmove = pos.fullmove + (color === BLACK ? 1 : 0);
  next.turn = opposite(color);
  return next;
}

export function legalMoves(pos, color = pos.turn) {
  return pseudoMoves(pos, color).filter((move) => !inCheck(makeMove(pos, move), color));
}

export function status(pos) {
  const moves = legalMoves(pos);
  const checked = inCheck(pos);
  if (moves.length > 0) return { over: false, check: checked, result: null, reason: null };
  if (checked) return { over: true, check: true, result: opposite(pos.turn), reason: 'checkmate' };
  return { over: true, check: false, result: 'draw', reason: 'stalemate' };
}

export function perft(pos, depth) {
  if (depth === 0) return 1;
  let total = 0;
  for (const move of legalMoves(pos)) total += perft(makeMove(pos, move), depth - 1);
  return total;
}
