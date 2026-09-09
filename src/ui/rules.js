// Content for the "The game" tab, kept in its own module for the same reason as
// the other two: it is prose nobody needs until they open the dialog. Nothing
// here runs; it is a string.

export const rulesHTML = `
  <h1>How chess works in 4D</h1>

  <p>Chess in 4 spatial dimensions, maybe surprisingly, is not really that different from  Every piece moves the way it always did. What changes is how many
  directions that turns out to mean, because the rules were never really about
  <em>north</em> or <em>diagonal</em> — they were about how many axes a step
  touches at once. Give the board two more axes and the same sentence describes
  a much larger set of moves.</p>

  <h2>The pieces</h2>

  <p>A <strong>rook</strong> moves along exactly one axis at a time. In 2D that
  is four directions; in 4D it is eight, because there are now four axes to run
  along instead of two.</p>

  <p>A <strong>bishop</strong> changes exactly two axes by one step each. That
  is the familiar diagonal — and in 4D there are 24 of them, since there are
  six pairs of axes to pick from rather than one.</p>

  <p>A <strong>queen</strong> is still "rook or bishop, and then some": any
  combination of axes, one step each, repeated until something blocks her. In
  4D that is 80 directions. The <strong>king</strong> has the same 80, but
  takes exactly one step down each.</p>

  <p>A <strong>knight</strong> still leaps two along one axis and one along
  another — 48 destinations in 4D, and still the only piece that jumps over
  what is in the way.</p>

  <p class="explain-note">Two pieces exist that flat chess has no room for: a
  <em>unicorn</em>, which changes three axes at once, and a <em>balloon</em>,
  which changes four. Neither appears in the starting position, but the engine
  knows how they move.</p>

  <h2>Pawns</h2>

  <p>Pawns are the one piece that cares which way is forward, and in 4D they
  get two forwards. A white pawn may advance along <strong>y</strong> or along
  <strong>w</strong> — each a separate move, so a pawn chooses an axis on its
  turn rather than advancing on both at once. Black advances the opposite way
  down both.</p>

  <p>Captures work as they always have: one step forward, plus one square
  sideways. "Sideways" here means x or z — never the other forward axis — so a
  pawn threatens four squares rather than two.</p>

  <p>From its starting square a pawn may push two along either forward axis,
  and the square it passes over must be empty, exactly as in flat chess. A pawn
  that reaches the far corner in <em>both</em> forward axes promotes.</p>

  <h2>Check, mate, and the rest</h2>

  <p>Unchanged. A king is in check when any enemy piece attacks its square, and
  a position with no legal reply to a check is mate. Stalemate is still a draw.
  There is no castling on the 4D boards — with four axes there is no meaningful
  "back rank" to castle along.</p>

  <h2>Reading a square</h2>

  <p>Squares gain one prefix per extra axis, each from a different alphabet so
  they never need separators. A flat <code>e4</code> becomes <code>γe4</code>
  in 3D — layer γ, then e4 — and <code>ivγe4</code> in 4D, where the Roman
  numeral counts w. Selecting a piece shows its full coordinate under the
  board.</p>

  <h2>The hard part</h2>

  <p>None of the above is what makes 4D chess difficult. The difficulty is that
  a piece two squares away in w is <em>adjacent</em>, and looks nothing like it
  on screen. A rook on the far cube attacks straight through the board you are
  looking at. Selecting a piece draws every square it can reach, which is the
  fastest way to build the intuition — and the reason the reach display exists
  at all.</p>
`;
