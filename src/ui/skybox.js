import * as THREE from 'three';

// The download is a 4x3 horizontal cross of 512px faces, blank in the corners:
//
//         [ +Y ]
//   [ -X ][ +Z ][ +X ][ -Z ]
//         [ -Y ]
//
// Cutting it here rather than committing six files keeps the asset exactly as
// it was downloaded and keeps the project buildless. three.js wants the faces
// in +X, -X, +Y, -Y, +Z, -Z order, as [column, row] of the cross.
const FACES = [[2, 1], [0, 1], [1, 0], [1, 2], [1, 1], [3, 1]];
const SOURCE = new URL('../../assets/skybox/cloudy-05.png', import.meta.url).href;

// Returns its own texture each call, so a viewer can dispose what it loaded
// without pulling the ground from under another one. The image behind it is
// fetched once and then served from the browser cache.
export function loadSkybox() {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => {
      const size = image.width / 4;
      const faces = FACES.map(([column, row]) => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(image, column * size, row * size, size, size, 0, 0, size, size);
        return canvas;
      });
      const texture = new THREE.CubeTexture(faces);
      // CubeTexture already sets flipY = false, which is what cross tiles want.
      // The colour space does have to be declared, or three treats the sky as
      // linear data and encodes it a second time on the way out.
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      resolve(texture);
    });
    image.addEventListener('error', () => reject(new Error('skybox image failed to load')));
    image.src = SOURCE;
  });
}
