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
//   4D  Dγe4       w-depth (capital), layer, file, rank
//   5D  v_2Dγe4    v-depth (named axis), w-depth, layer, file, rank
//
// The fifth axis is where the alphabets run out. Rather than pick a fourth one
// nobody can type, v is named outright and carries its coordinate as a digit:
// "v_2" is unambiguous, survives a round trip through the FEN field, and reads
// as a coordinate rather than as a rank that wandered to the front. Any axis
// beyond the fifth falls back to a ":n" suffix, which is where this stops
// pretending to be readable.
//
// Capitals count w and Greek letters count z. Both are plain coordinates, so
// there are n of each. The viewer's eight "cells" are a different thing -- the
// tesseract's boundary cubes, always eight of them however wide the board --
// and nothing here indexes those, so the words are kept apart on purpose.
// "Cube" would not have separated them either: every w slice is a cube, so is
// every z stack, and so is every one of the eight cells.
export const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω';
export const W_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const W_ROMAN = [
  'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii',
  'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi',
  'xvii', 'xviii', 'xix', 'xx', 'xxi', 'xxii', 'xxiii', 'xxiv', 'xxv', 'xxvi',
];

// Named-axis prefixes for everything past w, in axis order from axis 4 up.
// Underscore rather than a Unicode subscript so the name can be typed back in.
export const AXIS_NAMES = ['v', 'u', 't'];
export const axisPrefix = (axis, value) => `${AXIS_NAMES[axis - 4]}_${value + 1}`;

export const layerName = (z) => GREEK[z];
export const wName = (w) => W_ROMAN[w] ?? String(w + 1);

export function squareName(shape, index) {
  const coord = toCoord(shape, index);
  if (shape.length === 1) return FILES[coord[0]];
  let name = FILES[coord[0]] + (coord[1] + 1);
  if (shape.length >= 3) name = GREEK[coord[2]] + name;
  if (shape.length >= 4) name = wName(coord[3]) + name;
  // Named axes stack on the front like the others, highest axis outermost, so
  // a name still reads outside-in: v, then w, then z, then file and rank.
  for (let axis = 4; axis < shape.length; axis++) {
    if (axis - 4 < AXIS_NAMES.length) name = axisPrefix(axis, coord[axis]) + name;
    else name += ':' + (coord[axis] + 1);
  }
  return name;
}

export function parseSquare(shape, name) {
  const [full, ...rest] = name.split(':');
  const coord = new Array(shape.length).fill(0);
  // Strip the named prefixes off the front before the older branches run, so
  // everything below still sees the 1D-to-4D name it was written to parse.
  let head = full;
  for (let axis = shape.length - 1; axis >= 4; axis--) {
    if (axis - 4 >= AXIS_NAMES.length) continue;
    const tag = AXIS_NAMES[axis - 4] + '_';
    if (!head.startsWith(tag)) continue;
    // Read the digits by hand rather than through a built regex: the escaping
    // needed to get \d into a template literal is exactly the sort of thing
    // that silently matches a literal "d" instead.
    let end = tag.length;
    while (end < head.length && head[end] >= '0' && head[end] <= '9') end++;
    if (end === tag.length) continue;
    coord[axis] = Number(head.slice(tag.length, end)) - 1;
    head = head.slice(end);
  }
  if (shape.length >= 4) {
    let greekPos = -1;
    for (let j = 0; j < head.length; j++) {
      if (GREEK.includes(head[j])) {
        greekPos = j;
        break;
      }
    }
    if (greekPos > 0) {
      const wPart = head.slice(0, greekPos).toLowerCase();
      let wIdx = W_ROMAN.indexOf(wPart);
      if (wIdx === -1) wIdx = W_LETTERS.indexOf(head.slice(0, greekPos));
      coord[3] = wIdx >= 0 ? wIdx : parseInt(wPart, 10) - 1;
      coord[2] = GREEK.indexOf(head[greekPos]);
      coord[0] = FILES.indexOf(head[greekPos + 1]);
      coord[1] = parseInt(head.slice(greekPos + 2), 10) - 1;
    }
  } else if (shape.length === 3) {
    coord[2] = GREEK.indexOf(head[0]);
    coord[0] = FILES.indexOf(head[1]);
    coord[1] = parseInt(head.slice(2), 10) - 1;
  } else if (shape.length === 2) {
    coord[0] = FILES.indexOf(head[0]);
    coord[1] = parseInt(head.slice(1), 10) - 1;
  } else if (shape.length === 1) {
    coord[0] = FILES.indexOf(head[0]);
  }
  const suffixAxis = 4 + AXIS_NAMES.length;
  rest.forEach((part, k) => { coord[suffixAxis + k] = parseInt(part, 10) - 1; });
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
