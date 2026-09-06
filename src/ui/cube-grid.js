import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { squareName } from '../core/notation.js';
import { nameOf } from '../core/pieces.js';
import { tesseractCells, localIndexIn } from './tesseract.js';
import {
  CELL_COLORS, readTheme, LINE_VERTEX, LINE_FRAGMENT,
  PIECE_VERTEX, PIECE_FRAGMENT, buildGlyphAtlas, makePointCloud,
} from './gl-shared.js';

// The eight cubic cells of the tesseract, drawn as one canvas with eight
// scissored viewports rather than eight WebGL contexts -- browsers cap context
// count, and the master viewer already holds one.
//
// All eight share a single camera, so orbiting compares the same angle across
// every cell. Cells that meet at a face share vertices, so selecting a point
// can light up as many as four of these cubes at once.

export function createCubeGrid(pos, onSelect, glyphFor) {
  const theme = readTheme();
  const cells = tesseractCells(pos.shape);

  const root = document.createElement('section');
  root.className = 'cube-grid-panel';
  root.innerHTML = `
    <div class="cube-heading">
      <div>
        <span class="eyebrow">The eight cells</span>
        <h2>One cube per face of the hypercube.</h2>
      </div>
      <button class="reset-grid">Reset view</button>
    </div>
    <p class="hint">Each cell pins one axis to its lowest or highest value. <strong>w = 1</strong> is the interior cube and <strong>w = 8</strong> the outer one; the six between them join those two face to face. Cells share the vertices along their common faces, so one point can appear in several cubes.</p>`;

  const grid = document.createElement('div');
  grid.className = 'cube-grid';
  const cellEls = cells.map((cell, i) => {
    const el = document.createElement('div');
    el.className = `cube-cell role-${cell.role}`;
    el.dataset.cell = String(i);
    el.style.setProperty('--w-color', CELL_COLORS[cell.id]);
    const label = document.createElement('span');
    label.className = 'cube-cell-label';
    label.innerHTML = `${cell.label}${cell.role === 'face' ? '' : ` <em>${cell.role}</em>`}`;
    el.append(label);
    grid.append(el);
    return el;
  });
  const canvas = document.createElement('canvas');
  canvas.className = 'cube-grid-canvas';
  canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-label', 'The eight cells of the tesseract. Drag to orbit all of them; click a point to inspect it.');
  grid.append(canvas);
  root.append(grid);

  const caption = document.createElement('p');
  caption.className = 'cube-caption';
  caption.setAttribute('aria-live', 'polite');
  root.append(caption);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.autoClear = false;

  // Every cell spans the same three-axis extent on an even-sided board.
  const span = cells[0].size.map((n) => (n - 1) / 2);
  const radius = Math.hypot(...span) + 0.9;
  const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.1, radius * 40);
  camera.position.set(radius * 2.1, radius * 1.7, radius * 2.6);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.enablePan = false;
  controls.rotateSpeed = 0.85;

  const pointUniforms = { uHalfHeight: { value: 120 }, uPerspective: { value: 0 } };
  const pieceChars = [...new Set(pos.squares.filter(Boolean))];
  const atlas = pieceChars.length ? buildGlyphAtlas(pieceChars, glyphFor) : null;

  // A cell's three free axes become the cube's three spatial axes, in the same
  // screen mapping the master viewer uses: second free axis goes up.
  const localCoord = (cell, local) => [
    local % cell.size[0],
    Math.floor(local / cell.size[0]) % cell.size[1],
    Math.floor(local / (cell.size[0] * cell.size[1])) % cell.size[2],
  ];
  const worldOf = (c) => [c[0] - span[0], c[2] - span[2], -(c[1] - span[1])];

  const cubes = cells.map((cell, i) => {
    const scene = new THREE.Scene();
    const { geometry, material, points } = makePointCloud(cell.count, pointUniforms);
    const position = geometry.attributes.position.array;
    const color = geometry.attributes.aColor.array;
    const size = geometry.attributes.aSize.array;
    const scratch = new THREE.Color();

    for (let local = 0; local < cell.count; local++) {
      const c = localCoord(cell, local);
      position.set(worldOf(c), local * 3);
      scratch.set((c[0] + c[1] + c[2]) % 2 ? theme.dark : theme.light);
      color.set([scratch.r, scratch.g, scratch.b], local * 3);
      size[local] = 0.3;
    }
    geometry.computeBoundingSphere();
    scene.add(points);

    // Twelve outline edges only: full board grids are unreadable this small.
    const corners = [];
    for (const a of [0, cell.size[0] - 1]) for (const b of [0, cell.size[1] - 1]) for (const c of [0, cell.size[2] - 1]) corners.push([a, b, c]);
    const edges = [];
    for (let a = 0; a < corners.length; a++) {
      for (let b = a + 1; b < corners.length; b++) {
        const differing = corners[a].reduce((n, v, k) => n + (v === corners[b][k] ? 0 : 1), 0);
        if (differing === 1) edges.push(...worldOf(corners[a]), ...worldOf(corners[b]));
      }
    }
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edges), 3));
    edgeGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(edges.length / 3).fill(0.3), 1));
    const edgeMaterial = new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX,
      fragmentShader: LINE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(CELL_COLORS[cell.id]) } },
    });
    scene.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));

    let pieceMesh = null;
    const occupied = [];
    for (let local = 0; local < cell.count; local++) if (pos.get(cell.indices[local])) occupied.push(local);
    if (occupied.length && atlas) {
      const quad = new THREE.InstancedBufferGeometry();
      quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
      ]), 3));
      quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
      quad.setIndex([0, 1, 2, 0, 2, 3]);
      quad.instanceCount = occupied.length;
      const centers = new Float32Array(occupied.length * 3);
      const atlasCells = new Float32Array(occupied.length * 2);
      occupied.forEach((local, k) => {
        centers.set(worldOf(localCoord(cell, local)), k * 3);
        atlasCells.set(atlas.index.get(pos.get(cell.indices[local])), k * 2);
      });
      quad.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centers, 3));
      quad.setAttribute('aCell', new THREE.InstancedBufferAttribute(atlasCells, 2));
      quad.setAttribute('aHidden', new THREE.InstancedBufferAttribute(new Float32Array(occupied.length), 1));
      pieceMesh = new THREE.Mesh(quad, new THREE.ShaderMaterial({
        vertexShader: PIECE_VERTEX,
        fragmentShader: PIECE_FRAGMENT,
        uniforms: {
          uAtlas: { value: atlas.texture },
          uGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
          uSize: { value: 0.8 },
        },
      }));
      pieceMesh.frustumCulled = false;
      scene.add(pieceMesh);
    }

    const halo = makePointCloud(1, pointUniforms);
    halo.geometry.attributes.aColor.array.set([...new THREE.Color(theme.selected)]);
    halo.geometry.attributes.aSize.array[0] = 0.52;
    halo.geometry.attributes.aAlpha.array[0] = 0.9;
    halo.material.depthTest = false;
    halo.points.renderOrder = 3;
    halo.points.visible = false;
    halo.points.frustumCulled = false;
    scene.add(halo.points);

    return { cell, scene, el: cellEls[i], geometry, material, edgeGeometry, edgeMaterial, pieceMesh, halo, points };
  });

  let disposed = false;
  let needsRender = true;

  function resize() {
    const rect = grid.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    const cellRect = cellEls[0].getBoundingClientRect();
    const aspect = (cellRect.width || 1) / (cellRect.height || 1);
    camera.left = -radius * aspect;
    camera.right = radius * aspect;
    camera.top = radius;
    camera.bottom = -radius;
    camera.updateProjectionMatrix();
    pointUniforms.uHalfHeight.value = (cellRect.height * renderer.getPixelRatio()) / 2;
    needsRender = true;
  }

  const observer = new ResizeObserver(resize);
  observer.observe(grid);

  function render() {
    const rect = grid.getBoundingClientRect();
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    renderer.setScissorTest(true);
    for (const cube of cubes) {
      const r = cube.el.getBoundingClientRect();
      const left = r.left - rect.left;
      const bottom = rect.bottom - r.bottom;
      renderer.setViewport(left, bottom, r.width, r.height);
      renderer.setScissor(left, bottom, r.width, r.height);
      renderer.clearDepth();
      renderer.render(cube.scene, camera);
    }
    renderer.setScissorTest(false);
  }

  let frame = 0;
  function tick() {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    if (controls.update() || needsRender) {
      render();
      needsRender = false;
    }
  }
  controls.addEventListener('change', () => { needsRender = true; });

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.22;
  const pointer = new THREE.Vector2();
  let down = null;

  canvas.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY }; });
  canvas.addEventListener('pointerup', (event) => {
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5;
    down = null;
    if (moved) return;
    for (const cube of cubes) {
      const r = cube.el.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) continue;
      pointer.x = ((event.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((event.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(cube.points, false);
      if (hits.length) onSelect(cube.cell.indices[hits[0].index]);
      return;
    }
  });

  root.querySelector('.reset-grid').addEventListener('click', () => {
    camera.position.set(radius * 2.1, radius * 1.7, radius * 2.6);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
    needsRender = true;
  });

  resize();
  tick();

  return {
    element: root,
    update(index) {
      let owners = 0;
      for (const cube of cubes) {
        const local = index === null ? -1 : localIndexIn(cube.cell, pos.shape, index);
        const owns = local >= 0;
        if (owns) owners++;
        cube.el.classList.toggle('active', owns);
        cube.halo.points.visible = owns;
        if (!owns) continue;
        cube.halo.geometry.attributes.position.array.set(worldOf(localCoord(cube.cell, local)));
        cube.halo.geometry.attributes.position.needsUpdate = true;
      }
      const piece = index === null ? null : pos.get(index);
      if (index === null) {
        caption.textContent = 'Eight cells of 512 positions each; 2,800 distinct points lie on them.';
      } else if (owners === 0) {
        caption.textContent = `${squareName(pos.shape, index)} · interior point — on none of the eight cells.`;
      } else {
        caption.textContent = `${squareName(pos.shape, index)} · ${piece ? `${piece === piece.toUpperCase() ? 'White' : 'Black'} ${nameOf(piece.toLowerCase())}` : 'Empty'} · on ${owners} cell${owners > 1 ? 's' : ''}`;
      }
      needsRender = true;
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      for (const cube of cubes) {
        cube.geometry.dispose();
        cube.material.dispose();
        cube.edgeGeometry.dispose();
        cube.edgeMaterial.dispose();
        cube.pieceMesh?.geometry.dispose();
        cube.pieceMesh?.material.dispose();
        cube.halo.geometry.dispose();
        cube.halo.material.dispose();
      }
      atlas?.texture.dispose();
      renderer.dispose();
    },
  };
}
