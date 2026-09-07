import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Bakes a half turn about the vertical axis into a piece's vertex data, for
// models that were authored facing the wrong way. A rigid rotation, so nothing
// is re-tessellated: POSITION and NORMAL simply get x and z negated, in place.
//
// Baked rather than applied at load because the orientation is a property of
// the asset, not of one viewer -- and because model-pieces.js caches geometry
// module-wide, so a load-time fix would have to live somewhere every consumer
// remembers to call.
//
//   node scripts/rotate-piece.js knight
//
// The source set this was extracted from is no longer in the repository, so
// scripts/split-chess-set.js cannot regenerate these. If it ever is, re-run
// that first and then this.

const [name] = process.argv.slice(2);
if (!name) {
  console.error('usage: node scripts/rotate-piece.js <piece>');
  process.exit(1);
}

const file = path.join('assets/chess', `${name}.glb`);
const data = fs.readFileSync(file);
assert.equal(data.readUInt32LE(0), 0x46546c67, 'not a glb');
assert.equal(data.readUInt32LE(4), 2, 'expected glTF 2.0');

const jsonLength = data.readUInt32LE(12);
assert.equal(data.readUInt32LE(16), 0x4e4f534a, 'expected a JSON chunk first');
const doc = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
const binLength = data.readUInt32LE(20 + jsonLength);
assert.equal(data.readUInt32LE(24 + jsonLength), 0x004e4942, 'expected a BIN chunk second');
const bin = Buffer.from(data.subarray(28 + jsonLength, 28 + jsonLength + binLength));

// A node transform would be simpler, but three.js is not the only thing that
// reads these; putting the turn in the data means every consumer agrees.
assert.deepEqual(
  doc.nodes.map((node) => [node.rotation, node.matrix, node.translation, node.scale]),
  doc.nodes.map(() => [undefined, undefined, undefined, undefined]),
  'node already carries a transform; baking would compose with it',
);

const touched = new Set();
for (const mesh of doc.meshes) {
  for (const primitive of mesh.primitives) {
    for (const attribute of ['POSITION', 'NORMAL']) {
      const index = primitive.attributes[attribute];
      if (index === undefined || touched.has(index)) continue;
      touched.add(index);

      const accessor = doc.accessors[index];
      assert.equal(accessor.type, 'VEC3');
      assert.equal(accessor.componentType, 5126, 'expected float32');
      assert.ok(!accessor.sparse);
      const view = doc.bufferViews[accessor.bufferView];
      const stride = view.byteStride ?? 12;
      const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);

      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < accessor.count; i++) {
        const at = start + i * stride;
        // A half turn about Y: (x, y, z) -> (-x, y, -z).
        const v = [-bin.readFloatLE(at), bin.readFloatLE(at + 4), -bin.readFloatLE(at + 8)];
        for (let k = 0; k < 3; k++) {
          bin.writeFloatLE(v[k], at + k * 4);
          // Read the float back: the stored value is float32 and the bounds
          // have to describe what is actually in the buffer, not the double
          // that produced it.
          const stored = bin.readFloatLE(at + k * 4);
          min[k] = Math.min(min[k], stored);
          max[k] = Math.max(max[k], stored);
        }
      }
      if (accessor.min) accessor.min = min;
      if (accessor.max) accessor.max = max;
      console.log(`  ${attribute}: ${accessor.count} vertices, bounds ${JSON.stringify(min)} .. ${JSON.stringify(max)}`);
    }
  }
}
assert.ok(touched.size, 'found no POSITION or NORMAL to rotate');

// Chunks are 4-byte aligned: JSON pads with spaces, BIN with zeroes.
const json = Buffer.from(JSON.stringify(doc));
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const binPadded = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
const out = Buffer.alloc(12 + 8 + jsonPadded.length + 8 + binPadded.length);
out.writeUInt32LE(0x46546c67, 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(out.length, 8);
out.writeUInt32LE(jsonPadded.length, 12);
out.writeUInt32LE(0x4e4f534a, 16);
jsonPadded.copy(out, 20);
out.writeUInt32LE(binPadded.length, 20 + jsonPadded.length);
out.writeUInt32LE(0x004e4942, 24 + jsonPadded.length);
binPadded.copy(out, 28 + jsonPadded.length);

fs.writeFileSync(file, out);
console.log(`rotated ${file}: ${data.length} -> ${out.length} bytes`);
