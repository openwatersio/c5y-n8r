import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEvidence, passing, type EvidenceRequest, type WikiEntity } from '../src/evidence.ts';

const entity = (): WikiEntity => ({ id: 'Q1', lastrevid: 12, labels: { en: { value: 'Example' } }, claims: { P297: [{ id: 'Q1$test', rank: 'normal', mainsnak: { datavalue: { value: 'XX' } } }] } });
const request = (): EvidenceRequest => ({ id: 'label', qid: 'Q1', revision: 12, kind: 'label', language: 'en', expected: 'Example' });

test('evidence check finds supplied spelling at pinned and current revisions', async () => {
  const result = await checkEvidence(request(), async () => entity());
  assert.equal(result.status, 'source-match');
  assert.equal(passing([result]), false);
  assert.match(result.link, /oldid=12/);
});
test('evidence check rejects mismatched and missing supplied values', async () => {
  assert.equal((await checkEvidence({ ...request(), expected: 'Invented' }, async () => entity())).status, 'mismatch');
  assert.equal((await checkEvidence({ ...request(), kind: 'statement', property: 'P297', statementId: 'missing', expected: 'XX' }, async () => entity())).status, 'mismatch');
});
test('unsupported date qualifiers cannot pass a value-only match', async () => {
  const result = await checkEvidence({ ...request(), kind: 'statement', property: 'P297', statementId: 'Q1$test', expected: 'XX', qualifiers: { P580: [{ invented: 'date' }] } }, async () => entity());
  assert.equal(result.status, 'mismatch');
});
test('missing references and local overrides remain unverified', async () => {
  const result = await checkEvidence({ ...request(), kind: 'statement', property: 'P297', statementId: 'Q1$test', expected: 'XX' }, async () => entity());
  assert.equal(result.status, 'needs-review'); assert.equal(passing([result]), false);
  assert.equal((await checkEvidence({ ...request(), kind: 'local-policy' }, async () => entity())).status, 'needs-review');
});
test('source outages do not pass and upstream changes require review', async () => {
  const outage = await checkEvidence(request(), async () => { throw new Error('HTTP 429'); });
  assert.equal(outage.status, 'infrastructure-error'); assert.equal(passing([outage]), false);
  const changed = await checkEvidence(request(), async (_, revision) => { const e = entity(); if (!revision) e.labels.en.value = 'Changed'; return e; });
  assert.equal(changed.status, 'needs-review');
});

test('derived spellings cannot be certified by matching a folded label', async () => {
  const e = entity(); e.labels.en.value = 'Éxample';
  const result = await checkEvidence({ ...request(), kind: 'ascii-label' }, async () => e);
  assert.equal(result.status, 'needs-review');
  assert.equal(passing([result]), false);
});
