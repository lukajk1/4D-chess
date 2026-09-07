# Chess meshes

[Chess Set](https://poly.pizza/m/bfb3C6hpdi0) by Pia Leung, licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), via Poly Pizza.

Extracted from "Chess Set by Pia Leung - bfb3C6hpdi0.glb", supplied in the repository. The original source file is unchanged.

Six representative white pieces, with original normals and relative scale (materials omitted).
Piece bases are centred at (0, 0, 0), Y up.
No simplification or remeshing was performed.

`knight.glb` additionally carries a half turn about the vertical axis, baked
into its POSITION and NORMAL data by `scripts/rotate-piece.js` because the
original faces the wrong way. Rigid, so nothing was re-tessellated. Regenerating
with the command below would drop it; re-run `node scripts/rotate-piece.js
knight` afterwards.

Regenerate from the repository root with: node scripts/split-chess-set.js

| File | Triangles | Bytes |
|---|---:|---:|
| pawn.glb | 236 | 13860 |
| rook.glb | 236 | 13448 |
| knight.glb | 334 | 19940 |
| bishop.glb | 340 | 19272 |
| queen.glb | 429 | 25048 |
| king.glb | 430 | 23476 |
