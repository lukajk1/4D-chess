import { toCoord } from '../core/position.js';
import { squareName } from '../core/notation.js';
import { nameOf } from '../core/pieces.js';

const GLYPHS = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
  U: 'U', u: 'U', A: 'A', a: 'A',
};

// Presentation depends on dimension; cell identities always belong to Position.
// 1D uses points on a line; 2D uses axis 0 across and axis 1 up the page.
export function renderBoard(pos, view) {
  if (pos.dims > 2) return renderSlices(pos, view);
  return renderPlane(pos, view);
}

function renderPlane(pos, view, fixed = []) {
  const [width, height = 1] = pos.shape;
  const board = document.createElement('div');
  board.className = pos.dims === 1 ? 'board board-line' : 'board';
  board.style.setProperty('--files', width);
  board.style.setProperty('--ranks', height);

  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const index = pos.dims === 1 ? x : pos.index([x, y, ...fixed]);
      board.append(renderCell(pos, index, view));
    }
  }
  return board;
}

function renderSlices(pos, view) {
  const wrapper = document.createElement('div');
  wrapper.className = 'spatial-board';
  const help = document.createElement('p');
  help.className = 'hint';
  help.textContent = pos.variant?.inspectionOnly
    ? `Eight 8 × 8 slices${pos.dims === 4 ? ' of the selected w cube' : ''} · x runs across, y runs up, z selects the layer. Click any square to locate it in space.`
    : 'Each slice shows x across and y up. z selects depth'
    + (pos.dims === 4 ? '; w selects the fourth axis.' : '.')
    + ' U = Unicorn (3-axis diagonals)'
    + (pos.dims === 4 ? '; A = Balloon (4-axis diagonals).' : '.');
  wrapper.append(help);
  for (let w = 0; w < (pos.shape[3] ?? 1); w++) {
    if (view.wLayer !== undefined && w !== view.wLayer) continue;
    const group = document.createElement('section');
    if (pos.dims === 4) {
      const heading = document.createElement('h2');
      heading.className = 'axis-heading';
      heading.textContent = `w = ${w + 1}`;
      group.append(heading);
    }
    const slices = document.createElement('div');
    slices.className = 'slices';
    for (let z = 0; z < pos.shape[2]; z++) {
      const slice = document.createElement('div');
      slice.className = 'slice';
      const label = document.createElement('h3');
      label.textContent = pos.variant?.inspectionOnly ? `Layer ${z + 1}${pos.dims === 3 && (z === 3 || z === 4) ? ' · King & queen' : ''}` : `z = ${z + 1}`;
      slice.append(label, renderPlane(pos, view, pos.dims === 4 ? [z, w] : [z]), renderCoordinates(pos));
      slices.append(slice);
    }
    group.append(slices);
    wrapper.append(group);
  }
  return wrapper;
}

function renderCell(pos, index, view) {
  const { selected, targets, checkIndex, lastMove, onSquare } = view;
  const cell = document.createElement('button');
  const piece = pos.get(index);
  const target = targets.get(index);

  cell.className = 'cell' + (pos.coord(index).reduce((sum, value) => sum + value, 0) % 2 ? ' dark' : '');
  if (index === selected) cell.classList.add('selected');
  if (index === checkIndex) cell.classList.add('checked');
  if (lastMove && (index === lastMove.from || index === lastMove.to)) cell.classList.add('last');
  if (target) cell.classList.add(piece ? 'capture' : 'target');

  cell.dataset.index = String(index);
  cell.setAttribute('aria-label', describe(pos, index, piece, target));
  cell.title = describe(pos, index, piece, target);
  if (pos.dims === 1) {
    const point = document.createElement('span');
    point.className = 'point';
    point.setAttribute('aria-hidden', 'true');
    cell.append(point);
  }
  if (piece) {
    const glyph = document.createElement('span');
    glyph.className = 'piece ' + (piece === piece.toUpperCase() ? 'white' : 'black');
    glyph.textContent = GLYPHS[piece];
    cell.append(glyph);
  }
  cell.addEventListener('click', () => onSquare(index));
  return cell;
}

function describe(pos, index, piece, target) {
  const name = squareName(pos.shape, index);
  const occupant = piece ? ` ${piece === piece.toUpperCase() ? 'white' : 'black'} ${nameOf(piece.toLowerCase())}` : ' empty';
  return name + occupant + (target ? ', can move here' : '');
}

export function renderCoordinates(pos) {
  const [width] = pos.shape;
  const files = document.createElement('div');
  files.className = 'files';
  files.style.setProperty('--files', width);
  for (let x = 0; x < width; x++) {
    const label = document.createElement('span');
    label.textContent = 'abcdefghijklmnopqrstuvwxyz'[x];
    files.append(label);
  }
  return files;
}

export const glyphFor = (piece) => GLYPHS[piece];
export const coordOf = (pos, index) => toCoord(pos.shape, index);
