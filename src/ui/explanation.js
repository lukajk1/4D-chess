// Content for the explanation dialog, kept in its own module so it is fetched
// the first time the dialog is opened rather than on page load. Nothing here
// runs; it is a string, and app.js imports it dynamically.
//
// Places marked with a comment are where embedded 3D visuals will go.

export const explanationHTML = `
  <h1>WTF am I looking at?</h1>

  <p>Chess in four spatial dimensions, of course.</p>

  <p>Standard chess is played on a two-dimensional grid. To create 3D
  chess we stack eight of those grids along a new axis — upwards — getting a
  chess <strong>cube</strong>. Stacking eight cubes along another new axis —
  inwards<span class="explain-mark">*</span> — results in a chess
  <strong>tesseract</strong>, a figure that is to 4D as a cube is to 3D. The
  whole group of these objects, whose construction generalises to any number of
  dimensions, are called <em>hypercubes</em>.</p>

  <figure class="explain-figure" data-visual="family"
    data-alt="A square, a cube and a tesseract, each rotating.">
    <figcaption>Each one is the one before it dragged along a new axis. The
    square is turning in its only plane; the cube and the tesseract are turning
    in planes the figure below them does not have.</figcaption>
  </figure>

  <p>A full chess tesseract has dimensions 8×8×8×8 — 4,096 spaces in total.
  This is pretty unwieldy and a bit visually messy, so the default view is a
  pared-down 4×4×4×4 board of 256 positions, which is still plenty
  overwhelming. A proper chess tesseract is available for viewing and play from
  the board dropdown at the top of the main view.</p>

  <p class="explain-note"><span class="explain-mark">*</span> This axis is
  completely invisible to 3D Cartesian space, so it is more like just…
  <em>away</em>, or along a new distinct axis.</p>

  <h2>Is this really accurate if it's displayed on a 2D screen?</h2>

  <p>Somewhat unintuitively, yes. Just as we can interpret a cube spinning on a
  2D screen just fine, a 4D being would be able to see this as a 4D object
  spinning, even though it has been projected down by two dimensions. All the
  rotation and perspective-projection maths we use to display 3D vertices on 2D
  screens generalises perfectly to higher spatial dimensions.</p>

  <p>A 2D person viewing our 3D→2D projection on a 2D surface only sees
  <em>what should be solid squares shifting around in size and deforming</em>,
  but as 3D-oriented people we parse it as a 3D rotation without effort. A
  4D→3D projection is just as unintelligible to us: when a tesseract rotates in
  4D space we can only interpret it as <em>what should be solid cubes shifting
  around in size and deforming</em> — but a 4D being would understand it just
  fine.</p>

  <figure class="explain-figure" data-visual="deform"
    data-alt="A rotating cube with one face marked, and a rotating tesseract
      with one of its eight cubes marked.">
    <figcaption>The marked face never changes shape; the marked cube never
    changes size. Both are rigid, and neither looks it, because in each case
    you are one dimension short of the room they are turning in.</figcaption>
  </figure>

  <h2>Folding and unfolding</h2>

  <!-- Visual: the 3D→2D and 4D→3D unwrapping animations, side by side. -->

  <p>Much like a cube is constructed out of six squares folded up into the
  third dimension, a tesseract is constructed out of eight cubes folded up into
  the fourth. The <strong>Fold</strong> control in the space-manipulation panel
  runs that folding in reverse, hinge by hinge.</p>

  <h2>More analogies</h2>

  <p>Just as a projection of a cube to 2D looks like a smaller square inscribed
  in a bigger square, a projection of a tesseract to 3D looks like a smaller
  cube inscribed in a bigger cube. In both cases we are looking <em>through</em>
  the axis that does not exist one dimension lower: z, in the case of a cube
  projected to 2D, and w, in the case of a tesseract projected to 3D.</p>

  <figure class="explain-figure" data-visual="nesting"
    data-alt="A cube seen along z, drawn as a square inside a square, and a
      tesseract seen along w, drawn as a cube inside a cube.">
    <figcaption>Neither inner shape is smaller than its outer one. They are the
    far side of the same figure, and they look small for the reason anything far
    away does.</figcaption>
  </figure>

  <h2>Can we have chess in even higher dimensions?</h2>

  <p>Yes, it works perfectly fine — we have long since abandoned any semblance
  of making an actually interesting game from a design perspective. I considered
  adding a 5D board, but from previous experiments I know the visualisation is a
  bit underwhelming: just a larger mess of wireframe lines, cuboids and
  squares.</p>
`;
