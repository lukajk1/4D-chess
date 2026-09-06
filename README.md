# n-dimensional chess

Chess generalised over any number of dimensions. A 1×8 strip, an ordinary 8×8
board, and a 4×4×4×4 hypercube are the *same engine* with a different shape —
no per-variant move code.

Vanilla JavaScript and ES modules, with no build step. The engine has no
dependencies at all; the spatial viewer uses three.js, loaded through an import
map rather than a bundler.

```bash
npm install # three.js, for the 3D/4D viewer only
npm start   # serves http://localhost:5173
npm test    # move generator test suite
```

## The idea

A piece is defined by **how many axes its step vector touches**, not by a
hardcoded list of directions. Everything else falls out of the board shape.

| Piece | Rule | 1D | 2D | 3D | 4D |
|---|---|---|---|---|---|
| Rook | slide, exactly **1** axis ±1 | 2 | 4 | 6 | 8 |
| Bishop | slide, exactly **2** axes ±1 | 0 | 4 | 12 | 24 |
| Unicorn | slide, exactly **3** axes ±1 | 0 | 0 | 8 | 32 |
| Balloon | slide, exactly **4** axes ±1 | 0 | 0 | 0 | 16 |
| Queen | slide, **any** axes ±1 | 2 | 8 | 26 | 80 |
| King | one step, **any** axes ±1 | 2 | 8 | 26 | 80 |
| Knight | leap {1,2} on 2 distinct axes | 0 | 8 | 24 | 48 |

King and queen ray counts are 3ⁿ−1, as they should be.

This is why 1D chess needs no special case: bishops and knights have **zero**
legal vectors when there aren't two distinct axes to move along, and the queen
collapses onto the rook. Kings and rooks on a strip is simply what the geometry
leaves standing.

A pawn advances one square along the forward axis and captures one square
forward while also shifting by one on exactly one *other* axis — the familiar
two diagonals in 2D, six capture squares in 4D.

## Notation

Positions serialise to an n-dimensional FEN:

```
<shape> <placement> <turn> <castling> <en-passant> <halfmove> <fullmove>
```

Placement nests by axis. Squares along axis 0 are written directly; slices
along axis 1 are joined by `/`, along axis 2 by `//`, along axis 3 by `///`.
Axis 0 runs ascending (files a, b, c …) and every higher axis runs descending.

That ordering is chosen so **the 2D case is byte-for-byte ordinary FEN**:

```
1D strip    8 KR4rk w - - 0 1
2D chess    8x8 rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
```

Any standard FEN string works by prefixing `8x8 `. Square names follow the same
principle: `a` in 1D, `e4` in 2D, `e4:2:3` once there are more axes.

## Correctness

The 2D generator is verified by [perft](https://www.chessprogramming.org/Perft)
against published node counts — this is the check that catches castling,
en-passant, promotion and pin bugs:

| Depth | Nodes | |
|---|---|---|
| 4 | 197,281 | ✓ |
| 5 | 4,865,609 | ✓ |

Kiwipete and the rook-endgame position are also covered, plus 1D-specific
cases. `npm test` runs everything except the two slowest perft depths.

## Layout

```
src/core/geometry.js   step-vector generation from dimension count
src/core/position.js   coordinates, board state, cloning
src/core/pieces.js     piece definitions as vector rules
src/core/movegen.js    legal moves, check, castling, en passant, perft
src/core/notation.js   n-dimensional FEN, square names
src/variants.js        board shapes and starting positions
src/ui/board.js        1D/2D boards and n-D slice grids
src/ui/spatial-gl.js   WebGL lattice viewer (three.js)
```

`src/core` has no DOM dependency, no three.js dependency, and runs under plain
Node. The 4D -> 3D projection lives in the viewer, not the engine: three.js is
only ever handed 3D coordinates.

## Adding a dimension

A variant is data. 3D and 4D need an entry in `src/variants.js` giving the
shape and a starting FEN — the move generator already handles them. The
remaining work is presentation: rendering more than two axes means drawing
slices or a projection, which is a UI problem, not an engine one.

## Status

1D and 2D are complete and playable, with legal move generation.

3D (8x8x8, 512 positions) and 4D (8x8x8x8, 4,096 positions) exist as position
explorers only: the lattice renders and every square is inspectable, but pieces
do not move there yet.

### Why the viewer is WebGL

The first spatial viewer built one SVG element per position. Measured on an
8x8x8x8 lattice it reached 8,355 SVG nodes and ~26 ms per frame (~38 fps) while
orbiting -- and that was with an *empty* board, before pieces were added.

The WebGL viewer draws the same scene in 2-3 draw calls:

| | SVG | WebGL |
|---|---|---|
| DOM nodes (4D) | 8,355 | 56 |
| Frame time (4D) | 26.4 ms | 0.1 ms |
| Orbit (4D) | ~38 fps | 60 fps (vsync) |

Pieces are drawn as billboarded quads sampling a glyph atlas built on a canvas,
so all 232 of them cost one draw call.
