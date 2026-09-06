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
export function step(shape, coord, vector, times = 1) {
  const next = new Array(shape.length);
  for (let axis = 0; axis < shape.length; axis++) {
    next[axis] = coord[axis] + vector[axis] * times;
    if (next[axis] < 0 || next[axis] >= shape[axis]) return -1;
  }
  return toIndex(shape, next);
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

  kingIndex(color) {
    return this.find(withColor('k', color));
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
