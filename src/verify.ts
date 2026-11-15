type Field = 'u32' | 'i32' | 'bool' | 'string' | { vector: Field } | { table: Shape };
type Shape = ReadonlyArray<Field>;
const metadata: Shape = ['u32', 'u32', 'string', 'string', 'string', 'string', 'string', 'string', 'string'];
const entity: Shape = ['string', 'string', 'string', 'i32', 'i32', 'bool', { vector: 'u32' }];
const assignment: Shape = ['u32', 'string', 'string', 'string', 'i32', 'i32', 'bool', { vector: 'string' }, 'i32', 'i32'];
const key: Shape = ['string', { vector: 'u32' }];
const registry: Shape = [{ table: metadata }, { vector: { table: entity } }, { vector: { table: assignment } }, { vector: { table: key } }, { vector: 'i32' }, { vector: 'i32' }];

export function verify(bytes: Uint8Array, envelopeOnly = false): void {
  if (bytes.length < 12 || bytes.length > 32 * 1024 * 1024) throw new Error('Invalid database size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const visited = new Map<number, { shape: Shape; cost: number }>();
  const strings = new Set<number>();
  const vectors = new Map<number, { type: Field; cost: number }>();
  let work = 0;
  function charge(cost: number) {
    work += cost;
    // Count expanded references even when cached, since later readers still traverse them.
    if (work > bytes.length * 8) throw new Error('Database verification work limit exceeded');
  }
  function bounds(offset: number, size: number) {
    if (!Number.isSafeInteger(offset) || offset < 0 || size < 0 || offset + size > bytes.length) throw new Error('Database offset out of bounds');
  }
  function target(offset: number) {
    bounds(offset, 4);
    const relative = view.getUint32(offset, true);
    if (relative === 0) throw new Error('Invalid null offset');
    bounds(offset + relative, 4);
    return offset + relative;
  }
  function field(offset: number, type: Field, depth: number) {
    charge(4);
    if (depth > 16) throw new Error('Database nesting too deep');
    if (type === 'bool') { bounds(offset, 1); if (view.getUint8(offset) > 1) throw new Error('Invalid boolean'); return; }
    bounds(offset, 4);
    if (type === 'u32' || type === 'i32') return;
    const start = target(offset);
    if (type === 'string') {
      const length = view.getUint32(start, true);
      bounds(start + 4, length + 1);
      charge(length);
      if (strings.has(start)) return;
      if (view.getUint8(start + 4 + length) !== 0) throw new Error('Unterminated string');
      decoder.decode(bytes.subarray(start + 4, start + 4 + length));
      strings.add(start);
    } else if ('table' in type) table(start, type.table, depth + 1);
    else {
      const cached = vectors.get(start);
      if (cached) {
        if (cached.type !== type.vector) throw new Error('Conflicting vector types');
        charge(cached.cost); return;
      }
      const before = work;
      const count = view.getUint32(start, true), width = type.vector === 'bool' ? 1 : 4;
      bounds(start + 4, count * width);
      for (let i = 0; i < count; i++) field(start + 4 + i * width, type.vector, depth + 1);
      vectors.set(start, { type: type.vector, cost: work - before });
    }
  }
  function table(offset: number, shape: Shape, depth: number) {
    const cached = visited.get(offset);
    if (cached) { if (cached.shape !== shape) throw new Error('Conflicting table types'); charge(cached.cost); return; }
    const before = work;
    charge(shape.length * 2 + 4);
    bounds(offset, 4);
    const vtable = offset - view.getInt32(offset, true);
    bounds(vtable, 4);
    const vlength = view.getUint16(vtable, true), objectLength = view.getUint16(vtable + 2, true);
    if (vlength < 4 || vlength % 2 || objectLength < 4) throw new Error('Invalid vtable');
    bounds(vtable, vlength); bounds(offset, objectLength);
    for (let i = 0; i < shape.length; i++) {
      if (4 + i * 2 >= vlength) continue;
      const relative = view.getUint16(vtable + 4 + i * 2, true);
      if (!relative) continue;
      const width = shape[i] === 'bool' ? 1 : 4;
      if (relative < 4 || relative + width > objectLength) throw new Error('Invalid field offset');
      field(offset + relative, shape[i], depth);
    }
    visited.set(offset, { shape, cost: work - before });
  }
  if (decoder.decode(bytes.subarray(4, 8)) !== 'CRDB') throw new Error('Wrong database identifier');
  table(target(0), envelopeOnly ? [registry[0]] : registry, 0);
}
