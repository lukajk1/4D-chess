import { legalMoves, makeMove, inCheck, envelope } from '../core/movegen.js';
import { colorOf } from '../core/position.js';
import { toFen, squareName } from '../core/notation.js';
import { startPosition, loadFen, VARIANTS } from '../variants.js';
import { renderBoard, renderCoordinates, glyphFor } from './board.js';
import { createSpatialView } from './spatial-gl.js';
import { audioCues, unlockAudio } from './audio.js';
import { toast, clearToasts } from './toast.js';
import { difficulties } from '../core/search.js';

// Unlock on gestures before a move is submitted, including keyboard play.
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('keydown', unlockAudio);

const els = {
  variant: document.querySelector('#variant'),
  opponent: document.querySelector('#opponent'),
  boardArea: document.querySelector('#board-area'),
  status: document.querySelector('#status'),
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
  moves: [],       // legal moves for the side to move, rebuilt once per position
  check: false,    // is that side's king attacked right now
  opponent: null,  // difficulty key, or null for two players
  askedFor: null,  // the position the engine was last asked about
};

// The engine plays Black. A side picker is the obvious next thing to add here,
// but one colour keeps the first version honest.
const COMPUTER = 'b';

let computer = null;
let computerRequest = 0;

function ensureComputer() {
  if (computer) return computer;
  computer = new Worker(new URL('./computer.worker.js', import.meta.url), { type: 'module' });
  computer.addEventListener('message', (event) => {
    const { id, move, error } = event.data ?? {};
    // Anything the board has moved past. Undo, a new game and a later request
    // all bump the counter, so a stale reply can never be played.
    if (id !== computerRequest) return;
    if (error) { toast(`Computer: ${error}`); return; }
    if (move) submitMove(move);
  });
  return computer;
}

// Called after every position change. Guarded on the position itself rather
// than on a flag, because refresh() also runs for selection changes and must
// not set the engine going again on a board it is already thinking about.
function askComputer() {
  const pos = state.position;
  if (!state.opponent || pos.turn !== COMPUTER || !state.moves.length) return;
  if (state.askedFor === pos) return;
  state.askedFor = pos;
  const id = ++computerRequest;
  try {
    ensureComputer().postMessage({
      id, fen: toFen(pos), variantId: state.variantId, difficulty: state.opponent,
    });
  } catch (error) {
    toast('Computer unavailable in this browser');
    state.opponent = null;
    els.opponent.value = '';
  }
}

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

// 1D and 2D keep their DOM board, wrapped in the same interface the shell
// docks: element, update, destroy. It has no canvas, no camera and no controls,
// so the explorer's control column simply comes up holding only its toolbar.
function createBoardView(pos) {
  const root = document.createElement('div');
  // The wrapper carries the square, so the file letters match the board's
  // width rather than the whole centred area.
  root.className = pos.dims === 1 ? 'play-board line' : 'play-board';
  const draw = (selected) => {
    const targets = new Map();
    if (selected !== null) {
      for (const move of state.moves) {
        if (move.from === selected) targets.set(move.to, move);
      }
    }
    const checked = inCheck(pos);
    const parts = [renderBoard(pos, {
      selected,
      targets,
      checkIndex: checked ? pos.kingIndex(pos.turn) : null,
      lastMove: state.history.at(-1)?.move ?? null,
      onSquare,
    })];
    parts.push(renderCoordinates(pos));
    root.replaceChildren(...parts);
  };
  draw(state.selected);
  // Nothing to tear down -- no GL context, and the DOM goes with the shell --
  // but the shell calls destroy unconditionally, so honour the interface.
  return { element: root, update: draw, destroy() {} };
}

// What the spatial viewer draws as reachable. The legal list, not the raw
// reach, so a highlighted square is always one that can actually be played --
// and deduped, because a promotion contributes one move per piece it can
// become and would otherwise stack four walls on one square.
const legalTargets = (index) =>
  [...new Set(state.moves.filter((move) => move.from === index).map((move) => move.to))];

function refreshExplorer(pos, lastMove = null) {
  if (!explorer || explorer.position !== pos) {
    const prevCamera = explorer?.viewer?.getCameraState?.();
    const prevOpen = explorer?.getOpen?.();
    explorer?.destroy();

    const viewer = pos.dims > 2
      ? createSpatialView(pos, onSquare, glyphFor, lastMove, legalTargets)
      : createBoardView(pos);
    // Optional: a camera state only means something to the spatial viewer, and
    // switching from one of those to a flat board carries a live one across.
    if (prevCamera) viewer.setCameraState?.(prevCamera);
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
    // Read off the list refresh() already built rather than calling status(),
    // which would recompute legalMoves -- tens of milliseconds on the 8^4 board
    // for an answer we are holding.
    const noMoves = state.moves.length === 0;
    turn.textContent = noMoves
      ? (state.check
        ? `Checkmate — ${pos.turn === 'w' ? 'Black' : 'White'} wins`
        : 'Stalemate — draw')
      : `${pos.turn === 'w' ? 'White' : 'Black'} to move${state.check ? ' — check' : ''}`;
    const last = document.createElement('span');
    last.className = 'explorer-last-move';
    const previous = state.history.at(-1);
    last.textContent = previous
      ? `Last: ${colorOf(previous.move.piece) === 'w' ? 'White' : 'Black'} ${displayMove(previous.position.shape, previous.move)}`
      : 'Last: —';
    moveDisplay.append(turn, last);
    // The square readout is game state too, so it joins the turn and the last
    // move rather than floating over the board by itself. The viewer keeps its
    // own reference and goes on writing to it wherever it ends up.
    const caption = viewer.element.querySelector('.cube-caption');
    if (caption) moveDisplay.append(caption);
    // Title and game state ride on the view itself, alongside the asset
    // credits, so the control column is nothing but controls.
    const hud = document.createElement('div');
    hud.className = 'explorer-hud';
    const brand = document.createElement('header');
    brand.className = 'explorer-brand';
    brand.innerHTML = '<strong>4D chess</strong><a role="link" aria-disabled="true">created by lukajk</a>';
    // Attribution belongs with the byline rather than off in a corner of its
    // own. The dialog it opens stays where the viewer put it.
    const credit = viewer.element.querySelector('.credit-link');
    if (credit) brand.append(credit);
    // Board picker heads the control stack, directly under the game state.
    hud.append(brand, moveDisplay, els.variant, els.opponent);
    main.append(viewer.element, hud);
    const side = document.createElement('aside');
    side.className = 'explorer-side';
    side.hidden = true;
    // Controls ride on the view under the game state, optional views dock on
    // the right, and the canvas spans everything behind them.
    const controlsPanel = document.createElement('aside');
    controlsPanel.className = 'explorer-controls';
    hud.append(controlsPanel);
    shell.append(main, side);

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
  clearToasts();
  computerRequest++;
  state.askedFor = null;
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
  // One shell for every variant now. 1D and 2D dock a DOM board where the
  // canvas goes and inherit the same HUD, toolbar and history around it, so
  // `inspection` is really just "the explorer layout" and is always on.
  document.body.classList.add('inspection');
  // Every variant now plays by the same rules. legalMoves is dimension-generic
  // and perft-verified, so 3D and 4D get check, checkmate and stalemate from
  // the same code the flat boards use. It runs once per position, not per
  // click -- selection goes through refreshExplorer, which does not come here.
  state.moves = legalMoves(pos);
  state.check = inCheck(pos);
  refreshExplorer(pos, state.animatingMove ?? null);
  state.animatingMove = null;
  askComputer();
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
      // Same shape as the flat path: the move has to be in the legal list, and
      // several entries for one square means a promotion to choose between.
      const matching = state.moves.filter((m) => m.from === state.selected && m.to === index);
      if (matching.length === 1) return submitMove(matching[0]);
      if (matching.length > 1) return askPromotion(matching);
      // Nothing legal here. If the king is under attack that is almost always
      // the reason, and it is the one rejection worth explaining -- but only
      // when a real move was attempted, not on a click into open space.
      if (state.check && envelope(pos, state.selected).includes(index)) {
        toast('Check — that move leaves your king attacked');
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
    if (state.check && envelope(pos, state.selected).includes(index)) {
      toast('Check — that move leaves your king attacked');
    }
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
  // Fired here rather than in the click handler, so anything that submits a
  // move announces it -- a future opponent included.
  toast(`${colorOf(piece) === 'w' ? 'White' : 'Black'} ${displayMove(position.shape, submitted)}`);
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

const ALLOWED_VARIANTS = new Set(['1d', '2d', '3d', '4d-4', '4d']);
const VARIANT_LABELS = {
  '1d': '1D - 8 strip', '2d': '2D - 8² board',
  '3d': '3D - 8³ board',
  '4d-4': '4D - 4⁴ board', '4d': '4D - 8⁴ board',
};
for (const [id, variant] of Object.entries(VARIANTS)) {
  if (!ALLOWED_VARIANTS.has(id)) continue;
  const option = document.createElement('option');
  option.value = id;
  option.textContent = VARIANT_LABELS[id] ?? variant.name;
  els.variant.append(option);
}
els.variant.value = state.variantId;

for (const [key, options] of [['', 'Two players'], ...Object.entries(difficulties).map(([k, o]) => [k, `Computer — ${o.label}`])]) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = options;
  els.opponent.append(option);
}
els.opponent.value = '';

els.variant.addEventListener('change', (event) => newGame(event.target.value));
// Restarting on change is what makes this "choose before you play": swapping
// opponents mid-game would leave a history half of one and half of the other.
els.opponent.addEventListener('change', (event) => {
  state.opponent = event.target.value || null;
  newGame();
});
els.reset.addEventListener('click', () => newGame());
els.undo.addEventListener('click', undo);
els.load.addEventListener('click', loadFromField);
els.copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.fen.value);
  els.copy.textContent = 'Copied';
  setTimeout(() => { els.copy.textContent = 'Copy'; }, 1200);
});

newGame();
