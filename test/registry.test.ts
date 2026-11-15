import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, type SourceData } from '../src/compile.ts';
import { CountryRegistry, CompatibilityError } from '../src/index.ts';
import { day } from '../src/common.ts';

const bytes = readFileSync('data/countries.crdb');
const registry = CountryRegistry.open(bytes);
const fixture = (): SourceData => ({ metadata: { datasetVersion: 1, formatVersion: 1, minimumReaderVersion: '0.0.1', referenceDate: '2026-11-15', builtAt: '2026-11-15T00:00:00Z', evidenceDigest: 'a'.repeat(64), corpus: 'synthetic test', coverageFrom: '1974-01-01', coverageThrough: '2026-11-15' }, entities: [{ id: 'A', name: 'First', successors: [] }, { id: 'B', name: 'Second', successors: [] }], assignments: [{ entity: 'A', namespace: 'iso-alpha2', value: 'ZZ', status: 'test', from: '1980-01-01', until: '1990-01-01', temporalReviewed: true, evidence: ['synthetic'] }, { entity: 'B', namespace: 'iso-alpha2', value: 'ZZ', status: 'test', from: '2000-01-01', until: '2010-01-01', temporalReviewed: true, evidence: ['synthetic'] }] });

test('reads versions from loaded bytes and distinguishes freshness from compatibility', () => {
  const m = registry.metadata();
  assert.equal(m.datasetVersion, 1);
  assert.equal(registry.compareRelease().freshness, 'unknown');
  assert.equal(registry.compareRelease({ ...m, datasetVersion: 2 }).freshness, 'outdated');
  assert.equal(registry.compareRelease({ ...m, datasetVersion: 1 }).freshness, 'current');
  const data = fixture(); data.metadata.datasetVersion = 2;
  const newer = CountryRegistry.open(compile(data));
  assert.equal(newer.metadata().datasetVersion, 2);
  assert.equal(newer.compareRelease(m).freshness, 'ahead');
  assert.equal(registry.compareRelease({ ...m, minimumReaderVersion: '0.1.0' }).compatible, false);
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
  assert.equal(result.preferred, undefined);
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
  assert.equal(boundary.preferred, undefined);
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
