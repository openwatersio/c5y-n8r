import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyReviews, reviewDigest, statementState, validateReviews, reviewFinding } from '../src/overrides.ts';
import type { WikiEntity } from '../src/evidence.ts';

const claim = () => ({ id: 'Q43$test', rank: 'normal', mainsnak: { datavalue: { value: 'TR' } }, qualifiers: {}, references: [] });
const entity = (): WikiEntity => ({ id: 'Q43', lastrevid: 12, labels: { en: { value: 'Turkey' } }, claims: { P297: [claim()] } });
import { record } from './helpers/review-fixtures.ts';

const bundle = (records = [record()]) => ({ schemaVersion: 1 as const, records });

test('reviewed evidence preserves the snapshot and requires the exact approved record digest', () => {
  const r = record(), original = entity();
  const result = applyReviews(original, bundle([r]), { active: [r.id], retired: [] }, { [r.id]: reviewDigest(r) });
  assert.deepEqual(result.entity, original);
  assert.notEqual(result.entity, original);
  assert.equal(result.reviews.get(r.statementId)?.record.id, r.id);
  assert.throws(() => applyReviews(original, bundle([r]), { active: [r.id], retired: [] }, {}), /approved/);
  r.scope = 'Changed scope';
  assert.throws(() => applyReviews(original, bundle([r]), { active: [r.id], retired: [] }, { [r.id]: 'a'.repeat(64) }), /approved/);
});

test('corrections apply to a copy only and reject stale value, qualifier, rank and reference baselines', () => {
  const r = record(); r.mode = 'correction'; r.proposed = { value: 'TX', qualifiers: {}, rank: 'normal' };
  const approvals = { [r.id]: reviewDigest(r) };
  const original = entity();
  assert.equal(applyReviews(original, bundle([r]), { active: [r.id], retired: [] }, approvals).entity.claims.P297[0].mainsnak.datavalue.value, 'TX');
  assert.equal(original.claims.P297[0].mainsnak.datavalue.value, 'TR');
  for (const mutate of [(e: any) => e.claims.P297[0].mainsnak.datavalue.value = 'ZZ', (e: any) => e.claims.P297[0].qualifiers = { P518: [] }, (e: any) => e.claims.P297[0].rank = 'preferred', (e: any) => e.claims.P297[0].references = [{}]]) {
    const e = entity(); mutate(e);
    assert.throws(() => applyReviews(e, bundle([r]), { active: [r.id], retired: [] }, approvals), /baseline/);
  }
});

test('invalid reviews and duplicate targets cannot certify assertions', () => {
  for (const mutate of [(r: any) => r.corroborating.pop(), (r: any) => r.corroborating[0].url = r.primary.url, (r: any) => r.approval.by = '', (r: any) => r.primary.passage = '', (r: any) => r.baseline.rank = 'invented', (r: any) => r.property = 'P999', (r: any) => r.revision = 0, (r: any) => r.primary.retrieved = '2026-02-30']) {
    const r = record(); mutate(r); assert.throws(() => validateReviews(bundle([r])));
  }
  const replacement = { ...record(), id: 'replacement' };
  assert.doesNotThrow(() => validateReviews(bundle([record(), replacement])));
  assert.throws(() => applyReviews(entity(), bundle([record(), replacement]), { active: ['turkey-review', 'replacement'], retired: [] }, { 'turkey-review': reviewDigest(record()), replacement: reviewDigest(replacement) }), /Duplicate.*target/);
  assert.throws(() => validateReviews({ schemaVersion: 2, records: [] }), /schema/);
});

test('retirement accepts only explicitly reviewed equivalent reference URLs', () => {
  const r = record(); r.acceptedReferenceUrls = ['https://primary.example/report.pdf'];
  const upstream = entity();
  upstream.claims.P297[0].references = [{ snaks: { P854: [{ datavalue: { value: 'https://primary.example/report.pdf#section2' } }] } }];
  assert.equal(reviewFinding(r, 'retired', upstream).status, 'verified');
  delete r.acceptedReferenceUrls;
  assert.equal(reviewFinding(r, 'retired', upstream).status, 'needs-review');
});

test('adoption ignores generated qualifier hashes and accepts approved stated-in items', () => {
  const r = record(); r.mode = 'correction'; r.acceptedReferenceItems = ['Q123'];
  r.proposed = { value: 'TR', rank: 'normal', qualifiers: { P518: [{ snaktype: 'value', property: 'P518', datatype: 'wikibase-item', hash: 'local', datavalue: { type: 'wikibase-entityid', value: { id: 'Q48' } } }] } };
  const upstream = entity();
  upstream.claims.P297[0].qualifiers = structuredClone(r.proposed.qualifiers);
  (upstream.claims.P297[0].qualifiers as any).P518[0].hash = 'generated';
  upstream.claims.P297[0].references = [{ snaks: { P248: [{ datavalue: { value: { id: 'Q123' } } }] } }];
  assert.equal(reviewFinding(r, 'retired', upstream).status, 'verified');
  (upstream.claims.P297[0].qualifiers as any).P518[0].datavalue.value.id = 'Q46';
  assert.equal(reviewFinding(r, 'retired', upstream).status, 'needs-review');
});

test('corrections cannot introduce a value of the wrong property type', () => {
  const r = record(); r.mode = 'correction';
  for (const value of ['TOO-LONG', { id: 'Q48' }, null, 42]) {
    r.proposed = { value, qualifiers: {}, rank: 'normal' };
    assert.throws(() => validateReviews(bundle([r])), /value/);
  }
});

test('upstream adoption of a correction requires its primary reference', () => {
  const r = record(); r.mode = 'correction'; r.proposed = { value: 'TX', qualifiers: {}, rank: 'normal' };
  const upstream = entity(); upstream.claims.P297[0].mainsnak.datavalue.value = 'TX';
  assert.equal(reviewFinding(r, 'active', upstream).status, 'needs-review');
  assert.equal(reviewFinding(r, 'retired', upstream).status, 'needs-review');
  upstream.claims.P297[0].references = [{ snaks: { P854: [{ datavalue: { value: r.primary.url } }] } }];
  assert.match(reviewFinding(r, 'active', upstream).message, /retire/);
  assert.equal(reviewFinding(r, 'retired', upstream).status, 'verified');
});

test('staged records never apply and ambiguous or unknown activations fail', () => {
  const r = record();
  assert.equal(applyReviews(entity(), bundle([r]), { active: [], retired: [] }, {}).reviews.size, 0);
  for (const activation of [{ active: ['unknown'], retired: [] }, { active: [r.id, r.id], retired: [] }, { active: [r.id], retired: [r.id] }]) {
    assert.throws(() => applyReviews(entity(), bundle([r]), activation, { [r.id]: reviewDigest(r) }));
  }
});

test('live drift and upstream acceptance require review; retirement retains verification', () => {
  const r = record(), current = entity();
  assert.equal(reviewFinding(r, 'active', current).status, 'verified');
  current.claims.P297[0].rank = 'preferred';
  assert.equal(reviewFinding(r, 'active', current).status, 'needs-review');
  const adopted = entity();
  adopted.claims.P297[0].references = [{ snaks: { P854: [{ datavalue: { value: r.primary.url } }] } }];
  assert.match(reviewFinding(r, 'active', adopted).message, /retire/i);
  assert.equal(reviewFinding(r, 'retired', adopted).status, 'verified');
  const applied = applyReviews(adopted, bundle([r]), { active: [], retired: [r.id] }, { [r.id]: reviewDigest(r) });
  assert.equal(applied.reviews.get(r.statementId)?.state, 'retired');
  assert.throws(() => applyReviews(entity(), bundle([r]), { active: [], retired: [r.id] }, { [r.id]: reviewDigest(r) }), /upstream/);
});
