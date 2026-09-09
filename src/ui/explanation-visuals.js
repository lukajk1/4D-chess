// Wireframe hypercubes for the explanation dialog.
//
// Once the pieces, models and lighting come out, the board view is a line
// drawing of a projection -- which is all these figures need to be, so they run
// on a plain 2D canvas rather than standing three more WebGL contexts up inside
// a modal. The projection itself is the board's: divide each axis above the
// second away in turn, highest first.

// Eye distance along each axis that gets divided away. Axes 0 and 1 survive to
// the screen and never use theirs. w sits closer than z, because the nesting a
// close eye produces is the thing these pictures are about.
const DISTANCES = [0, 0, 4.4, 3.1];

const LABEL_SIZE = 12;

// 2^n vertices at every combination of +-1, with an edge wherever two of them
// differ in exactly one coordinate. The same construction at every n, which is
// the point being illustrated.
function hypercube(n) {
  const vertices = [];
  for (let i = 0; i < (1 << n); i++) {
    const v = new Float64Array(n);
    for (let axis = 0; axis < n; axis++) v[axis] = (i >> axis) & 1 ? 1 : -1;
    vertices.push(v);
  }
  const edges = [];
  for (let i = 0; i < vertices.length; i++) {
    for (let axis = 0; axis < n; axis++) {
      const j = i ^ (1 << axis);
      if (j > i) edges.push([i, j]);
    }
  }
  return { n, vertices, edges };
}

// A rotation is a plane, not an axis -- that is the part that does not survive
// the move up from 3D, where every plane happens to have a perpendicular axis
// to name it by. Each entry is [axisA, axisB, turnsPerSecond, phase].
function pose(cube, planes, time, out) {
  for (let i = 0; i < cube.vertices.length; i++) {
    const v = out[i];
    v.set(cube.vertices[i]);
    for (const [a, b, speed, phase = 0] of planes) {
      const angle = time * speed + phase;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const va = v[a];
      const vb = v[b];
      v[a] = va * cos - vb * sin;
      v[b] = va * sin + vb * cos;
    }
  }
}

// n dimensions down to two. Each divide shrinks everything below it, so by the
// time z is dropped it has already been pulled about by w -- which is why a
// 4D rotation makes the cubes appear to deform rather than merely move.
// `depth` collects what was thrown away, and is all the line weight has to go on.
function toScreen(v, scale, cx, cy, out) {
  const p = out.p;
  for (let a = 0; a < v.length; a++) p[a] = v[a];
  let depth = 0;
  let dropped = 0;
  for (let a = v.length - 1; a >= 2; a--) {
    const k = DISTANCES[a] / (DISTANCES[a] - p[a]);
    for (let b = 0; b < a; b++) p[b] *= k;
    depth += p[a];
    dropped++;
  }
  out.x = cx + p[0] * scale;
  out.y = cy - p[1] * scale;
  // A square has nothing hidden behind anything, so it draws at full weight.
  out.depth = dropped ? depth / dropped : 1;
  return out;
}

const FIGURES = {
  // The family, each member turning in a plane the one before it does not have.
  family: {
    aspect: 2.9,
    panels: [
      { label: 'square (2D)', dims: 2, scale: .30, planes: [[0, 1, .30]] },
      { label: 'cube (3D)', dims: 3, scale: .28, planes: [[0, 2, .38], [1, 2, .23]] },
      { label: 'tesseract (4D)', dims: 4, scale: .23, planes: [[0, 2, .30], [2, 3, .44]] },
    ],
  },

  // One face of the cube and one cell of the tesseract, picked out so you can
  // watch the thing that is actually rigid refuse to look it.
  deform: {
    aspect: 2.0,
    panels: [
      { label: 'a cube, one face marked', dims: 3, scale: .27, highlight: 2, planes: [[0, 2, .36], [1, 2, .21]] },
      { label: 'a tesseract, one cube marked', dims: 4, scale: .22, highlight: 3, planes: [[0, 2, .17], [2, 3, .40]] },
    ],
  },

  // No rotation in the axis being divided away, so the nesting stays put and
  // reads as what it is: the far side of the figure, seen through the near one.
  nesting: {
    aspect: 2.0,
    panels: [
      { label: 'a cube down z: square in square', dims: 3, scale: .27, planes: [] },
      { label: 'a tesseract down w: cube in cube', dims: 4, scale: .23, planes: [[1, 2, 0, .34], [0, 2, .10, .55]] },
    ],
  },
};

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function mountVisuals(root) {
  const figures = [];

  for (const element of root.querySelectorAll('[data-visual]')) {
    const spec = FIGURES[element.dataset.visual];
    if (!spec) continue;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', element.dataset.alt ?? '');
    canvas.style.width = '100%';
    canvas.style.display = 'block';
    canvas.style.aspectRatio = String(spec.aspect);
    element.prepend(canvas);

    const panels = spec.panels.map((panel) => {
      const cube = hypercube(panel.dims);
      // Everything on the far side of the marked face or cell -- so the mark is
      // a sub-hypercube of the figure, one dimension down, not a set of edges
      // that happen to look right.
      const marked = panel.highlight === undefined ? null : cube.edges.map(([i, j]) =>
        cube.vertices[i][panel.highlight] === 1 && cube.vertices[j][panel.highlight] === 1);
      return {
        ...panel,
        cube,
        marked,
        posed: cube.vertices.map(() => new Float64Array(panel.dims)),
        screen: cube.vertices.map(() => ({ x: 0, y: 0, depth: 0, p: new Float64Array(panel.dims) })),
      };
    });

    figures.push({
      element, canvas, panels,
      ctx: canvas.getContext('2d'),
      width: 0, height: 0, dpr: 1, visible: true,
    });
  }

  if (!figures.length) return { start() {}, stop() {}, destroy() {} };

  // Colours come off the stylesheet rather than being repeated here, so the
  // figures follow the theme the same way everything else does.
  let colors = { line: '#888', mark: '#6ba585', label: '#888', font: 'sans-serif' };
  function readColors() {
    const style = getComputedStyle(figures[0].canvas);
    colors = {
      line: style.getPropertyValue('--ink').trim() || style.color,
      mark: style.getPropertyValue('--accent').trim() || style.color,
      label: style.getPropertyValue('--muted').trim() || style.color,
      font: style.fontFamily || 'sans-serif',
    };
  }

  // Reduced motion gets one frame at an angle chosen to show the structure,
  // rather than nothing: these figures are the argument, not decoration.
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let clock = still.matches ? 1.9 : 0;
  let raf = 0;
  let origin = 0;

  const resizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const figure = figures.find((f) => f.canvas === entry.target);
      if (!figure) continue;
      const box = entry.contentRect;
      figure.dpr = Math.min(window.devicePixelRatio || 1, 2);
      figure.width = box.width;
      figure.height = box.height;
      figure.canvas.width = Math.round(box.width * figure.dpr);
      figure.canvas.height = Math.round(box.height * figure.dpr);
      draw(figure, clock);
    }
  });

  // Scrolled-away figures cost nothing. The dialog is taller than the viewport
  // by design, so at any moment most of them are off screen.
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const figure = figures.find((f) => f.element === entry.target);
      if (figure) figure.visible = entry.isIntersecting;
    }
  }, { root: root, rootMargin: '120px' });

  for (const figure of figures) {
    resizes.observe(figure.canvas);
    seen.observe(figure.element);
  }

  function draw(figure, time) {
    const { ctx, width, height, dpr } = figure;
    if (!width || !height) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';

    const slice = width / figure.panels.length;
    figure.panels.forEach((panel, index) => {
      const cx = slice * (index + .5);
      const cy = (height - LABEL_SIZE * 2) * .5;
      const scale = Math.min(slice, height) * panel.scale;

      pose(panel.cube, panel.planes, time, panel.posed);
      panel.posed.forEach((v, i) => toScreen(v, scale, cx, cy, panel.screen[i]));

      // Marked edges last, so they sit over the cage rather than inside it.
      for (const pass of panel.marked ? [false, true] : [false]) {
        panel.cube.edges.forEach(([i, j], edge) => {
          if (panel.marked && panel.marked[edge] !== pass) return;
          const a = panel.screen[i];
          const b = panel.screen[j];
          const near = clamp01(((a.depth + b.depth) / 2 + 1.1) / 2.2);
          ctx.strokeStyle = pass ? colors.mark : colors.line;
          ctx.globalAlpha = pass ? .45 + .55 * near : .18 + .5 * near;
          ctx.lineWidth = (pass ? 1.5 : .8) + 1.4 * near;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        });
      }

      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.label;
      ctx.font = `500 ${LABEL_SIZE}px ${colors.font}`;
      ctx.textAlign = 'center';
      ctx.fillText(panel.label, cx, height - LABEL_SIZE * .4);
    });
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    clock = (now - origin) / 1000;
    for (const figure of figures) if (figure.visible) draw(figure, clock);
  }

  return {
    start() {
      readColors();
      if (still.matches) {
        for (const figure of figures) draw(figure, clock);
        return;
      }
      if (raf) return;
      // Rewind the clock to where it stopped, so reopening the dialog picks the
      // figures up mid-turn instead of snapping them back to the start.
      origin = performance.now() - clock * 1000;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      resizes.disconnect();
      seen.disconnect();
    },
  };
}
