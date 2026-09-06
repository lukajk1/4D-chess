// Copies the only three.js files the app actually loads into vendor/, which is
// committed. Static hosts get a working site straight from the repo, with no
// npm install and no bundler. Re-run after upgrading three.
import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const files = [
  ...['loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js'].map(file => [`node_modules/three/examples/jsm/${file}`, `vendor/three/addons/${file}`]),
  // three.module.min.js imports ./three.core.min.js as a sibling, so the two
  // must stay side by side.
  ['node_modules/three/build/three.module.min.js', 'vendor/three/three.module.min.js'],
  ['node_modules/three/build/three.core.min.js', 'vendor/three/three.core.min.js'],
  ['node_modules/three/examples/jsm/controls/OrbitControls.js', 'vendor/three/addons/controls/OrbitControls.js'],
];

for (const [from, to] of files) {
  await mkdir(dirname(join(root, to)), { recursive: true });
  await copyFile(join(root, from), join(root, to));
  console.log('vendored', to);
}
