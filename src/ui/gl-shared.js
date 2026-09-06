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

// Small round points read dimmer than the flat squares the palette was picked
// for, so the board colours are lifted before they reach a lattice. Scaling
// lightness rather than the channels keeps the hue and saturation intact,
// where multiplying RGB would just wash pale squares out toward white.
export function brighten(color, factor = 1.3) {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return color.setHSL(hsl.h, hsl.s, Math.min(1, hsl.l * factor));
}

export const readTheme = () => {
  const style = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => (style.getPropertyValue(name).trim() || fallback);
  return {
    light: pick('--light-square', '#ebe6dd'),
    dark: pick('--dark-square', '#9aa88f'),
    muted: pick('--muted', '#6b7480'),
    selected: pick('--selected', '#e8c27d'),
    accent: pick('--accent', '#6ba585'),
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
  uniform float uSolidPass;
  void main() {
    // The sprite is a flat square; treat it as a sphere. Recovering the normal
    // analytically from the point coordinate gives real per-fragment shading
    // without a single extra vertex -- the alternative is thousands of sphere
    // meshes for the same picture.
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    // Drawn in two passes over the same buffer. Solid points write depth, so
    // a nearer point hides a farther one; faint points (dimmed interior,
    // filtered out) blend over the result afterwards without occluding
    // anything. Splitting here keeps it to two draw calls and no CPU sorting.
    bool solid = vAlpha >= 0.5;
    if (uSolidPass > 0.5 && !solid) discard;
    if (uSolidPass < 0.5 && solid) discard;
    // gl_PointCoord runs top-down, so y is flipped to face the light.
    vec3 normal = vec3(p.x, -p.y, sqrt(max(1.0 - r2, 0.0)));
    vec3 light = normalize(vec3(0.35, 0.55, 0.75));
    vec3 halfDir = normalize(light + vec3(0.0, 0.0, 1.0));
    float diffuse = max(dot(normal, light), 0.0);
    // Intensity, not exponent, is what dims a highlight: a lower exponent
    // spreads it wider instead. Kept fairly tight and simply made faint.
    float spec = pow(max(dot(normal, halfDir), 0.0), 30.0);
    // Ambient stays high so an unlit face keeps its board colour readable.
    vec3 shaded = vColor * (0.45 + 0.55 * diffuse) + vec3(spec * 0.12);
    gl_FragColor = vec4(shaded, vAlpha * (1.0 - smoothstep(0.82, 1.0, r2)));
  }`;

// The selection marker for an empty point. A ring rather than a disc, so
// the point it marks stays visible inside it instead of being painted over.
export const HALO_FRAGMENT = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    float ring = smoothstep(0.58, 0.70, r) * (1.0 - smoothstep(0.88, 1.0, r));
    if (ring < 0.01) discard;
    gl_FragColor = vec4(vColor, vAlpha * ring);
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
  uniform float uFade;
  void main() { gl_FragColor = vec4(uColor, vAlpha * uFade); }`;

export const PIECE_VERTEX = `
  attribute vec3 aCenter;
  attribute vec2 aCell;
  attribute float aHidden;
  attribute float aScale;
  attribute float aAlpha;
  varying vec2 vUv;
  varying vec2 vCell;
  varying float vHidden;
  varying float vAlpha;
  uniform float uSize;
  void main() {
    vUv = uv;
    vCell = aCell;
    vHidden = aHidden;
    vAlpha = aAlpha;
    // Billboard by offsetting in view space, which faces the camera under
    // both projections without any per-frame CPU work. aScale lets a piece
    // track the local lattice spacing, which the 4D perspective varies.
    vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
    mv.xy += position.xy * uSize * aScale;
    // Nudge toward the camera: a sprite sits on a lattice point, and now that
    // points write depth an equal-depth glyph would be punched out by its own
    // point. View space looks down -z, so nearer is larger.
    mv.z += 0.04;
    gl_Position = projectionMatrix * mv;
  }`;

export const PIECE_FRAGMENT = `
  varying vec2 vUv;
  varying vec2 vCell;
  varying float vHidden;
  varying float vAlpha;
  uniform sampler2D uAtlas;
  uniform vec2 uGrid;
  void main() {
    if (vHidden > 0.5) discard;
    // Atlas rows run top-down; the quad's v runs bottom-up.
    vec2 uv = (vCell + vec2(vUv.x, 1.0 - vUv.y)) / uGrid;
    vec4 texel = texture2D(uAtlas, uv);
    // The glyph edge is still alpha-tested for a crisp outline; the instance
    // alpha then lets ghost copies draw translucent.
    if (texel.a < 0.4) discard;
    gl_FragColor = vec4(texel.rgb, vAlpha);
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
export function makePointCloud(count, uniforms, overrides = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    transparent: true,
    // Solid points occlude each other; callers drawing the faint pass, or
    // markers meant to sit on top, turn this off.
    depthWrite: true,
    ...overrides,
    uniforms: { uSolidPass: { value: 1 }, ...uniforms },
  });
  return { geometry, material, points: new THREE.Points(geometry, material) };
}
