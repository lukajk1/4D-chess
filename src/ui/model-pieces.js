import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FILES = { p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king' };
// Original king is 8.96 units high. One shared scale preserves the set's proportions.
const MODEL_SCALE = .09;

export function createModelPieces(scene, instances, pieceAt, onLoad) {
  const material = new THREE.MeshStandardMaterial({ roughness: .68, metalness: 0 });
  const ghostMaterial = new THREE.MeshStandardMaterial({
    roughness: .68, metalness: 0, transparent: true, opacity: .42, depthWrite: false,
  });
  const groups = new Map();
  const loader = new GLTFLoader();
  let disposed = false;
  const ambient = new THREE.HemisphereLight('#fff8e9', '#637365', 2);
  const key = new THREE.DirectionalLight('#ffffff', 2.5);
  key.position.set(5, 9, 6);
  scene.add(ambient, key);
  const transform = new THREE.Object3D();

  const loads = Object.entries(FILES).map(async ([type, file]) => {
    const slots = instances.flatMap((inst, index) =>
      pieceAt(inst.lattice).toLowerCase() === type ? [index] : []);
    if (!slots.length) return;
    const gltf = await loader.loadAsync(new URL(`../../assets/chess/${file}.glb`, import.meta.url).href);
    const meshes = [];
    gltf.scene.traverse(object => { if (object.isMesh) meshes.push(object); });
    if (disposed || meshes.length !== 1) {
      meshes.forEach(mesh => {
        mesh.geometry.dispose();
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => m.dispose());
      });
      if (!disposed) throw new Error(`Expected one mesh in ${file}.glb`);
      return;
    }
    const source = meshes[0];
    gltf.scene.updateMatrixWorld(true);
    source.geometry.applyMatrix4(source.matrixWorld);
    (Array.isArray(source.material) ? source.material : [source.material]).forEach(m => m.dispose());
    const makeMesh = (subset, meshMaterial, renderOrder) => {
      if (!subset.length) return null;
      const mesh = new THREE.InstancedMesh(source.geometry, meshMaterial, subset.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      subset.forEach((slot, i) => {
        const char = pieceAt(instances[slot].lattice);
        mesh.setColorAt(i, new THREE.Color(char === char.toUpperCase() ? '#fff3d8' : '#34483d'));
      });
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    };
    const homes = slots.filter(slot => instances[slot].home);
    const ghosts = slots.filter(slot => !instances[slot].home);
    groups.set(type, {
      geometry: source.geometry,
      solid: { mesh: makeMesh(homes, material, 2), slots: homes },
      ghost: { mesh: makeMesh(ghosts, ghostMaterial, 1), slots: ghosts },
    });
  });
  Promise.allSettled(loads).then(results => {
    if (disposed) return;
    const failures = results.filter(r => r.status === 'rejected');
    failures.forEach(result => console.warn('Chess model could not load:', result.reason));
    onLoad(failures.length > 0);
  });

  return {
    has: type => groups.has(type),
    update(enabled, centers, scales, alphas, visible) {
      for (const group of groups.values()) {
        for (const [kind, { mesh, slots }] of Object.entries({ solid: group.solid, ghost: group.ghost })) {
          if (!mesh) continue;
          mesh.visible = enabled;
          if (!enabled) continue;
          slots.forEach((slot, i) => {
            transform.position.fromArray(centers, slot * 3);
            // Ghosts emerge with the unfolding instead of stacking visibly
            // over their home model while all cell copies still coincide.
            const emergence = kind === 'ghost' ? Math.min(1, alphas[slot] / .3) : 1;
            transform.scale.setScalar(visible(instances[slot]) ? scales[slot] * MODEL_SCALE * emergence : 0);
            const char = pieceAt(instances[slot].lattice);
            transform.rotation.y = char === char.toUpperCase() ? 0 : Math.PI;
            transform.updateMatrix();
            mesh.setMatrixAt(i, transform.matrix);
          });
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
    },
    dispose() {
      disposed = true;
      for (const group of groups.values()) {
        for (const { mesh } of [group.solid, group.ghost]) {
          if (!mesh) continue;
          scene.remove(mesh);
          mesh.dispose();
        }
        group.geometry.dispose();
      }
      material.dispose();
      ghostMaterial.dispose();
      scene.remove(ambient, key);
    },
  };
}
