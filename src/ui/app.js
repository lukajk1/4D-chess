import { legalMoves, makeMove, status, inCheck } from '../core/movegen.js';
import { toFen, moveToText, squareName } from '../core/notation.js';
import { startPosition, loadFen, VARIANTS } from '../variants.js';
import { renderBoard, renderCoordinates, glyphFor } from './board.js';
import { createSpatialView } from './spatial.js';

const els = {
  variant: document.querySelector('#variant'),
  boardArea: document.querySelector('#board-area'),
  status: document.querySelector('#status'),
  turn: document.querySelector('#turn'),
  history: document.querySelector('#history'),
  fen: document.querySelector('#fen'),
  load: document.querySelector('#load'),
  copy: document.querySelector('#copy'),
  undo: document.querySelector('#undo'),
  reset: document.querySelector('#reset'),
  blurb: document.querySelector('#blurb'),
  promotion: document.querySelector('#promotion'),
  promotionChoices: document.querySelector('#promotion-choices'),
};

const state = {
  variantId: '3d',
  position: null,
  history: [],      // { position, move } for undo and the move list
  selected: null,
  moves: [],
};

let explorer = null;

function refreshExplorer(pos) {
  if (explorer?.position !== pos) {
    explorer?.viewer.destroy();
    const slices = renderBoard(pos, { selected: null, targets: new Map(), checkIndex: null, lastMove: null, onSquare });
    const viewer = createSpatialView(pos, onSquare);
    const layout = document.createElement('div');
    layout.className = 'cube-explorer';
    layout.append(slices, viewer.element);
    els.boardArea.replaceChildren(layout);
    explorer = { position: pos, viewer, slices };
  }
  for (const cell of explorer.slices.querySelectorAll('.cell')) {
    const selected = Number(cell.dataset.index) === state.selected;
    cell.classList.toggle('selected', selected);
    cell.setAttribute('aria-pressed', String(selected));
  }
  explorer.viewer.update(state.selected);
  els.status.textContent = '3D position explorer';
  els.blurb.textContent = VARIANTS[state.variantId].blurb;
  els.reset.textContent = 'Reset position';
  els.fen.value = toFen(pos);
}

function newGame(variantId = state.variantId) {
  state.variantId = variantId;
  state.position = startPosition(variantId);
  state.history = [];
  state.selected = null;
  refresh();
}

function refresh() {
  const pos = state.position;
  document.body.classList.toggle('spatial', pos.dims > 2);
  const inspection = Boolean(pos.variant?.inspectionOnly);
  document.body.classList.toggle('inspection', inspection);
  if (inspection) {
    state.moves = [];
    refreshExplorer(pos);
    return;
  }
  if (explorer) { explorer.viewer.destroy(); explorer = null; }
  els.reset.textContent = 'New game';
  state.moves = legalMoves(pos);

  const targets = new Map();
  if (state.selected !== null) {
    for (const move of state.moves) {
      if (move.from === state.selected) targets.set(move.to, move);
    }
  }

  const checked = inCheck(pos);
  els.boardArea.replaceChildren(
    renderBoard(pos, {
      selected: state.selected,
      targets,
      checkIndex: checked ? pos.kingIndex(pos.turn) : null,
      lastMove: state.history.at(-1)?.move ?? null,
      onSquare,
    }),
    ...(pos.dims <= 2 ? [renderCoordinates(pos)] : []),
  );

  const state_ = status(pos);
  els.turn.className = 'turn-token ' + (pos.turn === 'w' ? 'white' : 'black');
  if (state_.over) {
    els.status.textContent = state_.reason === 'checkmate'
      ? `Checkmate — ${state_.result === 'w' ? 'White' : 'Black'} wins`
      : 'Stalemate — draw';
  } else {
    els.status.textContent = `${pos.turn === 'w' ? 'White' : 'Black'} to move${state_.check ? ' — check' : ''}`;
  }

  els.fen.value = toFen(pos);
  els.blurb.textContent = VARIANTS[state.variantId].blurb;
  els.undo.disabled = state.history.length === 0;
  renderHistory();
}

function renderHistory() {
  els.history.replaceChildren();
  state.history.forEach((entry, i) => {
    const row = document.createElement('li');
    const glyph = glyphFor(entry.move.piece);
    row.innerHTML = `<span class="ply">${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'}</span>`
      + `<span class="glyph">${glyph}</span>`
      + `<code>${moveToText(entry.position.shape, entry.move)}</code>`
      + (entry.move.captured ? '<span class="tag">x</span>' : '')
      + (entry.move.castle ? '<span class="tag">castle</span>' : '')
      + (entry.move.ep ? '<span class="tag">e.p.</span>' : '');
    els.history.append(row);
  });
  els.history.parentElement.scrollTop = els.history.parentElement.scrollHeight;
}

function onSquare(index) {
  const pos = state.position;
  if (pos.variant?.inspectionOnly) {
    state.selected = state.selected === index ? null : index;
    refreshExplorer(pos);
    return;
  }

  if (state.selected !== null) {
    const matching = state.moves.filter((m) => m.from === state.selected && m.to === index);
    if (matching.length === 1) return play(matching[0]);
    if (matching.length > 1) return askPromotion(matching);
  }

  const piece = pos.get(index);
  const owned = piece !== null && (piece === piece.toUpperCase() ? 'w' : 'b') === pos.turn;
  state.selected = owned && state.selected !== index ? index : null;
  refresh();
}

function play(move) {
  state.history.push({ position: state.position, move });
  state.position = makeMove(state.position, move);
  state.selected = null;
  refresh();
}

function askPromotion(moves) {
  els.promotionChoices.replaceChildren();
  for (const move of moves) {
    const button = document.createElement('button');
    const piece = state.position.turn === 'w' ? move.promotion.toUpperCase() : move.promotion;
    button.textContent = glyphFor(piece);
    button.title = move.promotion;
    button.addEventListener('click', () => {
      els.promotion.close();
      play(move);
    });
    els.promotionChoices.append(button);
  }
  els.promotion.showModal();
}

function undo() {
  const previous = state.history.pop();
  if (!previous) return;
  state.position = previous.position;
  state.selected = null;
  refresh();
}

function loadFromField() {
  try {
    const next = loadFen(els.fen.value.trim(), state.variantId);
    const expected = VARIANTS[state.variantId].shape.join('x');
    if (next.shape.join('x') !== expected) {
      throw new Error(`shape ${next.shape.join('x')} does not match the ${VARIANTS[state.variantId].name} board (${expected})`);
    }
    state.position = next;
    state.history = [];
    state.selected = null;
    refresh();
  } catch (error) {
    els.status.textContent = 'Could not load: ' + error.message;
  }
}

for (const [id, variant] of Object.entries(VARIANTS)) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = variant.name;
  els.variant.append(option);
}
els.variant.value = state.variantId;

els.variant.addEventListener('change', (event) => newGame(event.target.value));
els.reset.addEventListener('click', () => newGame());
els.undo.addEventListener('click', undo);
els.load.addEventListener('click', loadFromField);
els.copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.fen.value);
  els.copy.textContent = 'Copied';
  setTimeout(() => { els.copy.textContent = 'Copy'; }, 1200);
});

newGame();
