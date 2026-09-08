import { fromFen } from '../core/notation.js';
import { chooseMove, difficulties } from '../core/search.js';
import { VARIANTS } from '../variants.js';

// The opponent, off the main thread. A depth-2 search on 4^4 is half a second
// of solid arithmetic; run inline it would freeze the orbit and the render loop
// for exactly as long as it thought.
//
// Note this file gets no import map -- workers do not inherit the document's.
// It only reaches src/core and src/variants.js, none of which use a bare
// specifier, so the graph resolves on relative paths alone. Anything that pulls
// in three.js cannot be imported from here.
//
// The position crosses as a FEN rather than as an object: it is smaller than a
// structured clone of the board, and it round-trips through code the test suite
// already covers.

self.addEventListener('message', (event) => {
  const { id, fen, variantId, difficulty } = event.data ?? {};
  try {
    const pos = fromFen(fen, VARIANTS[variantId]);
    const options = difficulties[difficulty] ?? difficulties.medium;
    const result = chooseMove(pos, options);
    self.postMessage({
      id,
      move: result?.move ?? null,
      depth: result?.depth ?? 0,
      nodes: result?.nodes ?? 0,
      ms: Math.round(result?.ms ?? 0),
    });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
});
