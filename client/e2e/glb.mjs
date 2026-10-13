// GLB minimal fait de pavés nommés (nom, centre, taille) : paysage de test pour le parcours « monde ».
// Même construction que build_box_glb dans babiverse-studio/backend/app/gltf.py.
export function boxGlb(parts) {
  const positions = [];
  const indices = [];
  const nodes = [];
  const meshes = [];
  const accessors = [];
  const views = [];
  const tri = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  parts.forEach(([name, [cx, cy, cz], [sx, sy, sz]], i) => {
    const [hx, hy, hz] = [sx / 2, sy / 2, sz / 2];
    views.push({ buffer: 0, byteOffset: positions.length * 4, byteLength: 96 });
    for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) positions.push(x, y, z);
    views.push({ buffer: 0, byteOffset: indices.length * 2, byteLength: 72 });
    indices.push(...tri);
    accessors.push({ bufferView: 2 * i, componentType: 5126, count: 8, type: 'VEC3', min: [-hx, -hy, -hz], max: [hx, hy, hz] });
    accessors.push({ bufferView: 2 * i + 1, componentType: 5123, count: 36, type: 'SCALAR' });
    meshes.push({ primitives: [{ attributes: { POSITION: 2 * i }, indices: 2 * i + 1, material: i % 2 }] });
    nodes.push({ name, mesh: i, translation: [cx, cy, cz] });
  });
  const pos = Buffer.from(new Float32Array(positions).buffer);
  for (const v of views.filter((_, k) => k % 2)) v.byteOffset += pos.length;
  let blob = Buffer.concat([pos, Buffer.from(new Uint16Array(indices).buffer)]);
  blob = Buffer.concat([blob, Buffer.alloc((4 - (blob.length % 4)) % 4)]);
  const doc = {
    asset: { version: '2.0', generator: 'babiverse-e2e' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, accessors,
    bufferViews: views, buffers: [{ byteLength: blob.length }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.85, 0.55, 0.25, 1] } }, { pbrMetallicRoughness: { baseColorFactor: [0.2, 0.5, 0.8, 1] } }],
  };
  let js = Buffer.from(JSON.stringify(doc));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const chunk = (data, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
  const body = Buffer.concat([chunk(js, 0x4e4f534a), chunk(blob, 0x004e4942)]);
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'ascii'); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([head, body]);
}
