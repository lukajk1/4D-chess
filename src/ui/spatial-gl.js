import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { squareName } from '../core/notation.js';
import { nameOf } from '../core/pieces.js';

// WebGL viewer for the lattice. The 4D -> 3D projection stays here in JS
// because it is part of the model; three.js only handles 3D -> 2D and raster.
//
// Everything the camera touches lives in three buffers -- lattice points, wire
// edges and billboarded piece glyphs -- so a frame costs three draw calls
// regardless of whether there are 512 positions or 4,096.

const W_COLORS = ['#698d88', '#629d8a', '#65ad82', '#87b975', '#b4bf70', '#d1b96e', '#dda275', '#df877a'];

const readTheme = () => {
  const style = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => (style.getPropertyValue(name).trim() || fallback);
  return {
    light: pick('--light-square', '#ebe6dd'),
    dark: pick('--dark-square', '#9aa88f'),
    muted: pick('--muted', '#6b7480'),
    selected: pick('--selected', '#e8c27d'),
  };
};

const POINT_VERTEX = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uHalfHeight;
  uniform float uPerspective;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // projectionMatrix[1][1] converts world units to clip units for both
    // camera types, so one expression covers orthographic and perspective.
    float px = aSize * uHalfHeight * projectionMatrix[1][1];
    gl_PointSize = uPerspective > 0.5 ? px / max(-mv.z, 0.0001) : px;
  }`;

const POINT_FRAGMENT = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // Round the square point sprite and feather its edge.
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.42, d));
  }`;

const LINE_VERTEX = `
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const LINE_FRAGMENT = `
  varying float vAlpha;
  uniform vec3 uColor;
  void main() { gl_FragColor = vec4(uColor, vAlpha); }`;

const PIECE_VERTEX = `
  attribute vec3 aCenter;
  attribute vec2 aCell;
  attribute float aHidden;
  varying vec2 vUv;
  varying vec2 vCell;
  varying float vHidden;
  uniform float uSize;
  void main() {
    vUv = uv;
    vCell = aCell;
    vHidden = aHidden;
    // Billboard by offsetting in view space, which faces the camera under
    // both projections without any per-frame CPU work.
    vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
  }`;

const PIECE_FRAGMENT = `
  varying vec2 vUv;
  varying vec2 vCell;
  varying float vHidden;
  uniform sampler2D uAtlas;
  uniform vec2 uGrid;
  void main() {
    if (vHidden > 0.5) discard;
    // Atlas rows run top-down; the quad's v runs bottom-up.
    vec2 uv = (vCell + vec2(vUv.x, 1.0 - vUv.y)) / uGrid;
    vec4 texel = texture2D(uAtlas, uv);
    // Alpha test rather than blending, so glyphs need no depth sorting.
    if (texel.a < 0.4) discard;
    gl_FragColor = vec4(texel.rgb, 1.0);
  }`;

function buildGlyphAtlas(chars, glyphFor) {
  const cell = 128;
  const cols = Math.max(1, Math.ceil(Math.sqrt(chars.length)));
  const rows = Math.max(1, Math.ceil(chars.length / cols));
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(cell * 0.74)}px "Segoe UI Symbol", "DejaVu Sans", serif`;
  ctx.lineJoin = 'round';

  const index = new Map();
  chars.forEach((char, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const white = char === char.toUpperCase();
    ctx.lineWidth = cell * 0.07;
    ctx.strokeStyle = white ? '#354537' : '#e0e5d4';
    ctx.fillStyle = white ? '#fffdf6' : '#26362c';
    const x = (col + 0.5) * cell;
    const y = (row + 0.55) * cell;
    ctx.strokeText(glyphFor(char), x, y);
    ctx.fillText(glyphFor(char), x, y);
    index.set(char, [col, row]);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, cols, rows, index };
}

export function createSpatialView(pos, onSelect, glyphFor) {
  const is4D = pos.dims === 4;
  const theme = readTheme();
  const count = pos.squares.length;
  const coords = pos.squares.map((_, i) => pos.coord(i));
  const center = pos.shape.map((n) => (n - 1) / 2);
  const pieceIndices = pos.squares.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  const pieceCount = pieceIndices.length;

  // ---- DOM shell (markup mirrors the previous viewer so styling carries over)
  const root = document.createElement('section');
  root.className = 'cube-view';
  root.innerHTML = `
    <div class="cube-heading"><div><span class="eyebrow">${is4D ? '4D → 3D → 2D' : 'Spatial view'}</span><h2>${is4D ? 'Eight cubes. Four coordinates.' : 'Eight layers. One space.'}</h2></div><button class="reset-camera">Reset view</button></div>
    <div class="cube-controls">
      <label>${is4D ? '3D camera' : 'Projection'} <select aria-label="Projection"><option value="orthographic">Orthographic</option><option value="perspective">Perspective</option></select></label>
      ${is4D ? `<label>Cube <select aria-label="Visible w cube"><option value="all">All 8 cubes</option>${Array.from({ length: pos.shape[3] }, (_, w) => `<option value="${w}">w = ${w + 1}</option>`).join('')}</select></label>` : ''}
      <label>Layer <select aria-label="Visible layer"><option value="all">All ${pos.shape[2]} layers</option>${Array.from({ length: pos.shape[2] }, (_, z) => `<option value="${z}">Layer ${z + 1}</option>`).join('')}</select></label>
      <label>Spacing <input aria-label="Layer spacing" type="range" min="0.6" max="2" step="0.05" value="1"></label>
      ${pieceCount ? '<label class="piece-toggle"><input type="checkbox" checked> Pieces</label>' : ''}
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
    legend.innerHTML = W_COLORS.map((color, w) => `<span><i style="background:${color}"></i>w${w + 1}</span>`).join('');
    root.append(legend);
    const explanation = document.createElement('p');
    explanation.className = 'hint';
    explanation.textContent = 'Perspective along w nests the cubes: w1 innermost, w8 outermost. Dashed lines join matching corners across w.';
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

  // ---- geometry buffers
  const positions = new Float32Array(count * 3);
  const pointColors = new Float32Array(count * 3);
  const pointAlpha = new Float32Array(count).fill(1);
  const pointSize = new Float32Array(count);
  const scratch = new THREE.Color();

  const basePointSize = is4D ? 0.09 : 0.13;
  for (let i = 0; i < count; i++) {
    const parity = coords[i].reduce((a, b) => a + b, 0) % 2;
    scratch.set(is4D ? W_COLORS[coords[i][3]] : parity ? theme.dark : theme.light);
    pointColors.set([scratch.r, scratch.g, scratch.b], i * 3);
    pointSize[i] = basePointSize;
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
  for (let w = 0; w < (pos.shape[3] ?? 1); w++) {
    const c = (x, y, z) => (is4D ? [x, y, z, w] : [x, y, z]);
    const zList = is4D ? [0, maxZ] : Array.from({ length: pos.shape[2] }, (_, i) => i);
    for (const z of zList) {
      const xList = is4D ? [0, maxX] : Array.from({ length: pos.shape[0] }, (_, i) => i);
      const yList = is4D ? [0, maxY] : Array.from({ length: pos.shape[1] }, (_, i) => i);
      for (const x of xList) edgePairs.push({ a: at(c(x, 0, z)), b: at(c(x, maxY, z)), z, w });
      for (const y of yList) edgePairs.push({ a: at(c(0, y, z)), b: at(c(maxX, y, z)), z, w });
    }
    for (const x of [0, maxX]) {
      for (const y of [0, maxY]) {
        edgePairs.push({ a: at(c(x, y, 0)), b: at(c(x, y, maxZ)), z: null, w });
        if (is4D && w < pos.shape[3] - 1) {
          for (const z of [0, maxZ]) edgePairs.push({ a: at(c(x, y, z)), b: at([x, y, z, w + 1]), z: null, w });
        }
      }
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
    uniforms: { uColor: { value: new THREE.Color(theme.muted) } },
  });
  const wireframe = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  wireframe.renderOrder = 0;
  scene.add(wireframe);

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
  const haloGeometry = new THREE.BufferGeometry();
  haloGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  haloGeometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array([...new THREE.Color(theme.selected)]), 3));
  haloGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array([0.85]), 1));
  haloGeometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([basePointSize * 3.4]), 1));
  const halo = new THREE.Points(haloGeometry, new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: pointMaterial.uniforms,
  }));
  halo.renderOrder = 3;
  halo.visible = false;
  scene.add(halo);

  // ---- state
  let spacing = 1;
  let layer = null;
  let wLayer = null;
  let selected = null;
  let showPieces = true;
  let disposed = false;
  let needsRender = true;

  // The 4D -> 3D step: w becomes distance from a camera on the w axis, so the
  // eight cubes nest instead of overlapping. Positions in `pos` never change.
  function worldPosition(i, out) {
    const c = coords[i];
    const wScale = is4D ? 2.5 / (2.5 - (c[3] - center[3]) / (center[3] || 1)) : 1;
    out[0] = (c[0] - center[0]) * wScale;
    out[1] = (c[2] - center[2]) * spacing * wScale;
    out[2] = -(c[1] - center[1]) * wScale;
  }

  const tmp = [0, 0, 0];
  function rebuildPositions() {
    for (let i = 0; i < count; i++) {
      worldPosition(i, tmp);
      positions.set(tmp, i * 3);
    }
    pointGeometry.attributes.position.needsUpdate = true;
    pointGeometry.computeBoundingSphere();

    edgePairs.forEach((edge, i) => {
      edgePositions.set(positions.subarray(edge.a * 3, edge.a * 3 + 3), i * 6);
      edgePositions.set(positions.subarray(edge.b * 3, edge.b * 3 + 3), i * 6 + 3);
    });
    edgeGeometry.attributes.position.needsUpdate = true;
    edgeGeometry.computeBoundingSphere();

    if (pieceMesh) {
      pieceIndices.forEach((squareIndex, i) => {
        pieceCenters.set(positions.subarray(squareIndex * 3, squareIndex * 3 + 3), i * 3);
      });
      pieceMesh.geometry.attributes.aCenter.needsUpdate = true;
    }
    needsRender = true;
  }

  const visible = (i) => (layer === null || coords[i][2] === layer)
    && (wLayer === null || coords[i][3] === wLayer);

  function applyFilters() {
    for (let i = 0; i < count; i++) pointAlpha[i] = visible(i) ? 1 : 0.06;
    pointGeometry.attributes.aAlpha.needsUpdate = true;

    edgePairs.forEach((edge, i) => {
      const on = (wLayer === null || edge.w === wLayer) && (layer === null || edge.z === layer || edge.z === null);
      edgeAlpha[i * 2] = edgeAlpha[i * 2 + 1] = on ? 0.35 : 0.04;
    });
    edgeGeometry.attributes.aAlpha.needsUpdate = true;

    if (pieceMesh) {
      pieceIndices.forEach((squareIndex, i) => {
        pieceHidden[i] = showPieces && visible(squareIndex) ? 0 : 1;
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
      .filter((hit) => visible(hit.index));
    if (hits.length) onSelect(hits[0].index);
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
  const wSelect = root.querySelector('[aria-label="Visible w cube"]');
  layerSelect.addEventListener('change', () => {
    layer = layerSelect.value === 'all' ? null : Number(layerSelect.value);
    applyFilters();
  });
  wSelect?.addEventListener('change', () => {
    wLayer = wSelect.value === 'all' ? null : Number(wSelect.value);
    applyFilters();
  });
  root.querySelector('input[type=range]').addEventListener('input', (e) => {
    spacing = Number(e.target.value);
    rebuildPositions();
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
        if (wLayer !== null && wSelect) { wLayer = coords[selected][3]; wSelect.value = String(wLayer); applyFilters(); }
        worldPosition(selected, tmp);
        haloGeometry.attributes.position.array.set(tmp);
        haloGeometry.attributes.position.needsUpdate = true;
        haloGeometry.computeBoundingSphere();
      }
      halo.visible = selected !== null;
      const piece = selected === null ? null : pos.get(selected);
      caption.textContent = selected === null
        ? `${count.toLocaleString()} positions · ${pieceCount} pieces${is4D ? ' · Each w cube holds 512 positions.' : ' · Kings and queens on layers 4 and 5.'}`
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
