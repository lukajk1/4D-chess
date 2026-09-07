import { legalMoves, makeMove, status, inCheck, envelope, forwardAxisOf, forwardDirectionOf } from '../core/movegen.js';
import { colorOf, typeOf, toCoord } from '../core/position.js';
import { toFen, squareName } from '../core/notation.js';
import { startPosition, loadFen, VARIANTS } from '../variants.js';
import { renderBoard, renderCoordinates, glyphFor } from './board.js';
import { createSpatialView } from './spatial-gl.js';
import { audioCues, unlockAudio } from './audio.js';

// Unlock on gestures before a move is submitted, including keyboard play.
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('keydown', unlockAudio);

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
  promotion: document.querySelector('#promotion'),
  promotionChoices: document.querySelector('#promotion-choices'),
};

const state = {
  variantId: '4d-4',
  position: null,
  history: [],      // { position, move } for undo and the move list
  selected: null,
  moves: [],
};

let explorer = null;

function displayMove(shape, move) {
  if (move.castle) return 'Castle';
  const from = squareName(shape, move.from);
  const to = squareName(shape, move.to);
  const separator = move.captured || move.ep ? 'x' : '–';
  const promotion = move.promotion ? `=${move.promotion.toUpperCase()}` : '';
  return `${from}${separator}${to}${promotion}`;
}

// The flat slice boards, wrapped in the same { element, update, destroy }
// shape the spatial views use so the shell can dock any of them alike.
function buildSlices(pos) {
  const root = document.createElement('div');
  root.className = 'explorer-slices';
  // Every board at once: shape[2] layers of each of shape[3] cubes, each
  // labelled with the address its squares carry. No cube picker, because
  // nothing is hidden any more.
  root.append(renderBoard(pos, {
    selected: state.selected, targets: new Map(), checkIndex: null, lastMove: null, onSquare,
  }));
  return {
    element: root,
    update(selected) {
      for (const cell of root.querySelectorAll('.cell')) {
        const on = Number(cell.dataset.index) === selected;
        cell.classList.toggle('selected', on);
        cell.setAttribute('aria-pressed', String(on));
      }
    },
  };
}

function refreshExplorer(pos, lastMove = null) {
  if (!explorer || explorer.position !== pos) {
    const prevCamera = explorer?.viewer?.getCameraState?.();
    const prevOpen = explorer?.getOpen?.();
    explorer?.destroy();

    const viewer = createSpatialView(pos, onSquare, glyphFor, lastMove);
    if (prevCamera) viewer.setCameraState(prevCamera);
    const shell = document.createElement('div');
    shell.className = 'explorer-shell';
    const main = document.createElement('div');
    main.className = 'explorer-main';
    const moveDisplay = document.createElement('section');
    moveDisplay.className = 'explorer-move-display';
    moveDisplay.setAttribute('role', 'status');
    moveDisplay.setAttribute('aria-live', 'polite');
    const turn = document.createElement('strong');
    turn.className = 'explorer-turn';
    turn.dataset.turn = pos.turn;
    turn.textContent = `${pos.turn === 'w' ? 'White' : 'Black'} to move`;
    const last = document.createElement('span');
    last.className = 'explorer-last-move';
    const previous = state.history.at(-1);
    last.textContent = previous
      ? `Last: ${colorOf(previous.move.piece) === 'w' ? 'White' : 'Black'} ${displayMove(previous.position.shape, previous.move)}`
      : 'Last: —';
    moveDisplay.append(turn, last);
    main.append(viewer.element, moveDisplay);
    const side = document.createElement('aside');
    side.className = 'explorer-side';
    side.hidden = true;
    // Controls dock on the left, optional views on the right, canvas between.
    const controlsPanel = document.createElement('aside');
    controlsPanel.className = 'explorer-controls';
    const brand = document.createElement('header');
    brand.className = 'explorer-brand';
    brand.innerHTML = '<strong>4D chess</strong><a role="link" aria-disabled="true">created by lukajk</a>';
    controlsPanel.append(brand);
    shell.append(controlsPanel, main, side);

    // Which auxiliary views this position offers. Views that only make sense
    // in one dimension live in their own modules and are simply absent from
    // the list for the others, so this table is the only place the shell has
    // to know about dimension at all.
    const defs = [
      { id: 'slices', label: 'Slices', make: () => buildSlices(pos) },
    ];

    const toolbar = document.createElement('div');
    toolbar.className = 'explorer-toolbar';
    const open = new Set((prevOpen ?? []).filter((id) => defs.some((d) => d.id === id)));
    const built = new Map();

    const sync = () => {
      side.hidden = open.size === 0;
      for (const def of defs) {
        built.get(def.id)?.wrap.toggleAttribute('hidden', !open.has(def.id));
        def.button.setAttribute('aria-pressed', String(open.has(def.id)));
      }
    };

    for (const def of defs) {
      const button = document.createElement('button');
      button.textContent = def.label;
      def.button = button;
      button.addEventListener('click', () => {
        if (open.has(def.id)) {
          open.delete(def.id);
        } else {
          open.add(def.id);
          // Panels are built the first time they are opened, so the default
          // full-width view costs one WebGL context rather than three.
          if (!built.has(def.id)) {
            const view = def.make();
            const wrap = document.createElement('section');
            wrap.className = 'side-panel';
            wrap.append(view.element);
            side.append(wrap);
            built.set(def.id, { view, wrap });
            view.update?.(state.selected);
          }
        }
        sync();
      });
      toolbar.append(button);
      if (open.has(def.id)) {
        const view = def.make();
        const wrap = document.createElement('section');
        wrap.className = 'side-panel';
        wrap.append(view.element);
        side.append(wrap);
        built.set(def.id, { view, wrap });
        view.update?.(state.selected);
      }
    }

    // Fold the panel toggles and the view's own reset into the viewer's
    // control strip and drop its heading, so the explorer reads as one
    // surface instead of a card inside a toolbar inside a page.
    const controls = viewer.element.querySelector('.cube-controls');
    const heading = viewer.element.querySelector('.cube-heading');
    const resetView = heading?.querySelector('.reset-camera');
    heading?.remove();
    if (resetView) toolbar.append(resetView);
    toolbar.append(els.undo);
    toolbar.append(els.reset);
    if (controls) {
      controls.append(toolbar);
      controlsPanel.append(controls);
    } else {
      controlsPanel.append(toolbar);
    }

    sync();
    els.boardArea.replaceChildren(shell);
    explorer = {
      position: pos,
      viewer,
      getOpen() { return Array.from(open); },
      update(selected) {
        viewer.update(selected);
        for (const { view } of built.values()) view.update?.(selected);
      },
      destroy() {
        viewer.destroy();
        for (const { view } of built.values()) view.destroy?.();
      },
    };
  }
  explorer.update(state.selected);
  els.status.textContent = `${pos.dims}D · ${pos.turn === 'w' ? 'White' : 'Black'} to move`;
  els.reset.textContent = 'Reset position';
  els.fen.value = toFen(pos);
  els.undo.disabled = state.history.length === 0;
  renderHistory();
}

function newGame(variantId = state.variantId) {
  state.variantId = variantId;
  state.position = startPosition(variantId);
  state.history = [];
  state.selected = null;
  state.animatingMove = null;
  refresh();
}

function refresh() {
  const pos = state.position;
  document.body.classList.toggle('spatial', pos.dims > 2);
  const inspection = Boolean(pos.variant?.inspectionOnly);
  document.body.classList.toggle('inspection', inspection);
  if (inspection) {
    state.moves = [];
    refreshExplorer(pos, state.animatingMove ?? null);
    state.animatingMove = null;
    return;
  }
  // The explorer owns several views now, so it tears itself down.
  if (explorer) { explorer.destroy(); explorer = null; }
  els.reset.textContent = 'New game';
  state.moves = legalMoves(pos);

  const targets = new Map();
  if (state.selected !== null) {
    for (const move of state.moves) {
      if (move.from === state.selected) targets.set(move.to, move);
    }
  }

  const checked = inCheck(pos);
  // Wrapped so the wrapper can carry the square: the file letters then match
  // the board's width rather than the whole centred area.
  const wrap = document.createElement('div');
  wrap.className = pos.dims === 1 ? 'play-board line' : 'play-board';
  wrap.append(renderBoard(pos, {
    selected: state.selected,
    targets,
    checkIndex: checked ? pos.kingIndex(pos.turn) : null,
    lastMove: state.history.at(-1)?.move ?? null,
    onSquare,
  }));
  if (pos.dims <= 2) wrap.append(renderCoordinates(pos));
  els.boardArea.replaceChildren(wrap);

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
  els.undo.disabled = state.history.length === 0;
  // 1D and 2D have no left control column, so reset sits beside undo.
  const gameState = document.querySelector('.game-state');
  if (gameState && !gameState.contains(els.undo)) {
    gameState.append(els.undo, els.reset);
  } else {
    els.undo.parentElement?.append(els.reset);
  }
  renderHistory();
}

function renderHistory() {
  els.history.replaceChildren();
  state.history.forEach((entry, i) => {
    const row = document.createElement('li');
    const glyph = glyphFor(entry.move.piece);
    row.innerHTML = `<span class="ply">${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'}</span>`
      + `<span class="glyph">${glyph}</span>`
      + `<code>${displayMove(entry.position.shape, entry.move)}</code>`
      + (entry.move.castle ? '<span class="tag">castle</span>' : '')
      + (entry.move.ep ? '<span class="tag">e.p.</span>' : '');
    els.history.append(row);
  });
  els.history.parentElement.scrollTop = els.history.parentElement.scrollHeight;
}

function onSquare(index) {
  const pos = state.position;
  const isSpatial = pos.dims > 2;

  if (isSpatial) {
    if (state.selected !== null) {
      const targets = envelope(pos, state.selected);
      if (targets.includes(index)) {
        const piece = pos.get(state.selected);
        const color = colorOf(piece);
        const axis = forwardAxisOf(pos);
        const lastRank = forwardDirectionOf(pos, color) > 0 ? pos.shape[axis] - 1 : 0;
        const isPawnPromotion = typeOf(piece) === 'p' && toCoord(pos.shape, index)[axis] === lastRank;
        const move = {
          from: state.selected,
          to: index,
          piece,
          captured: pos.get(index),
          promotion: isPawnPromotion ? 'q' : null,
        };
        submitMove(move);
        return;
      }
    }

    const piece = pos.get(index);
    const owned = piece !== null && colorOf(piece) === pos.turn;
    state.selected = owned && state.selected !== index ? index : null;
    refreshExplorer(pos);
    return;
  }

  if (state.selected !== null) {
    const matching = state.moves.filter((m) => m.from === state.selected && m.to === index);
    if (matching.length === 1) return submitMove(matching[0]);
    if (matching.length > 1) return askPromotion(matching);
  }

  const piece = pos.get(index);
  const owned = piece !== null && (piece === piece.toUpperCase() ? 'w' : 'b') === pos.turn;
  state.selected = owned && state.selected !== index ? index : null;
  refresh();
}

// Human controls and computer players submit the same move object here. The
// controller owns turn order and history; a future AI only has to choose from
// the current position's moves and call this function.
export function submitMove(move) {
  const position = state.position;
  if (!position || !move) return false;
  const piece = position.get(move.from);
  if (piece === null || colorOf(piece) !== position.turn) return false;

  const submitted = {
    ...move,
    piece,
    captured: move.ep ? move.captured : position.get(move.to),
  };
  state.history.push({ position, move: submitted });
  state.animatingMove = {
    from: submitted.from,
    to: submitted.to,
    piece: submitted.piece,
    captured: submitted.captured,
  };
  state.position = makeMove(position, submitted);
  if (submitted.captured || submitted.ep) audioCues.capture();
  else audioCues.move();
  state.selected = null;
  refresh();
  return true;
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
      submitMove(move);
    });
    els.promotionChoices.append(button);
  }
  els.promotion.showModal();
}

function undo() {
  const previous = state.history.pop();
  if (!previous) return;
  state.animatingMove = null;
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
    state.animatingMove = null;
    refresh();
  } catch (error) {
    els.status.textContent = 'Could not load: ' + error.message;
  }
}

const ALLOWED_VARIANTS = new Set(['4d-4', '4d']);
const VARIANT_LABELS = { '4d-4': '4⁴ board', '4d': '8⁴ board' };
for (const [id, variant] of Object.entries(VARIANTS)) {
  if (!ALLOWED_VARIANTS.has(id)) continue;
  const option = document.createElement('option');
  option.value = id;
  option.textContent = VARIANT_LABELS[id] ?? variant.name;
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
