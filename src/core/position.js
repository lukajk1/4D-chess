// A position is a flat array of squares plus the shape that gives it meaning.
// Axis 0 varies fastest (files), axis 1 next (ranks), and so on.

export const WHITE = 'w';
export const BLACK = 'b';

export const sizeOf = (shape) => shape.reduce((a, b) => a * b, 1);
export const colorOf = (piece) => (piece === null ? null : piece === piece.toUpperCase() ? WHITE : BLACK);
export const typeOf = (piece) => (piece === null ? null : piece.toLowerCase());
export const opposite = (color) => (color === WHITE ? BLACK : WHITE);
export const withColor = (type, color) => (color === WHITE ? type.toUpperCase() : type.toLowerCase());

export function toIndex(shape, coord) {
  let index = 0;
  let stride = 1;
  for (let axis = 0; axis < shape.length; axis++) {
    index += coord[axis] * stride;
    stride *= shape[axis];
  }
  return index;
}

export function toCoord(shape, index) {
  const coord = new Array(shape.length);
  let rest = index;
  for (let axis = 0; axis < shape.length; axis++) {
    coord[axis] = rest % shape[axis];
    rest = Math.floor(rest / shape[axis]);
  }
  return coord;
}

export function inBounds(shape, coord) {
  for (let axis = 0; axis < shape.length; axis++) {
    if (coord[axis] < 0 || coord[axis] >= shape[axis]) return false;
  }
  return true;
}

// Returns the destination index, or -1 when the step leaves the board.
// The single hottest call in the engine -- every ray of every piece walks
// through it, thousands of times per move generation. It used to build a
// coordinate array and hand it to toIndex; folding the index arithmetic into
// the bounds loop gives the same answer with nothing allocated.
export function step(shape, coord, vector, times = 1) {
  let index = 0;
  let stride = 1;
  for (let axis = 0; axis < shape.length; axis++) {
    const value = coord[axis] + vector[axis] * times;
    if (value < 0 || value >= shape[axis]) return -1;
    index += value * stride;
    stride *= shape[axis];
  }
  return index;
}

export class Position {
  constructor({ shape, squares, turn = WHITE, castling = [], ep = null, halfmove = 0, fullmove = 1, variant = null }) {
    this.shape = shape;
    this.dims = shape.length;
    this.squares = squares ?? new Array(sizeOf(shape)).fill(null);
    this.turn = turn;
    this.castling = castling;   // ids of castling rights still available
    this.ep = ep;               // index a pawn may capture onto, or null
    this.halfmove = halfmove;
    this.fullmove = fullmove;
    this.variant = variant;
  }

  get(index) { return this.squares[index]; }
  set(index, piece) { this.squares[index] = piece; }
  coord(index) { return toCoord(this.shape, index); }
  index(coord) { return toIndex(this.shape, coord); }

  find(piece) {
    return this.squares.indexOf(piece);
  }

  // Remembered between calls. Legality testing asks for this once per
  // candidate move, and indexOf over the whole board each time is the single
  // most repeated scan in the engine. The guard re-reads one square to confirm
  // the king is still where it was, so the cache stays correct across an
  // applyMove/undoMove pair without either of them having to maintain it.
  kingIndex(color) {
    const piece = withColor('k', color);
    const cached = this._kings?.[color];
    if (cached !== undefined && this.squares[cached] === piece) return cached;
    const index = this.find(piece);
    (this._kings ??= {})[color] = index;
    return index;
  }

  clone() {
    return new Position({
      shape: this.shape,
      squares: this.squares.slice(),
      turn: this.turn,
      castling: this.castling.slice(),
      ep: this.ep,
      halfmove: this.halfmove,
      fullmove: this.fullmove,
      variant: this.variant,
    });
  }
}
