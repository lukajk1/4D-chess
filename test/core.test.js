import assert from 'node:assert/strict';
import test from 'node:test';

import { axisVectors, allStepVectors, leaperVectors } from '../src/core/geometry.js';
import { legalMoves, makeMove, perft, status, inCheck } from '../src/core/movegen.js';
import { toFen, fromFen, squareName, parseSquare, moveToText, findMove } from '../src/core/notation.js';
import { startPosition, loadFen, VARIANTS } from '../src/variants.js';

test('step vectors scale with dimension count', () => {
  for (const [dims, rook, bishop, royal, knight] of [
    [1, 2, 0, 2, 0],
    [2, 4, 4, 8, 8],
    [3, 6, 12, 26, 24],
    [4, 8, 24, 80, 48],
  ]) {
    assert.equal(axisVectors(dims, 1).length, rook, `rook dims=${dims}`);
    assert.equal(axisVectors(dims, 2).length, bishop, `bishop dims=${dims}`);
    assert.equal(allStepVectors(dims).length, royal, `king/queen dims=${dims}`);
    assert.equal(leaperVectors(dims, [1, 2]).length, knight, `knight dims=${dims}`);
  }
});

test('square names round-trip in every dimension', () => {
  for (const shape of [[8], [8, 8], [4, 4, 4], [4, 4, 4, 4]]) {
    const total = shape.reduce((a, b) => a * b, 1);
    for (let i = 0; i < total; i++) {
      assert.equal(parseSquare(shape, squareName(shape, i)), i);
    }
  }
  assert.equal(squareName([8], 0), 'a');
  assert.equal(squareName([8, 8], 4), 'e1');
  assert.equal(squareName([4, 4, 4, 4], 0), 'a1:1:1');
});

test('2D placement field is byte-identical to standard FEN', () => {
  const pos = startPosition('2d');
  const placement = toFen(pos).split(' ')[1];
  assert.equal(placement, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
});

test('FEN round-trips for both variants', () => {
  for (const id of Object.keys(VARIANTS)) {
    const pos = startPosition(id);
    assert.equal(toFen(pos), VARIANTS[id].start, id);
    assert.equal(toFen(fromFen(toFen(pos), VARIANTS[id])), VARIANTS[id].start, `${id} reparse`);
  }
});

test('standard chess perft matches published counts', () => {
  const pos = startPosition('2d');
  assert.equal(perft(pos, 1), 20);
  assert.equal(perft(pos, 2), 400);
  assert.equal(perft(pos, 3), 8902);
});

test('perft on positions exercising castling, en passant and promotion', () => {
  // Kiwipete: the standard position for catching special-move bugs.
  const kiwipete = loadFen(
    '8x8 r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', '2d');
  assert.equal(perft(kiwipete, 1), 48);
  assert.equal(perft(kiwipete, 2), 2039);

  // Position 3: rook and pawn endgame, heavy on en passant.
  const endgame = loadFen('8x8 8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', '2d');
  assert.equal(perft(endgame, 1), 14);
  assert.equal(perft(endgame, 2), 191);
  assert.equal(perft(endgame, 3), 2812);
});

test('castling moves the rook and clears the rights', () => {
  const pos = loadFen('8x8 r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', '2d');
  const moves = legalMoves(pos);
  const short = findMove(moves, pos.shape, 'e1g1');
  assert.ok(short, 'kingside castling available');
  const after = makeMove(pos, short);
  assert.equal(after.get(parseSquare(pos.shape, 'g1')), 'K');
  assert.equal(after.get(parseSquare(pos.shape, 'f1')), 'R');
  assert.equal(after.get(parseSquare(pos.shape, 'h1')), null);
  assert.deepEqual(after.castling, ['k', 'q']);
});

test('castling is blocked through an attacked square', () => {
  const pos = loadFen('8x8 4k3/8/8/8/8/8/5q2/R3K2R w KQ - 0 1', '2d');
  const texts = legalMoves(pos).map((m) => moveToText(pos.shape, m));
  assert.ok(!texts.includes('e1g1'), 'cannot castle through f1');
});

test('en passant captures the pawn that passed', () => {
  const pos = loadFen('8x8 4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', '2d');
  const capture = findMove(legalMoves(pos), pos.shape, 'e5d6');
  assert.ok(capture, 'en passant generated');
  const after = makeMove(pos, capture);
  assert.equal(after.get(parseSquare(pos.shape, 'd5')), null, 'captured pawn removed');
  assert.equal(after.get(parseSquare(pos.shape, 'd6')), 'P');
});

test('promotion offers every piece', () => {
  const pos = loadFen('8x8 4k3/P7/8/8/8/8/8/4K3 w - - 0 1', '2d');
  const promotions = legalMoves(pos)
    .filter((m) => moveToText(pos.shape, m).startsWith('a7a8'))
    .map((m) => m.promotion)
    .sort();
  assert.deepEqual(promotions, ['b', 'n', 'q', 'r']);
});

test("fool's mate is detected as checkmate", () => {
  let pos = startPosition('2d');
  for (const text of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) {
    const move = findMove(legalMoves(pos), pos.shape, text);
    assert.ok(move, `move ${text} is legal`);
    pos = makeMove(pos, move);
  }
  const state = status(pos);
  assert.equal(state.over, true);
  assert.equal(state.reason, 'checkmate');
  assert.equal(state.result, 'b');
});

test('stalemate is a draw, not a loss', () => {
  const pos = loadFen('8x8 7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', '2d');
  const state = status(pos);
  assert.equal(state.over, true);
  assert.equal(state.reason, 'stalemate');
  assert.equal(state.result, 'draw');
  assert.equal(inCheck(pos), false);
});

test('1D chess: only the rook has anywhere to go at the start', () => {
  const pos = startPosition('1d');
  const texts = legalMoves(pos).map((m) => moveToText(pos.shape, m)).sort();
  // King on a is boxed in by its own rook on b; the rook slides c-f or takes on g.
  assert.deepEqual(texts, ['bc', 'bd', 'be', 'bf', 'bg']);
});

test('1D chess: bishops and knights are inert, queens equal rooks', () => {
  const withMinors = loadFen('8 KNB3rk w - - 0 1', '1d');
  const fromB = legalMoves(withMinors).filter((m) => m.from === 1 || m.from === 2);
  assert.equal(fromB.length, 0, 'knight and bishop have no vectors in 1D');

  const queen = loadFen('8 KQ4rk w - - 0 1', '1d');
  const rook = loadFen('8 KR4rk w - - 0 1', '1d');
  assert.equal(legalMoves(queen).length, legalMoves(rook).length);
});

test('1D chess: mate needs the rook defended', () => {
  // King on f guards g, so the rook on g checks h with no escape and no capture.
  const mate = loadFen('8 5KRk b - - 0 1', '1d');
  const after = status(mate);
  assert.equal(after.over, true);
  assert.equal(after.reason, 'checkmate');
  assert.equal(after.result, 'w');

  // The same rook one square further from its king is simply taken.
  const loose = loadFen('8 K5Rk b - - 0 1', '1d');
  const escape = status(loose);
  assert.equal(escape.over, false);
  assert.deepEqual(legalMoves(loose).map((m) => moveToText(loose.shape, m)), ['hg']);
});
