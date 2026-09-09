import { fromFen, parseSquare, toFen } from './core/notation.js';
import { Position } from './core/position.js';

// Back ranks by board width. Kings and queens sit only on the middle layers,
// so each side fields one of each per cube rather than one per layer.
const BACK_RANKS = {
  4: { royal: 'BQKB', plain: 'R..R' },
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
  // The 3D game pulled apart along w: black occupies w = 1 and white occupies
  // w = n. The nested projection enlarges the high-w side, so the first-moving
  // white army also receives the visually easier targets.
  const royalLayers = layoutArmies(n, (x, y, z, piece) => {
    const white = piece === piece.toUpperCase();
    // layoutArmies mirrors black across y so the two sides face along y. Here
    // they face along w instead, so undo that mirror: both armies share one
    // (x, y, z) footprint and differ only in w, putting the entire separation
    // on the single axis being pulled apart -- as e1 and e8 share a file.
    pos.set(pos.index([x, white ? y : n - 1 - y, z, white ? n - 1 : 0]), piece);
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
        pos.set(pos.index([x, 0, z, n - 2]), 'P');
        pos.set(pos.index([x, 0, z, 1]), 'p');
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
    ...(pawnsAlongW && {
      forwardAxis: 3,
      forwardDirection: { w: -1, b: 1 },
      pawnRank: { w: n - 2, b: 1 },
    }),
    blurb: `${n} × ${n} × ${n} × ${n} · ${(n ** 4).toLocaleString()} positions · Eight cells, one lattice`,
    castling: [],
    start: toFen(pos),
  };
}

// 3^5. Experimental, and the first board too narrow for layoutArmies: three
// files leave no room for a back rank, so the army is placed by hand.
//
// The two sides are separated along v -- the newest axis, and the one worth
// making the game about -- so v is also the forward axis and the pawns advance
// along it. That leaves all four of x, y, z, w free for the diagonal captures,
// and means a pawn's every capture direction crosses an axis the 4D board did
// not have to offer.
function pentaVariant(n = 3) {
  const pos = new Position({ shape: [n, n, n, n, n] });
  const mid = (n - 1) / 2;

  // Royals on the middle file of the middle layer, so both armies sit in the
  // centre of their own v slice and neither starts closer to an edge. The rook
  // goes beside the king rather than behind it: with only three files there is
  // no behind.
  const place = (x, y, z, piece) => {
    pos.set(pos.index([x, y, z, mid, n - 1]), piece);
    pos.set(pos.index([x, y, z, mid, 0]), piece.toLowerCase());
  };
  place(mid, 0, mid, 'K');
  place(mid, 1, mid, 'Q');
  place(0, 0, mid, 'R');

  // No pawns. Three v slices leave no room for them: a pawn one step in front
  // of its own king stands on the middle slice, which is also one step in front
  // of the enemy king, and a pawn captures diagonally forward -- so both kings
  // would start in check from the other side's pawns, and 3^5 has no third
  // rank to back them off to. Pawns arrive when n reaches 5.
  //
  // What is left is a genuine game rather than a placeholder: king, queen and
  // rook apiece on a 243-square board, with the queen sliding along all ten
  // planes and the rook along all five axes.

  return {
    id: `5d-${n}`,
    name: `5D chess (${n}⁵)`,
    shape: pos.shape,
    inspectionOnly: true,
    royalLayers: [mid],
    // Declared even with no pawns on the board: a promotion cannot happen here,
    // but anything that asks which way is forward should be told v, not y.
    forwardAxis: 4,
    forwardDirection: { w: -1, b: 1 },
    blurb: `${n} × ${n} × ${n} × ${n} × ${n} · ${(n ** 5).toLocaleString()} positions · Experimental`,
    castling: [],
    start: toFen(pos),
  };
}

// ---------------------------------------------------------------------------
// The 4^4 board, laid out square by square rather than by BACK_RANKS.
// hypercubeVariant(n) still generates the 8-wide board; this one is placed by
// hand because the 4-wide layout is a deliberate arrangement rather than the
// generated one, in the same spirit as pentaVariant. Coordinates are written
// 1-based and converted on the way in, so the tables below read against the
// square names the UI shows rather than against raw indices.
//
// Each colour is written out in full, without deriving one from the other. The
// two are near-reflections, but spelling both out means the layout can be read
// straight off the page and either side edited on its own.
//
// White holds the two outer w layers, w = 4 and w = 3, on files x = 1 and 2.
// Black holds the two inner ones, w = 1 and w = 2, on files x = 4 and 3.
// ---------------------------------------------------------------------------
function hypercubeFourVariant() {
  const n = 4;
  const pos = new Position({ shape: [n, n, n, n] });
  // The tables count from 1 on every axis; the board counts from 0.
  const put = (x, y, z, w, piece) => pos.set(pos.index([x - 1, y - 1, z - 1, w - 1]), piece);

  // Back ranks, one row per z, read y = 1 to y = 4. Same shape as
  // BACK_RANKS[4]: the outer z layers carry rooks and knights, the middle ones
  // the bishops, and z = 3 holds the king and queen.
  const WHITE_RANKS = { 1: 'RNNR', 2: 'BPPB', 3: 'BKQB', 4: 'RNNR' };
  const BLACK_RANKS = { 1: 'rnnr', 2: 'bppb', 3: 'bkqb', 4: 'rnnr' };

  // White: back rank on x = 1 of w = 4, pawn screen on x = 2 of w = 4 and on
  // both files of w = 3. Each pawn block fills its whole (y, z) plane.
  for (const [z, rank] of Object.entries(WHITE_RANKS)) {
    for (let y = 1; y <= n; y++) put(1, y, Number(z), 4, rank[y - 1]);
  }
  for (let y = 1; y <= n; y++) {
    for (let z = 1; z <= n; z++) {
      put(2, y, z, 4, 'P');
      put(1, y, z, 3, 'P');
      put(2, y, z, 3, 'P');
    }
  }

  // Black: the same arrangement on the far files and the inner w layers.
  for (const [z, rank] of Object.entries(BLACK_RANKS)) {
    for (let y = 1; y <= n; y++) put(4, y, Number(z), 1, rank[y - 1]);
  }
  for (let y = 1; y <= n; y++) {
    for (let z = 1; z <= n; z++) {
      put(3, y, z, 1, 'p');
      put(4, y, z, 2, 'p');
      put(3, y, z, 2, 'p');
    }
  }

  return {
    id: '4d-4',
    name: `4D chess (${n}⁴)`,
    shape: pos.shape,
    royalLayers: [2],
    forwardAxis: 0,
    forwardDirection: { w: 1, b: -1 },
    pawnRank: { w: 1, b: 2 },
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
  // Eight layers stack twice as tall as four, so this one board halves the
  // vertical step to keep them in frame. Declared here rather than inferred
  // from the shape, so no other board is affected by it.
  '3d': { ...cubeVariant(8), verticalSpacing: .5 },
  '4d-4': hypercubeFourVariant(),
  // Eight w cells subdivide each z interval eight ways rather than four, so the
  // planes crowd; a third again of vertical step separates them. Same knob the
  // 8-cube uses, and like it, declared only on the board that wants it.
  '4d': { ...hypercubeVariant(8), verticalSpacing: 1.35 },
  '5d-3': pentaVariant(3),
};

export function startPosition(id) {
  const variant = VARIANTS[id];
  if (!variant) throw new Error(`unknown variant "${id}"`);
  return fromFen(variant.start, variant);
}

export function loadFen(fen, id) {
  return fromFen(fen, VARIANTS[id]);
}
