import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { envelope } from '../core/movegen.js';
import { squareName, layerName, wName } from '../core/notation.js';
import { nameOf } from '../core/pieces.js';
import { createModelPieces } from './model-pieces.js';
import { loadSkybox } from './skybox.js';
import { isInterior, tesseractCells, hingeTree, unfoldCoord } from './tesseract.js';
import {
  CELL_COLORS, readTheme, brighten, POINT_VERTEX, POINT_FRAGMENT,
  LINE_VERTEX, LINE_FRAGMENT, PIECE_VERTEX, PIECE_FRAGMENT, HALO_FRAGMENT, buildGlyphAtlas,
} from './gl-shared.js';

// WebGL viewer for the lattice. The 4D -> 3D projection stays here in JS
// because it is part of the model; three.js only handles 3D -> 2D and raster.
//
// Lattice points and wires stay in shared buffers. Pieces can use either the
// single billboard batch or one instanced model batch per visible piece type.

export function createSpatialView(pos, onSelect, glyphFor, lastMove = null) {
  const is4D = pos.dims === 4;
  const theme = readTheme();
  let animatingMove = lastMove && lastMove.from !== undefined && lastMove.to !== undefined ? {
    from: lastMove.from,
    to: lastMove.to,
    piece: lastMove.piece,
    startTime: performance.now(),
    duration: 250,
  } : null;
  let capturedToSpawn = lastMove?.captured && lastMove.to !== undefined ? {
    char: lastMove.captured,
    square: lastMove.to,
  } : null;
  // The explorer restores its previous fold state immediately after creation.
  // Wait one animation frame before placing capture debris so clone positions
  // reflect that restored state instead of the initially folded geometry.
  let captureSpawnReady = false;
  const count = pos.squares.length;
  const coords = pos.squares.map((_, i) => pos.coord(i));
  const center = pos.shape.map((n) => (n - 1) / 2);
  const cells = is4D ? tesseractCells(pos.shape) : [];
  const pieceIndices = pos.squares.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  const pieceCount = pieceIndices.length;

  // ---- DOM shell (markup mirrors the previous viewer so styling carries over)
  // Small choices read better as segmented controls than as dropdowns: every
  // option stays visible and switching is one click, not two.
  const segmented = (label, name, options, current) => `
    <div class="control">
      <span class="control-label">${label}</span>
      <div class="segmented${options.length > 2 ? ' segmented-three' : ''}" role="group" aria-label="${name}">
        ${options.map(([value, text]) => `<button type="button" data-value="${value}" aria-pressed="${value === current}">${text}</button>`).join('')}
      </div>
    </div>`;

  const root = document.createElement('section');
  root.className = 'cube-view';
  root.innerHTML = `
    <div class="cube-heading"><div><span class="eyebrow">${is4D ? '4D → 3D → 2D' : 'Spatial view'}</span><h2>${is4D ? 'One tesseract, eight cells.' : 'Eight layers. One space.'}</h2></div><button class="reset-camera">Reset view</button></div>
    <div class="cube-controls">
      ${segmented(is4D ? '3D camera' : 'Projection', 'Projection', [['perspective', 'Perspective'], ['orthographic', 'Ortho']], 'perspective')}
      <label>Background <select aria-label="Background"><option value="page">Page</option><option value="paper">Off-white</option><option value="sky">Sky</option></select></label>
      ${is4D ? segmented('4D \u2192 3D', 'Hyperprojection', [['nested', 'Nested'], ['oblique', 'Oblique']], 'nested') : ''}
      ${is4D ? segmented('Colour', 'Point colouring', [['board', 'Chessboard'], ['cell', 'By cell'], ['w', 'By w-layer']], 'board') : ''}
      ${segmented('Space style', 'Space style', [['squares', 'Squares'], ['opaque', 'Opaque'], ['verts', 'Points']], 'squares')}
      ${segmented('Labels', 'Axis labels', [['on', 'On'], ['off', 'Off']], 'on')}
      ${is4D ? '' : `<label>Layer <select aria-label="Visible layer"><option value="all">All ${pos.shape[2]} layers</option>${Array.from({ length: pos.shape[2] }, (_, z) => `<option value="${z}">Layer ${z + 1}</option>`).join('')}</select></label>`}
      ${is4D ? '<label>W spacing <input aria-label="W spacing" type="range" min="0.5" max="1.8" step="0.02" value="1"></label>' : ''}
      ${segmented('Reach', 'Move highlight', [['points', 'Points'], ['cubes', 'Cubes']], 'points')}
      ${is4D ? `<div class="control">
        <span class="control-label">Fold <output class="fold-value">0.00</output></span>
        <input class="fold-slider" aria-label="Fold" type="range" min="0" max="1" step="0.005" value="0">
      </div>
      <button class="unfold">Unfold</button>
      ${['XZ', 'YZ', 'ZW'].map((plane, i) => `<div class="control">
        <span class="control-label">${plane} rotation <output class="rotation-value" data-plane="${i}">0°</output></span>
        <input class="rotation-slider" data-plane="${i}" aria-label="${plane} rotation" type="range" min="0" max="1" step="0.001" value="0">
      </div>`).join('')}
      <button class="rotation-toggle" aria-pressed="false" title="Rotate in the XZ, YZ, and ZW planes">Start 4D rotation</button>` : ''}
    </div>`;

  const canvas = document.createElement('canvas');
  canvas.className = 'cube-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-label', `${pos.dims}D chess lattice. Drag to orbit, right-drag to pan, scroll to zoom, and click a piece or space.`);
  root.append(canvas);

  // Floats over the canvas rather than sitting under it, centred along the
  // bottom edge, so nothing crops the view.
  const caption = document.createElement('p');
  caption.className = 'cube-caption';
  caption.setAttribute('aria-live', 'polite');

  // Screen-space notation that remains pinned to reference-axis vertices as
  // OrbitControls turns the camera around the projected lattice.
  const axisLabelLayer = document.createElement('div');
  axisLabelLayer.className = 'axis-label-layer';
  axisLabelLayer.setAttribute('aria-hidden', 'true');

  // The piece models are CC BY 3.0, which requires attribution, so this outlives
  // the footer it used to sit in and docks with the controls instead.
  const creditLink = document.createElement('button');
  creditLink.type = 'button';
  creditLink.className = 'credit-link';
  creditLink.textContent = 'Asset credits';
  creditLink.setAttribute('aria-haspopup', 'dialog');

  const creditDialog = document.createElement('dialog');
  creditDialog.className = 'asset-credit';
  creditDialog.innerHTML = `
    <h2>Asset credits</h2>
    <p><a href="https://poly.pizza/m/bfb3C6hpdi0" target="_blank" rel="noopener"><cite>Chess Set</cite></a>
      by Pia Leung, licensed under
      <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="license noopener">CC BY 3.0</a>,
      via Poly Pizza.</p>
    <p><a href="https://opengameart.org/content/cloudy-skyboxes-0" target="_blank" rel="noopener"><cite>Cloudy Skyboxes</cite></a>
      by Screaming Brain Studios, released under
      <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="license noopener">CC0</a>
      into the public domain, via OpenGameArt. Credit is not required; this is here anyway.</p>
    <form method="dialog"><button>Close</button></form>`;
  creditLink.addEventListener('click', () => creditDialog.showModal());
  root.append(axisLabelLayer, caption, creditLink, creditDialog);

  // ---- three.js scene
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();

  const radius = Math.hypot(center[0], center[1], center[2]) * (is4D ? 1.9 : 1.25) + 1;
  const distance = radius * 3.2;
  const perspective = new THREE.PerspectiveCamera(38, 1, 0.1, distance * 6);
  const orthographic = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.1, distance * 6);
  let camera = orthographic;
  for (const cam of [perspective, orthographic]) cam.position.set(distance * 0.55, distance * 0.45, distance * 0.7);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.enablePan = true;
  controls.rotateSpeed = 0.9;
  controls.minDistance = radius * 0.6;
  controls.maxDistance = distance * 3;

  // ---- slots
  //
  // A point where cells meet needs one copy per cell that claims it: folded,
  // the copies coincide exactly and look like a single point; unfolding sends
  // each to its own cell in the net. Strictly interior points get one faint
  // slot and fade out when unfolded, having no cell to travel to.
  const wScaleOf = (c) => (is4D ? 2.5 / (2.5 - (c[3] - center[3]) / (center[3] || 1)) : 1);
  const basePointSize = (is4D ? 0.133 : 0.112) * 0.68;

  const slots = [];
  if (is4D) {
    for (const cell of cells) for (const lattice of cell.indices) slots.push({ lattice, cell });
    for (let i = 0; i < count; i++) if (isInterior(pos.shape, i)) slots.push({ lattice: i, cell: null });
  } else {
    for (let i = 0; i < count; i++) slots.push({ lattice: i, cell: null });
  }
  const slotCount = slots.length;
  const slotLattice = new Int32Array(slots.map((slot) => slot.lattice));
  // One representative copy per square, picked the way a piece picks its home
  // cube, so a move highlight lands where that square's model would stand
  // rather than being drawn once per cell that shares the point.
  const homeSlotOf = new Int32Array(count).fill(-1);
  slots.forEach((slot, s) => {
    const current = homeSlotOf[slot.lattice];
    const better = current < 0 || (slot.cell?.axis === 3 && slots[current].cell?.axis !== 3);
    if (better) homeSlotOf[slot.lattice] = s;
  });

  const positions = new Float32Array(slotCount * 3);
  const pointColors = new Float32Array(slotCount * 3);
  const pointAlpha = new Float32Array(slotCount).fill(1);
  const pointSize = new Float32Array(slotCount);
  const baseAlpha = new Float32Array(slotCount).fill(1);
  const tileAlpha = new Float32Array(slotCount);
  const tileScale = new Float32Array(slotCount).fill(1);
  const scratch = new THREE.Color();

  // Three colourings, switchable at runtime: chessboard parity, one colour per
  // cell, or a grayscale ramp across the w layers.
  const cellColors = new Float32Array(slotCount * 3);
  const boardColors = new Float32Array(slotCount * 3);
  const wColors = new Float32Array(slotCount * 3);
  slots.forEach((slot, s) => {
    const c = coords[slot.lattice];
    const parity = c.reduce((a, b) => a + b, 0) % 2;
    brighten(scratch.set(parity ? theme.dark : theme.light));
    boardColors.set([scratch.r, scratch.g, scratch.b], s * 3);
    // In 3D there are no cells, so the brightened board colours stand in.
    if (is4D) scratch.set(slot.cell ? CELL_COLORS[slot.cell.id] : theme.muted);
    cellColors.set([scratch.r, scratch.g, scratch.b], s * 3);
    // The w coordinate owns this meaning: w = 1 is white and the maximum w
    // layer is black, independent of how a projection happens to frame them.
    const wShade = is4D ? 1 - c[3] / Math.max(1, pos.shape[3] - 1) : 0;
    scratch.setHSL(0, 0, Math.min(1, Math.max(0, wShade)));
    wColors.set([scratch.r, scratch.g, scratch.b], s * 3);
    const loose = is4D && !slot.cell;
    pointSize[s] = basePointSize * wScaleOf(c) * (loose ? 0.62 : 1);
    baseAlpha[s] = 1;
  });
  pointColors.set(cellColors);

  // A vertex where cells meet has one copy per cell. While those copies sit on
  // top of each other they show the average of every owning cell's colour.
  const avgColors = new Float32Array(slotCount * 3);
  if (is4D) {
    const sum = new Map();   // lattice index -> [r, g, b, count]
    slots.forEach((slot, s) => {
      if (!slot.cell) return;
      const a = sum.get(slot.lattice) ?? [0, 0, 0, 0];
      for (let k = 0; k < 3; k++) a[k] += cellColors[s * 3 + k];
      a[3]++;
      sum.set(slot.lattice, a);
    });
    slots.forEach((slot, s) => {
      const a = sum.get(slot.lattice);
      if (!a) { avgColors.set(cellColors.subarray(s * 3, s * 3 + 3), s * 3); return; }
      for (let k = 0; k < 3; k++) avgColors[s * 3 + k] = a[k] / a[3];
    });
  }

  // ---- unfolding, as 4D hinge rotations projected to 3D
  //
  // Each cell turns a quarter turn about the face it shares with its parent,
  // inside its own time window, and rides along with its parent's turn. The
  // outer cube peels off first, the arm it hangs from lays down next, and the
  // remaining flaps follow. Reversing t reverses all of it, so the outer cube
  // is put back on last.
  //
  // A cell that flips over through w arrives mirrored -- the outer cube comes
  // out inside out. That is real: its 3D shadow flattens and re-emerges.
  const slotCell = new Int8Array(slotCount).fill(-1);
  const hinges = is4D ? hingeTree(cells) : [];
  const STAGE = {
    wmax: [0.00, 0.30],
    zmin: [0.26, 0.56], zmax: [0.26, 0.56],
    ymin: [0.48, 0.76], ymax: [0.48, 0.76],
    xmin: [0.68, 0.96], xmax: [0.68, 0.96],
    wmin: [0, 1],
  };
  const stageStart = new Float32Array(8);
  const stageEnd = new Float32Array(8);
  const angles = new Float64Array(8);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (u) => u * u * (3 - 2 * u);
  const angleAt = (t, ci) => smooth(clamp01((t - stageStart[ci]) / (stageEnd[ci] - stageStart[ci]))) * Math.PI / 2;

  // The 4D camera sits on the w axis. Close in, the nesting is dramatic; but a
  // cell swinging up past w = max would cross the camera plane, so it pulls
  // back early in the unfold.
  const K_FOLDED = 2.5;
  const K_UNFOLDED = 6;
  const cameraK = (t) => (K_FOLDED + (K_UNFOLDED - K_FOLDED) * smooth(clamp01(t / 0.25))) / wSpread;
  const wScaleAt = (w, K) => (is4D ? K / (K - (w - center[3]) / (center[3] || 1)) : 1);

  // A coordinate axis belongs to three independent planes in 4D. Rotating in
  // all three planes containing z gives the point cloud a true 4D motion: XZ
  // and YZ turn its spatial silhouette while ZW changes apparent 4D depth.
  let wMode = 'nested';
  // How far apart consecutive w slices are drawn. The two projections reach
  // that differently -- nested moves the 4D camera in, oblique lengthens its
  // step -- so this is a factor rather than a distance, and up means further
  // apart in both.
  let wSpread = 1;

  const zPlanes = [[0, 2], [1, 2], [2, 3]];
  const TAU = Math.PI * 2;
  const rotationAngles = new Float64Array(3);
  const rotationSpeeds = [.11, -.083, .14];
  const rotated4 = [0, 0, 0, 0];
  function rotateThroughZPlanes(c) {
    for (let axis = 0; axis < 4; axis++) rotated4[axis] = c[axis] - center[axis];
    zPlanes.forEach(([a, b], i) => {
      const cos = Math.cos(rotationAngles[i]);
      const sin = Math.sin(rotationAngles[i]);
      const va = rotated4[a];
      const vb = rotated4[b];
      rotated4[a] = va * cos - vb * sin;
      rotated4[b] = va * sin + vb * cos;
    });
    for (let axis = 0; axis < 4; axis++) rotated4[axis] += center[axis];
    return rotated4;
  }

  // An oblique parallel projection of the tesseract: w becomes a fixed
  // direction rather than a scale, so every cell keeps its true size and the
  // w-extreme cubes sit corner to corner, joined by the slanted edges that make
  // the familiar drawing. The offset is a little over half a square per w step
  // -- the cabinet convention. Cavalier, at a full square per step, smears an
  // 8-wide board past the point of reading.
  const OBLIQUE_DIR = ((v) => v.map((k) => k / Math.hypot(...v)))([1, .85, 1]);
  const OBLIQUE_STEP = is4D ? .58 * pos.shape[0] / Math.max(1, pos.shape[3] - 1) : 0;

  // Project a 4D point for a given camera, scale and spacing. Returns wScale.
  function projectAt(c, K, g, sp, out) {
    const q = is4D ? rotateThroughZPlanes(c) : c;
    if (is4D && wMode === 'oblique') {
      const dw = (q[3] - center[3]) * OBLIQUE_STEP * wSpread;
      out[0] = ((q[0] - center[0]) + dw * OBLIQUE_DIR[0]) * g;
      out[1] = ((q[2] - center[2]) * sp + dw * OBLIQUE_DIR[1]) * g;
      out[2] = (-(q[1] - center[1]) + dw * OBLIQUE_DIR[2]) * g;
      // A parallel projection has no foreshortening, so nothing scales with w.
      return 1;
    }
    const ws = wScaleAt(q[3], K);
    out[0] = (q[0] - center[0]) * ws * g;
    out[1] = (q[2] - center[2]) * sp * ws * g;
    out[2] = -(q[1] - center[1]) * ws * g;
    return ws;
  }

  // The finished net is bigger and off-centre relative to the folded tesseract
  // (the outer cube hangs below), so it is eased into a fit as it opens.
  let fitScale = 1;
  const netMid = [0, 0, 0];
  const cornerCoords = [];    // per cell, its 8 corner lattice points in 4D
  const CORNER_EDGES = [];    // the 12 edges of a cube as corner index pairs
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
    if (((a ^ b) & ((a ^ b) - 1)) === 0) CORNER_EDGES.push(a, b);   // differ in one bit
  }
  const coord4 = [0, 0, 0, 0];
  const proj = [0, 0, 0];
  if (is4D) {
    cells.forEach((cell, ci) => {
      [stageStart[ci], stageEnd[ci]] = STAGE[cell.id];
      const corners = [];
      for (let bits = 0; bits < 8; bits++) {
        const c = [0, 0, 0, 0];
        c[cell.axis] = cell.at;
        cell.free.forEach((axis, k) => { c[axis] = (bits >> k) & 1 ? cell.size[k] - 1 : 0; });
        corners.push(c);
      }
      cornerCoords.push(corners);
    });
    slots.forEach((slot, s) => { if (slot.cell) slotCell[s] = cells.indexOf(slot.cell); });

    measureNet();
  }

  // Use one coherent boundary cell for each axis so its labels continue along
  // a single edge when the tesseract opens into a net. The shared zero point
  // carries the complete address; subsequent ticks use their notation family.
  const axisLabels = [];
  const axisCarrier = (axis) => {
    if (!is4D) return null;
    const id = axis === 3 ? 'xmin' : 'wmin';
    return cells.find((cell) => cell.id === id) ?? null;
  };
  const axisToken = (axis, value) => {
    if (axis === 0) return squareName([pos.shape[0]], value);
    if (axis === 1) return String(value + 1);
    if (axis === 2) return layerName(value);
    return wName(value);
  };
  const zeroCoord = new Array(pos.dims).fill(0);
  const zeroLattice = pos.index(zeroCoord);
  const addAxisLabel = (text, lattice, carrier, origin = false) => {
    let slot = homeSlotOf[lattice];
    if (carrier) {
      const carried = slots.findIndex((entry) => entry.lattice === lattice && entry.cell === carrier);
      if (carried >= 0) slot = carried;
    }
    if (slot < 0) return;
    const element = document.createElement('span');
    element.className = `axis-label${origin ? ' origin' : ''}`;
    element.textContent = text;
    axisLabelLayer.append(element);
    axisLabels.push({ element, slot });
  };
  addAxisLabel(squareName(pos.shape, zeroLattice), zeroLattice, axisCarrier(0), true);
  for (let axis = 0; axis < pos.dims; axis++) {
    const carrier = axisCarrier(axis);
    for (let value = 1; value < pos.shape[axis]; value++) {
      const coord = new Array(pos.dims).fill(0);
      coord[axis] = value;
      const lattice = pos.index(coord);
      addAxisLabel(axisToken(axis, value), lattice, carrier);
    }
  }

  // Size the fully open net against the folded footprint. The two projections
  // give the net different extents, so this is remeasured when one is chosen.
  function measureNet() {
    const full = cells.map(() => Math.PI / 2);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    cornerCoords.forEach((corners, ci) => {
      for (const c of corners) {
        projectAt(unfoldCoord(c, ci, hinges, full, coord4), K_UNFOLDED, 1, 1, proj);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], proj[k]); hi[k] = Math.max(hi[k], proj[k]); }
      }
    });
    for (let k = 0; k < 3; k++) netMid[k] = (lo[k] + hi[k]) / 2;
    fitScale = radius / (Math.hypot(...hi.map((v, k) => v - netMid[k])) || 1);
  }

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pointGeometry.setAttribute('aColor', new THREE.BufferAttribute(pointColors, 3));
  pointGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(pointAlpha, 1));
  pointGeometry.setAttribute('aSize', new THREE.BufferAttribute(pointSize, 1));

  // Two passes over one buffer: solid points write depth so nearer ones hide
  // farther ones, then faint points blend on top without occluding. Without
  // this the GPU paints in buffer order and back points land over front ones.
  const pointUniforms = { uHalfHeight: { value: 300 }, uPerspective: { value: 0 }, uSolidPass: { value: 1 } };
  const pointMaterial = new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    transparent: true,
    depthWrite: true,
    uniforms: pointUniforms,
  });
  const pointCloud = new THREE.Points(pointGeometry, pointMaterial);
  pointCloud.renderOrder = 1;
  scene.add(pointCloud);

  const faintMaterial = new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    uniforms: { ...pointUniforms, uSolidPass: { value: 0 } },
  });
  const faintCloud = new THREE.Points(pointGeometry, faintMaterial);
  faintCloud.renderOrder = 2;
  scene.add(faintCloud);

  // A shallow block is centred on each lattice point rather than filling the
  // gap between four points. Its top stays at the point's exact world height;
  // the body extends downward and deliberately overhangs each edge by half a
  // square. Back-face culling prevents its far wall doubling its own opacity.
  const tileGeometry = new THREE.InstancedBufferGeometry();
  const tileBox = new THREE.BoxGeometry(1, 0.03, 1);
  tileBox.translate(0, -0.015, 0);
  tileGeometry.setAttribute('position', tileBox.attributes.position.clone());
  tileGeometry.setAttribute('normal', tileBox.attributes.normal.clone());
  tileGeometry.setIndex(tileBox.index.clone());
  tileBox.dispose();
  tileGeometry.instanceCount = slotCount;
  tileGeometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(positions, 3));
  tileGeometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(tileScale, 1));
  tileGeometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(pointColors, 3));
  tileGeometry.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(tileAlpha, 1));
  const tileMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0.28 },
      uOpaque: { value: 0 },
      uEnvironment: { value: null },
      uEnvironmentStrength: { value: 0 },
    },
    vertexShader: `
      attribute vec3 aCenter;
      attribute float aScale;
      attribute vec3 aColor;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vShade;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec3 vTilePosition;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vShade = normal.y > 0.5 ? 1.0 : (normal.y < -0.5 ? 0.58 : 0.76);
        vec3 at = aCenter + position * aScale;
        vec4 worldPosition = modelMatrix * vec4(at, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vTilePosition = position;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }`,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uOpaque;
      uniform samplerCube uEnvironment;
      uniform float uEnvironmentStrength;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vShade;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec3 vTilePosition;
      void main() {
        if (vAlpha <= 0.001) discard;
        if (uOpaque > 0.5 && vAlpha < 0.999) {
          vec3 cell = floor((vTilePosition + 0.5) * 28.0);
          float coverage = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          if (coverage > vAlpha) discard;
        }
        vec3 base = vColor * vShade;
        vec3 eye = normalize(vWorldPosition - cameraPosition);
        vec3 reflected = reflect(eye, normalize(vWorldNormal));
        vec3 environment = textureCube(uEnvironment, reflected).rgb;
        float alpha = uOpaque > 0.5 ? 1.0 : vAlpha * uOpacity;
        gl_FragColor = vec4(mix(base, environment, uEnvironmentStrength), alpha);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const tileMesh = new THREE.Mesh(tileGeometry, tileMaterial);
  tileMesh.frustumCulled = false;
  tileMesh.renderOrder = 1;
  tileMesh.visible = false;
  scene.add(tileMesh);

  // Picking uses its own full-space surfaces. It does not depend on whether a
  // point sprite or a square happens to represent that space visually.
  const spaceHitPositions = new Float32Array(slotCount * 4 * 3);
  const spaceHitIndices = new Uint32Array(slotCount * 6);
  for (let s = 0; s < slotCount; s++) {
    const v = s * 4;
    spaceHitIndices.set([v, v + 1, v + 2, v, v + 2, v + 3], s * 6);
  }
  const spaceHitGeometry = new THREE.BufferGeometry();
  spaceHitGeometry.setAttribute('position', new THREE.BufferAttribute(spaceHitPositions, 3));
  spaceHitGeometry.setIndex(new THREE.BufferAttribute(spaceHitIndices, 1));
  const spaceHitMaterial = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide, colorWrite: false, depthWrite: false,
  });
  const spaceHitMesh = new THREE.Mesh(spaceHitGeometry, spaceHitMaterial);
  spaceHitMesh.renderOrder = -1;
  scene.add(spaceHitMesh);

  // ---- wire edges, described as index pairs then filled each rebuild
  const edgePairs = [];
  const [maxX, maxY, maxZ] = pos.shape.map((n) => n - 1);
  const at = (c) => pos.index(c);
  const cubeEdges = (corners, make) => {
    for (let a = 0; a < corners.length; a++) {
      for (let b = a + 1; b < corners.length; b++) {
        const differing = corners[a].reduce((n, v, i) => n + (v === corners[b][i] ? 0 : 1), 0);
        if (differing === 1) make(corners[a], corners[b]);
      }
    }
  };
  const boxCorners = [];
  for (const x of [0, maxX]) for (const y of [0, maxY]) for (const z of [0, maxZ]) boxCorners.push([x, y, z]);

  if (is4D) {
    // Drawn per cell and animated with the unfold; see writeCellFrame.
  } else {
    for (let z = 0; z < pos.shape[2]; z++) {
      for (let x = 0; x < pos.shape[0]; x++) edgePairs.push({ a: at([x, 0, z]), b: at([x, maxY, z]), z, w: null });
      for (let y = 0; y < pos.shape[1]; y++) edgePairs.push({ a: at([0, y, z]), b: at([maxX, y, z]), z, w: null });
    }
    for (const x of [0, maxX]) for (const y of [0, maxY]) {
      edgePairs.push({ a: at([x, y, 0]), b: at([x, y, maxZ]), z: null, w: null });
    }
  }

  const edgePositions = new Float32Array(edgePairs.length * 6);
  const edgeAlpha = new Float32Array(edgePairs.length * 2).fill(0.35);
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
  edgeGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(edgeAlpha, 1));
  const edgeMaterial = new THREE.ShaderMaterial({
    vertexShader: LINE_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(theme.muted) }, uFade: { value: 1 } },
  });
  const wireframe = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  wireframe.renderOrder = 0;
  scene.add(wireframe);

  let netFrameMaterial = null;
  let cellFrameGeometry = null;
  const cellFramePositions = new Float32Array(is4D ? cells.length * CORNER_EDGES.length * 3 : 0);
  if (is4D) {
    const frameColor = new THREE.Color(theme.muted).lerp(new THREE.Color('#ffffff'), 0.24);
    cellFrameGeometry = new THREE.BufferGeometry();
    cellFrameGeometry.setAttribute('position', new THREE.BufferAttribute(cellFramePositions, 3));
    cellFrameGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(cellFramePositions.length / 3).fill(0.32 * 1.24), 1));
    netFrameMaterial = new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX,
      fragmentShader: LINE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: frameColor }, uFade: { value: 1 } },
    });
    const cellFrame = new THREE.LineSegments(cellFrameGeometry, netFrameMaterial);
    cellFrame.frustumCulled = false;
    cellFrame.renderOrder = 0;
    scene.add(cellFrame);
  }

  // Every slot copy of an occupied square gets a sprite. The copy in the
  // piece's own w cell -- its home cube -- is the piece itself; the rest are
  // ghosts, faint reminders that one square appears in several cells. Ghosts
  // are listed first so home pieces draw over them wherever they coincide.
  const GHOST_ALPHA = 0.3;
  const pieceInstances = [];
  pieceIndices.forEach((lattice, i) => {
    const copies = [];
    for (let s = 0; s < slotCount; s++) if (slotLattice[s] === lattice) copies.push(s);
    const home = copies.find((s) => slots[s].cell?.axis === 3) ?? copies[0];
    for (const s of copies) {
      pieceInstances.push({ piece: i, lattice, slot: s, home: s === home, homeSlot: home });
    }
  });
  pieceInstances.sort((a, b) => Number(a.home) - Number(b.home));

  // ---- pieces as one instanced, billboarded quad
  let pieceMesh = null;
  let pieceCenters = null;
  let pieceHidden = null;
  let pieceScale = null;
  let pieceAlpha = null;
  let pieceCapturable = null;
  let atlas = null;
  if (pieceCount) {
    const chars = [...new Set(pieceIndices.map((i) => pos.get(i)))];
    atlas = buildGlyphAtlas(chars, glyphFor);

    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ]), 3));
    quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const instanceCount = pieceInstances.length;
    quad.instanceCount = instanceCount;

    pieceCenters = new Float32Array(instanceCount * 3);
    pieceHidden = new Float32Array(instanceCount);
    pieceScale = new Float32Array(instanceCount).fill(1);
    pieceAlpha = new Float32Array(instanceCount).fill(1);
    pieceCapturable = new Float32Array(instanceCount);
    const atlasCells = new Float32Array(instanceCount * 2);
    pieceInstances.forEach((inst, k) => {
      atlasCells.set(atlas.index.get(pos.get(inst.lattice)), k * 2);
    });
    quad.setAttribute('aCenter', new THREE.InstancedBufferAttribute(pieceCenters, 3));
    quad.setAttribute('aCell', new THREE.InstancedBufferAttribute(atlasCells, 2));
    quad.setAttribute('aHidden', new THREE.InstancedBufferAttribute(pieceHidden, 1));
    quad.setAttribute('aScale', new THREE.InstancedBufferAttribute(pieceScale, 1));
    quad.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(pieceAlpha, 1));
    quad.setAttribute('aCapturable', new THREE.InstancedBufferAttribute(pieceCapturable, 1));

    pieceMesh = new THREE.Mesh(quad, new THREE.ShaderMaterial({
      vertexShader: PIECE_VERTEX,
      fragmentShader: PIECE_FRAGMENT,
      uniforms: {
        uAtlas: { value: atlas.texture },
        uGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uSize: { value: 0.85 },
      },
      // Ghost copies are translucent, so sprites blend rather than alpha-test.
      transparent: true,
      depthWrite: false,
    }));
    pieceMesh.frustumCulled = false;
    pieceMesh.renderOrder = 2;
    scene.add(pieceMesh);
  }

  const modelStatus = document.createElement('output');
  modelStatus.setAttribute('aria-live', 'polite');
  root.querySelector('.cube-controls').append(modelStatus);
  const modelPieces = createModelPieces(scene, pieceInstances, (index) => pos.get(index), (failed) => {
    modelStatus.textContent = failed ? 'Some models unavailable; using glyphs.' : '';
    applyFilters();
  }, theme.selected);

  // ---- selection halo
  const HALO_MAX = 8;
  const haloGeometry = new THREE.BufferGeometry();
  haloGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HALO_MAX * 3), 3));
  const haloColors = new Float32Array(HALO_MAX * 3);
  for (let i = 0; i < HALO_MAX; i++) haloColors.set([...new THREE.Color(theme.selected)], i * 3);
  haloGeometry.setAttribute('aColor', new THREE.BufferAttribute(haloColors, 3));
  haloGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(HALO_MAX), 1));
  haloGeometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(HALO_MAX).fill(basePointSize * 3.4), 1));
  const halo = new THREE.Points(haloGeometry, new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: pointMaterial.uniforms,
  }));
  halo.frustumCulled = false;
  halo.renderOrder = 3;
  halo.visible = false;
  scene.add(halo);

  // ---- move envelope, drawn as the cells a piece could reach
  // A lattice point is the middle of a cell's floor -- it is where a piece model
  // stands -- so a cell runs half a square either side in x and y and a whole
  // layer upward in z. Corners are fractional board coordinates pushed through
  // the same projection as the lattice itself, so the boxes fold, unfold, rotate
  // and take the w perspective along with everything else.
  const HIGHLIGHT_MAX = 420;
  const CUBE_CORNERS = [];
  for (let bits = 0; bits < 8; bits++) {
    CUBE_CORNERS.push([bits & 1 ? .5 : -.5, bits & 2 ? .5 : -.5, bits & 4 ? 1 : 0, 0]);
  }
  const CUBE_EDGES = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
    if (((a ^ b) & ((a ^ b) - 1)) === 0) CUBE_EDGES.push(a, b);   // differ in one bit
  }
  const CUBE_FACES = [];
  for (let axis = 0; axis < 3; axis++) {
    const bit = 1 << axis;
    const [u, v] = [0, 1, 2].filter((k) => k !== axis).map((k) => 1 << k);
    for (const side of [0, bit]) CUBE_FACES.push(side, side | u, side | u | v, side, side | u | v, side | v);
  }

  const highlightCorners = new Float32Array(HIGHLIGHT_MAX * 8 * 3);
  const highlightAlpha = new THREE.BufferAttribute(new Float32Array(HIGHLIGHT_MAX * 8).fill(1), 1);
  const highlightPosition = new THREE.BufferAttribute(highlightCorners, 3);
  const indexFor = (pattern) => {
    const out = new Uint16Array(HIGHLIGHT_MAX * pattern.length);
    for (let i = 0; i < HIGHLIGHT_MAX; i++) {
      for (let k = 0; k < pattern.length; k++) out[i * pattern.length + k] = i * 8 + pattern[k];
    }
    return new THREE.BufferAttribute(out, 1);
  };
  // Wire and fill share one set of corners and differ only in how they are
  // indexed, so a single position update moves both.
  const highlightGeometry = new THREE.BufferGeometry();
  highlightGeometry.setAttribute('position', highlightPosition);
  highlightGeometry.setAttribute('aAlpha', highlightAlpha);
  highlightGeometry.setIndex(indexFor(CUBE_EDGES));
  const highlightFillGeometry = new THREE.BufferGeometry();
  highlightFillGeometry.setAttribute('position', highlightPosition);
  highlightFillGeometry.setAttribute('aAlpha', highlightAlpha);
  highlightFillGeometry.setIndex(indexFor(CUBE_FACES));

  const highlightMaterial = new THREE.ShaderMaterial({
    vertexShader: LINE_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(theme.accent) }, uFade: { value: .85 } },
  });
  // Faint enough that a queen's two hundred cells do not fog the lattice; the
  // wire carries the read, the fill only says which side of it is inside.
  const highlightFillMaterial = new THREE.ShaderMaterial({
    vertexShader: LINE_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(theme.accent) }, uFade: { value: .1 } },
  });
  const highlightWire = new THREE.LineSegments(highlightGeometry, highlightMaterial);
  const highlightFill = new THREE.Mesh(highlightFillGeometry, highlightFillMaterial);

  // The lighter reading of the same information: ring the reachable points
  // instead of boxing the cells around them. Same ring the selection uses, in
  // the accent colour and a size below it, so the two never compete. Unlike the
  // halo these are depth-tested -- a couple of hundred markers floating over
  // everything would say nothing about where they are.
  const markerGeometry = new THREE.BufferGeometry();
  markerGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HIGHLIGHT_MAX * 3), 3));
  const markerColors = new Float32Array(HIGHLIGHT_MAX * 3);
  for (let i = 0; i < HIGHLIGHT_MAX; i++) markerColors.set([...new THREE.Color(theme.accent)], i * 3);
  markerGeometry.setAttribute('aColor', new THREE.BufferAttribute(markerColors, 3));
  markerGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(HIGHLIGHT_MAX), 1));
  markerGeometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(HIGHLIGHT_MAX), 1));
  const markerMaterial = new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    uniforms: pointUniforms,
  });
  const markers = new THREE.Points(markerGeometry, markerMaterial);

  // Square mode uses the footprint itself as the move marker. One non-indexed
  // line loop per visible clone keeps the outline cheap and easy to rewrite as
  // cells separate during unfolding.
  const SQUARE_OUTLINE_MAX = HIGHLIGHT_MAX * (is4D ? 8 : 1);
  const squareOutlinePositions = new Float32Array(SQUARE_OUTLINE_MAX * 8 * 3);
  const squareOutlineGeometry = new THREE.BufferGeometry();
  squareOutlineGeometry.setAttribute('position', new THREE.BufferAttribute(squareOutlinePositions, 3));
  squareOutlineGeometry.setDrawRange(0, 0);
  const squareOutlineColor = new THREE.Color(theme.accent).lerp(new THREE.Color('#e8fff0'), 0.45);
  const squareOutlineMaterial = new THREE.LineBasicMaterial({
    color: squareOutlineColor, transparent: true, opacity: 0.92, depthWrite: false,
  });
  const squareOutlines = new THREE.LineSegments(squareOutlineGeometry, squareOutlineMaterial);

  for (const object of [highlightWire, highlightFill, markers, squareOutlines]) {
    object.frustumCulled = false;
    object.renderOrder = 3;
    object.visible = false;
    scene.add(object);
  }

  // ---- state
  // Layer spacing lost its slider but not its wiring: projectAt and
  // rebuildFolded still scale z by it, so putting a control back is one line.
  let spacing = 1;
  let targets = [];
  let reachMode = 'points';
  let unfoldT = 0;
  let unfoldTarget = 0;
  let colourMode = 'board';
  let latticeMode = 'squares';
  let layer = null;
  let selected = null;
  let showAxisLabels = true;
  let showPieces = true;
  let pieceMode = 'meshes';
  let rotationRunning = false;
  let disposed = false;
  let needsRender = true;

  // The 4D -> 3D step: w becomes distance from a camera on the w axis, so the
  // cells nest instead of overlapping. Positions in `pos` never change.
  const latticeFolded = new Float32Array(count * 3);
  function rebuildFolded() {
    for (let i = 0; i < count; i++) {
      const c = coords[i];
      const wScale = wScaleOf(c);
      latticeFolded[i * 3] = (c[0] - center[0]) * wScale;
      latticeFolded[i * 3 + 1] = (c[2] - center[2]) * spacing * wScale;
      latticeFolded[i * 3 + 2] = -(c[1] - center[1]) * wScale;
    }
  }

  function syncHalo() {
    const alpha = haloGeometry.attributes.aAlpha.array;
    const where = haloGeometry.attributes.position.array;
    alpha.fill(0);
    let n = 0;
    if (selected !== null) {
      for (let s = 0; s < slotCount && n < HALO_MAX; s++) {
        // A copy drawn as a model carries the rim instead; haloing it too
        // would put a bright disc inside the piece.
        if (slotLattice[s] !== selected || hasVisibleModelAt(s)) continue;
        where.set(positions.subarray(s * 3, s * 3 + 3), n * 3);
        alpha[n] = 0.85;
        n++;
      }
    }
    halo.visible = n > 0;
    haloGeometry.attributes.position.needsUpdate = true;
    haloGeometry.attributes.aAlpha.needsUpdate = true;
    haloGeometry.computeBoundingSphere();
  }

  // Coincident copies of a shared vertex show their cells' average; each one
  // resolves to its own cell's colour as that cell swings away from the rest.
  function applyColors() {
    if (colourMode === 'board') {
      pointColors.set(boardColors);
    } else if (colourMode === 'w') {
      pointColors.set(wColors);
    } else if (!is4D) {
      pointColors.set(cellColors);
    } else {
      for (let s = 0; s < slotCount; s++) {
        const ci = slotCell[s];
        const p = ci < 0 ? 1 : angles[ci] / (Math.PI / 2);
        for (let k = 0; k < 3; k++) {
          pointColors[s * 3 + k] = avgColors[s * 3 + k] * (1 - p) + cellColors[s * 3 + k] * p;
        }
      }
    }
    pointGeometry.attributes.aColor.needsUpdate = true;
    tileGeometry.attributes.aColor.needsUpdate = true;
  }

  function writeCellFrame(K, g, shift) {
    let o = 0;
    cornerCoords.forEach((corners, ci) => {
      const pts = corners.map((c) => {
        const out = [0, 0, 0];
        projectAt(unfoldCoord(c, ci, hinges, angles, coord4), K, g, spacing, out);
        return out.map((v, k) => v - shift[k]);
      });
      for (let e = 0; e < CORNER_EDGES.length; e += 2) {
        cellFramePositions.set(pts[CORNER_EDGES[e]], o);
        cellFramePositions.set(pts[CORNER_EDGES[e + 1]], o + 3);
        o += 6;
      }
    });
    cellFrameGeometry.attributes.position.needsUpdate = true;
  }

  function findMatchingSlot(lattice, cell) {
    if (cell) {
      for (let s = 0; s < slotCount; s++) {
        if (slotLattice[s] === lattice && slots[s].cell === cell) return s;
      }
    }
    return homeSlotOf[lattice];
  }

  const capturable = new Set();

  function updateCapturable() {
    capturable.clear();
    if (selected !== null) {
      const piece = pos.get(selected);
      const myColor = piece ? (piece === piece.toUpperCase() ? 'w' : 'b') : null;
      for (const target of targets) {
        const targetPiece = pos.get(target);
        if (targetPiece && (targetPiece === targetPiece.toUpperCase() ? 'w' : 'b') !== myColor) {
          capturable.add(target);
        }
      }
    }
  }

  function updatePiecePositions(now = performance.now()) {
    if (!pieceMesh) return;

    let easeT = 1;
    let arcY = 0;
    if (animatingMove) {
      const elapsed = now - animatingMove.startTime;
      const progress = Math.min(1, Math.max(0, elapsed / animatingMove.duration));
      easeT = progress * progress * (3 - 2 * progress);
      arcY = Math.sin(Math.PI * progress);
      if (progress >= 1) {
        animatingMove = null;
      }
    }

    pieceInstances.forEach((inst, k) => {
      const s = inst.slot;
      let tx = is4D ? positions[s * 3] : latticeFolded[inst.lattice * 3];
      let ty = is4D ? positions[s * 3 + 1] : latticeFolded[inst.lattice * 3 + 1];
      let tz = is4D ? positions[s * 3 + 2] : latticeFolded[inst.lattice * 3 + 2];
      let tScale = is4D ? pointSize[s] / basePointSize : 1;

      if (animatingMove && inst.lattice === animatingMove.to) {
        const fromSlot = is4D ? findMatchingSlot(animatingMove.from, slots[s].cell) : -1;
        const fx = is4D ? positions[fromSlot * 3] : latticeFolded[animatingMove.from * 3];
        const fy = is4D ? positions[fromSlot * 3 + 1] : latticeFolded[animatingMove.from * 3 + 1];
        const fz = is4D ? positions[fromSlot * 3 + 2] : latticeFolded[animatingMove.from * 3 + 2];
        const fScale = is4D ? pointSize[fromSlot] / basePointSize : 1;

        const dist = Math.hypot(tx - fx, ty - fy, tz - fz);
        const arcPeak = Math.min(0.65, 0.22 + 0.1 * dist);

        tx = fx + (tx - fx) * easeT;
        ty = fy + (ty - fy) * easeT + arcY * arcPeak;
        tz = fz + (tz - fz) * easeT;
        tScale = fScale + (tScale - fScale) * easeT;
      }

      pieceCenters[k * 3] = tx;
      pieceCenters[k * 3 + 1] = ty;
      pieceCenters[k * 3 + 2] = tz;
      pieceScale[k] = tScale;
      if (pieceCapturable) pieceCapturable[k] = capturable.has(inst.lattice) ? 1 : 0;

      if (is4D) {
        if (inst.home) {
          pieceAlpha[k] = 1;
        } else {
          const h = inst.homeSlot * 3;
          const apart = Math.hypot(
            positions[s * 3] - positions[h],
            positions[s * 3 + 1] - positions[h + 1],
            positions[s * 3 + 2] - positions[h + 2],
          );
          pieceAlpha[k] = GHOST_ALPHA * Math.min(1, apart / 0.6);
        }
      }
    });

    pieceMesh.geometry.attributes.aCenter.needsUpdate = true;
    pieceMesh.geometry.attributes.aScale.needsUpdate = true;
    if (pieceMesh.geometry.attributes.aCapturable) pieceMesh.geometry.attributes.aCapturable.needsUpdate = true;
    if (is4D) pieceMesh.geometry.attributes.aAlpha.needsUpdate = true;

    syncModelPieces();
  }

  function writeSlotPositions() {
    const t = unfoldT;
    const K = cameraK(t);
    const open = smooth(t);
    const g = 1 + (fitScale - 1) * open;
    const shift = netMid.map((v) => v * g * open);
    for (let ci = 0; ci < angles.length; ci++) angles[ci] = angleAt(t, ci);
    lastK = K;
    lastG = g;
    lastShift = shift;

    for (let s = 0; s < slotCount; s++) {
      const c = coords[slotLattice[s]];
      const ci = slotCell[s];
      const ws = ci >= 0
        ? projectAt(unfoldCoord(c, ci, hinges, angles, coord4), K, g, spacing, proj)
        : projectAt(c, K, g, spacing, proj);
      positions[s * 3] = proj[0] - shift[0];
      positions[s * 3 + 1] = proj[1] - shift[1];
      positions[s * 3 + 2] = proj[2] - shift[2];
      // Nearer the 4D camera reads larger, exactly as the lattice spacing does.
      pointSize[s] = basePointSize * ws * g * (is4D && ci < 0 ? 0.62 : 1);
      tileScale[s] = ws * g;
      const half = tileScale[s] / 2;
      const hit = s * 12;
      spaceHitPositions.set([
        positions[s * 3] - half, positions[s * 3 + 1], positions[s * 3 + 2] - half,
        positions[s * 3] + half, positions[s * 3 + 1], positions[s * 3 + 2] - half,
        positions[s * 3] + half, positions[s * 3 + 1], positions[s * 3 + 2] + half,
        positions[s * 3] - half, positions[s * 3 + 1], positions[s * 3 + 2] + half,
      ], hit);
    }
    pointGeometry.attributes.position.needsUpdate = true;
    pointGeometry.attributes.aSize.needsUpdate = true;
    tileGeometry.attributes.aCenter.needsUpdate = true;
    tileGeometry.attributes.aScale.needsUpdate = true;
    spaceHitGeometry.attributes.position.needsUpdate = true;
    spaceHitGeometry.computeBoundingSphere();
    pointGeometry.computeBoundingSphere();
    applyColors();
    if (is4D && pieceMesh) {
      updatePiecePositions();
    }
    if (is4D) writeCellFrame(K, g, shift);
    writeHighlights();
    syncHalo();
  }

  let lastK = K_FOLDED;
  let lastG = 1;
  let lastShift = [0, 0, 0];
  const cornerCoord = [0, 0, 0, 0];

  const shownTargets = [];

  function writeHighlights() {
    const squareMode = latticeMode !== 'verts' && reachMode === 'points';
    if (squareMode) {
      highlightWire.visible = false;
      highlightFill.visible = false;
      markers.visible = false;
      const targetSet = new Set(targets);
      let n = 0;
      for (let s = 0; s < slotCount && n < SQUARE_OUTLINE_MAX; s++) {
        if (!targetSet.has(slotLattice[s]) || !visible(s)) continue;
        if (is4D && !slots[s].cell && unfoldT >= 0.45) continue;
        const home = homeSlotOf[slotLattice[s]];
        if (is4D && s !== home) {
          const h = home * 3;
          const apart = Math.hypot(
            positions[s * 3] - positions[h],
            positions[s * 3 + 1] - positions[h + 1],
            positions[s * 3 + 2] - positions[h + 2],
          );
          if (apart < 0.06) continue;
        }
        const x = positions[s * 3];
        const y = positions[s * 3 + 1] + 0.008;
        const z = positions[s * 3 + 2];
        const half = tileScale[s] / 2;
        const corners = [
          [x - half, y, z - half], [x + half, y, z - half],
          [x + half, y, z + half], [x - half, y, z + half],
        ];
        const edgeOrder = [0, 1, 1, 2, 2, 3, 3, 0];
        for (let k = 0; k < edgeOrder.length; k++) {
          squareOutlinePositions.set(corners[edgeOrder[k]], (n * 8 + k) * 3);
        }
        n++;
      }
      squareOutlineGeometry.setDrawRange(0, n * 8);
      squareOutlineGeometry.attributes.position.needsUpdate = true;
      squareOutlineGeometry.computeBoundingSphere();
      squareOutlines.visible = n > 0;
      return;
    }
    squareOutlines.visible = false;
    // A target in a hidden layer or a filtered-out cell is not shown, whichever
    // reading is on, so the two always agree on what is being pointed at.
    shownTargets.length = 0;
    for (const lattice of targets) {
      const s = homeSlotOf[lattice];
      // Overriding selection behavior for capturable pieces: they render with a
      // transparent red material directly, so empty-square markers are suppressed.
      if (capturable.has(lattice)) continue;
      if (s >= 0 && visible(s) && shownTargets.length < HIGHLIGHT_MAX) shownTargets.push(lattice);
    }
    const n = shownTargets.length;
    const boxes = reachMode === 'cubes' && n > 0;
    highlightWire.visible = highlightFill.visible = boxes;
    markers.visible = reachMode === 'points' && n > 0;
    if (!n) return;

    if (!boxes) {
      const where = markerGeometry.attributes.position.array;
      const alpha = markerGeometry.attributes.aAlpha.array;
      const size = markerGeometry.attributes.aSize.array;
      alpha.fill(0);
      shownTargets.forEach((lattice, i) => {
        const s = homeSlotOf[lattice];
        where.set(positions.subarray(s * 3, s * 3 + 3), i * 3);
        alpha[i] = .9;
        // Tracks the point it rings, so it shrinks with distance in w too.
        size[i] = pointSize[s] * 2.6;
      });
      markerGeometry.attributes.position.needsUpdate = true;
      markerGeometry.attributes.aAlpha.needsUpdate = true;
      markerGeometry.attributes.aSize.needsUpdate = true;
      return;
    }

    shownTargets.forEach((lattice, i) => {
      const c = coords[lattice];
      const ci = slotCell[homeSlotOf[lattice]];
      for (let k = 0; k < 8; k++) {
        for (let a = 0; a < 4; a++) cornerCoord[a] = (c[a] ?? 0) + CUBE_CORNERS[k][a];
        // A cell that has swung away carries its boxes with it.
        const q = ci >= 0 ? unfoldCoord(cornerCoord, ci, hinges, angles, coord4) : cornerCoord;
        projectAt(q, lastK, lastG, spacing, proj);
        const at = (i * 8 + k) * 3;
        highlightCorners[at] = proj[0] - lastShift[0];
        highlightCorners[at + 1] = proj[1] - lastShift[1];
        highlightCorners[at + 2] = proj[2] - lastShift[2];
      }
    });
    highlightGeometry.setDrawRange(0, n * CUBE_EDGES.length);
    highlightFillGeometry.setDrawRange(0, n * CUBE_FACES.length);
    highlightPosition.needsUpdate = true;
  }

  function rebuildPositions() {
    rebuildFolded();
    writeSlotPositions();

    edgePairs.forEach((edge, i) => {
      edgePositions.set(latticeFolded.subarray(edge.a * 3, edge.a * 3 + 3), i * 6);
      edgePositions.set(latticeFolded.subarray(edge.b * 3, edge.b * 3 + 3), i * 6 + 3);
    });
    edgeGeometry.attributes.position.needsUpdate = true;
    edgeGeometry.computeBoundingSphere();

    // In 4D the pieces are placed per slot in writeSlotPositions, which has
    // already run; this folded-lattice path is for the 3D board only.
    if (pieceMesh && !is4D) {
      updatePiecePositions();
    } else {
      syncModelPieces();
    }
    needsRender = true;
  }

  // A cell pins one axis, so membership is a single coordinate test. Cells
  // overlap where they share a face, unlike the w shells this replaced.
  const visible = (s) => {
    const c = coords[slotLattice[s]];
    return layer === null || c[2] === layer;
  };

  const hasVisibleModelAt = (s) => {
    const piece = pos.get(slotLattice[s]);
    return showPieces && pieceMode === 'meshes' && piece
      && modelPieces.has(piece.toLowerCase()) && visible(s);
  };

  function applyFilters() {
    const t = unfoldT;
    for (let s = 0; s < slotCount; s++) {
      // Points on no cell have nowhere to unfold to, so they fade away.
      const fade = is4D && !slots[s].cell ? 1 - Math.min(1, t / 0.5) : 1;
      const base = (visible(s) ? baseAlpha[s] : 0.06) * fade;
      const home = homeSlotOf[slotLattice[s]];
      let cloneFade = 1;
      if (is4D && s !== home) {
        const h = home * 3;
        cloneFade = Math.min(1, Math.hypot(
          positions[s * 3] - positions[h],
          positions[s * 3 + 1] - positions[h + 1],
          positions[s * 3 + 2] - positions[h + 2],
        ) / 0.6);
      }
      tileAlpha[s] = base * cloneFade;
      // A point sprite and a model anchored at the same coordinate intersect
      // ambiguously because the sprite only has one flat depth value. The
      // model carries the occupied-square marker itself, so suppress that
      // sphere while retaining the point in the raycast geometry.
      pointAlpha[s] = latticeMode === 'verts' && !hasVisibleModelAt(s) ? base : 0;
    }
    pointGeometry.attributes.aAlpha.needsUpdate = true;
    tileGeometry.attributes.aAlpha.needsUpdate = true;
    const squareMode = latticeMode !== 'verts';
    const opaqueSquares = latticeMode === 'opaque';
    tileMesh.visible = squareMode;
    tileMaterial.transparent = !opaqueSquares;
    tileMaterial.uniforms.uOpacity.value = opaqueSquares ? 1 : 0.28;
    tileMaterial.uniforms.uOpaque.value = opaqueSquares ? 1 : 0;
    tileMaterial.uniforms.uEnvironmentStrength.value = opaqueSquares && tileMaterial.uniforms.uEnvironment.value ? .22 : 0;
    tileMaterial.depthWrite = opaqueSquares;

    edgePairs.forEach((edge, i) => {
      // The tesseract frame stays whole; only the 3D board grids answer to
      // the layer control.
      const on = layer === null || edge.z === layer || edge.z === null;
      edgeAlpha[i * 2] = edgeAlpha[i * 2 + 1] = on ? 0.35 : 0.04;
    });
    edgeGeometry.attributes.aAlpha.needsUpdate = true;

    if (pieceMesh) {
      // Sprites answer to the same layer and cell filters as their slots.
      pieceInstances.forEach((inst, k) => {
        const modeled = pieceMode === 'meshes' && modelPieces.has(pos.get(inst.lattice).toLowerCase());
        pieceHidden[k] = showPieces && visible(inst.slot) && !modeled ? 0 : 1;
      });
      pieceMesh.geometry.attributes.aHidden.needsUpdate = true;
    }
    syncModelPieces();
    needsRender = true;
  }

  function syncModelPieces() {
    modelPieces.update(pieceMode === 'meshes' && showPieces, pieceCenters, pieceScale, pieceAlpha,
      (inst) => visible(inst.slot), capturable);
  }

  let canvasWidth = 0;
  let canvasHeight = 0;
  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    // Creation happens before the viewer is attached to the explorer shell.
    // Wait for real layout dimensions rather than projecting a disposable
    // 600px square frame that would make overlays jump on the next paint.
    if (!width || !height) return;
    canvasWidth = width;
    canvasHeight = height;
    renderer.setSize(width, height, false);
    perspective.aspect = width / height;
    perspective.updateProjectionMatrix();
    const aspect = width / height;
    orthographic.left = -radius * aspect;
    orthographic.right = radius * aspect;
    orthographic.top = radius;
    orthographic.bottom = -radius;
    orthographic.updateProjectionMatrix();
    pointMaterial.uniforms.uHalfHeight.value = (height * renderer.getPixelRatio()) / 2;
    needsRender = true;
  }

  const labelPoint = new THREE.Vector3();
  function updateAxisLabels() {
    const canvasRect = canvas.getBoundingClientRect();
    const layerRect = axisLabelLayer.getBoundingClientRect();
    const midX = canvasRect.left + canvasRect.width / 2;
    const midY = canvasRect.top + canvasRect.height / 2;
    camera.updateMatrixWorld();
    for (const label of axisLabels) {
      labelPoint.fromArray(positions, label.slot * 3).project(camera);
      const inView = labelPoint.z >= -1 && labelPoint.z <= 1
        && labelPoint.x >= -1.08 && labelPoint.x <= 1.08
        && labelPoint.y >= -1.08 && labelPoint.y <= 1.08;
      label.element.hidden = !inView;
      if (!inView) continue;
      const x = canvasRect.left + (labelPoint.x + 1) * canvasRect.width / 2;
      const y = canvasRect.top + (1 - labelPoint.y) * canvasRect.height / 2;
      const dx = x - midX;
      const dy = y - midY;
      const length = Math.hypot(dx, dy) || 1;
      const offset = 10;
      label.element.style.left = `${x - layerRect.left + dx / length * offset}px`;
      label.element.style.top = `${y - layerRect.top + dy / length * offset}px`;
    }
    axisLabelLayer.classList.add('ready');
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  function setCamera(kind) {
    const next = kind === 'perspective' ? perspective : orthographic;
    next.position.copy(camera.position);
    camera = next;
    controls.object = next;
    pointMaterial.uniforms.uPerspective.value = kind === 'perspective' ? 1 : 0;
    controls.update();
    needsRender = true;
  }

  const zoomOutput = root.querySelector('.zoom-level');
  function reportZoom() {
    if (!zoomOutput) return;
    const ratio = camera.isOrthographicCamera
      ? camera.zoom
      : distance / camera.position.distanceTo(controls.target);
    zoomOutput.textContent = `${Math.round(ratio * 100)}%`;
  }

  controls.addEventListener('change', () => { needsRender = true; reportZoom(); });

  // ---- picking
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;

  canvas.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5;
    down = null;
    if (moved) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    // Pieces are picked off their own geometry, so a click lands where the
    // model actually is -- the head of a king included -- rather than on a
    // fixed-radius sphere at its foot. The point under a piece is no longer a
    // target of its own; it only becomes one again in glyph mode, or with the
    // pieces hidden, where pickTargets is empty.
    let bestPiece = null;
    let bestTarget = null;
    let bestSpace = null;
    const closer = (current, distance, slot) => {
      if (current && distance >= current.distance) return current;
      return { distance, lattice: slotLattice[slot] };
    };
    for (const { mesh, slots } of modelPieces.pickTargets()) {
      for (const hit of raycaster.intersectObject(mesh, false)) {
        const slot = pieceInstances[slots[hit.instanceId]].slot;
        if (visible(slot)) bestPiece = closer(bestPiece, hit.distance, slot);
      }
    }
    const spaceHits = raycaster.intersectObject(spaceHitMesh, false);
    for (const hit of spaceHits) {
      const slot = Math.floor(hit.faceIndex / 2);
      if (!visible(slot) || tileAlpha[slot] <= 0.1) continue;
      if (selected !== null && targets.includes(slotLattice[slot])) {
        bestTarget = closer(bestTarget, hit.distance, slot);
      } else {
        bestSpace = closer(bestSpace, hit.distance, slot);
      }
    }
    const best = bestTarget ?? bestPiece ?? bestSpace;
    if (best) onSelect(best.lattice);
  });

  // ---- controls wiring
  root.querySelector('.reset-camera').addEventListener('click', () => {
    camera.position.set(distance * 0.55, distance * 0.45, distance * 0.7);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
    reportZoom();
  });
  // Clicking a segment presses it and releases its sibling.
  function onSegment(name, handler) {
    const group = root.querySelector(`.segmented[aria-label="${name}"]`);
    group?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-value]');
      if (!button || button.getAttribute('aria-pressed') === 'true') return;
      for (const other of group.querySelectorAll('button')) {
        other.setAttribute('aria-pressed', String(other === button));
      }
      handler(button.dataset.value);
    });
  }

  onSegment('Projection', setCamera);
  onSegment('Hyperprojection', (value) => {
    wMode = value;
    measureNet();
    rebuildPositions();
  });
  onSegment('Move highlight', (value) => {
    reachMode = value;
    writeHighlights();
    needsRender = true;
  });
  const layerSelect = root.querySelector('[aria-label="Visible layer"]');
  layerSelect?.addEventListener('change', () => {
    layer = layerSelect.value === 'all' ? null : Number(layerSelect.value);
    applyFilters();
  });
  onSegment('Point colouring', (value) => {
    colourMode = value;
    applyColors();
    needsRender = true;
  });
  onSegment('Space style', (value) => {
    latticeMode = value;
    applyFilters();
    writeHighlights();
  });
  onSegment('Axis labels', (value) => {
    showAxisLabels = value === 'on';
    axisLabelLayer.hidden = !showAxisLabels;
    needsRender = true;
  });
  // Background is the scene clear, not a canvas style. Leaving it null keeps
  // the canvas transparent so the page shows through, which is what the viewer
  // has always drawn against.
  const OFF_WHITE = new THREE.Color('#f3f0e8');
  const skyStatus = document.createElement('output');
  skyStatus.setAttribute('aria-live', 'polite');
  root.querySelector('.cube-controls').append(skyStatus);
  let skyTexture = null;
  let skyRequested = false;
  let background = 'page';

  function applyBackground() {
    scene.background = background === 'paper' ? OFF_WHITE
      : background === 'sky' ? skyTexture
      : null;
    scene.environment = background === 'sky' ? skyTexture : null;
    tileMaterial.uniforms.uEnvironment.value = scene.environment;
    tileMaterial.uniforms.uEnvironmentStrength.value = latticeMode === 'opaque' && scene.environment ? .22 : 0;
    needsRender = true;
  }

  function requestSkybox() {
    if (skyRequested) return;
    skyRequested = true;
    loadSkybox().then((texture) => {
      if (disposed) return texture.dispose();
      skyTexture = texture;
      applyBackground();
    }, () => { skyStatus.textContent = 'Sky texture unavailable.'; });
  }

  root.querySelector('[aria-label="Background"]').addEventListener('change', (event) => {
    background = event.target.value;
    // A megabyte of sky is not worth fetching for the visitors who never ask
    // for it, so the texture is loaded the first time it is chosen.
    if (background === 'sky') requestSkybox();
    applyBackground();
  });

  // Addressed by label rather than type because the control strip contains
  // several independent ranges. Absent outside 4D, where there is no w.
  root.querySelector('[aria-label="W spacing"]')?.addEventListener('input', (e) => {
    wSpread = Number(e.target.value);
    // The open net changes size with the spread, exactly as it does with the
    // projection, so its fit has to be taken again.
    measureNet();
    rebuildPositions();
  });
  const unfoldButton = root.querySelector('.unfold');
  const foldSlider = root.querySelector('.fold-slider');
  const foldValue = root.querySelector('.fold-value');
  const rotationButton = root.querySelector('.rotation-toggle');
  const rotationSliders = Array.from(root.querySelectorAll('.rotation-slider'));
  const rotationValues = Array.from(root.querySelectorAll('.rotation-value'));

  function syncFoldUI() {
    if (foldSlider) foldSlider.value = String(unfoldT);
    if (foldValue) foldValue.textContent = unfoldT.toFixed(2);
    if (unfoldButton) {
      // The button names what it will do next, so it follows the target
      // rather than the current position while an animation is running.
      const opening = unfoldTarget >= 0.5;
      unfoldButton.textContent = opening ? 'Fold' : 'Unfold';
      unfoldButton.setAttribute('aria-pressed', String(opening));
    }
  }

  function syncRotationButton() {
    if (!rotationButton) return;
    rotationButton.textContent = rotationRunning ? 'Stop 4D rotation' : 'Start 4D rotation';
    rotationButton.setAttribute('aria-pressed', String(rotationRunning));
  }

  function syncRotationUI() {
    rotationSliders.forEach((slider, i) => {
      const rawTurn = rotationAngles[i] / TAU;
      const turn = rawTurn >= 0 && rawTurn <= 1
        ? rawTurn
        : ((rotationAngles[i] % TAU) + TAU) % TAU / TAU;
      slider.value = String(turn);
      if (rotationValues[i]) rotationValues[i].textContent = `${Math.round(turn * 360)}°`;
    });
  }

  function stopRotation() {
    if (!rotationRunning) return;
    rotationRunning = false;
    syncRotationButton();
  }

  unfoldButton?.addEventListener('click', () => {
    unfoldTarget = unfoldT >= 0.5 ? 0 : 1;
    syncFoldUI();
  });

  rotationButton?.addEventListener('click', () => {
    rotationRunning = !rotationRunning;
    syncRotationButton();
    needsRender = true;
  });

  rotationSliders.forEach((slider, i) => {
    slider.addEventListener('pointerdown', stopRotation);
    slider.addEventListener('input', () => {
      stopRotation();
      rotationAngles[i] = Number(slider.value) * TAU;
      writeSlotPositions();
      applyFilters();
      syncRotationUI();
    });
  });

  foldSlider?.addEventListener('input', () => {
    // Grabbing the slider takes over: matching the target to the current
    // value ends any run in progress, leaving the cells wherever they are,
    // and scrubbing then drives the fold directly in either direction.
    unfoldT = unfoldTarget = Number(foldSlider.value);
    writeSlotPositions();
    applyFilters();
    syncFoldUI();
  });
  root.querySelector('.piece-toggle input')?.addEventListener('change', (e) => {
    showPieces = e.target.checked;
    applyFilters();
  });
  root.querySelectorAll('[aria-label="Piece rendering"] button').forEach((button) => {
    button.addEventListener('click', () => {
      pieceMode = button.dataset.value;
      button.parentElement.querySelectorAll('button').forEach((option) => {
        option.setAttribute('aria-pressed', String(option === button));
      });
      applyFilters();
    });
  });

  // ---- loop: damping needs continuous updates, but rendering is conditional
  let frame = 0;
  let lastTick = performance.now();
  function tick(now = performance.now()) {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    if (canvas.clientWidth !== canvasWidth || canvas.clientHeight !== canvasHeight) resize();
    const elapsed = Math.min(.05, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    if (capturedToSpawn && captureSpawnReady) {
      const sq = capturedToSpawn.square;
      const home = homeSlotOf[sq];
      const captureSlots = is4D
        ? slots.flatMap((slot, s) => slot.lattice === sq && visible(s) ? [s] : [])
        : [home];
      const spawnedAt = [];
      for (const s of captureSlots) {
        if (s < 0) continue;
        const capX = is4D ? positions[s * 3] : latticeFolded[sq * 3];
        const capY = is4D ? positions[s * 3 + 1] : latticeFolded[sq * 3 + 1];
        const capZ = is4D ? positions[s * 3 + 2] : latticeFolded[sq * 3 + 2];
        // Folded clones occupy the same point. Emit once there, then fan out
        // naturally as unfolding gives each cell copy a distinct position.
        if (spawnedAt.some(([x, y, z]) => Math.hypot(capX - x, capY - y, capZ - z) < 0.001)) continue;
        spawnedAt.push([capX, capY, capZ]);
        const capScale = is4D ? (pointSize[s] / basePointSize) : 1;
        let capOpacity = 1;
        if (is4D && s !== home) {
          const apart = Math.hypot(
            positions[s * 3] - positions[home * 3],
            positions[s * 3 + 1] - positions[home * 3 + 1],
            positions[s * 3 + 2] - positions[home * 3 + 2],
          );
          capOpacity = GHOST_ALPHA * Math.min(1, apart / 0.6);
        }
        if (capOpacity > 0.01) {
          modelPieces.spawnTossed(capturedToSpawn.char, [capX, capY, capZ], capScale, capOpacity);
        }
      }
      capturedToSpawn = null;
    }
    captureSpawnReady = true;

    let positionsChanged = false;
    if (unfoldT !== unfoldTarget) {
      // Around 3.3s end to end, long enough to read each stage.
      const stepSize = 1 / 200;
      unfoldT = unfoldTarget > unfoldT
        ? Math.min(unfoldTarget, unfoldT + stepSize)
        : Math.max(unfoldTarget, unfoldT - stepSize);
      syncFoldUI();
      positionsChanged = true;
    }
    if (rotationRunning) {
      for (let i = 0; i < rotationAngles.length; i++) {
        rotationAngles[i] = (rotationAngles[i] + rotationSpeeds[i] * elapsed + TAU) % TAU;
      }
      syncRotationUI();
      positionsChanged = true;
    }
    if (positionsChanged) {
      writeSlotPositions();
      applyFilters();
    } else if (animatingMove) {
      updatePiecePositions(now);
      needsRender = true;
    }

    const hasTossed = modelPieces.updateTossed?.(elapsed);
    if (hasTossed) needsRender = true;

    if (controls.update() || needsRender) {
      updateAxisLabels();
      renderer.render(scene, camera);
      needsRender = false;
    }
  }

  rebuildPositions();
  applyFilters();
  resize();
  setCamera('perspective');
  reportZoom();
  syncFoldUI();
  syncRotationUI();
  // The caller restores the previous camera and fold state immediately after
  // creation. Starting on the next frame avoids briefly rendering defaults.
  frame = requestAnimationFrame(tick);

  return {
    element: root,
    getCameraState() {
      return {
        cameraKind: camera === perspective ? 'perspective' : 'orthographic',
        position: camera.position.clone(),
        target: controls.target.clone(),
        zoom: camera.zoom,
        pieceMode,
        showPieces,
        reachMode,
        colourMode,
        latticeMode,
        showAxisLabels,
        wMode,
        wSpread,
        unfoldT,
        unfoldTarget,
        rotationRunning,
        rotationAngles: Array.from(rotationAngles),
        layer,
        background,
      };
    },
    setCameraState(state) {
      if (!state) return;
      if (state.cameraKind) setCamera(state.cameraKind);
      if (state.position) camera.position.copy(state.position);
      if (state.target) controls.target.copy(state.target);
      if (state.zoom !== undefined) {
        camera.zoom = state.zoom;
        camera.updateProjectionMatrix();
      }
      controls.update();
      reportZoom();

      let needsRebuild = false;
      if (state.pieceMode !== undefined && state.pieceMode !== pieceMode) {
        pieceMode = state.pieceMode;
        root.querySelectorAll('[aria-label="Piece rendering"] button').forEach((btn) => {
          btn.setAttribute('aria-pressed', String(btn.dataset.value === pieceMode));
        });
      }
      if (state.showPieces !== undefined && state.showPieces !== showPieces) {
        showPieces = state.showPieces;
        const cb = root.querySelector('.piece-toggle input');
        if (cb) cb.checked = showPieces;
      }
      if (state.reachMode !== undefined && state.reachMode !== reachMode) {
        reachMode = state.reachMode;
        root.querySelectorAll('[aria-label="Move highlight"] button').forEach((btn) => {
          btn.setAttribute('aria-pressed', String(btn.dataset.value === reachMode));
        });
      }
      if (state.colourMode !== undefined && state.colourMode !== colourMode) {
        colourMode = state.colourMode;
        root.querySelectorAll('[aria-label="Point colouring"] button').forEach((btn) => {
          btn.setAttribute('aria-pressed', String(btn.dataset.value === colourMode));
        });
        applyColors();
      }
      if (state.latticeMode !== undefined && state.latticeMode !== latticeMode) {
        latticeMode = state.latticeMode;
        root.querySelectorAll('[aria-label="Space style"] button').forEach((btn) => {
          btn.setAttribute('aria-pressed', String(btn.dataset.value === latticeMode));
        });
      }
      if (state.showAxisLabels !== undefined && state.showAxisLabels !== showAxisLabels) {
        showAxisLabels = state.showAxisLabels;
        axisLabelLayer.hidden = !showAxisLabels;
        root.querySelectorAll('[aria-label="Axis labels"] button').forEach((btn) => {
          btn.setAttribute('aria-pressed', String((btn.dataset.value === 'on') === showAxisLabels));
        });
      }
      if (state.wMode !== undefined && state.wMode !== wMode) {
        wMode = state.wMode;
        root.querySelectorAll('[aria-label="Hyperprojection"] button').forEach((btn) => {
          btn.setAttribute('aria-pressed', String(btn.dataset.value === wMode));
        });
        needsRebuild = true;
      }
      if (state.wSpread !== undefined && state.wSpread !== wSpread) {
        wSpread = state.wSpread;
        const wInput = root.querySelector('[aria-label="W spacing"]');
        if (wInput) wInput.value = String(wSpread);
        measureNet();
        needsRebuild = true;
      }
      if (state.unfoldT !== undefined) {
        unfoldT = state.unfoldT;
        unfoldTarget = state.unfoldTarget ?? state.unfoldT;
        syncFoldUI();
      }
      if (state.rotationRunning !== undefined && state.rotationRunning !== rotationRunning) {
        rotationRunning = state.rotationRunning;
        syncRotationButton();
      }
      if (state.rotationAngles && rotationAngles) {
        for (let i = 0; i < rotationAngles.length; i++) {
          rotationAngles[i] = ((state.rotationAngles[i] % TAU) + TAU) % TAU;
        }
        syncRotationUI();
      }
      if (state.layer !== undefined && state.layer !== layer) {
        layer = state.layer;
        const layerSelect = root.querySelector('[aria-label="Visible layer"]');
        if (layerSelect) layerSelect.value = layer === null ? 'all' : String(layer);
      }
      if (state.background !== undefined && state.background !== background) {
        background = state.background;
        const bgSelect = root.querySelector('[aria-label="Background"]');
        if (bgSelect) bgSelect.value = background;
        if (background === 'sky') requestSkybox();
        applyBackground();
      }

      if (needsRebuild) {
        rebuildPositions();
      } else {
        writeSlotPositions();
      }
      applyFilters();
      needsRender = true;
    },
    update(index) {
      selected = index;
      if (selected !== null) {
        if (layer !== null && layerSelect) { layer = coords[selected][2]; layerSelect.value = String(layer); applyFilters(); }
      }
      targets = selected === null ? [] : envelope(pos, selected);
      updateCapturable();
      modelPieces.setCapturable(capturable);
      modelPieces.setHighlight(selected);
      writeSlotPositions();
      const piece = selected === null ? null : pos.get(selected);
      const coordText = selected === null ? ''
        : coords[selected].map((v, i) => `${['x', 'y', 'z', 'w'][i] ?? i}:${v + 1}`).join(', ');
      caption.textContent = selected === null ? ''
        : `${squareName(pos.shape, selected)} · ${piece ? `${piece === piece.toUpperCase() ? 'White' : 'Black'} ${nameOf(piece.toLowerCase())}` : 'Empty'} · (${coordText})`;
      needsRender = true;
    },
    destroy() {
      disposed = true;
      if (creditDialog.open) creditDialog.close();
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      pointGeometry.dispose();
      tileGeometry.dispose();
      spaceHitGeometry.dispose();
      edgeGeometry.dispose();
      haloGeometry.dispose();
      highlightGeometry.dispose();
      highlightFillGeometry.dispose();
      squareOutlineGeometry.dispose();
      markerGeometry.dispose();
      markerMaterial.dispose();
      highlightMaterial.dispose();
      highlightFillMaterial.dispose();
      squareOutlineMaterial.dispose();
      pointMaterial.dispose();
      tileMaterial.dispose();
      spaceHitMaterial.dispose();
      edgeMaterial.dispose();
      halo.material.dispose();
      pieceMesh?.geometry.dispose();
      pieceMesh?.material.dispose();
      atlas?.texture.dispose();
      skyTexture?.dispose();
      modelPieces.dispose();
      renderer.dispose();
    },
  };
}
