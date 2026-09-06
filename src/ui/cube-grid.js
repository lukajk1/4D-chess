import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { squareName } from '../core/notation.js';
import { nameOf } from '../core/pieces.js';
import {
  W_COLORS, readTheme, LINE_VERTEX, LINE_FRAGMENT,
  PIECE_VERTEX, PIECE_FRAGMENT, buildGlyphAtlas, makePointCloud,
} from './gl-shared.js';

// The eight cubes that compose the tesseract, drawn as one canvas with eight
// scissored viewports rather than eight WebGL contexts -- browsers cap context
// count, and the master viewer already holds one.
//
// All eight share a single camera, so orbiting compares the same angle across
// every cube. Each keeps its own scene because it holds different geometry.

export function createCubeGrid(pos, onSelect, glyphFor) {
  const [sizeX, sizeY, sizeZ, cubeCount] = pos.shape;
  const perCube = sizeX * sizeY * sizeZ;
  const theme = readTheme();
  const center = [(sizeX - 1) / 2, (sizeY - 1) / 2, (sizeZ - 1) / 2];

  // ---- DOM: labelled cells with one canvas laid over them
  const root = document.createElement('section');
  root.className = 'cube-grid-panel';
  root.innerHTML = `
    <div class="cube-heading">
      <div>
        <span class="eyebrow">Component cubes</span>
        <h2>Eight cubes, one angle.</h2>
      </div>
      <button class="reset-grid">Reset view</button>
    </div>
    <p class="hint">Each cube is one w layer of the lattice above. Drag any cube to orbit all eight together; selecting a point anywhere highlights it in its own cube.</p>`;

  const grid = document.createElement('div');
  grid.className = 'cube-grid';
  const cells = [];
  for (let w = 0; w < cubeCount; w++) {
    const cell = document.createElement('div');
    cell.className = 'cube-cell';
    cell.dataset.w = String(w);
    cell.style.setProperty('--w-color', W_COLORS[w]);
    const label = document.createElement('span');
    label.className = 'cube-cell-label';
    label.textContent = `w = ${w + 1}`;
    cell.append(label);
    grid.append(cell);
    cells.push(cell);
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'cube-grid-canvas';
  canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-label', 'The eight component cubes. Drag to orbit all of them; click a point to inspect it.');
  grid.append(canvas);
  root.append(grid);

  const caption = document.createElement('p');
  caption.className = 'cube-caption';
  caption.setAttribute('aria-live', 'polite');
  root.append(caption);

  // ---- renderer, shared camera
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.autoClear = false;

  const radius = Math.hypot(...center) + 0.9;
  const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.1, radius * 40);
  camera.position.set(radius * 2.1, radius * 1.7, radius * 2.6);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.enablePan = false;
  controls.rotateSpeed = 0.85;

  const pointUniforms = { uHalfHeight: { value: 120 }, uPerspective: { value: 0 } };

  // ---- one scene per cube
  const pieceChars = [...new Set(pos.squares.filter(Boolean))];
  const atlas = pieceChars.length ? buildGlyphAtlas(pieceChars, glyphFor) : null;

  const localCoord = (local) => [
    local % sizeX,
    Math.floor(local / sizeX) % sizeY,
    Math.floor(local / (sizeX * sizeY)) % sizeZ,
  ];
  // Same axis mapping as the master viewer: z is up the screen, y goes back.
  const worldOf = (c) => [c[0] - center[0], c[2] - center[2], -(c[1] - center[1])];

  const cubes = cells.map((cell, w) => {
    const scene = new THREE.Scene();
    const { geometry, material, points } = makePointCloud(perCube, pointUniforms);
    const position = geometry.attributes.position.array;
    const color = geometry.attributes.aColor.array;
    const size = geometry.attributes.aSize.array;
    const scratch = new THREE.Color();

    for (let local = 0; local < perCube; local++) {
      const c = localCoord(local);
      position.set(worldOf(c), local * 3);
      scratch.set((c[0] + c[1] + c[2]) % 2 ? theme.dark : theme.light);
      color.set([scratch.r, scratch.g, scratch.b], local * 3);
      size[local] = 0.16;
    }
    geometry.computeBoundingSphere();
    scene.add(points);

    // Twelve outline edges only: board grids are unreadable at this size.
    const corners = [];
    for (const x of [0, sizeX - 1]) for (const y of [0, sizeY - 1]) for (const z of [0, sizeZ - 1]) corners.push([x, y, z]);
    const edgePositions = [];
    for (let a = 0; a < corners.length; a++) {
      for (let b = a + 1; b < corners.length; b++) {
        const differing = corners[a].reduce((n, v, i) => n + (v === corners[b][i] ? 0 : 1), 0);
        if (differing !== 1) continue;
        edgePositions.push(...worldOf(corners[a]), ...worldOf(corners[b]));
      }
    }
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgePositions), 3));
    edgeGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(edgePositions.length / 3).fill(0.3), 1));
    const edgeMaterial = new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX,
      fragmentShader: LINE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(theme.muted) } },
    });
    scene.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));

    // Pieces belonging to this cube.
    let pieceMesh = null;
    const locals = [];
    for (let local = 0; local < perCube; local++) if (pos.get(w * perCube + local)) locals.push(local);
    if (locals.length && atlas) {
      const quad = new THREE.InstancedBufferGeometry();
      quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
      ]), 3));
      quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
      quad.setIndex([0, 1, 2, 0, 2, 3]);
      quad.instanceCount = locals.length;
      const centers = new Float32Array(locals.length * 3);
      const atlasCells = new Float32Array(locals.length * 2);
      locals.forEach((local, i) => {
        centers.set(worldOf(localCoord(local)), i * 3);
        atlasCells.set(atlas.index.get(pos.get(w * perCube + local)), i * 2);
      });
      quad.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centers, 3));
      quad.setAttribute('aCell', new THREE.InstancedBufferAttribute(atlasCells, 2));
      quad.setAttribute('aHidden', new THREE.InstancedBufferAttribute(new Float32Array(locals.length), 1));
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

    // Selection marker, shown only in the cube that owns the selected point.
    const halo = makePointCloud(1, pointUniforms);
    halo.geometry.attributes.aColor.array.set([...new THREE.Color(theme.selected)]);
    halo.geometry.attributes.aSize.array[0] = 0.52;
    halo.geometry.attributes.aAlpha.array[0] = 0.9;
    halo.material.depthTest = false;
    halo.points.renderOrder = 3;
    halo.points.visible = false;
    halo.points.frustumCulled = false;
    scene.add(halo.points);

    return { scene, cell, geometry, material, edgeGeometry, edgeMaterial, pieceMesh, halo, points };
  });

  // ---- sizing: the canvas covers the grid; each cell becomes a viewport
  let disposed = false;
  let needsRender = true;

  function resize() {
    const rect = grid.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    const cellRect = cells[0].getBoundingClientRect();
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
      const r = cube.cell.getBoundingClientRect();
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

  // ---- picking: locate the cell under the pointer, then ray-cast its scene
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.22;
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
    for (const cube of cubes) {
      const r = cube.cell.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) continue;
      pointer.x = ((event.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((event.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(cube.points, false);
      if (hits.length) onSelect(Number(cube.cell.dataset.w) * perCube + hits[0].index);
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
      const owner = index === null ? -1 : Math.floor(index / perCube);
      cubes.forEach((cube, w) => {
        cube.cell.classList.toggle('active', w === owner);
        cube.halo.points.visible = w === owner;
        if (w !== owner) return;
        const c = localCoord(index % perCube);
        cube.halo.geometry.attributes.position.array.set(worldOf(c));
        cube.halo.geometry.attributes.position.needsUpdate = true;
      });
      const piece = index === null ? null : pos.get(index);
      caption.textContent = index === null
        ? `${cubeCount} cubes of ${perCube.toLocaleString()} positions each.`
        : `${squareName(pos.shape, index)} · ${piece ? `${piece === piece.toUpperCase() ? 'White' : 'Black'} ${nameOf(piece.toLowerCase())}` : 'Empty'} · cube w = ${owner + 1}`;
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
