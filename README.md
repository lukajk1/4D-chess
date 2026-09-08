# n-dimensional chess

Chess generalised over any number of dimensions. A 1×8 strip, an ordinary 8×8
board, and a 4×4×4×4 hypercube are the *same engine* with a different shape —
no per-variant move code.

Vanilla JavaScript and ES modules, with no build step. The engine has no
dependencies at all; the spatial viewer uses three.js, loaded through an import
map rather than a bundler.

```bash
npm start   # serves http://localhost:5173
npm test    # move generator test suite
```

## Deploying

There is no build step and nothing to install. Every file the browser needs is
committed, so the repository *is* the deployable site — copy it to any static
host and open `index.html`:

```bash
# GitHub Pages, Netlify, S3, nginx, python -m http.server ... all work as-is
```

Two things make that true, and both are easy to break:

- **three.js is vendored**, not pulled from `node_modules` (which is
  git-ignored) or a CDN. The renderer, controls, and GLB loader are included — see
  `scripts/vendor-three.js`, and re-run `npm run vendor` after upgrading three.
  `three.module.min.js` imports `./three.core.min.js` as a sibling, so those two
  must stay side by side.
- **The import map uses relative paths.** Absolute ones would 404 on any host
  that serves the site from a subpath, which includes GitHub Pages project
  sites at `user.github.io/repo/`.

`npm install` is only needed to re-vendor three or to work on the dependency
itself; `server.js` is a convenience for local development, not a requirement.

**`server.js` is not a deployment target.** Vercel and the like have no
persistent Node process, so nothing runs it — and nothing needs to. Configuring
a host to "use Node" for this repo asks it to do something the repo does not
want. `vercel.json` pins the honest description instead:

```json
{ "framework": null, "buildCommand": null, "outputDirectory": "." }
```

No framework, no build, serve the repo root. On Vercel the dashboard equivalents
are Framework Preset **Other**, Build Command **off**, Output Directory **`.`**;
`vercel.json` overrides those, so it is the one place to change them.

`three` is a devDependency, not a dependency: the site loads `vendor/three/`,
and `node_modules/three` exists only to re-vendor from.

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

Any standard FEN string works by prefixing `8x8 `.

Square names gain one prefix per extra axis, each from a different alphabet so
they never need separators:

| dims | example | reads as |
|---|---|---|
| 1D | `e` | file |
| 2D | `e4` | file, rank |
| 3D | `γe4` | layer γ (the third board), e4 |
| 4D | `ivγe4` | w-depth iv, layer γ, e4 |

Roman numerals count w and Greek letters count z, so `i` is the first w-depth and `α`
the first board in the z stack. Both are plain coordinates: there are n of each.
The viewer's eight **cells** are something else — the tesseract's boundary
cubes, always eight of them however wide the board — and the notation never
indexes those. (Calling the w prefix a "cube" would not have helped: every w
slice is a cube, so is every z stack, and so is every one of the eight cells.)

Each level of the hierarchy uses a distinct character class — Roman numerals, Greek,
lowercase, digits — which is what lets `ivγe4` parse without punctuation.
Roman numerals are separated from the file letters by the intervening Greek layer,
and each layer remains distinct.

In 4D the armies sit in the two w-extreme cells: white's half of the 3D setup in
the interior cube (w = 1), black's in the outer cube (w = n), facing each other
across the fourth axis with open board between.

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

The **4D -> 3D** control picks how w reaches three dimensions. *Nested* is a
Schlegel diagram: w becomes distance from a 4D camera on the w axis, so the
cells nest and radius carries w. *Oblique* is a parallel projection: w becomes a
fixed diagonal offset, so every cell keeps its true size and the w-extreme cubes
sit corner to corner joined by slanted edges -- the drawing most people picture
when they picture a tesseract. The step is a little over half a square per w,
the cabinet convention; cavalier, at a full square, smears an 8-wide board past
reading. It is a separate control from the 3D camera because the choices are
independent: either 4D projection can be viewed through either camera.

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

Selecting a piece draws its **envelope** -- every cell it could reach on an
empty board. `envelope()` in `movegen.js` deliberately ignores occupancy: rays
run to the edge rather than stopping at the first piece, so this is the shape
of a piece's reach, not a list of its legal moves. It is dimension-generic like
everything else, so a 4D rook gets its 8 axis rays and a queen its 80. The
largest envelope on any board here is a centred 8-cube queen at 255 cells.

A cell is drawn as a box rather than a marked point, because a lattice point is
the middle of a cell's floor -- it is where a piece model stands -- so the box
runs half a square either side in x and y and a whole layer upward in z. Its
corners are fractional board coordinates pushed through the same projection as
the lattice, so the boxes fold, unfold, rotate and take the w perspective along
with it. A **Reach** toggle switches that box for a ring on the point itself,
which stays legible where a couple of hundred boxes merge into one mass.
Selecting an empty point rings it too, in the selection colour a size up.

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

The main spatial viewer defaults to 3D pieces and offers a **3D / Glyphs** toggle. 3D mode loads the
six GLB pieces in `assets/chess/` and instances each type with per-piece colours.
Models preserve their relative sizes and sit with their bases on lattice points.
Clicking picks off the model geometry itself, so the head of a king is as good a
target as its foot and the lattice point under a piece is no longer a separate
one; a selected piece is ringed by an inverted hull -- the same mesh welded,
re-normalled, grown along its normals and drawn back faces only -- which reaches
individual instances where a postprocessing outline pass could not. Empty points
keep the halo.
Unfolding ghost copies use translucent instances of the same models; auxiliary
views retain glyphs. If a model cannot load, its pieces retain their glyphs. The set was extracted from the supplied Pia Leung
GLB; see `assets/chess/README.md` for provenance and triangle counts.

A **Background** dropdown picks between the page colour, a soft off-white, and
a cloudy skybox. The skybox ships as the single 4x3 cross PNG it was downloaded
as and is cut into six cube faces at load time by `src/ui/skybox.js`, fetched
only when it is chosen. See `assets/skybox/README.md` for provenance.
