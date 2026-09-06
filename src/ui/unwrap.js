import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { squareName } from '../core/notation.js';
import { tesseractCells, localIndexIn, PLACEMENT, hingeTree, unfoldCoord } from './tesseract.js';
import { CELL_COLORS, readTheme } from './gl-shared.js';

// The tesseract unfolded into 3D: the interior cell sits at the centre and the
// six face cells attach to the six faces it shares with them, so adjacency in
// 4D becomes adjacency you can walk around. The outer cell has no free face
// left on the centre cube, so it continues the column past the bottom arm --
// the standard hypercube net.
//
// Cells are drawn as translucent solids rather than point clouds: at this scale
// the shape of each cell and how it joins its neighbours is the whole point.

export function createUnwrapView(pos, onSelect, options = {}) {
  // Compact is the always-on minimap: coloured wireframes, no chrome, no
  // picking. The docked panel keeps its filled faces and its controls.
  const compact = Boolean(options.compact);
  const theme = readTheme();
  const cells = tesseractCells(pos.shape);
  const extent = pos.shape[0] - 1;          // world units across one cell
  const step = extent * 1.04;               // a hair of daylight between cells

  const root = document.createElement('section');
  root.className = compact ? 'unwrap-panel unwrap-mini' : 'unwrap-panel';
  root.innerHTML = compact ? '' : `
    <div class="cube-heading">
      <div>
        <span class="eyebrow">Unfolded</span>
        <h2>The net, laid out in 3D.</h2>
      </div>
      <button class="reset-unwrap">Reset view</button>
    </div>
    <p class="hint">The interior cell in the middle, each face cell resting against the face of it they share, and the outer cell continuing past the bottom arm. Same colours as the views above.</p>`;

  const canvas = document.createElement('canvas');
  canvas.className = 'unwrap-canvas';
  canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-label', 'The tesseract unfolded into a three-dimensional net. Drag to orbit, right-drag to pan, scroll to zoom, click a cell to identify it.');
  root.append(canvas);

  const caption = document.createElement('p');
  caption.className = 'cube-caption';
  caption.setAttribute('aria-live', 'polite');
  root.append(caption);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();

  const box = new THREE.BoxGeometry(extent, extent, extent);
  const outline = new THREE.EdgesGeometry(box);
  const bounds = new THREE.Box3();

  const solids = cells.map((cell) => {
    const [px, py, pz] = PLACEMENT[cell.id];
    const origin = new THREE.Vector3(px * step, py * step, pz * step);

    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(CELL_COLORS[cell.id]),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(box, material);
    mesh.position.copy(origin);
    mesh.userData.cell = cell;
    // Wireframe only in compact mode. Hiding the mesh also disables picking,
    // since the raycaster skips invisible objects -- a minimap needs neither.
    mesh.visible = !compact;
    scene.add(mesh);

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(CELL_COLORS[cell.id]),
      transparent: true,
      opacity: compact ? 0.6 : 0.75,
    });
    const edges = new THREE.LineSegments(outline, edgeMaterial);
    edges.position.copy(origin);
    scene.add(edges);

    bounds.expandByPoint(origin.clone().addScalar(extent / 2));
    bounds.expandByPoint(origin.clone().addScalar(-extent / 2));

    // Marks the selected board square inside whichever cells contain it.
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(extent * 0.08, 16, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.selected), depthTest: false }),
    );
    marker.renderOrder = 5;
    marker.visible = false;
    scene.add(marker);

    return { cell, mesh, material, edges, edgeMaterial, marker, origin };
  });

  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getSize(new THREE.Vector3()).length() / 2;

  const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.1, radius * 40);
  const home = new THREE.Vector3(radius * 1.6, radius * 1.1, radius * 2.0).add(center);
  camera.position.copy(home);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.enablePan = true;
  controls.target.copy(center);
  controls.update();

  let disposed = false;
  let needsRender = true;

  function resize() {
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 400;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    camera.left = -radius * aspect;
    camera.right = radius * aspect;
    camera.top = radius;
    camera.bottom = -radius;
    camera.updateProjectionMatrix();
    needsRender = true;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  controls.addEventListener('change', () => { needsRender = true; });

  let frame = 0;
  function tick() {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    if (controls.update() || needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }
  }

  // Where a board square sits inside its cell's box, using the real 4D
  // unfolding so each cell's orientation -- including the mirrored outer cube
  // -- matches the master view.
  const hinges = hingeTree(cells);
  const fullyOpen = cells.map(() => Math.PI / 2);
  const span = extent / 2;
  function offsetWithin(cell, index) {
    if (localIndexIn(cell, pos.shape, index) < 0) return null;
    const c = [];
    let rest = index;
    for (let a = 0; a < 4; a++) { c.push(rest % pos.shape[a]); rest = Math.floor(rest / pos.shape[a]); }
    const u = unfoldCoord(c, cells.indexOf(cell), hinges, fullyOpen);
    // PLACEMENT is in world axes; the unfolded point is in lattice axes.
    const D = PLACEMENT[cell.id];
    const landing = [span + D[0] * extent, span - D[2] * extent, span + D[1] * extent];
    return new THREE.Vector3(u[0] - landing[0], u[2] - landing[2], -(u[1] - landing[1]));
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;
  let focused = null;

  canvas.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY }; });
  canvas.addEventListener('pointerup', (event) => {
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5;
    down = null;
    if (moved) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(solids.map((s) => s.mesh), false)[0];
    focused = hit ? hit.object.userData.cell.id : null;
    describe();
    needsRender = true;
  });

  root.querySelector('.reset-unwrap')?.addEventListener('click', () => {
    camera.position.copy(home);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    needsRender = true;
  });

  let selected = null;

  function describe() {
    if (selected !== null) {
      const owners = solids.filter((s) => localIndexIn(s.cell, pos.shape, selected) >= 0);
      caption.textContent = owners.length
        ? `${squareName(pos.shape, selected)} · shown in ${owners.map((o) => o.cell.label).join(', ')}`
        : `${squareName(pos.shape, selected)} · interior point — on none of the eight cells.`;
      return;
    }
    const cell = focused && cells.find((c) => c.id === focused);
    caption.textContent = cell
      ? `${cell.label} · the ${cell.role} cell`
      : 'Eight cells, unfolded. Click one to identify it.';
  }

  function paint() {
    for (const solid of solids) {
      const owns = selected !== null && localIndexIn(solid.cell, pos.shape, selected) >= 0;
      const lit = owns || solid.cell.id === focused;
      solid.material.opacity = owns ? 0.4 : lit ? 0.3 : 0.16;
      // With no fill to carry it, the wireframe shows the highlight instead.
      solid.edgeMaterial.opacity = compact ? (owns ? 1 : 0.5) : lit ? 1 : 0.75;
      solid.marker.visible = owns;
      if (owns) solid.marker.position.copy(solid.origin).add(offsetWithin(solid.cell, selected));
    }
    needsRender = true;
  }

  resize();
  describe();
  paint();
  tick();

  return {
    element: root,
    update(index) {
      selected = index;
      if (index !== null) focused = null;
      paint();
      describe();
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      box.dispose();
      outline.dispose();
      for (const solid of solids) {
        solid.material.dispose();
        solid.edgeMaterial.dispose();
        solid.marker.geometry.dispose();
        solid.marker.material.dispose();
      }
      renderer.dispose();
    },
  };
}
