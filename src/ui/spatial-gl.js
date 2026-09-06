import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { squareName } from '../core/notation.js';
import { nameOf } from '../core/pieces.js';
import { isInterior, tesseractCells, latticeStats, hingeTree, unfoldCoord } from './tesseract.js';
import {
  CELL_COLORS, readTheme, POINT_VERTEX, POINT_FRAGMENT,
  LINE_VERTEX, LINE_FRAGMENT, PIECE_VERTEX, PIECE_FRAGMENT, buildGlyphAtlas,
} from './gl-shared.js';

// WebGL viewer for the lattice. The 4D -> 3D projection stays here in JS
// because it is part of the model; three.js only handles 3D -> 2D and raster.
//
// Everything the camera touches lives in three buffers -- lattice points, wire
// edges and billboarded piece glyphs -- so a frame costs three draw calls
// regardless of whether there are 512 positions or 4,096.

export function createSpatialView(pos, onSelect, glyphFor) {
  const is4D = pos.dims === 4;
  const theme = readTheme();
  const count = pos.squares.length;
  const coords = pos.squares.map((_, i) => pos.coord(i));
  const center = pos.shape.map((n) => (n - 1) / 2);
  const cells = is4D ? tesseractCells(pos.shape) : [];
  const stats = latticeStats(pos.shape);
  const royalLayers = pos.variant?.royalLayers ?? null;
  const pieceIndices = pos.squares.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  const pieceCount = pieceIndices.length;

  // ---- DOM shell (markup mirrors the previous viewer so styling carries over)
  const root = document.createElement('section');
  root.className = 'cube-view';
  root.innerHTML = `
    <div class="cube-heading"><div><span class="eyebrow">${is4D ? '4D → 3D → 2D' : 'Spatial view'}</span><h2>${is4D ? 'One tesseract, eight cells.' : 'Eight layers. One space.'}</h2></div><button class="reset-camera">Reset view</button></div>
    <div class="cube-controls">
      <label>${is4D ? '3D camera' : 'Projection'} <select aria-label="Projection"><option value="orthographic">Orthographic</option><option value="perspective">Perspective</option></select></label>
      ${is4D ? `<label>Cell <select aria-label="Visible cell"><option value="all">All 8 cells</option>${cells.map((cell, i) => `<option value="${i}">${cell.label}${cell.role === 'face' ? '' : ` (${cell.role})`}</option>`).join('')}</select></label>` : ''}
      ${is4D ? '<label>Colour <select aria-label="Point colouring"><option value="cell">By cell</option><option value="board">Chessboard</option></select></label>' : ''}
      <label>Layer <select aria-label="Visible layer"><option value="all">All ${pos.shape[2]} layers</option>${Array.from({ length: pos.shape[2] }, (_, z) => `<option value="${z}">Layer ${z + 1}</option>`).join('')}</select></label>
      <label>Spacing <input aria-label="Layer spacing" type="range" min="0.6" max="2" step="0.05" value="1"></label>
      ${pieceCount ? '<label class="piece-toggle"><input type="checkbox" checked> Pieces</label>' : ''}
      ${is4D ? '<button class="unfold">Unfold</button>' : ''}
      <output class="zoom-level" aria-label="Zoom level">100%</output>
    </div>`;

  const canvas = document.createElement('canvas');
  canvas.className = 'cube-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-label', `${pos.dims}D chess lattice. Drag to orbit, scroll to zoom, click a point to inspect.`);
  root.append(canvas);

  if (is4D) {
    const legend = document.createElement('div');
    legend.className = 'w-legend';
    legend.innerHTML = cells.map((cell) => `<span><i style="background:${CELL_COLORS[cell.id]}"></i>${cell.label}${cell.role === 'face' ? '' : ` ${cell.role}`}</span>`).join('');
    root.append(legend);
    const explanation = document.createElement('p');
    explanation.className = 'hint';
    explanation.textContent = `Radius carries w: the w = 1 cell is the inner cube, w = ${pos.shape[3]} the outer. Colour carries the angular sector, so a wedge shares its colour with the face of the inner cube it grows from — that is where each of the six remaining cells lives. Points on no cell stay faint.`;
    root.append(explanation);
  }

  const caption = document.createElement('p');
  caption.className = 'cube-caption';
  caption.setAttribute('aria-live', 'polite');
  const help = document.createElement('p');
  help.className = 'hint';
  help.textContent = 'Drag to orbit · Scroll to zoom · Click a point to inspect.';
  root.append(caption, help);

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
  controls.enablePan = false;
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
  const basePointSize = is4D ? 0.19 : 0.16;

  const slots = [];
  if (is4D) {
    for (const cell of cells) for (const lattice of cell.indices) slots.push({ lattice, cell });
    for (let i = 0; i < count; i++) if (isInterior(pos.shape, i)) slots.push({ lattice: i, cell: null });
  } else {
    for (let i = 0; i < count; i++) slots.push({ lattice: i, cell: null });
  }
  const slotCount = slots.length;
  const slotLattice = new Int32Array(slots.map((slot) => slot.lattice));

  const positions = new Float32Array(slotCount * 3);
  const pointColors = new Float32Array(slotCount * 3);
  const pointAlpha = new Float32Array(slotCount).fill(1);
  const pointSize = new Float32Array(slotCount);
  const baseAlpha = new Float32Array(slotCount).fill(1);
  const scratch = new THREE.Color();

  // Two colourings, switchable at runtime: one colour per cell so the interior
  // and outer cubes read as whole objects, or the chessboard parity used on
  // every other board in the app.
  const cellColors = new Float32Array(slotCount * 3);
  const boardColors = new Float32Array(slotCount * 3);
  slots.forEach((slot, s) => {
    const c = coords[slot.lattice];
    const parity = c.reduce((a, b) => a + b, 0) % 2;
    scratch.set(parity ? theme.dark : theme.light);
    boardColors.set([scratch.r, scratch.g, scratch.b], s * 3);
    scratch.set(is4D ? (slot.cell ? CELL_COLORS[slot.cell.id] : theme.muted) : parity ? theme.dark : theme.light);
    cellColors.set([scratch.r, scratch.g, scratch.b], s * 3);
    const loose = is4D && !slot.cell;
    pointSize[s] = basePointSize * wScaleOf(c) * (loose ? 0.62 : 1);
    baseAlpha[s] = loose ? 0.22 : 1;
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
  const cameraK = (t) => K_FOLDED + (K_UNFOLDED - K_FOLDED) * smooth(clamp01(t / 0.25));
  const wScaleAt = (w, K) => (is4D ? K / (K - (w - center[3]) / (center[3] || 1)) : 1);

  // Project a 4D point for a given camera, scale and spacing. Returns wScale.
  function projectAt(c, K, g, sp, out) {
    const ws = wScaleAt(c[3], K);
    out[0] = (c[0] - center[0]) * ws * g;
    out[1] = (c[2] - center[2]) * sp * ws * g;
    out[2] = -(c[1] - center[1]) * ws * g;
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

    // Size the fully open net against the folded footprint.
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
    cellFrameGeometry = new THREE.BufferGeometry();
    cellFrameGeometry.setAttribute('position', new THREE.BufferAttribute(cellFramePositions, 3));
    cellFrameGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(cellFramePositions.length / 3).fill(0.32), 1));
    netFrameMaterial = new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX,
      fragmentShader: LINE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(theme.muted) }, uFade: { value: 1 } },
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
    const atlasCells = new Float32Array(instanceCount * 2);
    pieceInstances.forEach((inst, k) => {
      atlasCells.set(atlas.index.get(pos.get(inst.lattice)), k * 2);
    });
    quad.setAttribute('aCenter', new THREE.InstancedBufferAttribute(pieceCenters, 3));
    quad.setAttribute('aCell', new THREE.InstancedBufferAttribute(atlasCells, 2));
    quad.setAttribute('aHidden', new THREE.InstancedBufferAttribute(pieceHidden, 1));
    quad.setAttribute('aScale', new THREE.InstancedBufferAttribute(pieceScale, 1));
    quad.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(pieceAlpha, 1));

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
    fragmentShader: POINT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: pointMaterial.uniforms,
  }));
  halo.frustumCulled = false;
  halo.renderOrder = 3;
  halo.visible = false;
  scene.add(halo);

  // ---- state
  let spacing = 1;
  let unfoldT = 0;
  let unfoldTarget = 0;
  let colourMode = 'cell';
  let layer = null;
  let cellFilter = null;
  let selected = null;
  let showPieces = true;
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
    if (selected !== null) {
      let n = 0;
      for (let s = 0; s < slotCount && n < HALO_MAX; s++) {
        if (slotLattice[s] !== selected) continue;
        where.set(positions.subarray(s * 3, s * 3 + 3), n * 3);
        alpha[n] = 0.85;
        n++;
      }
    }
    haloGeometry.attributes.position.needsUpdate = true;
    haloGeometry.attributes.aAlpha.needsUpdate = true;
    haloGeometry.computeBoundingSphere();
  }

  // Coincident copies of a shared vertex show their cells' average; each one
  // resolves to its own cell's colour as that cell swings away from the rest.
  function applyColors() {
    if (colourMode === 'board') {
      pointColors.set(boardColors);
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

  function writeSlotPositions() {
    const t = unfoldT;
    const K = cameraK(t);
    const open = smooth(t);
    const g = 1 + (fitScale - 1) * open;
    const shift = netMid.map((v) => v * g * open);
    for (let ci = 0; ci < angles.length; ci++) angles[ci] = angleAt(t, ci);

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
    }
    pointGeometry.attributes.position.needsUpdate = true;
    pointGeometry.attributes.aSize.needsUpdate = true;
    pointGeometry.computeBoundingSphere();
    applyColors();
    if (is4D && pieceMesh) {
      // Every sprite follows its own slot and scales with the lattice spacing
      // there. A ghost stays invisible while it still coincides with the home
      // copy and fades in as the unfold carries it away.
      pieceInstances.forEach((inst, k) => {
        const s = inst.slot;
        pieceCenters.set(positions.subarray(s * 3, s * 3 + 3), k * 3);
        pieceScale[k] = pointSize[s] / basePointSize;
        if (inst.home) { pieceAlpha[k] = 1; return; }
        const h = inst.homeSlot * 3;
        const apart = Math.hypot(
          positions[s * 3] - positions[h],
          positions[s * 3 + 1] - positions[h + 1],
          positions[s * 3 + 2] - positions[h + 2],
        );
        pieceAlpha[k] = GHOST_ALPHA * Math.min(1, apart / 0.6);
      });
      pieceMesh.geometry.attributes.aCenter.needsUpdate = true;
      pieceMesh.geometry.attributes.aScale.needsUpdate = true;
      pieceMesh.geometry.attributes.aAlpha.needsUpdate = true;
    }
    if (is4D) writeCellFrame(K, g, shift);
    syncHalo();
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
      pieceInstances.forEach((inst, k) => {
        pieceCenters.set(latticeFolded.subarray(inst.lattice * 3, inst.lattice * 3 + 3), k * 3);
      });
      pieceMesh.geometry.attributes.aCenter.needsUpdate = true;
    }
    needsRender = true;
  }

  // A cell pins one axis, so membership is a single coordinate test. Cells
  // overlap where they share a face, unlike the w shells this replaced.
  const visible = (s) => {
    const c = coords[slotLattice[s]];
    return (layer === null || c[2] === layer)
      && (cellFilter === null || slots[s].cell === cellFilter);
  };

  function applyFilters() {
    const t = unfoldT;
    for (let s = 0; s < slotCount; s++) {
      // Points on no cell have nowhere to unfold to, so they fade away.
      const fade = is4D && !slots[s].cell ? 1 - Math.min(1, t / 0.5) : 1;
      pointAlpha[s] = (visible(s) ? baseAlpha[s] : 0.06) * fade;
    }
    pointGeometry.attributes.aAlpha.needsUpdate = true;

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
        pieceHidden[k] = showPieces && visible(inst.slot) ? 0 : 1;
      });
      pieceMesh.geometry.attributes.aHidden.needsUpdate = true;
    }
    needsRender = true;
  }

  function resize() {
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 600;
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
    const ratio = camera.isOrthographicCamera
      ? camera.zoom
      : distance / camera.position.distanceTo(controls.target);
    zoomOutput.textContent = `${Math.round(ratio * 100)}%`;
  }

  controls.addEventListener('change', () => { needsRender = true; reportZoom(); });

  // ---- picking
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = is4D ? 0.16 : 0.2;
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
    const hits = raycaster.intersectObject(pointCloud, false)
      .filter((hit) => visible(hit.index) && pointAlpha[hit.index] > 0.1);
    if (hits.length) onSelect(slotLattice[hits[0].index]);
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
  root.querySelector('[aria-label="Projection"]').addEventListener('change', (e) => setCamera(e.target.value));
  const layerSelect = root.querySelector('[aria-label="Visible layer"]');
  const cellSelect = root.querySelector('[aria-label="Visible cell"]');
  layerSelect.addEventListener('change', () => {
    layer = layerSelect.value === 'all' ? null : Number(layerSelect.value);
    applyFilters();
  });
  cellSelect?.addEventListener('change', () => {
    cellFilter = cellSelect.value === 'all' ? null : cells[Number(cellSelect.value)];
    applyFilters();
  });
  root.querySelector('[aria-label="Point colouring"]')?.addEventListener('change', (e) => {
    colourMode = e.target.value;
    applyColors();
    // The legend names cells, so it only applies to the cell colouring.
    const legend = root.querySelector('.w-legend');
    if (legend) legend.hidden = colourMode === 'board';
    needsRender = true;
  });
  root.querySelector('input[type=range]').addEventListener('input', (e) => {
    spacing = Number(e.target.value);
    rebuildPositions();
  });
  const unfoldButton = root.querySelector('.unfold');
  unfoldButton?.addEventListener('click', () => {
    unfoldTarget = unfoldTarget > 0 ? 0 : 1;
    unfoldButton.textContent = unfoldTarget > 0 ? 'Fold' : 'Unfold';
    unfoldButton.setAttribute('aria-pressed', String(unfoldTarget > 0));
  });
  root.querySelector('.piece-toggle input')?.addEventListener('change', (e) => {
    showPieces = e.target.checked;
    applyFilters();
  });

  // ---- loop: damping needs continuous updates, but rendering is conditional
  let frame = 0;
  function tick() {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    if (unfoldT !== unfoldTarget) {
      // Around 3.3s end to end, long enough to read each stage.
      const stepSize = 1 / 200;
      unfoldT = unfoldTarget > unfoldT
        ? Math.min(unfoldTarget, unfoldT + stepSize)
        : Math.max(unfoldTarget, unfoldT - stepSize);
      writeSlotPositions();
      applyFilters();
    }
    if (controls.update() || needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }
  }

  rebuildPositions();
  applyFilters();
  resize();
  setCamera('orthographic');
  reportZoom();
  tick();

  return {
    element: root,
    update(index) {
      selected = index;
      if (selected !== null) {
        if (layer !== null) { layer = coords[selected][2]; layerSelect.value = String(layer); applyFilters(); }
        if (cellFilter !== null && cellSelect) {
          // Keep the filtered cell if it holds the selection; otherwise follow
          // the selection to one of its cells, or drop the filter when the
          // point is interior and belongs to none.
          const owners = cells.filter((cell) => coords[selected][cell.axis] === cell.at);
          const next = owners.includes(cellFilter) ? cellFilter : owners[0] ?? null;
          if (next !== cellFilter) {
            cellFilter = next;
            cellSelect.value = next ? String(cells.indexOf(next)) : 'all';
            applyFilters();
          }
        }
      }
      halo.visible = selected !== null;
      syncHalo();
      const piece = selected === null ? null : pos.get(selected);
      caption.textContent = selected === null
        ? `${count.toLocaleString()} positions · ${pieceCount} pieces${is4D
            ? ` · ${stats.boundary.toLocaleString()} lie on the eight cells, ${stats.interior.toLocaleString()} strictly inside.`
            : royalLayers ? ` · Kings and queens on layers ${royalLayers.map((z) => z + 1).join(' and ')}.` : ''}`
        : `${squareName(pos.shape, selected)} · ${piece ? `${piece === piece.toUpperCase() ? 'White' : 'Black'} ${nameOf(piece.toLowerCase())}` : 'Empty'} · ${coords[selected].map((v, axis) => `${'xyzw'[axis]} ${v + 1}`).join(', ')}`;
      needsRender = true;
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      pointGeometry.dispose();
      edgeGeometry.dispose();
      haloGeometry.dispose();
      pointMaterial.dispose();
      edgeMaterial.dispose();
      halo.material.dispose();
      pieceMesh?.geometry.dispose();
      pieceMesh?.material.dispose();
      atlas?.texture.dispose();
      renderer.dispose();
    },
  };
}
