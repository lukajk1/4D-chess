import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const FILES = { p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king' };
// Original king is 8.96 units high. One shared scale preserves the set's proportions.
const MODEL_SCALE = .09;
// A selected square appears in every cell that holds a copy of it, so the rim
// needs as many instances as the halo has points.
const OUTLINE_MAX = 8;
// Object-space units, pushed along the surface normal. Every type shares one
// MODEL_SCALE, so a fixed offset here is a fixed width for pawn and king alike
// -- which growing the hull by a percentage would not give.
const OUTLINE_WIDTH = .34;

// An inverted hull: the same mesh grown along its normals, back faces only, so
// the piece itself covers all of it but the rim. Cheaper than a postprocessing
// pass and, unlike one, it follows individual instances.
function outlineShader(shader) {
  shader.uniforms.uOutline = { value: OUTLINE_WIDTH };
  shader.vertexShader = `uniform float uOutline;\n${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n\ttransformed += normalize(normal) * uOutline;',
  );
}

// Welded by position alone, then re-normalled smooth. The source meshes split
// vertices at hard edges, and a hull grown along split normals tears open at
// every one of them.
function hullOf(geometry) {
  const seam = new THREE.BufferGeometry();
  seam.setAttribute('position', geometry.getAttribute('position').clone());
  if (geometry.index) seam.setIndex(geometry.index.clone());
  const hull = mergeVertices(seam);
  seam.dispose();
  hull.computeVertexNormals();
  return hull;
}

// Module-level cache for parsed geometries and hulls to avoid asynchronous
// reloading and flickering fallback glyphs when moving pieces or rebuilding views.
const geometryCache = new Map();
const loadingPromises = new Map();
const loader = new GLTFLoader();

function loadPieceGeometry(type) {
  if (geometryCache.has(type)) {
    return Promise.resolve(geometryCache.get(type));
  }
  if (loadingPromises.has(type)) {
    return loadingPromises.get(type);
  }
  const file = FILES[type];
  const promise = (async () => {
    const gltf = await loader.loadAsync(new URL(`../../assets/chess/${file}.glb`, import.meta.url).href);
    const meshes = [];
    gltf.scene.traverse(object => { if (object.isMesh) meshes.push(object); });
    if (meshes.length !== 1) {
      meshes.forEach(mesh => {
        mesh.geometry.dispose();
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => m.dispose());
      });
      throw new Error(`Expected one mesh in ${file}.glb`);
    }
    const source = meshes[0];
    gltf.scene.updateMatrixWorld(true);
    source.geometry.applyMatrix4(source.matrixWorld);
    (Array.isArray(source.material) ? source.material : [source.material]).forEach(m => m.dispose());
    const hull = hullOf(source.geometry);
    const entry = { geometry: source.geometry, hull };
    geometryCache.set(type, entry);
    return entry;
  })();
  loadingPromises.set(type, promise);
  return promise;
}

// Pre-load all pieces immediately so they are cached as early as possible
for (const type of Object.keys(FILES)) {
  loadPieceGeometry(type).catch(() => {});
}

export function createModelPieces(scene, instances, pieceAt, onLoad, outlineColor = '#e8c27d') {
  const material = new THREE.MeshStandardMaterial({ roughness: .68, metalness: 0 });
  const ghostMaterial = new THREE.MeshStandardMaterial({
    roughness: .68, metalness: 0, transparent: true, opacity: .42, depthWrite: false,
  });
  const captureMaterial = new THREE.MeshStandardMaterial({
    color: '#ff2828',
    emissive: '#880000',
    emissiveIntensity: 0.35,
    roughness: 0.3,
    metalness: 0.1,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  const captureGhostMaterial = new THREE.MeshStandardMaterial({
    color: '#ff2828',
    emissive: '#880000',
    emissiveIntensity: 0.2,
    roughness: 0.3,
    metalness: 0.1,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  const outlineMaterial = new THREE.MeshBasicMaterial({ color: outlineColor, side: THREE.BackSide });
  outlineMaterial.onBeforeCompile = outlineShader;
  const groups = new Map();
  let disposed = false;
  const ambient = new THREE.HemisphereLight('#fff8e9', '#637365', 2);
  const key = new THREE.DirectionalLight('#ffffff', 2.5);
  key.position.set(5, 9, 6);
  scene.add(ambient, key);
  const transform = new THREE.Object3D();
  const scratch = new THREE.Matrix4();
  // The rim is written from the matrices the solid and ghost batches already
  // hold, so it cannot drift out of step with them.
  let highlight = null;
  let enabled = false;
  let capturable = new Set();
  let lastUpdateArgs = null;
  const tossed = [];

  const makeMesh = (count, meshMaterial, geometry, renderOrder) => {
    if (!count) return null;
    const mesh = new THREE.InstancedMesh(geometry, meshMaterial, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  };
  const colour = (mesh, subset) => {
    subset.forEach((slot, i) => {
      const char = pieceAt(instances[slot].lattice);
      mesh?.setColorAt(i, new THREE.Color(char === char.toUpperCase() ? '#fff3d8' : '#34483d'));
    });
    return mesh;
  };

  const initGroup = (type, geometry, hull) => {
    const slots = instances.flatMap((inst, index) =>
      pieceAt(inst.lattice).toLowerCase() === type ? [index] : []);
    if (!slots.length) return;
    const homes = slots.filter(slot => instances[slot].home);
    const ghosts = slots.filter(slot => !instances[slot].home);
    groups.set(type, {
      geometry,
      hull,
      solid: { mesh: colour(makeMesh(homes.length, material, geometry, 2), homes), slots: homes },
      ghost: { mesh: colour(makeMesh(ghosts.length, ghostMaterial, geometry, 1), ghosts), slots: ghosts },
      captureSolid: { mesh: makeMesh(homes.length, captureMaterial, geometry, 3), slots: homes },
      captureGhost: { mesh: makeMesh(ghosts.length, captureGhostMaterial, geometry, 2), slots: ghosts },
      outline: makeMesh(Math.min(OUTLINE_MAX, slots.length), outlineMaterial, hull, 1),
    });
  };

  // Synchronously initialize groups for any pieces already in cache
  for (const type of Object.keys(FILES)) {
    if (geometryCache.has(type)) {
      const cached = geometryCache.get(type);
      initGroup(type, cached.geometry, cached.hull);
    }
  }

  const loads = Object.keys(FILES).map(async (type) => {
    const slots = instances.flatMap((inst, index) =>
      pieceAt(inst.lattice).toLowerCase() === type ? [index] : []);
    if (!slots.length) return;
    const { geometry, hull } = await loadPieceGeometry(type);
    if (disposed) return;
    if (!groups.has(type)) {
      initGroup(type, geometry, hull);
    }
  });
  Promise.allSettled(loads).then(results => {
    if (disposed) return;
    const failures = results.filter(r => r.status === 'rejected');
    failures.forEach(result => console.warn('Chess model could not load:', result.reason));
    onLoad(failures.length > 0);
  });

  function writeOutlines() {
    for (const group of groups.values()) {
      if (group.outline) group.outline.visible = false;
    }
    if (!enabled || highlight === null) return;
    const char = pieceAt(highlight);
    const group = char ? groups.get(char.toLowerCase()) : null;
    if (!group?.outline) return;
    const capacity = group.outline.instanceMatrix.count;
    let n = 0;
    // Every copy of the square is rimmed, ghosts included: which cells hold a
    // copy is exactly what a selection is meant to show.
    for (const part of [group.solid, group.ghost]) {
      if (!part.mesh) continue;
      part.slots.forEach((slot, i) => {
        if (n >= capacity || instances[slot].lattice !== highlight) return;
        part.mesh.getMatrixAt(i, scratch);
        group.outline.setMatrixAt(n, scratch);
        n++;
      });
    }
    // Filtered-out copies carry a zero scale, so their rim collapses with them.
    group.outline.count = n;
    group.outline.visible = n > 0;
    group.outline.instanceMatrix.needsUpdate = true;
    group.outline.boundingSphere = null;
  }

  return {
    has: type => groups.has(type),
    // Which batches a click can hit, and the instance table row behind each.
    pickTargets() {
      const targets = [];
      for (const group of groups.values()) {
        for (const part of [group.solid, group.ghost, group.captureSolid, group.captureGhost]) {
          if (part?.mesh?.visible) targets.push({ mesh: part.mesh, slots: part.slots });
        }
      }
      return targets;
    },
    setCapturable(set) {
      capturable = set instanceof Set ? set : new Set(set ?? []);
      if (lastUpdateArgs) {
        this.update(...lastUpdateArgs);
      }
    },
    setHighlight(lattice) {
      highlight = lattice;
      writeOutlines();
    },
    update(on, centers, scales, alphas, visible, capturableSet) {
      lastUpdateArgs = [on, centers, scales, alphas, visible];
      enabled = on;
      if (capturableSet !== undefined) {
        capturable = capturableSet instanceof Set ? capturableSet : new Set(capturableSet ?? []);
      }
      for (const group of groups.values()) {
        const batches = [
          { kind: 'solid', mesh: group.solid.mesh, slots: group.solid.slots, isCapture: false },
          { kind: 'ghost', mesh: group.ghost.mesh, slots: group.ghost.slots, isCapture: false },
          { kind: 'solid', mesh: group.captureSolid.mesh, slots: group.captureSolid.slots, isCapture: true },
          { kind: 'ghost', mesh: group.captureGhost.mesh, slots: group.captureGhost.slots, isCapture: true },
        ];
        for (const { kind, mesh, slots, isCapture } of batches) {
          if (!mesh) continue;
          mesh.visible = on;
          if (!on) continue;
          slots.forEach((slot, i) => {
            const lat = instances[slot].lattice;
            const isCap = capturable.has(lat);
            const match = isCapture ? isCap : !isCap;
            transform.position.fromArray(centers, slot * 3);
            const emergence = kind === 'ghost' ? Math.min(1, alphas[slot] / .3) : 1;
            const s = (match && visible(instances[slot])) ? scales[slot] * MODEL_SCALE * emergence : 0;
            transform.scale.setScalar(s);
            const char = pieceAt(lat);
            transform.rotation.y = char === char.toUpperCase() ? 0 : Math.PI;
            transform.updateMatrix();
            mesh.setMatrixAt(i, transform.matrix);
          });
          mesh.instanceMatrix.needsUpdate = true;
          mesh.boundingSphere = null;
        }
      }
      writeOutlines();
    },
    spawnTossed(char, [x, y, z], scale = 1, opacity = 1) {
      if (!char) return;
      const type = char.toLowerCase();
      const cached = geometryCache.get(type);
      if (!cached) return;

      const mat = captureMaterial.clone();
      mat.opacity *= opacity;
      const mesh = new THREE.Mesh(cached.geometry, mat);
      mesh.renderOrder = 4;
      mesh.scale.setScalar(scale * MODEL_SCALE);
      mesh.position.set(x, y, z);
      const isWhite = char === char.toUpperCase();
      mesh.rotation.y = isWhite ? 0 : Math.PI;
      scene.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 0.8;
      tossed.push({
        mesh,
        mat,
        x, y, z,
        vx: Math.cos(angle) * speed,
        vy: 4.8 + Math.random() * 1.0,
        vz: Math.sin(angle) * speed,
        rx: (Math.random() - 0.5) * 10,
        ry: (Math.random() - 0.5) * 8,
        rz: (Math.random() - 0.5) * 10,
        startY: y,
        startOpacity: mat.opacity,
      });
    },
    updateTossed(elapsed) {
      for (let i = tossed.length - 1; i >= 0; i--) {
        const p = tossed[i];
        p.vy -= 14 * elapsed;
        p.x += p.vx * elapsed;
        p.y += p.vy * elapsed;
        p.z += p.vz * elapsed;

        p.mesh.position.set(p.x, p.y, p.z);
        p.mesh.rotation.x += p.rx * elapsed;
        p.mesh.rotation.y += p.ry * elapsed;
        p.mesh.rotation.z += p.rz * elapsed;

        const drop = p.startY - p.y;
        if (drop > 1.2) {
          p.mat.opacity = Math.max(0, p.startOpacity * (1 - (drop - 1.2) / 3.5));
        }

        if (drop > 4.5 || p.mat.opacity <= 0.01) {
          scene.remove(p.mesh);
          p.mat.dispose();
          tossed.splice(i, 1);
        }
      }
      return tossed.length > 0;
    },
    dispose() {
      disposed = true;
      for (const p of tossed) {
        scene.remove(p.mesh);
        p.mat.dispose();
      }
      tossed.length = 0;
      for (const group of groups.values()) {
        for (const part of [group.solid, group.ghost, group.captureSolid, group.captureGhost, { mesh: group.outline }]) {
          if (!part?.mesh) continue;
          scene.remove(part.mesh);
          part.mesh.dispose();
        }
      }
      material.dispose();
      ghostMaterial.dispose();
      captureMaterial.dispose();
      captureGhostMaterial.dispose();
      outlineMaterial.dispose();
      scene.remove(ambient, key);
    },
  };
}
