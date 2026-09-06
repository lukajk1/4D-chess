// The eight cubic cells of a tesseract. Each cell pins exactly one axis to its
// minimum or maximum; the other three axes stay free and span a cube.
//
// Under a projection along w this is the familiar tesseract wireframe: the
// w-minimum cell is the interior cube, the w-maximum cell is the outer cube,
// and the six x/y/z cells are the frusta joining them face to face.
//
// Cells share the vertices on their common faces, so a point can belong to up
// to four of them. On an 8^4 lattice: 1,728 points lie in one cell, 864 in two,
// 192 in three and 16 in four. The 1,296 points whose coordinates are all
// interior belong to no cell at all.

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

export const isInterior = (shape, index) => {
  let rest = index;
  for (let a = 0; a < 4; a++) {
    const v = rest % shape[a];
    if (v === 0 || v === shape[a] - 1) return false;
    rest = Math.floor(rest / shape[a]);
  }
  return true;
};
