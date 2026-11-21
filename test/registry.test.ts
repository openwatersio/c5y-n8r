import { observeLookup } from '../src/compatibility.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, type SourceData } from '../src/compile.ts';
import { CountryRegistry, CompatibilityError } from '../src/index.ts';
import { day, FORMAT_VERSION } from '../src/common.ts';

const bytes = readFileSync('data/countries.crdb');
const registry = CountryRegistry.open(bytes);
const fixture = (): SourceData => ({ metadata: { datasetVersion: 1, formatVersion: FORMAT_VERSION, minimumReaderVersion: '0.0.1', referenceDate: '2026-11-15', builtAt: '2026-11-15T00:00:00Z', evidenceDigest: 'a'.repeat(64), corpus: 'synthetic test', coverageFrom: '1974-01-01', coverageThrough: '2026-11-15' }, entities: [{ id: 'A', name: 'First', successors: [] }, { id: 'B', name: 'Second', successors: [] }], assignments: [{ entity: 'A', namespace: 'iso-alpha2', value: 'ZZ', status: 'test', from: '1980-01-01', until: '1990-01-01', temporalReviewed: true, evidence: ['synthetic'] }, { entity: 'B', namespace: 'iso-alpha2', value: 'ZZ', status: 'test', from: '2000-01-01', until: '2010-01-01', temporalReviewed: true, evidence: ['synthetic'] }] });

test('reads versions from loaded bytes and distinguishes freshness from compatibility', async () => {
  const m = registry.metadata();
  assert.equal(m.datasetVersion, 5);
  assert.equal((await registry.compareRelease()).freshness, 'unknown');
  assert.equal((await registry.compareRelease({ ...m, datasetVersion: m.datasetVersion + 1 })).freshness, 'outdated');
  assert.equal((await registry.compareRelease({ ...m, datasetVersion: m.datasetVersion })).freshness, 'current');
  const data = fixture(); data.metadata.datasetVersion = m.datasetVersion + 1;
  const newer = CountryRegistry.open(compile(data));
  assert.equal(newer.metadata().datasetVersion, m.datasetVersion + 1);
  assert.equal((await newer.compareRelease(m)).freshness, 'ahead');
  assert.equal((await registry.compareRelease({ ...m, minimumReaderVersion: '0.1.0' })).compatible, false);
  data.metadata.minimumReaderVersion = '0.1.0';
  assert.throws(() => CountryRegistry.open(compile(data)), CompatibilityError);
});

test('preserves country rename spellings and diacritics without global accent folding', () => {
  for (const name of ['Turkey', 'Türkiye', 'Turkiye', '  TÜRKIYE  ']) {
    assert.equal(registry.resolve(name).preferred?.id, 'Q43');
  }
  assert.equal(registry.resolve('Czech Republic').preferred?.id, 'Q213');
  assert.equal(registry.resolve('Czechia').preferred?.id, 'Q213');
  assert.equal(registry.resolve('Curaçao').preferred?.id, 'Q25279');
  assert.equal(registry.resolve('Curaçao').evidenceStatus, 'unreviewed-spike');
});

test('keeps unofficial codes separate and reports ambiguous names', () => {
  assert.equal(registry.resolve('UK', { namespace: 'unofficial' }).preferred?.id, 'Q145');
  assert.equal(registry.resolve('UK', { namespace: 'iso-alpha2' }).preferred, undefined);
  const result = registry.resolve('Congo');
  assert.equal(result.selection, 'ambiguous');
  assert.equal(result.preferred?.id, undefined);
  assert.equal(result.temporalAmbiguity, false);
  assert.deepEqual(new Set(result.candidates.map(c => c.id)), new Set(['Q971', 'Q974']));
});

test('retains retired entities and multiple successor pointers', () => {
  const result = registry.resolve('AN', { namespace: 'iso-alpha2' });
  assert.equal(result.preferred?.id, 'Q25227');
  assert.equal(result.preferred?.applicability, 'retired');
  assert.deepEqual(new Set(result.preferred?.successors), new Set(['Q25279', 'Q26273', 'Q27561']));
});

test('resolves reused codes by date and exposes alternatives without a date', () => {
  assert.equal(registry.resolve('CS', { namespace: 'iso-alpha2', date: '1990-01-01' }).preferred?.id, 'Q33946');
  assert.equal(registry.resolve('CS', { namespace: 'iso-alpha2', date: '2005-01-01' }).preferred?.id, 'Q37024');
  const latest = registry.resolve('CS', { namespace: 'iso-alpha2' });
  assert.equal(latest.preferred?.id, 'Q37024');
  assert.equal(latest.temporalAmbiguity, true);
  assert.equal(latest.candidates.length, 2);
  const boundary = registry.resolve('CS', { namespace: 'iso-alpha2', date: '2003-06-01' });
  assert.equal(boundary.preferred?.id, undefined);
  assert.equal(boundary.selection, 'uncertain');
  assert.equal(boundary.candidates.some(c => c.applicability === 'uncertain'), true);
});

test('inclusive starts, exclusive ends, and gaps are not redirects', () => {
  const db = CountryRegistry.open(compile(fixture()));
  assert.equal(db.resolve('ZZ', { namespace: 'iso-alpha2', date: '1980-01-01' }).preferred?.id, 'A');
  assert.equal(db.resolve('ZZ', { namespace: 'iso-alpha2', date: '1990-01-01' }).preferred, undefined);
  assert.equal(db.resolve('ZZ', { namespace: 'iso-alpha2', date: '2000-01-01' }).preferred?.id, 'B');
});

test('missing bounds cannot outrank a known historical assignment', () => {
  const data = fixture();
  delete data.assignments[1].from; delete data.assignments[1].until;
  data.assignments[1].temporalReviewed = false;
  const db = CountryRegistry.open(compile(data));
  const result = db.resolve('ZZ', { namespace: 'iso-alpha2' });
  assert.equal(result.preferred?.id, undefined);
  assert.equal(result.selection, 'ambiguous');
  assert.equal(result.candidates.find(c => c.id === 'B')?.applicability, 'uncertain');
});

test('a tentative code on another entity cannot displace a retired assignment', () => {
  const data = fixture();
  data.assignments[1].from = '1990-01-01';
  delete data.assignments[1].until;
  data.assignments[1].temporalReviewed = false;
  const result = CountryRegistry.open(compile(data)).resolve('ZZ', { namespace: 'iso-alpha2' });
  assert.equal(result.preferred, undefined);
  assert.equal(result.selection, 'ambiguous');
});

test('tentative starts must reach the final possible retired day', () => {
  for (const [from, preferred] of [['1989-12-30', undefined], ['1989-12-31', 'BB'], ['1990-01-01', 'BB'], ['1990-01-02', 'BB']] as const) {
    const data = fixture();
    data.entities = [data.entities[0]!];
    data.assignments = [data.assignments[0]!, { entity: 'A', namespace: 'iso-alpha2', value: 'BB', status: 'iso-code', from, temporalReviewed: false, evidence: ['synthetic'] }];
    const result = CountryRegistry.open(compile(data)).assignments('A', { namespace: 'iso-alpha2' });
    assert.equal(result.preferred?.value, preferred, from);
    assert.equal(result.temporalAmbiguity, true);
  }
});

test('a current code can be selected over a retired code on the same entity without hiding uncertainty', () => {
  const result = registry.convert('MMR', { from: 'iso-alpha3', to: 'iso-alpha2' });
  assert.equal(result.source.preferred?.id, 'Q836');
  assert.equal(result.target.preferred?.value, 'MM');
  assert.equal(result.target.preferred?.applicability, 'uncertain');
  assert.equal(result.target.preferred?.tentative, true);
  assert.equal(result.target.temporalAmbiguity, true);
  assert.ok(result.target.candidates.some(c => c.value === 'BU' && c.applicability === 'retired'));
  assert.equal(registry.assignments('Q836', { namespace: 'iso-alpha3' }).preferred?.value, 'MMR');
  assert.equal(registry.convert('MMR', { from: 'iso-alpha3', to: 'iso-alpha2', date: '1989-06-01' }).target.preferred, undefined);
  const historical = registry.convert('BU', { from: 'iso-alpha2', to: 'iso-alpha3' });
  assert.equal(historical.source.preferred?.applicability, 'retired');
  assert.equal(historical.target.preferred?.value, 'MMR');
  assert.equal(historical.target.preferred?.tentative, true);
});

test('a missing end cannot promote an earlier or undated code over known same-entity history', () => {
  for (const from of [undefined, '1975-01-01']) {
    const data = fixture();
    data.entities = [data.entities[0]!];
    data.assignments = [data.assignments[0]!, { entity: 'A', namespace: 'iso-alpha2', value: 'BB', status: 'iso-code', ...(from ? { from } : {}), temporalReviewed: false, evidence: ['synthetic'] }];
    const result = CountryRegistry.open(compile(data)).assignments('A', { namespace: 'iso-alpha2' });
    assert.equal(result.preferred?.value, undefined);
    assert.equal(result.selection, 'ambiguous');
  }
});

test('competing tentative or imprecise codes on one entity remain ambiguous', () => {
  for (const other of [{ from: '1995-01-01' }, { from: '2026-01-01', fromLatest: '2026-12-31' }]) {
    const data = fixture();
    data.entities = [data.entities[0]!];
    data.assignments = [data.assignments[0]!,
      { entity: 'A', namespace: 'iso-alpha2', value: 'BB', status: 'iso-code', from: '1990-01-01', temporalReviewed: false, evidence: ['synthetic'] },
      { entity: 'A', namespace: 'iso-alpha2', value: 'CC', status: 'iso-code', ...other, temporalReviewed: false, evidence: ['synthetic'] }];
    const result = CountryRegistry.open(compile(data)).assignments('A', { namespace: 'iso-alpha2' });
    assert.equal(result.preferred?.value, undefined);
    assert.equal(result.selection, 'ambiguous');
  }
});

test('invalid dates and non-ASCII codes cannot silently become assignments', () => {
  assert.throws(() => registry.resolve('TR', { date: '2025-02-29' }));
  assert.throws(() => registry.resolve('TR', { date: new Date(NaN) }));
  assert.equal(day(new Date('2020-01-01T23:00:00-02:00')), day('2020-01-02'));
  assert.equal(registry.resolve('ß', { namespace: 'iso-alpha2' }).candidates.length, 0);
  assert.equal(registry.resolve('ıo', { namespace: 'iso-alpha2' }).candidates.length, 0);
  assert.equal(registry.resolve('TR', { date: '1970-01-01' }).coverage, 'outside-coverage');
  assert.equal(registry.resolve('TR', { date: '2027-01-01' }).preferred, undefined);
  assert.equal(registry.resolve('unrecorded name').coverage, 'partial');
});

test('compiler is deterministic and refuses invalid source references', () => {
  assert.deepEqual(compile(fixture()), compile(fixture()));
  const data = fixture(); data.assignments[0].entity = 'missing';
  assert.throws(() => compile(data));
});

test('rejects malformed, truncated, wrong-format, and missing-metadata binaries', () => {
  for (const size of [0, 4, 12, Math.floor(bytes.length / 2)]) assert.throws(() => CountryRegistry.open(bytes.subarray(0, size)));
  const badId = Uint8Array.from(bytes); badId[4] = 0; assert.throws(() => CountryRegistry.open(badId));
  const badRoot = Uint8Array.from(bytes); new DataView(badRoot.buffer).setUint32(0, 0xffffffff, true); assert.throws(() => CountryRegistry.open(badRoot));
  const badVersion = Uint8Array.from(bytes);
  const rootOffset = new DataView(badVersion.buffer).getUint32(0, true);
  const view = new DataView(badVersion.buffer);
  const rootVtable = rootOffset - view.getInt32(rootOffset, true);
  const metaField = rootOffset + view.getUint16(rootVtable + 4, true);
  const metaOffset = metaField + view.getUint32(metaField, true);
  const metaVtable = metaOffset - view.getInt32(metaOffset, true);
  view.setUint32(metaOffset + view.getUint16(metaVtable + 6, true), 99, true);
  assert.throws(() => CountryRegistry.open(badVersion), CompatibilityError);
  const missing = Uint8Array.from(bytes), mv = new DataView(missing.buffer);
  mv.setUint16(rootVtable + 4, 0, true);
  assert.throws(() => CountryRegistry.open(missing));
});

test('dated answers retain uncertainty when either unreviewed bound is missing', () => {
  for (const missing of ['from', 'until'] as const) {
    const data = fixture(); data.assignments = [data.assignments[0]];
    delete data.assignments[0][missing]; data.assignments[0].temporalReviewed = false;
    const result = CountryRegistry.open(compile(data)).resolve('ZZ', { namespace: 'iso-alpha2', date: '1985-01-01' });
    assert.equal(result.preferred?.id, undefined);
    assert.equal(result.candidates[0].applicability, 'uncertain');
    assert.equal(result.selection, 'uncertain');
  }
});

test('codes respect entity lifetimes and uncertainty at the reference date', () => {
  const data = fixture(); data.assignments = [data.assignments[0]];
  data.entities[0].from = '1982-01-01'; data.entities[0].until = '1988-01-01';
  const db = CountryRegistry.open(compile(data));
  for (const date of ['1981-01-01', '1988-01-01']) assert.equal(db.resolve('ZZ', { namespace: 'iso-alpha2', date }).preferred?.id, undefined);
  data.metadata.referenceDate = '1985-06-01'; data.assignments[0].untilEarliest = '1985-01-01';
  const uncertain = CountryRegistry.open(compile(data)).resolve('ZZ', { namespace: 'iso-alpha2' });
  assert.equal(uncertain.preferred, undefined);
  assert.equal(uncertain.candidates[0].applicability, 'uncertain');
});

test('overlapping imprecise bounds retain candidates without inventing a definite interval', () => {
  const data = fixture(); data.assignments = [data.assignments[0]];
  Object.assign(data.assignments[0], { from: '1980-01-01', fromLatest: '1981-01-01', untilEarliest: '1980-01-01', until: '1981-01-01' });
  const result = CountryRegistry.open(compile(data)).resolve('ZZ', { namespace: 'iso-alpha2', date: '1980-06-01' });
  assert.equal(result.preferred?.id, undefined);
  assert.equal(result.candidates[0].applicability, 'uncertain');
});

test('deprecated claims remain visible without becoming preferred answers', () => {
  const data = fixture(); data.assignments = [data.assignments[0]];
  data.assignments[0].status = 'deprecated-claim';
  const db = CountryRegistry.open(compile(data));
  for (const date of [undefined, '1985-01-01']) {
    const result = db.resolve('ZZ', { namespace: 'iso-alpha2', date });
    assert.equal(result.preferred?.id, undefined);
    assert.equal(result.candidates[0].applicability, 'deprecated');
  }
});

test('incompatible format metadata is readable before inspecting an unknown body', () => {
  const changed = Uint8Array.from(bytes), v = new DataView(changed.buffer);
  const root = v.getUint32(0, true), table = root - v.getInt32(root, true);
  const field = root + v.getUint16(table + 4, true), metadata = field + v.getUint32(field, true);
  const mt = metadata - v.getInt32(metadata, true);
  v.setUint32(metadata + v.getUint16(mt + 6, true), 99, true);
  const body = root + v.getUint16(table + 6, true); v.setUint32(body, 0xffffffff, true);
  assert.throws(() => CountryRegistry.open(changed), (error: any) => error instanceof CompatibilityError && error.metadata.formatVersion === 99);
});

test('the reader rejects the legacy status contract instead of misreading it', () => {
  const legacy = Uint8Array.from(bytes), view = new DataView(legacy.buffer);
  const root = view.getUint32(0, true), table = root - view.getInt32(root, true);
  const field = root + view.getUint16(table + 4, true), metadata = field + view.getUint32(field, true);
  const mt = metadata - view.getInt32(metadata, true);
  view.setUint32(metadata + view.getUint16(mt + 6, true), 1, true);
  assert.throws(() => CountryRegistry.open(legacy), (error: any) => error instanceof CompatibilityError && error.metadata.formatVersion === 1);
});

test('reused dataset versions do not hide changed release identity', async () => {
  const m = registry.metadata();
  assert.equal((await registry.compareRelease({ ...m, evidenceDigest: '0'.repeat(64) })).freshness, 'different');
  assert.equal((await registry.compareRelease({ ...m, referenceDate: '2026-11-14' })).freshness, 'different');
});

test('release freshness checks the supplied binary hash even when metadata is identical', async () => {
  const release = JSON.parse(readFileSync('data/release.json', 'utf8'));
  assert.equal((await registry.compareRelease(release)).freshness, 'current');
  assert.equal((await registry.compareRelease({ ...release, sha256: '0'.repeat(64) })).freshness, 'different');
});


test('entity assignments provide direct code lookup with dates and evidence', () => {
  const db = CountryRegistry.open(compile(fixture()));
  const result = db.assignments('A', { namespace: 'iso-alpha2', date: '1985-01-01' });
  assert.equal(result.preferred?.value, 'ZZ');
  assert.deepEqual(result.preferred?.evidence, ['synthetic']);
  assert.equal(db.assignments('A', { namespace: 'iso-alpha2' }).preferred?.applicability, 'retired');
  assert.equal(db.assignments('A', { date: '1990-01-01' }).preferred, undefined);
  assert.deepEqual(db.assignments('missing').candidates, []);
  assert.throws(() => db.assignments('A', { date: '2025-02-29' }));
});

test('same entity with two codes never invents a unique preferred code', () => {
  const data = fixture();
  data.assignments = [data.assignments[0], { ...data.assignments[0], value: 'YY' }];
  const db = CountryRegistry.open(compile(data));
  const result = db.assignments('A', { namespace: 'iso-alpha2', date: '1985-01-01' });
  assert.equal(result.preferred, undefined);
  assert.equal(result.selection, 'ambiguous');
  assert.deepEqual(new Set(result.candidates.map(c => c.value)), new Set(['ZZ', 'YY']));
});

test('conversion retains source ambiguity and all target alternatives', () => {
  const data = fixture();
  data.assignments.push(
    { ...data.assignments[0], namespace: 'iso-alpha3', value: 'AAA' },
    { ...data.assignments[1], namespace: 'iso-alpha3', value: 'BBB' },
  );
  const db = CountryRegistry.open(compile(data));
  const dated = db.convert('ZZ', { from: 'iso-alpha2', to: 'iso-alpha3', date: '1985-01-01' });
  assert.equal(dated.target.preferred?.value, 'AAA');
  assert.equal(dated.target.candidates.length, 2);
  assert.deepEqual(dated.target.preferred?.evidence, ['synthetic']);
  assert.equal(db.convert('ZZ', { to: 'iso-alpha3', date: '1995-01-01' }).target.preferred, undefined);
  delete data.assignments[1].from; delete data.assignments[1].until;
  data.assignments[1].temporalReviewed = false;
  const ambiguous = CountryRegistry.open(compile(data)).convert('ZZ', { to: 'iso-alpha3' });
  assert.equal(ambiguous.source.selection, 'ambiguous');
  assert.equal(ambiguous.target.selection, 'ambiguous');
  assert.equal(ambiguous.target.preferred, undefined);
  assert.equal(ambiguous.target.candidates.length, 2);
});

test('assignment lookup preserves unknown dates, deprecated claims and coverage', () => {
  const data = fixture(); data.assignments = [data.assignments[0]];
  delete data.assignments[0].from; data.assignments[0].temporalReviewed = false;
  let db = CountryRegistry.open(compile(data));
  assert.equal(db.assignments('A', { date: '1985-01-01' }).selection, 'uncertain');
  assert.equal(db.assignments('A', { date: '1970-01-01' }).coverage, 'outside-coverage');
  data.assignments[0].status = 'deprecated-claim'; db = CountryRegistry.open(compile(data));
  assert.equal(db.assignments('A').preferred, undefined);
  assert.equal(db.assignments('A').candidates[0].applicability, 'deprecated');
});


test('method observations preserve full source and target contracts and absent methods fail closed', () => {
  const converted = observeLookup(registry, { operation: 'convert', input: 'TUR', from: 'iso-alpha3', to: 'iso-alpha2' });
  assert.ok('source' in converted.result);
  if ('source' in converted.result) {
    assert.ok(converted.result.source);
    assert.ok(converted.result.target);
    assert.equal(converted.result.source.evidenceStatus, 'unreviewed-spike');
    assert.equal(converted.result.target.candidates[0].namespace, 'iso-alpha2');
    assert.ok(converted.result.target.candidates[0].evidence.length);
    assert.equal(typeof converted.result.target.candidates[0].tentative, 'boolean');
  }
  for (const operation of ['convert', 'assignments'] as const) {
    const missing = observeLookup({ resolve: registry.resolve.bind(registry) }, { operation, input: 'Q43', to: 'iso-alpha2' });
    assert.deepEqual(missing.result, { error: { name: 'Error', message: `Reader method unavailable: ${operation}` } });
  }
  const legacy = observeLookup(registry, { input: 'TR', namespace: 'iso-alpha2' });
  assert.equal('operation' in legacy, false);
  assert.equal('from' in legacy, false);
  assert.equal('to' in legacy, false);
});
