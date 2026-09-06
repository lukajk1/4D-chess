import { glyphFor } from './board.js';
import { squareName } from '../core/notation.js';
import { nameOf } from '../core/pieces.js';

const NS = 'http://www.w3.org/2000/svg';
const svgElement = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

// Camera and DOM nodes live independently of selection and the rules engine.
export function createSpatialView(pos, onSelect) {
  const root = document.createElement('section');
  root.className = 'cube-view';
  root.innerHTML = `
    <div class="cube-heading"><div><span class="eyebrow">Spatial view</span><h2>Eight layers. One space.</h2></div><button class="reset-camera">Reset view</button></div>
    <div class="cube-controls">
      <label>Projection <select aria-label="Projection"><option value="orthographic">Orthographic</option><option value="perspective">Perspective</option></select></label>
      <label>Layer <select aria-label="Visible layer"><option value="all">All 8 layers</option>${pos.shape[2] ? Array.from({length: pos.shape[2]}, (_, z) => `<option value="${z}">Layer ${z + 1}</option>`).join('') : ''}</select></label>
      <label>Spacing <input aria-label="Layer spacing" type="range" min="0.6" max="2" step="0.05" value="1"></label>
      <label class="piece-toggle"><input type="checkbox" checked> Pieces</label>
      <output class="zoom-level" aria-label="Zoom level">100%</output>
    </div>`;
  const svg = svgElement('svg', { viewBox: '0 0 720 720', class: 'cube-svg', tabindex: '0', role: 'group', 'aria-label': '3D chess lattice. Drag to rotate; scroll or use plus and minus to zoom; arrow keys rotate; Home resets the view. Click a point to inspect.' });
  const title = svgElement('title');
  title.textContent = '512 positions on eight stacked chessboards';
  const wire = svgElement('g', { class: 'cube-wire', 'pointer-events': 'none' });
  const points = svgElement('g');
  const axes = svgElement('g', { class: 'cube-axes', 'pointer-events': 'none' });
  svg.append(title, wire, points, axes);
  root.append(svg);
  const caption = document.createElement('p');
  caption.className = 'cube-caption';
  caption.setAttribute('aria-live', 'polite');
  const help = document.createElement('p');
  help.className = 'hint';
  help.textContent = 'Drag to orbit · Scroll or + / − to zoom · Click a point or square to inspect. Pieces stay in place.';
  root.append(caption, help);

  let yaw = -.55, pitch = .48, spacing = 1, layer = null, selected = null;
  let projection = 'orthographic';
  let zoom = 1;
  let showPieces = true, frame = 0, gesture = null, disposed = false;
  const center = pos.shape.map(n => (n - 1) / 2);
  const coords = pos.squares.map((_, i) => pos.coord(i));
  const nodes = coords.map((coord, index) => {
    const group = svgElement('g', { 'data-index': index, class: 'cube-node' });
    const label = `${squareName(pos.shape, index)} · ${pos.get(index) ? `${pos.get(index) === pos.get(index).toUpperCase() ? 'White' : 'Black'} ${nameOf(pos.get(index).toLowerCase())}` : 'Empty'}`;
    group.setAttribute('aria-label', label);
    const tip = svgElement('title'); tip.textContent = label;
    const hit = svgElement('circle', { r: 11, fill: 'transparent' });
    const dot = svgElement('circle', { r: 3, class: coord.reduce((a, b) => a + b, 0) % 2 ? 'cube-dot dark' : 'cube-dot' });
    const ring = svgElement('circle', { r: 13, class: 'cube-ring', visibility: 'hidden' });
    group.append(tip, hit, ring, dot);
    let piece = null;
    if (pos.get(index)) {
      piece = svgElement('text', { 'text-anchor': 'middle', y: -5, class: `cube-piece ${pos.get(index) === pos.get(index).toUpperCase() ? 'white' : 'black'}`, 'pointer-events': 'none' });
      piece.textContent = glyphFor(pos.get(index));
      group.append(piece);
    }
    points.append(group);
    return { group, dot, ring, piece, label };
  });
  const edges = [];
  const addEdge = (a, b, z) => {
    const node = svgElement('line'); wire.append(node); edges.push({ a, b, z, node });
  };
  for (let z = 0; z < pos.shape[2]; z++) {
    for (let x = 0; x < pos.shape[0]; x++) addEdge([x, 0, z], [x, 7, z], z);
    for (let y = 0; y < pos.shape[1]; y++) addEdge([0, y, z], [7, y, z], z);
  }
  for (const x of [0, 7]) for (const y of [0, 7]) addEdge([x, y, 0], [x, y, 7], null);
  const axisNodes = ['x', 'y', 'z'].map(name => {
    const line = svgElement('line'); const text = svgElement('text'); text.textContent = name;
    axes.append(line, text); return { line, text };
  });

  function rotate(c) {
    const x = c[0] - center[0], y = (c[2] - center[2]) * spacing, z = -(c[1] - center[1]);
    const rx = x * Math.cos(yaw) + z * Math.sin(yaw);
    const rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
    return { x: rx, y: y * Math.cos(pitch) - rz * Math.sin(pitch), depth: y * Math.sin(pitch) + rz * Math.cos(pitch) };
  }
  function draw() {
    frame = 0;
    if (disposed) return;
    const rotated = coords.map(rotate);
    // Fit the bounding sphere, independent of camera orientation. Fitting the
    // projected bounds each frame made orbiting look like the cube was warping.
    const radius = Math.hypot(center[0], center[1], center[2] * spacing);
    const scale = 275 / radius;
    const cameraDistance = radius * 3;
    const projectRotated = p => {
      // A pinhole camera looking toward the origin; positive depth is nearer.
      // Orthographic projection simply drops depth. Both agree at the origin.
      const magnification = zoom * (projection === 'perspective' ? cameraDistance / (cameraDistance - p.depth) : 1);
      return { x: 360 + p.x * scale * magnification, y: 350 - p.y * scale * magnification, magnification };
    };
    const project = c => projectRotated(rotate(c));
    for (const edge of edges) {
      const a = project(edge.a), b = project(edge.b);
      for (const [key, value] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) edge.node.setAttribute(key, value);
      edge.node.setAttribute('opacity', layer === null ? .28 : edge.z === layer ? .65 : .06);
    }
    const order = coords.map((_, i) => i).sort((a, b) => rotated[a].depth - rotated[b].depth);
    for (const i of order) {
      const p = projectRotated(rotated[i]), node = nodes[i];
      const visible = layer === null || coords[i][2] === layer;
      node.group.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${p.magnification})`);
      node.group.setAttribute('opacity', visible ? 1 : .08);
      node.group.style.pointerEvents = visible ? 'auto' : 'none';
      node.ring.setAttribute('visibility', i === selected ? 'visible' : 'hidden');
      node.dot.setAttribute('r', i === selected ? 4 : 3);
      if (node.piece) node.piece.style.display = showPieces && visible ? '' : 'none';
      points.append(node.group);
    }
    if (selected !== null) points.append(nodes[selected].group);
    const origin = rotate(center);
    axisNodes.forEach(({ line, text }, axis) => {
      const c = center.slice(); c[axis] += 1;
      const p = rotate(c), x = 55 + (p.x - origin.x) * 28, y = 663 - (p.y - origin.y) * 28;
      for (const [key, value] of Object.entries({ x1: 55, y1: 663, x2: x, y2: y })) line.setAttribute(key, value);
      text.setAttribute('x', x + 5); text.setAttribute('y', y + 4);
    });
  }
  function schedule() { if (!frame && !disposed) frame = requestAnimationFrame(draw); }
  function setZoom(value) {
    zoom = Math.max(.4, Math.min(4, value));
    root.querySelector('.zoom-level').textContent = `${Math.round(zoom * 100)}%`;
    schedule();
  }
  function reset() { yaw = -.55; pitch = .48; setZoom(1); }
  svg.addEventListener('wheel', event => {
    // Keep browser-level Ctrl+wheel zoom available. Ordinary wheel scrolling
    // belongs to this viewport, including when its zoom limit is reached.
    if (event.ctrlKey) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.clientHeight : 1;
    const delta = Math.max(-160, Math.min(160, event.deltaY * unit));
    setZoom(zoom * Math.exp(-delta * .002));
  }, { passive: false });
  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0 || gesture) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, index: event.target.closest('[data-index]')?.dataset.index };
    svg.setPointerCapture(event.pointerId);
    svg.focus({ preventScroll: true });
  });
  svg.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 5) gesture.moved = true;
    if (gesture.moved) {
      yaw += (event.clientX - gesture.x) * .008;
      pitch = Math.max(-1.4, Math.min(1.4, pitch + (event.clientY - gesture.y) * .008));
      schedule();
    }
    gesture.x = event.clientX; gesture.y = event.clientY;
  });
  svg.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const previous = gesture; gesture = null;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (!previous.moved && previous.index !== undefined) onSelect(Number(previous.index));
  });
  svg.addEventListener('pointercancel', () => { gesture = null; });
  svg.addEventListener('lostpointercapture', () => { gesture = null; });
  svg.addEventListener('keydown', event => {
    if (['+', '=', '-', '_'].includes(event.key)) {
      event.preventDefault();
      setZoom(zoom * (event.key === '+' || event.key === '=' ? 1.15 : 1 / 1.15));
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') return reset();
    yaw += event.key === 'ArrowLeft' ? -.12 : event.key === 'ArrowRight' ? .12 : 0;
    pitch = Math.max(-1.4, Math.min(1.4, pitch + (event.key === 'ArrowUp' ? -.12 : event.key === 'ArrowDown' ? .12 : 0)));
    schedule();
  });
  root.querySelector('.reset-camera').addEventListener('click', reset);
  root.querySelector('[aria-label="Projection"]').addEventListener('change', event => { projection = event.target.value; schedule(); });
  const layerSelect = root.querySelector('[aria-label="Visible layer"]');
  layerSelect.addEventListener('change', () => { layer = layerSelect.value === 'all' ? null : Number(layerSelect.value); schedule(); });
  root.querySelector('input[type=range]').addEventListener('input', event => { spacing = Number(event.target.value); schedule(); });
  root.querySelector('input[type=checkbox]').addEventListener('change', event => { showPieces = event.target.checked; schedule(); });
  return {
    element: root,
    update(index) {
      selected = index;
      if (selected !== null && layer !== null) { layer = coords[selected][2]; layerSelect.value = String(layer); }
      caption.textContent = selected === null ? '512 positions · 232 pieces · Kings and queens on layers 4 and 5.' : `${nodes[selected].label} · x ${coords[selected][0] + 1}, y ${coords[selected][1] + 1}, z ${coords[selected][2] + 1}`;
      schedule();
    },
    destroy() { disposed = true; cancelAnimationFrame(frame); },
  };
}
