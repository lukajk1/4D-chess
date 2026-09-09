// Content for the about dialog, kept in its own module for the same reason as
// explanation.js: it is prose nobody needs until they ask for it, so the first
// open fetches it rather than the page load. Nothing here runs; it is a string.

export const aboutHTML = `
  <h1>About</h1>

  <p>This project was inspired by
  <a href="https://x.com/miki_code/status/2096132455652549117" target="_blank"
     rel="noopener noreferrer">a post on Xitter</a>, where a user asked the recently released GPT-6 Astra to create 4D chess.</p>

  <p>Surprisingly, it seems that no one has ever made a tesseract-based 4D chess
  visualization before. There are a good number of existing writeups and
  projects made about 4D chess in general - <a href="https://chess4d.herokuapp.com/" target="_blank" rel="noopener noreferrer">1</a>,
    <a href="https://www.researchgate.net/publication/402606313_A_Mathematical_Framework_for_Four-Dimensional_Chess_Extending_Game_Mechanics_Through_Higher-Dimensional_Geometry" target="_blank" rel="noopener noreferrer">2</a>,
    <a href="https://www.chessvariants.com/large.dir/contest/chesseract.html" target="_blank" rel="noopener noreferrer">3</a>,
    <a href="https://www.youtube.com/watch?v=3wFQPSEPgWc" target="_blank" rel="noopener noreferrer">4</a>,
    <a href="https://www.youtube.com/watch?v=XvH20cbuLK0" target="_blank" rel="noopener noreferrer">5</a>, but I did not find any documentation of such a visualization.</p>

  <!--
  <ul class="about-links">
    <li><a href="https://chess4d.herokuapp.com/" target="_blank" rel="noopener noreferrer">chess4d.herokuapp.com</a></li>
    <li><a href="https://www.researchgate.net/publication/402606313_A_Mathematical_Framework_for_Four-Dimensional_Chess_Extending_Game_Mechanics_Through_Higher-Dimensional_Geometry" target="_blank" rel="noopener noreferrer">A Mathematical Framework for Four-Dimensional Chess</a></li>
    <li><a href="https://www.chessvariants.com/large.dir/contest/chesseract.html" target="_blank" rel="noopener noreferrer">Chesseract, on chessvariants.com</a></li>
    <li><a href="https://www.youtube.com/watch?v=3wFQPSEPgWc" target="_blank" rel="noopener noreferrer">How to Play 4D Chess (video)</a></li>
    <li><a href="https://www.youtube.com/watch?v=XvH20cbuLK0" target="_blank" rel="noopener noreferrer">Movement of 4D Chess (video)</a></li>
  </ul>-->

  <p>That potentially makes the Astra 4D chess visualization on a tesseract the first ever, surprisingly. I
  expected someone to have done it in the past, given how long experimentation with a spatial 4th dimension and chess have existed for. </p>
  <!--
  The traditional layout
  for 4D chess tends to be 16 grids of 4&times;4 dimensions — halved from the
  standard 8&times;8 board for the sake of manageability. The Astra
  visualization only used 4&times;4&times;2&times;2: two boards along z, and two
  along w. However, I o I set out to visualize a
  4&times;4&times;4&times;4 and 8&times;8&times;8&times;8 board in its true
  glory.</p>

  <p>Naturally, laying out the board this way is not pragmatic.
  It makes the game even more unwieldy to play, and the structure of laying out
  the 16 boards in a 1&times;4&times;4 sort of slice is a much more intuitive
  way to actually play the game. But it looks cool, and this way you can rotate
  the spaces around in 4D — win some and lose some&hellip;</p>
  -->

  <p>Piece movements generalize quite well. We simply hardcode the forward
  direction for pawns as both along y and w (the 4th spatial axis), and
  otherwise calculations involving pieces with a w-move are almost mundane.
  From a move computation standpoint, there isn't really anything different
  between w and y.</p>
`;
