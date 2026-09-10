// Content for the about dialog, kept in its own module for the same reason as
// explanation.js: it is prose nobody needs until they ask for it, so the first
// open fetches it rather than the page load. Nothing here runs; it is a string.

export const aboutHTML = `
  <h1>About</h1>

  <p>This project was inspired by a
  <a href="https://x.com/miki_code/status/2096132455652549117" target="_blank"
     rel="noopener noreferrer">post on twitter</a> where a user asked the recently released GPT-6 Astra to create 4D chess. That board was smaller though - 4&times;4&times;2&times;2: with two boards along z, and two
  along w (the 4th axis). Out of curiousity, I wanted to see what a 8&times;8&times;8&times;8 and 4&times;4&times;4&times;4 board would look like. Of course, I'm pretty sure the game plays terribly and I didn't try to balance it at all.</p>

  <h2>What's the purple tint for?</h2>
  <p>I wanted to emphasize that the smaller boards were moving along the 4th dimension, on the w-axis.</p>

  <h2>Isn't the 4th dimension time?</h2>

  <p>Yes and no. "Dimensions" broadly can just mean values that define a
  reality. But "dimensions" here refers to <em>spatial</em> dimensions: in the
  case of 4D, a new axis called w, so that a vertex is defined across four
  values — (x, y, z, w).</p>

  <p>Surprisingly, it seems that no one has ever made a tesseract-based 4D chess
  visualization before. There are a good number of existing writeups and
  projects made about 4D chess in general - <a href="https://chess4d.herokuapp.com/" target="_blank" rel="noopener noreferrer">1</a>,
    <a href="https://www.researchgate.net/publication/402606313_A_Mathematical_Framework_for_Four-Dimensional_Chess_Extending_Game_Mechanics_Through_Higher-Dimensional_Geometry" target="_blank" rel="noopener noreferrer">2</a>,
    <a href="https://www.chessvariants.com/large.dir/contest/chesseract.html" target="_blank" rel="noopener noreferrer">3</a>,
    <a href="https://www.youtube.com/watch?v=3wFQPSEPgWc" target="_blank" rel="noopener noreferrer">4</a>,
    <a href="https://www.youtube.com/watch?v=XvH20cbuLK0" target="_blank" rel="noopener noreferrer">5</a>, but I did not find any documentation of such a visualization.</p>

  <p>That potentially makes the Astra 4D chess visualization on a tesseract the first ever, surprisingly. I
  expected someone to have done it in the past, given how long experimentation with a spatial 4th dimension and chess have existed for. </p>

  <p>Piece movements generalize quite well. We hardcode the forward
  direction for pawns as both along y and w (the 4th spatial axis), and
  otherwise calculations involving pieces with a w-move are almost mundane.
  From a move computation standpoint, a fourth spatial dimension is not that complex!</p>
`;
