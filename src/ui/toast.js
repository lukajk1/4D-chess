// Transient messages over the board.
//
// The host lives on <body>, not inside the explorer shell: that shell is torn
// down and rebuilt on every move, so a toast parented there would be destroyed
// by the very move that raised it.
//
// One message is shown at a time. A new call interrupts whatever is up rather
// than stacking beneath it, so the newest is always the one being read and its
// timer starts fresh -- a run of quick moves reads as a changing line, not as a
// growing pile.

const DURATION = 2600;
const FADE = 800;          // must match the .is-leaving transition
let host = null;
let active = null;

function ensureHost() {
  // isConnected rather than a plain null check, so a toast still works if
  // something ever replaces the body's children out from under it.
  if (host?.isConnected) return host;
  host = document.createElement('div');
  host.className = 'toast-host';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  document.body.append(host);
  return host;
}

export function toast(message, { duration = DURATION } = {}) {
  if (!message) return null;
  clearToasts();

  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  ensureHost().append(node);
  // Next frame, so the entry transition has a start state to move from.
  requestAnimationFrame(() => node.classList.add('is-shown'));

  const entry = { node, timer: 0, done: false };
  const dismiss = () => {
    if (entry.done) return;
    entry.done = true;
    clearTimeout(entry.timer);
    if (active === entry) active = null;
    // Leaving is slower than arriving, so the message reads as fading out
    // rather than being cut off.
    node.classList.add('is-leaving');
    node.classList.remove('is-shown');
    // Removal is on a timer alone. transitionend does not fire in a background
    // tab, and firing on the first of two transitioning properties made it a
    // race that could cut the fade short.
    setTimeout(() => node.remove(), FADE + 80);
  };
  entry.timer = setTimeout(dismiss, duration);
  active = entry;
  return { dismiss };
}

// Takes down whatever is showing at once, with no fade. Used both by an
// interrupting message and when the board changes underneath, so a stale
// readout cannot outlive the game it described.
export function clearToasts() {
  if (active) {
    clearTimeout(active.timer);
    active.done = true;
    active = null;
  }
  host?.replaceChildren();
}
