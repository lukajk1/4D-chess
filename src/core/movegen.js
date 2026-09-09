import { WHITE, BLACK, colorOf, typeOf, opposite, withColor, toCoord, toIndex, step } from './position.js';
import { PIECES, vectorsFor, modeOf } from './pieces.js';

export const forwardAxisOf = (pos) => pos.variant?.forwardAxis ?? (pos.dims >= 2 ? 1 : 0);
export const forwardDirectionOf = (pos, color) => pos.variant?.forwardDirection?.[color]
  ?? (color === WHITE ? 1 : -1);
const promotionsOf = (pos) => pos.variant?.promotions ?? ['q', 'r', 'b', 'n'];

// A variant may describe its pawns as moving along several axes at once, which
// the single forwardAxis/forwardDirection pair cannot express. `pawnRules`
// carries, per colour: the axes a push may run along and which way, the axes a
// capture steps sideways in, and the corner a pawn promotes on.
//
// Pushes are still one axis at a time -- four separate moves, not a diagonal --
// so a pawn chooses an axis each turn rather than advancing on both together.
export const pawnRulesOf = (pos, color) => pos.variant?.pawnRules?.[color] ?? null;

// Every generated move carries the same fields in the same order, so this --
// the engine's most frequent allocation -- keeps to one hidden class, and no
// consumer has to distinguish "absent" from "false". `rank` is included for
// the search's move ordering, which writes it on every move of every node and
// would otherwise reshape each object as it went.
function newMove(from, to, piece, captured, promotion = null, ep = false, double = false, castle = null) {
  return { from, to, piece, captured, promotion, ep, double, castle, rank: 0 };
}

function slide(pos, from, piece, vectors, out, color) {
  const coord = toCoord(pos.shape, from);
  for (const vector of vectors) {
    for (let distance = 1; ; distance++) {
      const to = step(pos.shape, coord, vector, distance);
      if (to === -1) break;
      const target = pos.get(to);
      if (target === null) { out.push(newMove(from, to, piece, null)); continue; }
      if (colorOf(target) !== color) out.push(newMove(from, to, piece, target));
      break;
    }
  }
}

function leap(pos, from, piece, vectors, out, color) {
  const coord = toCoord(pos.shape, from);
  for (const vector of vectors) {
    const to = step(pos.shape, coord, vector);
    if (to === -1) continue;
    const target = pos.get(to);
    if (target !== null && colorOf(target) === color) continue;
    out.push(newMove(from, to, piece, target));
  }
}

// A pawn advances one square along the forward axis, and captures one square
// forward diagonally across files (axis 0), optionally shifting to a higher, lower
// or same layer (axis 2: z) in 3D/4D.
// Every direction some sliding piece travels, each paired with the types that
// travel it. Derived from the piece table rather than hardcoded, so a new
// slider is picked up here the moment it is declared.
const rayCache = new Map();
function sliderRays(dims) {
  if (!rayCache.has(dims)) {
    const byKey = new Map();
    for (const [type, def] of Object.entries(PIECES)) {
      if (def.mode !== 'slide') continue;
      for (const vector of vectorsFor(type, dims)) {
        const key = vector.join(',');
        if (!byKey.has(key)) byKey.set(key, { vector, types: new Set() });
        byKey.get(key).types.add(type);
      }
    }
    rayCache.set(dims, [...byKey.values()]);
  }
  return rayCache.get(dims);
}

const LEAPERS = Object.keys(PIECES).filter((type) => PIECES[type].mode === 'step');

const pawnVectorCache = new Map();
function pawnCaptureVectorsFor(dims, axis, direction) {
  const key = `${dims}|${axis}|${direction}`;
  if (!pawnVectorCache.has(key)) {
    pawnVectorCache.set(key, pawnCaptureVectors(dims, axis, direction));
  }
  return pawnVectorCache.get(key);
}

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

// Push and capture vectors for a multi-axis pawn, built from `pawnRules`.
// Cached per colour and dimension count: the rules never change during a game.
const multiPawnCache = new Map();
function multiPawnVectors(dims, rules) {
  const key = `${dims}|${rules.push.map((p) => p.axis + ':' + p.direction).join(',')}|${rules.sideAxes.join(',')}`;
  if (!multiPawnCache.has(key)) {
    const pushes = rules.push.map(({ axis, direction }) => {
      const v = new Array(dims).fill(0);
      v[axis] = direction;
      return { axis, direction, vector: v };
    });
    // A capture advances one step along one push axis and one square sideways,
    // in a single named axis. The other push axis is deliberately not offered
    // as a sideways step, so the two forward directions never combine.
    const captures = [];
    for (const { axis, direction } of rules.push) {
      for (const side of rules.sideAxes) {
        for (const delta of [-1, 1]) {
          const v = new Array(dims).fill(0);
          v[axis] = direction;
          v[side] = delta;
          captures.push(v);
        }
      }
    }
    multiPawnCache.set(key, { pushes, captures });
  }
  return multiPawnCache.get(key);
}

// True when a coordinate sits on the square a pawn of this colour promotes on.
// The rule is a conjunction: every named axis must be at its stated value, so
// a pawn promotes in one corner rather than on either far face.
function atPromotion(coord, rules) {
  for (const [axis, value] of rules.promoteAt) if (coord[axis] !== value) return false;
  return true;
}

function multiPawnMoves(pos, from, piece, color, rules, out) {
  const coord = toCoord(pos.shape, from);
  const { pushes, captures } = multiPawnVectors(pos.dims, rules);

  const push = (to, captured, ep = false) => {
    if (atPromotion(toCoord(pos.shape, to), rules)) {
      for (const promotion of promotionsOf(pos)) out.push(newMove(from, to, piece, captured, promotion, ep));
    } else {
      out.push(newMove(from, to, piece, captured, null, ep));
    }
  };

  for (const { axis, direction, vector } of pushes) {
    const one = step(pos.shape, coord, vector);
    if (one === -1 || pos.get(one) !== null) continue;
    push(one, null);
    // The double step is a first move only, and like a standard pawn's it is
    // blocked by anything on the square passed over -- already checked above.
    if (coord[axis] === rules.start[axis]) {
      const two = step(pos.shape, coord, vector, 2);
      if (two !== -1 && pos.get(two) === null) out.push(newMove(from, two, piece, null, null, false, true));
    }
  }

  for (const vector of captures) {
    const to = step(pos.shape, coord, vector);
    if (to === -1) continue;
    const target = pos.get(to);
    if (target !== null && colorOf(target) !== color) push(to, target);
    else if (target === null && to === pos.ep) push(to, withColor('p', opposite(color)), true);
  }
}

function pawnMoves(pos, from, piece, color, out) {
  const rules = pawnRulesOf(pos, color);
  if (rules) return multiPawnMoves(pos, from, piece, color, rules, out);
  const axis = forwardAxisOf(pos);
  const direction = forwardDirectionOf(pos, color);
  const coord = toCoord(pos.shape, from);
  const lastRank = direction > 0 ? pos.shape[axis] - 1 : 0;
  const startRank = pos.variant?.pawnRank?.[color]
    ?? (direction > 0 ? 1 : pos.shape[axis] - 2);

  const forward = new Array(pos.dims).fill(0);
  forward[axis] = direction;

  const push = (to, captured, ep = false) => {
    if (toCoord(pos.shape, to)[axis] === lastRank) {
      for (const promotion of promotionsOf(pos)) out.push(newMove(from, to, piece, captured, promotion, ep));
    } else {
      out.push(newMove(from, to, piece, captured, null, ep));
    }
  };

  const one = step(pos.shape, coord, forward);
  if (one !== -1 && pos.get(one) === null) {
    push(one, null);
    if (coord[axis] === startRank) {
      const two = step(pos.shape, coord, forward, 2);
      if (two !== -1 && pos.get(two) === null) out.push(newMove(from, two, piece, null, null, false, true));
    }
  }

  for (const vector of pawnCaptureVectors(pos.dims, axis, direction)) {
    const to = step(pos.shape, coord, vector);
    if (to === -1) continue;
    const target = pos.get(to);
    if (target !== null && colorOf(target) !== color) push(to, target);
    else if (target === null && to === pos.ep) push(to, withColor('p', opposite(color)), true);
  }
}

function castlingMoves(pos, color, out) {
  for (const right of pos.variant?.castling ?? []) {
    if (right.color !== color || !pos.castling.includes(right.id)) continue;
    if (pos.get(right.kingFrom) !== withColor('k', color)) continue;
    if (pos.get(right.rookFrom) !== withColor('r', color)) continue;
    if (right.empty.some((index) => pos.get(index) !== null)) continue;
    if (right.safe.some((index) => isAttacked(pos, index, opposite(color)))) continue;
    out.push(newMove(right.kingFrom, right.kingTo, withColor('k', color), null, null, false, false, right.id));
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
    const rules = pawnRulesOf(pos, color);
    if (rules) {
      // Generate and read off the destinations, so the envelope cannot drift
      // from what pawnMoves actually allows.
      const moves = [];
      multiPawnMoves(pos, from, piece, color, rules, moves);
      for (const move of moves) reached.add(move.to);
      if (ignoreOccupancy) {
        for (const vector of multiPawnVectors(pos.dims, rules).captures) {
          const to = step(pos.shape, coord, vector);
          if (to !== -1) reached.add(to);
        }
      }
      return [...reached];
    }
    const axis = forwardAxisOf(pos);
    const direction = forwardDirectionOf(pos, color);
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
    if (mode === 'pawn') pawnMoves(pos, from, piece, color, out);
    else if (mode === 'slide') slide(pos, from, piece, vectorsFor(type, pos.dims), out, color);
    else leap(pos, from, piece, vectorsFor(type, pos.dims), out, color);
  }
  castlingMoves(pos, color, out);
  // No normalising pass: the generators emit finished moves, so this no longer
  // allocates a second object for every one of the couple of hundred it made.
  return out;
}

// Asked from the target square outward, not from every piece inward. The old
// form visited all n^d squares and, for each enemy piece, tried every vector it
// owns -- on an 8^4 board that is 4,096 squares against 80 directions. Probing
// outward costs one walk per direction plus one lookup per leaper offset,
// independent of how big the board is or how many pieces are on it.
//
// This is the hottest function in the engine: legality testing calls it once
// per candidate move, and any search calls legality once per node.
// `found` non-null collects every attacker; null stops at the first, which is
// all isAttacked needs and is the shape the hot path wants. One body, so the
// two can never disagree about what counts as an attack.
function probeAttackers(pos, index, byColor, found) {
  const shape = pos.shape;
  const coord = toCoord(shape, index);

  // A pawn attacking this square stands one capture vector back from it.
  const pawn = withColor('p', byColor);
  const pawnRules = pawnRulesOf(pos, byColor);
  const axis = forwardAxisOf(pos);
  const direction = forwardDirectionOf(pos, byColor);
  const captureVectors = pawnRules
    ? multiPawnVectors(pos.dims, pawnRules).captures
    : pawnCaptureVectorsFor(pos.dims, axis, direction);
  for (const vector of captureVectors) {
    const from = step(shape, coord, vector, -1);
    if (from !== -1 && pos.squares[from] === pawn) {
      if (!found) return true;
      found.push(from);
    }
  }

  // Leaper vector sets are closed under negation, so a piece that could jump
  // here sits exactly one of its own vectors away, in either direction.
  for (const type of LEAPERS) {
    const piece = withColor(type, byColor);
    for (const vector of vectorsFor(type, pos.dims)) {
      const from = step(shape, coord, vector);
      if (from !== -1 && pos.squares[from] === piece) {
        if (!found) return true;
        found.push(from);
      }
    }
  }

  // Walk out along each sliding direction. Only the first piece met matters:
  // if it slides along the direction we arrived on it attacks, and either way
  // it blocks everything behind it.
  for (const ray of sliderRays(pos.dims)) {
    for (let distance = 1; ; distance++) {
      const to = step(shape, coord, ray.vector, distance);
      if (to === -1) break;
      const piece = pos.squares[to];
      if (piece === null) continue;
      if (colorOf(piece) === byColor && ray.types.has(typeOf(piece))) {
        if (!found) return true;
        found.push(to);
      }
      break;
    }
  }
  return found ?? false;
}

export function isAttacked(pos, index, byColor) {
  return probeAttackers(pos, index, byColor, null);
}

// Every enemy piece bearing on a square. Costs the same order as one attack
// test rather than one per enemy piece, because it is the same outward walk.
export function attackersOf(pos, index, byColor) {
  return probeAttackers(pos, index, byColor, []);
}

export function inCheck(pos, color = pos.turn) {
  const king = pos.kingIndex(color);
  return king === -1 ? false : isAttacked(pos, king, opposite(color));
}

function midpoint(pos, move) {
  const from = toCoord(pos.shape, move.from);
  const to = toCoord(pos.shape, move.to);
  const mid = from.slice();
  // A multi-axis pawn picks a push axis per move, so the axis that moved is
  // read off the move itself rather than taken from the variant.
  const axis = pawnRulesOf(pos, colorOf(move.piece))
    ? from.findIndex((v, a) => v !== to[a])
    : forwardAxisOf(pos);
  if (axis === -1) return move.to;
  mid[axis] = (from[axis] + to[axis]) / 2;
  return toIndex(pos.shape, mid);
}

// Applies a move in place and returns everything needed to take it back.
// Search cannot afford makeMove's clone: at roughly 180 candidates a node, a
// copy of the whole board per candidate dwarfs the move itself.
//
// `castling` is replaced rather than mutated, so the undo record can hold the
// original array by reference instead of copying it.
export function applyMove(pos, move) {
  const color = colorOf(move.piece);
  const type = typeOf(move.piece);
  const undo = {
    move,
    turn: pos.turn,
    castling: pos.castling,
    ep: pos.ep,
    halfmove: pos.halfmove,
    fullmove: pos.fullmove,
    from: pos.squares[move.from],
    to: pos.squares[move.to],
    epSquare: -1,
    epPiece: null,
    rookFrom: -1,
    rookTo: -1,
    rookFromPiece: null,
    rookToPiece: null,
  };

  pos.set(move.from, null);
  if (move.ep) {
    const captureCoord = toCoord(pos.shape, move.to);
    const epRules = pawnRulesOf(pos, color);
    if (epRules) {
      // The capture ran along one push axis and one side axis; the pawn taken
      // stands back along the push axis only.
      const fromCoord = toCoord(pos.shape, move.from);
      for (const { axis, direction } of epRules.push) {
        if (captureCoord[axis] - fromCoord[axis] === direction) { captureCoord[axis] -= direction; break; }
      }
    } else {
      captureCoord[forwardAxisOf(pos)] -= forwardDirectionOf(pos, color);
    }
    undo.epSquare = toIndex(pos.shape, captureCoord);
    undo.epPiece = pos.squares[undo.epSquare];
    pos.set(undo.epSquare, null);
  }
  pos.set(move.to, move.promotion ? withColor(move.promotion, color) : move.piece);

  if (move.castle) {
    const right = pos.variant.castling.find((r) => r.id === move.castle);
    undo.rookFrom = right.rookFrom;
    undo.rookTo = right.rookTo;
    undo.rookFromPiece = pos.squares[right.rookFrom];
    undo.rookToPiece = pos.squares[right.rookTo];
    pos.set(right.rookFrom, null);
    pos.set(right.rookTo, withColor('r', color));
  }

  // Any move touching a king or rook home square spends the matching right.
  pos.castling = pos.castling.filter((id) => {
    const right = pos.variant.castling.find((r) => r.id === id);
    return ![right.kingFrom, right.rookFrom].some((sq) => sq === move.from || sq === move.to);
  });

  // midpoint reads only the shape and the move's own coordinates, so it does
  // not mind that the board has already changed underneath it.
  pos.ep = move.double ? midpoint(pos, move) : null;
  pos.halfmove = type === 'p' || move.captured ? 0 : pos.halfmove + 1;
  pos.fullmove = pos.fullmove + (color === BLACK ? 1 : 0);
  pos.turn = opposite(color);
  return undo;
}

export function undoMove(pos, undo) {
  const { move } = undo;
  if (undo.rookFrom !== -1) {
    pos.set(undo.rookFrom, undo.rookFromPiece);
    pos.set(undo.rookTo, undo.rookToPiece);
  }
  pos.set(move.to, undo.to);
  pos.set(move.from, undo.from);
  if (undo.epSquare !== -1) pos.set(undo.epSquare, undo.epPiece);
  pos.turn = undo.turn;
  pos.castling = undo.castling;
  pos.ep = undo.ep;
  pos.halfmove = undo.halfmove;
  pos.fullmove = undo.fullmove;
}

// The immutable form the UI is built on, defined in terms of the mutating one
// so there is only ever one description of what a move does.
export function makeMove(pos, move) {
  const next = pos.clone();
  applyMove(next, move);
  return next;
}

// Filters pseudo-moves down to the legal ones by playing each and asking
// whether it leaves the king attacked, restoring the board as it goes. Mutates
// `pos` and puts it back, so only call it on a board you own.
export function legalMovesInPlace(pos, color = pos.turn) {
  const moves = pseudoMoves(pos, color);
  const legal = [];
  for (const move of moves) {
    const undo = applyMove(pos, move);
    if (!inCheck(pos, color)) legal.push(move);
    undoMove(pos, undo);
  }
  return legal;
}

export function legalMoves(pos, color = pos.turn) {
  // Cloned so a live game position is never touched. A search owns its board
  // and calls legalMovesInPlace directly, skipping even this one copy.
  return legalMovesInPlace(pos.clone(), color);
}

export function status(pos) {
  // A side with no king left has lost, and this is checked before anything
  // else because the rest of the file assumes a king exists: inCheck reads a
  // missing one as "not in check", so a kingless side would otherwise go on
  // playing, never in check and never mated. Legality testing cannot let this
  // happen in a normal game -- but a position can be loaded from FEN, and a
  // variant is free to leave a side without one.
  for (const color of ['w', 'b']) {
    if (pos.kingIndex(color) === -1) {
      return { over: true, check: false, result: opposite(color), reason: 'king captured' };
    }
  }
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
