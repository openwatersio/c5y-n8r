import { ByteBuffer, Encoding } from 'flatbuffers';
import { Assignment, Entity, Key, Registry } from './generated/country-spike.js';
import { alpha2Slot, day, FORMAT_VERSION, keyFor, MAX_ENTITY_ID_LENGTH, MAX_DAY, MIN_DAY, NAMESPACES, normalize, readerSupports, type Namespace } from './common.ts';
import { verify } from './verify.ts';

export interface Metadata {
  datasetVersion: number; formatVersion: number; minimumReaderVersion: string;
  referenceDate: string; builtAt: string; evidenceDigest: string; corpus: string;
  coverageFrom: string; coverageThrough: string;
}
export type { Namespace } from './common.ts';
const encoder = new TextEncoder();
export class CompatibilityError extends Error {
  constructor(message: string, public readonly metadata: Metadata) { super(message); }
}

export class Candidate {
  constructor(private readonly registry: Registry, private readonly assignment: Assignment, readonly applicability: 'active' | 'retired' | 'outside-date' | 'uncertain' | 'deprecated', readonly tentative = false) {}
  get id() { return this.entity.id()!; }
  get name() { return this.entity.name()!; }
  /** Empty when no continent classification is admitted for this entity. */
  get continent() { return this.entity.continent()!; }
  get namespace() { return this.assignment.namespace()!; }
  get value() { return this.assignment.value()!; }
  get matchedBy() { return this.assignment.status()!; }
  get temporalReviewed() { return this.assignment.temporalReviewed(); }
  get retiredAtDay() { return Math.min(this.assignment.untilDay(), this.entity.untilDay()); }
  get evidence() { return Array.from({ length: this.assignment.evidenceLength() }, (_, i) => this.assignment.evidence(i)!); }
  get successors() { return Array.from({ length: this.entity.successorsLength() }, (_, i) => this.registry.entities(this.entity.successors(i)!)!.id()!); }
  private get entity() { return this.registry.entities(this.assignment.entity())!; }
}

export interface LookupOptions { namespace?: Namespace; date?: string | Date }
export interface ConversionResult { source: Result; target: Result }

export interface Result {
  preferred?: Candidate;
  candidates: Candidate[];
  selection: 'at-date' | 'latest' | 'ambiguous' | 'uncertain' | 'none';
  temporalAmbiguity: boolean;
  coverage: 'partial' | 'outside-coverage';
  evidenceStatus: 'unreviewed-spike';
}

export class CountryRegistry {
  private readonly referenceDay: number;
  private binaryDigest?: Promise<string>;
  private readonly entityAssignments = new Map<string, number[]>();
  private readonly coverageFrom: number;
  private readonly coverageThrough: number;
  private constructor(private readonly root: Registry, private readonly info: Metadata, private readonly bytes: Uint8Array) { this.referenceDay = day(info.referenceDate); this.coverageFrom = day(info.coverageFrom); this.coverageThrough = day(info.coverageThrough);
    for (let i = 0; i < root.assignmentsLength(); i++) {
      const id = root.entities(root.assignments(i)!.entity())!.id()!;
      const indexes = this.entityAssignments.get(id) ?? [];
      indexes.push(i); this.entityAssignments.set(id, indexes);
    }
  }

  static open(bytes: Uint8Array): CountryRegistry {
    verify(bytes, true);
    const root = Registry.getRootAsRegistry(new ByteBuffer(bytes)), m = root.metadata();
    if (!m) throw new Error('Missing metadata');
    const info: Metadata = { datasetVersion: m.datasetVersion(), formatVersion: m.formatVersion(), minimumReaderVersion: m.minimumReaderVersion()!, referenceDate: m.referenceDate()!, builtAt: m.builtAt()!, evidenceDigest: m.evidenceDigest()!, corpus: m.corpus()!, coverageFrom: m.coverageFrom()!, coverageThrough: m.coverageThrough()! };
    if (!info.datasetVersion || !info.formatVersion || !info.minimumReaderVersion || !info.corpus || !/^[a-f0-9]{64}$/.test(info.evidenceDigest)) throw new Error('Invalid metadata');
    day(info.referenceDate);
    if (day(info.coverageFrom) > day(info.coverageThrough)) throw new Error('Invalid coverage interval');
    if (!Number.isFinite(Date.parse(info.builtAt))) throw new Error('Invalid build time');
    if (info.formatVersion !== FORMAT_VERSION || !readerSupports(info.minimumReaderVersion)) throw new CompatibilityError('Database requires a different reader', info);
    verify(bytes);
    if (root.alpha2Length() !== 676 || root.numericLength() !== 1000 || !root.entitiesLength()) throw new Error('Missing registry indexes');
    let previous = '';
    for (let i = 0; i < root.entitiesLength(); i++) {
      const e = root.entities(i)!;
      const id = e.id();
      if (!id || id.length > MAX_ENTITY_ID_LENGTH) throw new Error('Invalid entity identity');
      if (!e.name() || id <= previous || e.fromDay() >= e.untilDay()) throw new Error('Invalid entity table');
      previous = id;
      for (let j = 0; j < e.successorsLength(); j++) if (e.successors(j)! >= root.entitiesLength()) throw new Error('Invalid successor');
    }
    for (let i = 0; i < root.assignmentsLength(); i++) {
      const a = root.assignments(i)!, ns = a.namespace() as Namespace;
      if (a.entity() >= root.entitiesLength() || !NAMESPACES.includes(ns) || !a.value() || !normalize(a.value()!, ns) || !a.status() || !a.evidenceLength() || a.fromDay() >= a.untilDay() || a.fromLatestDay() < a.fromDay() || a.untilEarliestDay() > a.untilDay() || a.fromLatestDay() > a.untilDay() || a.untilEarliestDay() < a.fromDay()) throw new Error('Invalid assignment');
    }
    let previousBytes: Uint8Array = new Uint8Array();
    const seen = new Set<number>();
    for (let i = 0; i < root.keysLength(); i++) {
      const k = root.keys(i)!, bytes = k.key(Encoding.UTF8_BYTES) as Uint8Array;
      if (!bytes || compare(previousBytes, bytes) >= 0 || !k.assignmentsLength()) throw new Error('Invalid sorted keys');
      previousBytes = bytes;
      for (let j = 0; j < k.assignmentsLength(); j++) {
        const id = k.assignments(j)!;
        if (id >= root.assignmentsLength() || seen.has(id)) throw new Error('Invalid candidate index');
        seen.add(id);
        const a = root.assignments(id)!;
        if (compare(encoder.encode(keyFor(a.value()!, a.namespace() as Namespace)), bytes)) throw new Error('Key does not match assignment');
      }
    }
    if (seen.size !== root.assignmentsLength()) throw new Error('Unindexed assignment');
    for (let i = 0; i < 676; i++) validateDirect(root.alpha2(i)!, `iso-alpha2\0${String.fromCharCode(65 + Math.floor(i / 26), 65 + i % 26)}`);
    for (let i = 0; i < 1000; i++) validateDirect(root.numeric(i)!, `iso-numeric\0${String(i).padStart(3, '0')}`);
    function validateDirect(index: number, expected: string) {
      if (index < -1 || index >= root.keysLength() || (index !== -1 && root.keys(index)!.key() !== expected)) throw new Error('Invalid direct index');
    }
    for (let i = 0; i < root.keysLength(); i++) {
      const [ns, value] = root.keys(i)!.key()!.split('\0');
      if (ns === 'iso-alpha2' && root.alpha2(alpha2Slot(value)) !== i) throw new Error('Missing alpha2 index');
      if (ns === 'iso-numeric' && root.numeric(Number(value)) !== i) throw new Error('Missing numeric index');
    }
    return new CountryRegistry(root, Object.freeze(info), bytes);
  }

  metadata(): Readonly<Metadata> { return this.info; }

  async compareRelease(latest?: Metadata & { sha256?: string }) {
    if (!latest) return { freshness: 'unknown', compatible: true } as const;
    if (!Number.isSafeInteger(latest.datasetVersion) || latest.datasetVersion < 1) throw new Error('Invalid release version');
    if (latest.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(latest.sha256)) throw new Error('Invalid release digest');
    let sameMetadata = Object.entries(this.info).every(([key, value]) => latest[key as keyof Metadata] === value);
    if (sameMetadata && latest.sha256) {
      this.binaryDigest ??= crypto.subtle.digest('SHA-256', new Uint8Array(this.bytes)).then(hash => Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join(''));
      sameMetadata = await this.binaryDigest === latest.sha256;
    }
    return { freshness: this.info.datasetVersion < latest.datasetVersion ? 'outdated' : this.info.datasetVersion === latest.datasetVersion ? sameMetadata ? 'current' : 'different' : 'ahead', compatible: latest.formatVersion === FORMAT_VERSION && readerSupports(latest.minimumReaderVersion) };
  }

  entity(id: string): { id: string; name: string } | undefined {
    let low = 0, high = this.root.entitiesLength() - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1, e = this.root.entities(mid)!;
      if (e.id() === id) return { id, name: e.name()! };
      if (e.id()! < id) low = mid + 1; else high = mid - 1;
    }
    return undefined;
  }

  resolve(value: string, options: LookupOptions = {}): Result {
    if (typeof value !== 'string' || !value.trim() || value.length > 1024) throw new Error('Invalid lookup text');
    if (options.namespace && !NAMESPACES.includes(options.namespace)) throw new Error('Unknown namespace');
    const indexes: number[] = [], seen = new Set<number>();
    for (const namespace of options.namespace ? [options.namespace] : NAMESPACES) {
      const normalized = normalize(value, namespace);
      if (!normalized) continue;
      const key = this.findKey(namespace, normalized);
      if (!key) continue;
      for (let i = 0; i < key.assignmentsLength(); i++) {
        const index = key.assignments(i)!;
        if (seen.has(index)) continue; seen.add(index);
        indexes.push(index);
      }
    }
    return this.select(indexes, options, c => c.id);
  }

  assignments(id: string, options: LookupOptions = {}): Result {
    if (typeof id !== 'string' || !id || id.length > MAX_ENTITY_ID_LENGTH) throw new Error('Invalid entity identity');
    if (options.namespace && !NAMESPACES.includes(options.namespace)) throw new Error('Unknown namespace');
    const indexes = (this.entityAssignments.get(id) ?? []).filter(index => !options.namespace || this.root.assignments(index)!.namespace() === options.namespace);
    return this.select(indexes, options, c => keyFor(c.value, c.namespace as Namespace));
  }

  convert(value: string, options: { from?: Namespace; to: Namespace; date?: string | Date }): ConversionResult {
    if (!NAMESPACES.includes(options.to)) throw new Error('Unknown namespace');
    const source = this.resolve(value, { namespace: options.from, date: options.date });
    const ids = [...new Set(source.candidates.map(c => c.id))];
    const indexes = ids.flatMap(id => this.entityAssignments.get(id) ?? []).filter(index => this.root.assignments(index)!.namespace() === options.to);
    const target = this.select(indexes, options, c => `${c.id}\0${keyFor(c.value, c.namespace as Namespace)}`);
    if (source.preferred) {
      const selected = this.assignments(source.preferred.id, { namespace: options.to, date: options.date });
      target.preferred = selected.preferred;
      target.selection = selected.selection;
      target.temporalAmbiguity ||= source.temporalAmbiguity || selected.temporalAmbiguity;
    } else if (target.candidates.length) {
      target.preferred = undefined;
      target.selection = source.selection === 'ambiguous' ? 'ambiguous' : source.selection === 'uncertain' ? 'uncertain' : 'none';
      target.temporalAmbiguity ||= source.temporalAmbiguity;
    }
    return { source, target };
  }

  private select(indexes: number[], options: { date?: string | Date }, identity: (candidate: Candidate) => string): Result {
    const at = options.date === undefined ? this.referenceDay : day(options.date);
    const outsideCoverage = at < this.coverageFrom || at > this.coverageThrough;
    const candidates = indexes.map(index => {
        const a = this.root.assignments(index)!, e = this.root.entities(a.entity())!;
        let applicability: Candidate['applicability'];
        const name = a.namespace() === 'name' || a.namespace() === 'unofficial';
        const from = Math.max(a.fromDay(), e.fromDay()), until = Math.min(a.untilDay(), e.untilDay());
        const unknownCodeBounds = !name && !a.temporalReviewed() && (a.fromDay() === MIN_DAY || a.untilDay() === MAX_DAY);
        const imprecise = at < a.fromLatestDay() || at >= a.untilEarliestDay();
        if (a.status() === 'deprecated-claim') applicability = 'deprecated';
        else if (at < from || at >= until) applicability = options.date === undefined && at >= until ? 'retired' : 'outside-date';
        else if ((options.date !== undefined && name) || unknownCodeBounds || imprecise) applicability = 'uncertain';
        else applicability = 'active';
        return new Candidate(this.root, a, applicability, unknownCodeBounds && !imprecise);
    });
    let eligible = candidates.filter(c => c.applicability === 'active');
    if (options.date === undefined && !eligible.length && candidates.length) {
      const tentative = candidates.filter(c => c.applicability === 'uncertain' && c.tentative);
      const retired = candidates.filter(c => c.applicability === 'retired');
      const ended = retired.map(c => c.retiredAtDay);
      const latestEnd = ended.length ? Math.max(...ended) : MIN_DAY;
      const followsHistory = candidates.every((c, i) => {
        if (c.applicability !== 'uncertain' || !c.tentative) return true;
        const assignment = this.root.assignments(indexes[i])!;
        return assignment.fromDay() !== MIN_DAY && assignment.fromLatestDay() >= latestEnd - 1;
      });
      if (tentative.length && followsHistory && new Set(candidates.map(c => c.id)).size === 1) eligible = tentative;
      else {
        eligible = retired.filter((_, i) => ended[i] === latestEnd);
        if (!eligible.length) eligible = tentative;
      }
    }
    const ids = new Set(eligible.map(identity));
    const uncertainOther = candidates.some(c => c.applicability === 'uncertain' && !ids.has(identity(c)));
    const preferred = !outsideCoverage && ids.size === 1 && !uncertainOther ? eligible[0] : undefined;
    const differentEntities = new Set(candidates.map(identity)).size > 1;
    const temporalAmbiguity = candidates.some(c => c.applicability === 'uncertain') || (differentEntities && candidates.some(c => c.applicability !== 'active'));
    const plausibleIds = new Set(candidates.filter(c => c.applicability === 'active' || c.applicability === 'uncertain').map(identity));
    return { preferred, candidates, selection: preferred ? options.date === undefined ? 'latest' : 'at-date' : plausibleIds.size > 1 || ids.size > 1 || uncertainOther && ids.size > 0 ? 'ambiguous' : candidates.some(c => c.applicability === 'uncertain') ? 'uncertain' : 'none', temporalAmbiguity, coverage: outsideCoverage ? 'outside-coverage' : 'partial', evidenceStatus: 'unreviewed-spike' };
  }

  private findKey(namespace: Namespace, value: string): Key | undefined {
    if (namespace === 'iso-alpha2') { const index = this.root.alpha2(alpha2Slot(value))!; return index === -1 ? undefined : this.root.keys(index)!; }
    if (namespace === 'iso-numeric') { const index = this.root.numeric(Number(value))!; return index === -1 ? undefined : this.root.keys(index)!; }
    const target = encoder.encode(`${namespace}\0${value}`);
    let low = 0, high = this.root.keysLength() - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1, k = this.root.keys(mid)!, order = compare(k.key(Encoding.UTF8_BYTES) as Uint8Array, target);
      if (!order) return k;
      if (order < 0) low = mid + 1; else high = mid - 1;
    }
    return undefined;
  }
}

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
