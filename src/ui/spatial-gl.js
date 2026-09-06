import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { squareName } from '../core/notation.js';
import { nameOf } from '../core/pieces.js';
import { isInterior, tesseractCells, latticeStats, localIndexIn, localCoordIn, PLACEMENT } from './tesseract.js';
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
  const sizeFolded = new Float32Array(slotCount);
  const sizeUnfolded = new Float32Array(slotCount);
  const baseAlpha = new Float32Array(slotCount).fill(1);
  const scratch = new THREE.Color();

  slots.forEach((slot, s) => {
    const c = coords[slot.lattice];
    const parity = c.reduce((a, b) => a + b, 0) % 2;
    // One colour per cell, so the interior and outer cubes read as whole
    // objects. The six face cells keep the sector colours they already had.
    scratch.set(is4D
      ? (slot.cell ? CELL_COLORS[slot.cell.id] : theme.muted)
      : parity ? theme.dark : theme.light);
    pointColors.set([scratch.r, scratch.g, scratch.b], s * 3);
    const loose = is4D && !slot.cell;
    sizeFolded[s] = basePointSize * wScaleOf(c) * (loose ? 0.62 : 1);
    sizeUnfolded[s] = basePointSize * (loose ? 0.62 : 1);
    pointSize[s] = sizeFolded[s];
    baseAlpha[s] = loose ? 0.22 : 1;
  });

  // ---- where every slot lands once unfolded, scaled to occupy about the same
  // screen space as the folded tesseract so the camera never has to move.
  const netTarget = new Float32Array(slotCount * 3);
  const netCorners = [];
  if (is4D) {
    const extent = pos.shape[0] - 1;
    const step = extent * 1.04;
    const place = (cell, lc) => {
      const span = cell.size.map((n) => (n - 1) / 2);
      const at = PLACEMENT[cell.id];
      return [
        at[0] * step + (lc[0] - span[0]),
        at[1] * step + (lc[2] - span[2]),
        at[2] * step - (lc[1] - span[1]),
      ];
    };
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const raw = new Float32Array(slotCount * 3);
    slots.forEach((slot, s) => {
      if (!slot.cell) return;
      const p = place(slot.cell, localCoordIn(slot.cell, localIndexIn(slot.cell, pos.shape, slot.lattice)));
      raw.set(p, s * 3);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    });
    const mid = lo.map((v, k) => (v + hi[k]) / 2);
    const netScale = radius / (Math.hypot(...hi.map((v, k) => v - mid[k])) || 1);
    slots.forEach((slot, s) => {
      if (!slot.cell) return;
      for (let k = 0; k < 3; k++) netTarget[s * 3 + k] = (raw[s * 3 + k] - mid[k]) * netScale;
    });
    // Box outlines for each cell, in the same net space.
    for (const cell of cells) {
      const corners = [];
      for (const a of [0, cell.size[0] - 1]) for (const b of [0, cell.size[1] - 1]) for (const d of [0, cell.size[2] - 1]) {
        const p = place(cell, [a, b, d]);
        corners.push(p.map((v, k) => (v - mid[k]) * netScale));
      }
      for (let a = 0; a < corners.length; a++) {
        for (let b = a + 1; b < corners.length; b++) {
          const differing = [0, 1, 2].reduce((n, k) => n + (Math.abs(corners[a][k] - corners[b][k]) < 1e-6 ? 0 : 1), 0);
          if (differing === 1) netCorners.push(...corners[a], ...corners[b]);
        }
      }
    }
  }

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  pointGeometry.setAttribute('aColor', new THREE.BufferAttribute(pointColors, 3));
  pointGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(pointAlpha, 1));
  pointGeometry.setAttribute('aSize', new THREE.BufferAttribute(pointSize, 1));

  const pointMaterial = new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    uniforms: { uHalfHeight: { value: 300 }, uPerspective: { value: 0 } },
  });
  const pointCloud = new THREE.Points(pointGeometry, pointMaterial);
  pointCloud.renderOrder = 1;
  scene.add(pointCloud);

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
    // A tesseract frame: the interior cell (w minimum), the outer cell (w
    // maximum), and the eight edges joining matching corners. Drawing a box at
    // every w produced eight nested cubes, which is not a tesseract -- the
    // cells of a tesseract meet at faces.
    const maxW = pos.shape[3] - 1;
    for (const w of [0, maxW]) {
      cubeEdges(boxCorners, (a, b) => edgePairs.push({ a: at([...a, w]), b: at([...b, w]), z: null, w: null }));
    }
    for (const corner of boxCorners) {
      edgePairs.push({ a: at([...corner, 0]), b: at([...corner, maxW]), z: null, w: null });
    }
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
  if (is4D) {
    const netGeometry = new THREE.BufferGeometry();
    netGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(netCorners), 3));
    netGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(netCorners.length / 3).fill(0.32), 1));
    netFrameMaterial = new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX,
      fragmentShader: LINE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(theme.muted) }, uFade: { value: 0 } },
    });
    const netFrame = new THREE.LineSegments(netGeometry, netFrameMaterial);
    netFrame.renderOrder = 0;
    scene.add(netFrame);
  }

  // ---- pieces as one instanced, billboarded quad
  let pieceMesh = null;
  let pieceCenters = null;
  let pieceHidden = null;
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
    quad.instanceCount = pieceCount;

    pieceCenters = new Float32Array(pieceCount * 3);
    pieceHidden = new Float32Array(pieceCount);
    const cells = new Float32Array(pieceCount * 2);
    pieceIndices.forEach((squareIndex, i) => {
      cells.set(atlas.index.get(pos.get(squareIndex)), i * 2);
    });
    quad.setAttribute('aCenter', new THREE.InstancedBufferAttribute(pieceCenters, 3));
    quad.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    quad.setAttribute('aHidden', new THREE.InstancedBufferAttribute(pieceHidden, 1));

    pieceMesh = new THREE.Mesh(quad, new THREE.ShaderMaterial({
      vertexShader: PIECE_VERTEX,
      fragmentShader: PIECE_FRAGMENT,
      uniforms: {
        uAtlas: { value: atlas.texture },
        uGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uSize: { value: 0.85 },
      },
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

  const ease = () => unfoldT * unfoldT * (3 - 2 * unfoldT);

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

  function writeSlotPositions() {
    const t = ease();
    for (let s = 0; s < slotCount; s++) {
      const l = slotLattice[s] * 3;
      const travels = is4D && slots[s].cell;
      for (let k = 0; k < 3; k++) {
        positions[s * 3 + k] = travels
          ? latticeFolded[l + k] * (1 - t) + netTarget[s * 3 + k] * t
          : latticeFolded[l + k];
      }
      pointSize[s] = sizeFolded[s] * (1 - t) + sizeUnfolded[s] * t;
    }
    pointGeometry.attributes.position.needsUpdate = true;
    pointGeometry.attributes.aSize.needsUpdate = true;
    pointGeometry.computeBoundingSphere();
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

    if (pieceMesh) {
      pieceIndices.forEach((squareIndex, i) => {
        pieceCenters.set(latticeFolded.subarray(squareIndex * 3, squareIndex * 3 + 3), i * 3);
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
    const t = ease();
    for (let s = 0; s < slotCount; s++) {
      // Points on no cell have nowhere to unfold to, so they fade away.
      const fade = is4D && !slots[s].cell ? 1 - t : 1;
      pointAlpha[s] = (visible(s) ? baseAlpha[s] : 0.06) * fade;
    }
    pointGeometry.attributes.aAlpha.needsUpdate = true;
    edgeMaterial.uniforms.uFade.value = 1 - t;
    if (netFrameMaterial) netFrameMaterial.uniforms.uFade.value = t;

    edgePairs.forEach((edge, i) => {
      // The tesseract frame stays whole; only the 3D board grids answer to
      // the layer control.
      const on = layer === null || edge.z === layer || edge.z === null;
      edgeAlpha[i * 2] = edgeAlpha[i * 2 + 1] = on ? 0.35 : 0.04;
    });
    edgeGeometry.attributes.aAlpha.needsUpdate = true;

    if (pieceMesh) {
      pieceIndices.forEach((squareIndex, i) => {
        pieceHidden[i] = showPieces && (layer === null || coords[squareIndex][2] === layer) ? 0 : 1;
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
      // About three quarters of a second end to end, eased in writeSlotPositions.
      const stepSize = 1 / 45;
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
