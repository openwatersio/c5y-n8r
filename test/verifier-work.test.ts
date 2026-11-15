import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/compile.ts';
import { Builder, ByteBuffer } from 'flatbuffers';
import { readFileSync } from 'node:fs';
import { Registry, Assignment, MetadataT } from '../src/generated/country-spike.js';
import { CountryRegistry } from '../src/index.ts';

function sharedReferences(strings: number, length: number, tables: number) {
  const m = JSON.parse(readFileSync('data/release.json', 'utf8'));
  const b = new Builder(), text = b.createString('x'.repeat(length));
  Assignment.startEvidenceVector(b, strings);
  for (let i = 0; i < strings; i++) b.addOffset(text);
  const evidence = b.endVector();
  Assignment.startAssignment(b); Assignment.addEvidence(b, evidence); const a = b.endObject();
  Registry.startAssignmentsVector(b, tables);
  for (let i = 0; i < tables; i++) b.addOffset(a);
  const assignments = b.endVector();
  const metadata = new MetadataT(m.datasetVersion, m.formatVersion, m.minimumReaderVersion, m.referenceDate, m.builtAt, m.evidenceDigest, m.corpus, m.coverageFrom, m.coverageThrough).pack(b);
  Registry.startRegistry(b); Registry.addMetadata(b, metadata); Registry.addAssignments(b, assignments);
  b.finish(b.endObject(), 'CRDB');
  return b.asUint8Array();
}

test('verification bounds repeated string expansion before semantic validation', () => {
  assert.throws(() => CountryRegistry.open(sharedReferences(4000, 16384, 1)), /verification work limit/);
});

test('cached tables still count their expanded verification work', () => {
  assert.throws(() => CountryRegistry.open(sharedReferences(256, 1, 4000)), /verification work limit/);
});

test('indexed entity identities have a bounded length before semantic readers use them', () => {
  const root = Registry.getRootAsRegistry(new ByteBuffer(readFileSync('data/countries.crdb'))).unpack();
  root.entities[0].id = 'A'.repeat(65);
  const builder = new Builder(); builder.finish(root.pack(builder), 'CRDB');
  assert.throws(() => CountryRegistry.open(builder.asUint8Array()), /Invalid entity identity/);
});

test('the compiler rejects overlong entity identities', () => {
  const metadata = JSON.parse(readFileSync('data/release.json', 'utf8'));
  const id = 'A'.repeat(65);
  assert.throws(() => compile({ metadata, entities: [{ id, name: 'Synthetic', successors: [] }], assignments: [{ entity: id, namespace: 'name', value: 'Synthetic', status: 'test', temporalReviewed: false, evidence: ['test'] }] }), /Invalid entity identity/);
});
