import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Extract this uncompressed, texture-free set without re-tessellating its meshes.
const source = 'Chess Set by Pia Leung - bfb3C6hpdi0.glb';
const outDir = 'assets/chess';
const file = fs.readFileSync(source);
assert.equal(file.readUInt32LE(0), 0x46546c67);
assert.equal(file.readUInt32LE(4), 2);
const jsonLength = file.readUInt32LE(12);
const original = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
const bin = file.subarray(28 + jsonLength);
assert.ok(!original.extensionsUsed?.length && !original.textures?.length);
const selections = { pawn: 29, rook: 18, knight: 20, bishop: 31, queen: 33, king: 32 };
fs.mkdirSync(outDir, { recursive: true });
const report = [];
for (const [name, meshIndex] of Object.entries(selections)) {
  const mesh = structuredClone(original.meshes[meshIndex]);
  const doc = {
    asset: { version: '2.0', generator: 'split-chess-set.js', extras: {
      source, creator: 'Pia Leung', license: 'CC BY 3.0',
      sourceUrl: 'https://poly.pizza/m/bfb3C6hpdi0',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    } },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name, mesh: 0 }],
    meshes: [mesh], accessors: [], bufferViews: [], materials: [], buffers: [],
  };
  mesh.name = name;
  const accessorMap = new Map(), materialMap = new Map();
  const chunks = [];
  let byteLength = 0;
  function copyAccessor(index) {
    if (accessorMap.has(index)) return accessorMap.get(index);
    const accessor = structuredClone(original.accessors[index]);
    assert.ok(!accessor.sparse);
    const view = original.bufferViews[accessor.bufferView];
    const componentBytes = { 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
    const components = { SCALAR: 1, VEC3: 3 }[accessor.type];
    assert.ok(componentBytes && components);
    const stride = view.byteStride ?? componentBytes * components;
    const length = (accessor.count - 1) * stride + componentBytes * components;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const bytes = Buffer.from(bin.subarray(start, start + length));
    accessor.bufferView = doc.bufferViews.length;
    accessor.byteOffset = 0;
    doc.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: length,
      ...(view.byteStride ? { byteStride: view.byteStride } : {}), target: view.target });
    const padding = (4 - length % 4) % 4;
    chunks.push(bytes, Buffer.alloc(padding));
    byteLength += length + padding;
    const mapped = doc.accessors.length;
    doc.accessors.push(accessor);
    accessorMap.set(index, mapped);
    return mapped;
  }
  for (const primitive of mesh.primitives) {
    primitive.indices = copyAccessor(primitive.indices);
    for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = copyAccessor(primitive.attributes[key]);
    const material = primitive.material;
    if (!materialMap.has(material)) {
      materialMap.set(material, doc.materials.length);
      doc.materials.push(structuredClone(original.materials[material]));
    }
    primitive.material = materialMap.get(material);
  }
  const binary = Buffer.concat(chunks);
  // Bake centring into vertex positions, leaving identity node transforms.
  const positionIds = [...new Set(mesh.primitives.map(p => p.attributes.POSITION))];
  const min = [0, 1, 2].map(axis => Math.min(...positionIds.map(i => doc.accessors[i].min[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...positionIds.map(i => doc.accessors[i].max[axis])));
  const offset = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  for (const id of positionIds) {
    const a = doc.accessors[id], v = doc.bufferViews[a.bufferView];
    assert.equal(a.componentType, 5126);
    assert.equal(a.type, 'VEC3');
    for (let i = 0; i < a.count; i++) for (let axis = 0; axis < 3; axis++) {
      const at = v.byteOffset + (a.byteOffset ?? 0) + i * (v.byteStride ?? 12) + axis * 4;
      binary.writeFloatLE(binary.readFloatLE(at) - offset[axis], at);
    }
    a.min = a.min.map((n, axis) => n - offset[axis]);
    a.max = a.max.map((n, axis) => n - offset[axis]);
  }
  doc.buffers.push({ byteLength: binary.length });
  const json = Buffer.from(JSON.stringify(doc));
  const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + paddedJson.length + binary.length, 8);
  header.writeUInt32LE(paddedJson.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(binary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const result = Buffer.concat([header, paddedJson, binHeader, binary]);
  fs.writeFileSync(path.join(outDir, `${name}.glb`), result);
  report.push({ name, triangles: mesh.primitives.reduce((sum, p) => sum + doc.accessors[p.indices].count / 3, 0), bytes: result.length });
}
fs.writeFileSync(path.join(outDir, 'README.md'), `# Chess meshes\n\n[Chess Set](https://poly.pizza/m/bfb3C6hpdi0) by Pia Leung, licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), via Poly Pizza.\n\nExtracted from "${source}", supplied in the repository. The original source file is unchanged.\n\nSix representative white pieces, with original materials, normals, and relative scale.\nPiece bases are centred at (0, 0, 0), Y up.\nNo simplification or remeshing was performed.\n\nRegenerate from the repository root with: node scripts/split-chess-set.js\n\n| File | Triangles | Bytes |\n|---|---:|---:|\n${report.map(r => `| ${r.name}.glb | ${r.triangles} | ${r.bytes} |`).join('\n')}\n`);
console.table(report);
