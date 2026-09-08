import { WHITE, colorOf, typeOf, opposite, toCoord, Position } from './position.js';
import { PIECES, modeOf } from './pieces.js';
import {
  envelope, inCheck, applyMove, undoMove, legalMovesInPlace, pseudoMoves,
  forwardAxisOf, forwardDirectionOf,
} from './movegen.js';

// Negamax with alpha-beta, iterative deepening and a quiescence tail. No DOM,
// no clock beyond a monotonic reading, no three.js -- so this imports into a
// Web Worker unchanged, which is the point of keeping src/core clean.
//
// Deliberately no transposition table yet: that needs incremental Zobrist
// hashing on the position, which is a change to applyMove rather than to this
// file. It is the next real win once the search is in place.

const MATE = 1_000_000;
const now = typeof performance === 'object' && performance.now
  ? () => performance.now()
  : () => Date.now();

class Timeout extends Error {}

// ---------------------------------------------------------------- evaluation

const PAWN = 100;
const ROOK_ANCHOR = 500;
// Reach alone undervalues leapers, which pass through blockers rather than
// being stopped by them. 1.7 puts a knight near its conventional 320 on an 8x8
// board -- the one shape whose values everybody already agrees on, so it makes
// a usable calibration point for shapes where nobody has an opinion.
const LEAPER_BONUS = 1.7;
const CENTRE_WEIGHT = 12;
const ADVANCE_WEIGHT = 6;

const valueCache = new Map();

// Piece values measured from the board rather than imported. A rook on 4x4x4x4
// is not a rook on 8x8: it has four full-length rays instead of two, and its
// worth relative to a bishop moves accordingly. Averaging each piece's reach
// over an empty board of this shape captures that; anchoring the rook at 500
// and pinning the pawn at 100 keeps the numbers on chess's familiar scale.
export function pieceValues(shape) {
  const key = shape.join('x');
  if (valueCache.has(key)) return valueCache.get(key);

  const board = new Position({ shape });
  const total = board.squares.length;
  // Sampled on large boards: an 8^4 sweep is 4,096 squares times eighty
  // directions per piece, and the average converges long before that.
  const stride = Math.max(1, Math.ceil(total / 256));
  const reach = {};
  for (const type of Object.keys(PIECES)) {
    if (type === 'p') continue;
    let sum = 0;
    let seen = 0;
    for (let i = 0; i < total; i += stride) {
      board.squares[i] = type.toUpperCase();
      sum += envelope(board, i).length;
      board.squares[i] = null;
      seen++;
    }
    reach[type] = (sum / seen) * (modeOf(type) === 'step' ? LEAPER_BONUS : 1);
  }

  // A pawn's worth is promotion and structure, not squares covered, so reach
  // would badly misprice it. The king is never captured under legal move
  // generation -- mate is "no moves while in check" -- so it scores nothing.
  const values = { p: PAWN, k: 0 };
  for (const [type, r] of Object.entries(reach)) {
    if (type === 'k') continue;
    values[type] = reach.r > 0 ? Math.round((r / reach.r) * ROOK_ANCHOR) : 0;
  }
  valueCache.set(key, values);
  return values;
}

// O(pieces), not O(squares^2). Material, plus two cheap positional terms that
// between them stop the engine shuffling on the rim.
export function evaluate(pos, color, values = pieceValues(pos.shape)) {
  const shape = pos.shape;
  const axis = forwardAxisOf(pos);
  let score = 0;
  for (let i = 0; i < pos.squares.length; i++) {
    const piece = pos.squares[i];
    if (piece === null) continue;
    const side = colorOf(piece);
    const type = typeOf(piece);
    let worth = values[type] ?? 0;

    const coord = toCoord(shape, i);
    // Centre control over every axis. A 4D board has four ways to be on the
    // rim, and counting only two of them would call a corner central.
    let spread = 0;
    for (let a = 0; a < shape.length; a++) {
      const half = (shape[a] - 1) / 2;
      if (half > 0) spread += Math.abs(coord[a] - half) / half;
    }
    worth += (1 - spread / shape.length) * CENTRE_WEIGHT;

    if (type === 'p') {
      const home = forwardDirectionOf(pos, side) > 0 ? 0 : shape[axis] - 1;
      worth += Math.abs(coord[axis] - home) * ADVANCE_WEIGHT;
    }
    score += side === WHITE ? worth : -worth;
  }
  return color === WHITE ? score : -score;
}

// ------------------------------------------------------------ move ordering

// MVV-LVA: try the moves that take the most valuable thing with the least
// valuable thing first. Ordering is most of what makes alpha-beta cut, so this
// is worth more than it looks.
function order(moves, values) {
  for (const move of moves) {
    move.rank = move.captured
      ? values[typeOf(move.captured)] * 10 - values[typeOf(move.piece)]
      : move.promotion ? 9000
      : 0;
  }
  moves.sort((a, b) => b.rank - a.rank);
}

// ------------------------------------------------------------------- search

// Stopping at a fixed depth in the middle of an exchange reads the position as
// though the recapture will never come, which is where an engine hangs pieces.
// Quiescence keeps going until nothing is being taken.
function quiesce(board, color, alpha, beta, ply, left, ctx) {
  ctx.nodes++;
  ctx.check();
  const checked = inCheck(board, color);
  let best = -Infinity;

  if (!checked) {
    // Standing pat: the side to move is not obliged to capture, so the static
    // score is a lower bound on what it can get.
    best = evaluate(board, color, ctx.values);
    if (left <= 0 || best >= beta) return best;
    if (best > alpha) alpha = best;
  }

  if (checked && left <= 0) return evaluate(board, color, ctx.values);

  // In check every reply matters, so none can be skipped. Otherwise only the
  // moves that change material are worth extending for -- and filtering the
  // pseudo-moves first means legality is only ever proved for those, not for
  // the two hundred quiet moves quiescence is going to discard anyway.
  const pseudo = pseudoMoves(board, color);
  const moves = checked ? pseudo : pseudo.filter((move) => move.captured || move.promotion);
  order(moves, ctx.values);

  let any = false;
  for (const move of moves) {
    const undo = applyMove(board, move);
    if (inCheck(board, color)) { undoMove(board, undo); continue; }
    any = true;
    const score = -quiesce(board, opposite(color), -beta, -alpha, ply + 1, left - 1, ctx);
    undoMove(board, undo);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  // Only meaningful when in check, where every reply was on the list: no legal
  // reply to a check is mate. Otherwise an empty list just means nothing hangs.
  if (checked && !any) return -(MATE - ply);
  return best;
}

function negamax(board, color, depth, alpha, beta, ply, ctx) {
  ctx.nodes++;
  ctx.check();
  if (depth <= 0) return quiesce(board, color, alpha, beta, ply, ctx.quiescence, ctx);

  // Legality is proved lazily, one move at a time, rather than for the whole
  // list up front. With decent ordering alpha-beta cuts after a handful of
  // moves, so proving all two hundred legal first throws away almost all of
  // that work -- this was the single biggest cost in the first version.
  const moves = pseudoMoves(board, color);
  order(moves, ctx.values);

  let best = -Infinity;
  let any = false;
  for (const move of moves) {
    const undo = applyMove(board, move);
    if (inCheck(board, color)) { undoMove(board, undo); continue; }
    any = true;
    const score = -negamax(board, opposite(color), depth - 1, -beta, -alpha, ply + 1, ctx);
    undoMove(board, undo);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  // A cutoff leaves `any` true, so this only fires when every pseudo-move was
  // tried and none was legal. Mate is scored by distance, so a mate in two
  // beats a mate in four and a loss is put off as long as possible.
  if (!any) return inCheck(board, color) ? -(MATE - ply) : 0;
  return best;
}

// Randomness among near-equal moves, so an easy opponent does not replay the
// same game every time. Off above easy, where predictability is the point.
function pick(sorted, jitter, random) {
  if (jitter <= 0 || sorted.length === 1) return sorted[0];
  const floor = sorted[0].score - jitter;
  let n = 1;
  while (n < sorted.length && sorted[n].score >= floor) n++;
  return sorted[Math.floor(random() * n)];
}

// maxDepth is an ambition, not a promise: iterative deepening returns the last
// depth that finished inside budgetMs, so these degrade gracefully on a big
// board and reach their cap on a small one. Measured on 4^4, medium lands on
// depth 2 in about half its budget and hard sometimes reaches 3.
//
// Quiescence is where the anti-blunder behaviour lives, so even easy gets it.
// Raising it to 3 costs more than the ply it buys -- it tripled the node count
// at depth 1 without changing the move -- hence 2 everywhere but extreme.
export const difficulties = {
  easy: { label: 'Easy', maxDepth: 1, quiescence: 2, budgetMs: 400, jitter: 60 },
  medium: { label: 'Medium', maxDepth: 2, quiescence: 2, budgetMs: 1200, jitter: 20 },
  hard: { label: 'Hard', maxDepth: 3, quiescence: 2, budgetMs: 4000, jitter: 0 },
  extreme: { label: 'Extreme', maxDepth: 4, quiescence: 3, budgetMs: 12000, jitter: 0 },
};

// Returns { move, score, depth, nodes, ms } or null when there is nothing to
// play. Iterative deepening: each pass reorders the root by what the last one
// found, which is what makes the next one cut early, and a pass cut short by
// the clock is discarded rather than half-trusted.
export function chooseMove(pos, options = {}) {
  const {
    maxDepth = 3, quiescence = 2, budgetMs = 1000, jitter = 0, random = Math.random,
  } = options;

  const board = pos.clone();
  const color = board.turn;
  const root = legalMovesInPlace(board, color);
  if (!root.length) return null;

  const started = now();
  const ctx = {
    nodes: 0,
    quiescence,
    values: pieceValues(board.shape),
    deadline: started + budgetMs,
    check() {
      // Every 1,024 nodes: reading the clock on every node costs more than the
      // search the reading is there to bound.
      if ((this.nodes & 1023) === 0 && now() >= this.deadline) throw new Timeout();
    },
  };

  order(root, ctx.values);
  let best = { move: root[0], score: 0, depth: 0, nodes: 0, ms: 0 };

  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      let alpha = -Infinity;
      for (const move of root) {
        const undo = applyMove(board, move);
        move.score = -negamax(board, opposite(color), depth - 1, -Infinity, -alpha, 1, ctx);
        undoMove(board, undo);
        if (move.score > alpha) alpha = move.score;
      }
      root.sort((a, b) => b.score - a.score);
      const chosen = pick(root, jitter, random);
      best = { move: chosen, score: chosen.score, depth, nodes: ctx.nodes, ms: now() - started };
      // Nothing deeper can beat a forced mate already found at this depth.
      if (Math.abs(best.score) >= MATE - depth) break;
    } catch (error) {
      if (!(error instanceof Timeout)) throw error;
      break;
    }
  }
  return best;
}
