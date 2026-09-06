import { fromFen, parseSquare, toFen } from './core/notation.js';
import { Position } from './core/position.js';

// Back ranks by board width. Kings and queens sit only on the middle layers,
// so each side fields one of each per cube rather than one per layer.
const BACK_RANKS = {
  4: { royal: 'RQKR', plain: 'R..R' },
  6: { royal: 'RNQKNR', plain: 'RN..NR' },
  8: { royal: 'RNBQKBNR', plain: 'RNB..BNR' },
};

const middleLayers = (n) => [Math.floor((n - 1) / 2), Math.ceil((n - 1) / 2)];

// Lays out both armies on a cube: back rank on the near face of every layer,
// royals only on the middle layers, pawns when there is room. `place` gets
// cube coordinates and the piece, so callers decide where the cube lives.
function layoutArmies(n, place) {
  const ranks = BACK_RANKS[n];
  const royalLayers = middleLayers(n);
  for (let z = 0; z < n; z++) {
    const back = royalLayers.includes(z) ? ranks.royal : ranks.plain;
    for (let x = 0; x < n; x++) {
      if (back[x] !== '.') {
        place(x, 0, z, back[x]);
        place(x, n - 1, z, back[x].toLowerCase());
      }
      // A 4-wide board has no room for pawns without filling every square.
      if (n >= 6) {
        place(x, 1, z, 'P');
        place(x, n - 2, z, 'p');
      }
    }
  }
  return royalLayers;
}

function cubeVariant(n) {
  const pos = new Position({ shape: [n, n, n] });
  const royalLayers = layoutArmies(n, (x, y, z, piece) => pos.set(pos.index([x, y, z]), piece));
  return {
    id: n === 8 ? '3d' : `3d-${n}`,
    name: `3D chess (${n}³)`,
    shape: pos.shape,
    inspectionOnly: true,
    royalLayers,
    blurb: `${n} × ${n} × ${n} · ${(n ** 3).toLocaleString()} positions · A spatial study`,
    castling: [],
    start: toFen(pos),
  };
}

function hypercubeVariant(n) {
  const pos = new Position({ shape: [n, n, n, n] });
  // A 4-wide cube has no room for pawns along y, so layoutArmies leaves them
  // off and they go in along w instead, where there is room.
  const pawnsAlongW = n < 6;
  // The 3D game pulled apart along w: white's half lives in the interior cube
  // (w = 1) and black's in the outer cube (w = n), facing each other across the
  // fourth axis with open board between.
  const royalLayers = layoutArmies(n, (x, y, z, piece) => {
    const white = piece === piece.toUpperCase();
    // layoutArmies mirrors black across y so the two sides face along y. Here
    // they face along w instead, so undo that mirror: both armies share one
    // (x, y, z) footprint and differ only in w, putting the entire separation
    // on the single axis being pulled apart -- as e1 and e8 share a file.
    pos.set(pos.index([x, white ? y : n - 1 - y, z, white ? 0 : n - 1]), piece);
  });

  // Both back ranks sit in the y = 0 plane, so the pawns are a plane too: the
  // full (x, z) square, one step along w in front of the rank it screens. That
  // fills the w axis of that plane -- back, pawns, pawns, back -- which is the
  // only arrangement four cells allow, and leaves y and the six face cells
  // open. The two pawn planes touch, so nothing can advance, but every pawn
  // starts able to capture: a capture steps forward in w and one square in
  // exactly one other axis, which reaches the enemy plane diagonally.
  if (pawnsAlongW) {
    for (let x = 0; x < n; x++) {
      for (let z = 0; z < n; z++) {
        pos.set(pos.index([x, 0, z, 1]), 'P');
        pos.set(pos.index([x, 0, z, n - 2]), 'p');
      }
    }
  }

  return {
    id: n === 8 ? '4d' : `4d-${n}`,
    royalLayers,
    name: `4D chess (${n}⁴)`,
    shape: pos.shape,
    inspectionOnly: true,
    // Those pawns advance along w, so w is the forward axis. The 8-wide board
    // keeps the y-facing pawns layoutArmies gives it, and the axis-1 default.
    ...(pawnsAlongW && { forwardAxis: 3 }),
    blurb: `${n} × ${n} × ${n} × ${n} · ${(n ** 4).toLocaleString()} positions · Eight cells, one lattice`,
    castling: [],
    start: toFen(pos),
  };
}

// Castling rights are declared as data rather than hardcoded in the generator,
// so a variant without castling simply declares none.
function castlingRight(shape, id, color, king, rook, empty, safe) {
  return {
    id,
    color,
    kingFrom: parseSquare(shape, king[0]),
    kingTo: parseSquare(shape, king[1]),
    rookFrom: parseSquare(shape, rook[0]),
    rookTo: parseSquare(shape, rook[1]),
    empty: empty.map((sq) => parseSquare(shape, sq)),
    safe: safe.map((sq) => parseSquare(shape, sq)),
  };
}

const SHAPE_2D = [8, 8];

const standardCastling = [
  castlingRight(SHAPE_2D, 'K', 'w', ['e1', 'g1'], ['h1', 'f1'], ['f1', 'g1'], ['e1', 'f1', 'g1']),
  castlingRight(SHAPE_2D, 'Q', 'w', ['e1', 'c1'], ['a1', 'd1'], ['b1', 'c1', 'd1'], ['e1', 'd1', 'c1']),
  castlingRight(SHAPE_2D, 'k', 'b', ['e8', 'g8'], ['h8', 'f8'], ['f8', 'g8'], ['e8', 'f8', 'g8']),
  castlingRight(SHAPE_2D, 'q', 'b', ['e8', 'c8'], ['a8', 'd8'], ['b8', 'c8', 'd8'], ['e8', 'd8', 'c8']),
];

export const VARIANTS = {
  // A 1x8 strip: king on the end square, rook in front of it. Bishops and
  // knights are omitted because they have no legal vectors in one dimension.
  '1d': {
    id: '1d',
    name: '1D chess',
    blurb: 'One line, eight points. Kings and rooks only.',
    shape: [8],
    forwardAxis: 0,
    castling: [],
    start: '8 KR4rk w - - 0 1',
  },

  '2d': {
    id: '2d',
    name: '2D chess',
    blurb: 'The ordinary 8x8 game.',
    shape: SHAPE_2D,
    forwardAxis: 1,
    castling: standardCastling,
    pawnRank: { w: 1, b: 6 },
    start: '8x8 rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  },
  '3d-4': cubeVariant(4),
  '3d': cubeVariant(8),
  '4d-4': hypercubeVariant(4),
  '4d': hypercubeVariant(8),
};

export function startPosition(id) {
  const variant = VARIANTS[id];
  if (!variant) throw new Error(`unknown variant "${id}"`);
  return fromFen(variant.start, variant);
}

export function loadFen(fen, id) {
  return fromFen(fen, VARIANTS[id]);
}
