import { fromFen, parseSquare, toFen } from './core/notation.js';
import { Position } from './core/position.js';

function cubeVariant() {
  const pos = new Position({ shape: [8, 8, 8] });
  for (let z = 0; z < 8; z++) {
    const back = z === 3 || z === 4 ? 'RNBQKBNR' : 'RNB..BNR';
    for (let x = 0; x < 8; x++) {
      if (back[x] !== '.') {
        pos.set(pos.index([x, 0, z]), back[x]);
        pos.set(pos.index([x, 7, z]), back[x].toLowerCase());
      }
      pos.set(pos.index([x, 1, z]), 'P');
      pos.set(pos.index([x, 6, z]), 'p');
    }
  }
  return {
    id: '3d', name: '3D chess', shape: pos.shape, inspectionOnly: true,
    blurb: '8 × 8 × 8 · 512 positions · A spatial study',
    castling: [], start: toFen(pos),
  };
}

function hypercubeVariant() {
  const pos = new Position({ shape: [8, 8, 8, 8] });
  return {
    id: '4d', name: '4D chess', shape: pos.shape, inspectionOnly: true,
    blurb: '8 × 8 × 8 × 8 · 4,096 positions · Eight cubes, one lattice',
    castling: [], start: toFen(pos),
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
  '3d': cubeVariant(),
  '4d': hypercubeVariant(),
};

export function startPosition(id) {
  const variant = VARIANTS[id];
  if (!variant) throw new Error(`unknown variant "${id}"`);
  return fromFen(variant.start, variant);
}

export function loadFen(fen, id) {
  return fromFen(fen, VARIANTS[id]);
}
