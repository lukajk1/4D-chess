import { Position, toCoord, toIndex, sizeOf } from './position.js';

// ---------------------------------------------------------------------------
// N-dimensional FEN
//
//   <shape> <placement> <turn> <castling> <ep> <halfmove> <fullmove>
//
// Placement nests by axis: squares along axis 0 are written directly, slices
// along axis 1 are joined by "/", along axis 2 by "//", along axis 3 by "///".
// Axis 0 runs ascending (files a, b, c ...); every higher axis runs descending,
// so an 8x8 board writes rank 8 first and the placement field is byte-for-byte
// identical to ordinary FEN.
//
//   1x8 strip   8 KR4rk w - - 0 1
//   8x8 chess   8x8 rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
// ---------------------------------------------------------------------------

const FILES = 'abcdefghijklmnopqrstuvwxyz';

// Square names gain one prefix per extra axis, each from a different alphabet
// so they never need separators and parse unambiguously:
//
//   1D  e          file
//   2D  e4         file, rank
//   3D  γe4        layer (Greek), file, rank
//   4D  Dγe4       cell (capital), layer, file, rank
//
// Capitals count w, so A is the interior cube and the last letter the outer one
// -- the first and last cells of the tesseract. Layers are the z slices, so α
// is the first board in the stack.
export const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω';
// Uppercase against the lowercase files, so a cell letter and a file letter can
// never be confused however wide the board gets. One character per cell keeps
// every square name the same length, which Roman numerals did not.
export const CELLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const layerName = (z) => GREEK[z];
export const cellName = (w) => CELLS[w];

export function squareName(shape, index) {
  const coord = toCoord(shape, index);
  if (shape.length === 1) return FILES[coord[0]];
  let name = FILES[coord[0]] + (coord[1] + 1);
  if (shape.length >= 3) name = GREEK[coord[2]] + name;
  if (shape.length >= 4) name = CELLS[coord[3]] + name;
  // Beyond four axes there is no obvious alphabet left; fall back to suffixes.
  for (let axis = 4; axis < shape.length; axis++) name += ':' + (coord[axis] + 1);
  return name;
}

export function parseSquare(shape, name) {
  const [head, ...rest] = name.split(':');
  const coord = new Array(shape.length).fill(0);
  let i = 0;
  if (shape.length >= 4) coord[3] = CELLS.indexOf(head[i++]);
  if (shape.length >= 3) coord[2] = GREEK.indexOf(head[i++]);
  coord[0] = FILES.indexOf(head[i++]);
  if (shape.length > 1) coord[1] = parseInt(head.slice(i), 10) - 1;
  rest.forEach((part, k) => { coord[4 + k] = parseInt(part, 10) - 1; });
  return toIndex(shape, coord);
}

function separator(axis) { return '/'.repeat(axis); }

function formatPlacement(shape, squares) {
  const emit = (axis, fixed) => {
    if (axis === 0) {
      let row = '';
      let empty = 0;
      for (let x = 0; x < shape[0]; x++) {
        const piece = squares[toIndex(shape, [x, ...fixed])];
        if (piece === null) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += piece;
      }
      return empty ? row + empty : row;
    }
    const parts = [];
    for (let v = shape[axis] - 1; v >= 0; v--) {
      const next = fixed.slice();
      next[axis - 1] = v;
      parts.push(emit(axis - 1, next));
    }
    return parts.join(separator(axis));
  };
  // `fixed` holds coordinates for axes 1..n-1, indexed one lower.
  return emit(shape.length - 1, new Array(Math.max(0, shape.length - 1)).fill(0));
}

function parsePlacement(shape, text) {
  const squares = new Array(sizeOf(shape)).fill(null);

  const consume = (axis, chunk, fixed) => {
    if (axis === 0) {
      let x = 0;
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];
        if (/\d/.test(ch)) {
          let digits = ch;
          while (i + 1 < chunk.length && /\d/.test(chunk[i + 1])) digits += chunk[++i];
          x += parseInt(digits, 10);
        } else {
          squares[toIndex(shape, [x, ...fixed])] = ch;
          x++;
        }
      }
      if (x !== shape[0]) throw new Error(`row "${chunk}" does not fill ${shape[0]} squares`);
      return;
    }
    const pattern = new RegExp(`(?<!/)/{${axis}}(?!/)`);
    const parts = chunk.split(pattern);
    if (parts.length !== shape[axis]) {
      throw new Error(`expected ${shape[axis]} slices on axis ${axis}, found ${parts.length}`);
    }
    parts.forEach((part, i) => {
      const next = fixed.slice();
      next[axis - 1] = shape[axis] - 1 - i;
      consume(axis - 1, part, next);
    });
  };

  consume(shape.length - 1, text, new Array(Math.max(0, shape.length - 1)).fill(0));
  return squares;
}

export function toFen(pos) {
  const shape = pos.shape.join('x');
  const placement = formatPlacement(pos.shape, pos.squares);
  const castling = pos.castling.length ? pos.castling.join('') : '-';
  const ep = pos.ep === null ? '-' : squareName(pos.shape, pos.ep);
  return `${shape} ${placement} ${pos.turn} ${castling} ${ep} ${pos.halfmove} ${pos.fullmove}`;
}

export function fromFen(fen, variant = null) {
  const [shapeText, placement, turn = 'w', castling = '-', ep = '-', halfmove = '0', fullmove = '1'] = fen.trim().split(/\s+/);
  const shape = shapeText.split('x').map(Number);
  if (shape.some((n) => !Number.isInteger(n) || n < 1)) throw new Error(`bad shape "${shapeText}"`);
  return new Position({
    shape,
    squares: parsePlacement(shape, placement),
    turn,
    castling: castling === '-' ? [] : castling.split(''),
    ep: ep === '-' ? null : parseSquare(shape, ep),
    halfmove: Number(halfmove),
    fullmove: Number(fullmove),
    variant,
  });
}

// Long algebraic: from-square, to-square, optional promotion letter.
export function moveToText(shape, move) {
  return squareName(shape, move.from) + squareName(shape, move.to) + (move.promotion ?? '');
}

export function findMove(moves, shape, text) {
  return moves.find((move) => moveToText(shape, move) === text) ?? null;
}
