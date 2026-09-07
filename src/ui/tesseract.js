// The eight cubic cells of a tesseract. Each cell pins exactly one axis to its
// minimum or maximum; the other three axes stay free and span a cube.
//
// Under a projection along w this is the familiar tesseract wireframe: the
// w-minimum cell is the interior cube, the w-maximum cell is the outer cube,
// and the six x/y/z cells are the frusta joining them face to face.
//
// Cells share the vertices on their common faces, so a point can belong to up
// to four of them -- the sixteen four-cell points are the tesseract's corners,
// and there are sixteen at any board size. Points whose coordinates are all
// interior belong to no cell at all: (n-2)^4 of them.

const AXES = 'xyzw';

export function tesseractCells(shape) {
  const cells = [];
  for (let axis = 0; axis < 4; axis++) {
    for (const end of [0, 1]) {
      const at = end ? shape[axis] - 1 : 0;
      const free = [0, 1, 2, 3].filter((a) => a !== axis);
      const size = free.map((a) => shape[a]);
      const count = size[0] * size[1] * size[2];
      const indices = new Int32Array(count);

      for (let local = 0; local < count; local++) {
        const coord = [0, 0, 0, 0];
        coord[axis] = at;
        let rest = local;
        for (let k = 0; k < 3; k++) {
          coord[free[k]] = rest % size[k];
          rest = Math.floor(rest / size[k]);
        }
        let global = 0;
        let stride = 1;
        for (let a = 0; a < 4; a++) {
          global += coord[a] * stride;
          stride *= shape[a];
        }
        indices[local] = global;
      }

      cells.push({
        id: `${AXES[axis]}${end ? 'max' : 'min'}`,
        axis,
        at,
        free,
        size,
        count,
        indices,
        label: `${AXES[axis]} = ${at + 1}`,
        role: axis !== 3 ? 'face' : end ? 'outer' : 'interior',
      });
    }
  }

  // Read inner to outer: interior cube, the six face cells, then the outer cube.
  const order = ['wmin', 'xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax', 'wmax'];
  return order.map((id) => cells.find((cell) => cell.id === id));
}

export const isInterior = (shape, index) => {
  let rest = index;
  for (let a = 0; a < 4; a++) {
    const v = rest % shape[a];
    if (v === 0 || v === shape[a] - 1) return false;
    rest = Math.floor(rest / shape[a]);
  }
  return true;
};

// ---------------------------------------------------------------------------
// Unfolding, done as it actually happens: in 4D.
//
// The net is a tree. Every non-root cell hinges on the face it shares with its
// parent, and unfolding rotates it about that face -- a rotation in the plane
// spanned by the two pinned axes (the cell's and its parent's). A child's
// rotation is then carried along by its parent's, so the outer cube rides on
// the arm it is attached to.
//
// Restricted to 3D this is not always a rotation: a cell that flips over
// through w comes out mirrored, which is why the outer cube ends up inside out.
// ---------------------------------------------------------------------------

const PARENT = { xmin: 'wmin', xmax: 'wmin', ymin: 'wmin', ymax: 'wmin', zmin: 'wmin', zmax: 'wmin', wmax: 'zmin' };

export function hingeTree(cells) {
  const index = new Map(cells.map((cell, i) => [cell.id, i]));
  return cells.map((cell) => {
    const parentId = PARENT[cell.id];
    if (!parentId) return { cell, parent: -1 };
    const parent = cells[index.get(parentId)];
    // The cell swings away from its parent along its own pinned axis; sigma
    // picks the rotation sense that achieves that for this pair of ends.
    const awayC = cell.at === 0 ? -1 : 1;
    const towardP = parent.at === 0 ? 1 : -1;
    return {
      cell,
      parent: index.get(parentId),
      axisC: cell.axis, centreC: cell.at,
      axisP: parent.axis, centreP: parent.at,
      sigma: -awayC * towardP,
    };
  });
}

// Rotate a 4D point about one hinge, in place.
function turn(p, h, angle) {
  const dc = p[h.axisC] - h.centreC;
  const dp = p[h.axisP] - h.centreP;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  p[h.axisC] = h.centreC + dc * cos - h.sigma * dp * sin;
  p[h.axisP] = h.centreP + h.sigma * dc * sin + dp * cos;
}

// Unfold one point of a cell by the given per-cell angles, walking up the tree.
export function unfoldCoord(coord, cellIndex, hinges, angles, out = [0, 0, 0, 0]) {
  for (let k = 0; k < 4; k++) out[k] = coord[k];
  for (let i = cellIndex; hinges[i].parent >= 0; i = hinges[i].parent) {
    turn(out, hinges[i], angles[i]);
  }
  return out;
}
