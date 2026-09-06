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

// Where each cell sits in the unfolded net, in units of one cell width.
// Board x maps to world X, board z to world Y (up), board y to world -Z.
// The outer cell has no free face left on the centre cube, so it continues
// the column past the bottom arm -- the standard hypercube net.
export const PLACEMENT = {
  wmin: [0, 0, 0],
  xmin: [-1, 0, 0],
  xmax: [1, 0, 0],
  ymin: [0, 0, 1],
  ymax: [0, 0, -1],
  zmax: [0, 1, 0],
  zmin: [0, -1, 0],
  wmax: [0, -2, 0],
};

// A cell-local index as its three free-axis coordinates.
export function localCoordIn(cell, local) {
  return [
    local % cell.size[0],
    Math.floor(local / cell.size[0]) % cell.size[1],
    Math.floor(local / (cell.size[0] * cell.size[1])) % cell.size[2],
  ];
}

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

// Which cells a lattice point belongs to; empty for strictly interior points.
export function cellsContaining(cells, shape, index) {
  const coord = [];
  let rest = index;
  for (let a = 0; a < 4; a++) {
    coord.push(rest % shape[a]);
    rest = Math.floor(rest / shape[a]);
  }
  return cells.filter((cell) => coord[cell.axis] === cell.at);
}

// Position of a point within its cell's own cube, or -1 when absent.
export function localIndexIn(cell, shape, index) {
  const coord = [];
  let rest = index;
  for (let a = 0; a < 4; a++) {
    coord.push(rest % shape[a]);
    rest = Math.floor(rest / shape[a]);
  }
  if (coord[cell.axis] !== cell.at) return -1;
  let local = 0;
  let stride = 1;
  for (let k = 0; k < 3; k++) {
    local += coord[cell.free[k]] * stride;
    stride *= cell.size[k];
  }
  return local;
}

// Totals for a lattice of any size: the boundary is everything the eight
// cells cover between them, the interior everything they miss.
export function latticeStats(shape) {
  const total = shape.reduce((a, b) => a * b, 1);
  const interior = shape.reduce((a, b) => a * Math.max(0, b - 2), 1);
  return { total, interior, boundary: total - interior };
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
