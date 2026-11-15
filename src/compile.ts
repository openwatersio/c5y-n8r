import { Builder } from 'flatbuffers';
import { AssignmentT, EntityT, KeyT, MetadataT, RegistryT } from './generated/country-spike.js';
import { alpha2Slot, day, FORMAT_VERSION, keyFor, MAX_ENTITY_ID_LENGTH, MAX_DAY, MIN_DAY, NAMESPACES, normalize, type Namespace, versionParts } from './common.ts';

export interface SourceEntity { id: string; name: string; continent?: string; from?: string; until?: string; successors: string[] }
export interface SourceAssignment { entity: string; namespace: Namespace; value: string; status: string; from?: string; fromLatest?: string; until?: string; untilEarliest?: string; temporalReviewed: boolean; evidence: string[] }
export interface SourceData {
  metadata: { datasetVersion: number; formatVersion: number; minimumReaderVersion: string; referenceDate: string; builtAt: string; evidenceDigest: string; corpus: string; coverageFrom: string; coverageThrough: string };
  entities: SourceEntity[];
  assignments: SourceAssignment[];
}

export function compile(source: SourceData): Uint8Array {
  const meta = source.metadata;
  if (!Number.isSafeInteger(meta.datasetVersion) || meta.datasetVersion < 1 || meta.datasetVersion > 0xffffffff) throw new Error('Invalid dataset version');
  if (meta.formatVersion !== FORMAT_VERSION || !/^[a-f0-9]{64}$/.test(meta.evidenceDigest)) throw new Error('Invalid format or evidence digest');
  day(meta.referenceDate); versionParts(meta.minimumReaderVersion);
  if (day(meta.coverageFrom) > day(meta.coverageThrough)) throw new Error('Invalid coverage interval');
  if (!Number.isFinite(Date.parse(meta.builtAt))) throw new Error('Invalid build time');
  const entities = [...source.entities].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const indexes = new Map(entities.map((e, i) => [e.id, i]));
  if (indexes.size !== entities.length) throw new Error('Duplicate entity ID');
  const e = entities.map(entity => {
    if (typeof entity.id !== 'string' || !entity.id || entity.id.length > MAX_ENTITY_ID_LENGTH) throw new Error('Invalid entity identity');
    if (!entity.name) throw new Error('Missing entity name');
    const from = entity.from ? day(entity.from) : MIN_DAY, until = entity.until ? day(entity.until) : MAX_DAY;
    if (from >= until) throw new Error('Invalid entity interval');
    return new EntityT(entity.id, entity.name, entity.continent ?? '', from, until, false, entity.successors.map(id => {
      const index = indexes.get(id); if (index === undefined) throw new Error('Unknown successor'); return index;
    }));
  });
  const assignments = source.assignments.map(a => {
    const entity = indexes.get(a.entity);
    if (entity === undefined || !NAMESPACES.includes(a.namespace) || !normalize(a.value, a.namespace) || !a.status || !a.evidence.length) throw new Error('Invalid assignment');
    const from = a.from ? day(a.from) : MIN_DAY, until = a.until ? day(a.until) : MAX_DAY;
    const fromLatest = a.fromLatest ? day(a.fromLatest) : from, untilEarliest = a.untilEarliest ? day(a.untilEarliest) : until;
    if (from >= until || fromLatest < from || untilEarliest > until || fromLatest > until || untilEarliest < from) throw new Error('Invalid assignment interval');
    return new AssignmentT(entity, a.namespace, a.value, a.status, from, until, a.temporalReviewed, a.evidence, fromLatest, untilEarliest);
  });
  const groups = new Map<string, number[]>();
  source.assignments.forEach((a, index) => {
    const key = keyFor(a.value, a.namespace);
    const ids = groups.get(key) ?? []; ids.push(index); groups.set(key, ids);
  });
  const keys = [...groups].sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(([k, ids]) => new KeyT(k, ids));
  const alpha2 = Array<number>(676).fill(-1), numeric = Array<number>(1000).fill(-1);
  keys.forEach((k, index) => {
    const [namespace, value] = String(k.key).split('\0');
    if (namespace === 'iso-alpha2') alpha2[alpha2Slot(value)] = index;
    if (namespace === 'iso-numeric') numeric[Number(value)] = index;
  });
  const root = new RegistryT(new MetadataT(meta.datasetVersion, meta.formatVersion, meta.minimumReaderVersion, meta.referenceDate, meta.builtAt, meta.evidenceDigest, meta.corpus, meta.coverageFrom, meta.coverageThrough), e, assignments, keys, alpha2, numeric);
  const builder = new Builder(1024);
  builder.finish(root.pack(builder), 'CRDB');
  return builder.asUint8Array();
}
