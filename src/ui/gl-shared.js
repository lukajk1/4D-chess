import * as THREE from 'three';

// Shared between the master tesseract viewer and the per-cube grid, so both
// draw points, wires and glyphs from the same shaders and the same atlas.

// One colour per cell of the tesseract. The six face cells double as the six
// angular sectors of the master view, so a wedge and the interior-cube face it
// springs from share a colour.
export const CELL_COLORS = {
  xmin: '#d1725a', xmax: '#e2a95c',
  ymin: '#6fa86a', ymax: '#a9c163',
  zmin: '#5f93c0', zmax: '#6fc4c4',
  wmin: '#9b82c8', wmax: '#c87fb0',
};

export const SECTOR_IDS = ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'];

// Which face of the hypercube a point radiates towards: the axis with the
// largest displacement from centre wins, exactly like cube-map face selection.
//
// Points on an edge or corner sit exactly on the plane between two sectors and
// belong to neither. Handing every tie to the lowest axis skews the wedges
// badly (120 points against 56 on an 8-cube), so ties are spread across the
// tied axes by coordinate sum: deterministic, and even in aggregate.
export function sectorOf(coord, shape) {
  let best = -1;
  const tied = [];
  for (let a = 0; a < 3; a++) {
    const magnitude = Math.abs(coord[a] - (shape[a] - 1) / 2);
    if (magnitude > best + 1e-9) {
      best = magnitude;
      tied.length = 0;
      tied.push(a);
    } else if (Math.abs(magnitude - best) < 1e-9) {
      tied.push(a);
    }
  }
  const axis = tied[(coord[0] + coord[1] + coord[2]) % tied.length];
  return 'xyz'[axis] + (coord[axis] - (shape[axis] - 1) / 2 >= 0 ? 'max' : 'min');
}

export const readTheme = () => {
  const style = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => (style.getPropertyValue(name).trim() || fallback);
  return {
    light: pick('--light-square', '#ebe6dd'),
    dark: pick('--dark-square', '#9aa88f'),
    muted: pick('--muted', '#6b7480'),
    selected: pick('--selected', '#e8c27d'),
  };
};

export const POINT_VERTEX = `
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
    px = uPerspective > 0.5 ? px / max(-mv.z, 0.0001) : px;
    // Below about 1.5px the round mask below is nearly all feathered edge and
    // the point disappears, so keep a floor regardless of zoom or canvas size.
    gl_PointSize = max(px, 1.5);
  }`;

export const POINT_FRAGMENT = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // Round the square point sprite and feather its edge.
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.42, d));
  }`;

export const LINE_VERTEX = `
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

export const LINE_FRAGMENT = `
  varying float vAlpha;
  uniform vec3 uColor;
  void main() { gl_FragColor = vec4(uColor, vAlpha); }`;

export const PIECE_VERTEX = `
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

export const PIECE_FRAGMENT = `
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

export function buildGlyphAtlas(chars, glyphFor) {
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

// One point cloud plus its per-vertex colour, alpha and size buffers.
export function makePointCloud(count, uniforms) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    uniforms,
  });
  return { geometry, material, points: new THREE.Points(geometry, material) };
}
