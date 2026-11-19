import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEvidence, passing, requestDigest, reviewReadiness, parseReviewManifest, type EvidenceReview, type EvidenceRequest, type WikiEntity } from '../src/evidence.ts';

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
test('missing references are advisory while local policy still requires review', async () => {
  const result = await checkEvidence({ ...request(), kind: 'statement', property: 'P297', statementId: 'Q1$test', expected: 'XX' }, async () => entity());
  assert.equal(result.status, 'source-match'); assert.equal(passing([result]), false);
  assert.equal(result.blocking, false);
  assert.ok(result.advisories?.includes('missing-statement-references'));
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

const review = (): EvidenceReview => ({
  id: 'label', requestDigest: requestDigest(request()),
  statement: { property: 'P1448', id: 'Q1$name', expected: 'Example' },
  sources: ['authority', 'corroboration', 'corroboration', 'corroboration'].map((role, i) => ({ url: `https://source${i}.example/page`, publisher: `Publisher ${i}`, role: role as 'authority' | 'corroboration', passage: 'Example is the name', location: 'Table 1', retrieved: '2026-01-01' })),
  reviewer: 'maintainer', issue: 'https://example.com/issues/1', permalink: 'https://example.com/reviews/1', reviewedAt: '2026-01-01', independenceExplanation: 'Distinct original publishers checked by the reviewer',
});
const referencedEntity = (): WikiEntity => {
  const e = entity();
  e.claims.P1448 = [{ id: 'Q1$name', mainsnak: { datavalue: { value: { text: 'Example', language: 'en' } } }, references: review().sources.map(s => ({ snaks: { P854: [{ datavalue: { value: s.url } }] } })) }];
  return e;
};
test('digest binds review to exact request including revision and qualifiers', () => {
  assert.notEqual(requestDigest(request()), requestDigest({ ...request(), revision: 13 }));
  assert.equal(requestDigest(request()), requestDigest({ ...request() }));
});
test('review metadata cannot approve itself and readiness never verifies evidence', async () => {
  const record = review();
  const untrusted = await reviewReadiness(request(), record, undefined, async () => referencedEntity());
  assert.deepEqual(untrusted.missing, ['trusted-maintainer-attestation']);
  const ready = await reviewReadiness(request(), record, record, async () => referencedEntity());
  assert.equal(ready.status, 'ready-for-human-review');
  assert.equal((await checkEvidence(request(), async () => referencedEntity())).status, 'source-match');
});
test('stale, duplicate and incomplete source reviews remain incomplete', async () => {
  const record = review(); record.requestDigest = requestDigest({ ...request(), revision: 13 });
  record.sources[1] = { ...record.sources[0], role: 'corroboration' }; record.sources[2].passage = '';
  const result = await reviewReadiness(request(), record, record, async () => referencedEntity());
  assert.ok(result.missing.includes('stale-or-mismatched-request'));
  assert.ok(result.missing.includes('independent-publisher-review'));
  assert.ok(result.missing.includes('source-passages'));
  assert.throws(() => parseReviewManifest({ schemaVersion: 1, reviews: [record, record] }), /duplicate/);
});
test('name statement and all four references must exist at pinned and current revision', async () => {
  const record = review();
  const result = await reviewReadiness(request(), record, record, async (_, revision) => {
    const e = referencedEntity(); if (!revision) e.claims.P1448[0].references.pop(); return e;
  });
  assert.deepEqual(result.missing, ['current-statement-references']);
  record.statement.id = 'Q1$missing';
  assert.ok((await reviewReadiness(request(), record, record, async () => entity())).missing.includes('pinned-statement-references'));
});

test('offline readiness cannot claim a live current reference check', async () => {
  const record = review(), revisions: (number | undefined)[] = [];
  const result = await reviewReadiness(request(), record, record, async (_, revision) => { revisions.push(revision); return referencedEntity(); }, { offline: true });
  assert.deepEqual(revisions, [12]);
  assert.deepEqual(result.missing, ['live-current-source-reference-check']);
  assert.equal(result.status, 'incomplete');
});
test('an ISO string or wrong-language name statement cannot establish a label or alias', async () => {
  const alias = { ...request(), kind: 'alias' as const, expected: 'XX' };
  const record = { ...review(), requestDigest: requestDigest(alias), statement: { property: 'P297', id: 'Q1$test', expected: 'XX' } };
  assert.ok((await reviewReadiness(alias, record, record, async () => entity())).missing.includes('referenced-name-or-value-statement'));
  for (const value of ['Example', { text: 'Example', language: 'fr' }]) {
    const e = referencedEntity(); e.claims.P1448[0].mainsnak.datavalue.value = value;
    const r = review();
    assert.ok((await reviewReadiness(request(), r, r, async () => e)).missing.includes('pinned-statement-references'));
  }
});
test('reference comparison ignores only URL fragments and rejects duplicate document sources', async () => {
  const record = review(); record.sources[0].url += '#section';
  assert.equal((await reviewReadiness(request(), record, record, async () => referencedEntity())).status, 'ready-for-human-review');
  for (const url of ['http://source0.example/page', 'https://source0.example/page?edition=2']) {
    record.sources[0].url = url;
    assert.ok((await reviewReadiness(request(), record, record, async () => referencedEntity())).missing.includes('pinned-statement-references'));
  }
  record.sources[0].url = 'https://source0.example/page#one';
  record.sources[1].url = 'https://source0.example/page#two';
  assert.ok((await reviewReadiness(request(), record, record, async () => referencedEntity())).missing.includes('independent-publisher-review'));
});
test('readiness ledger cannot replace an existing reviewed override approval', async () => {
  const reviewed = { ...request(), review: {} as NonNullable<EvidenceRequest['review']> };
  const record = review();
  const result = await reviewReadiness(reviewed, record, record, async () => { throw new Error('must not fetch'); });
  assert.deepEqual(result.missing, ['unsupported-reviewed-override-request']);
});

test('readiness detects changed name-statement scope and rank at the current revision', async () => {
  for (const changed of ['scope','rank']) {
    const record=review();
    const result=await reviewReadiness(request(),record,record,async(_,revision)=>{
      const e=referencedEntity();
      if(!revision) {
        if(changed==='rank') e.claims.P1448[0].rank='preferred';
        else e.claims.P1448[0].qualifiers={P518:[{datavalue:{value:{id:'Q2'}}}]};
      }
      return e;
    });
    assert.ok(result.missing.includes('current-statement-scope-or-rank'));
    assert.equal(result.status,'incomplete');
  }
});

test('current source drift and outages are advisory only after a faithful pinned match', async () => {
  const statement = { ...request(), kind: 'statement' as const, property: 'P297', statementId: 'Q1$test', expected: 'XX' };
  for (const change of ['value', 'qualifiers', 'outage']) {
    const fetcher = async (_: string, revision?: number) => {
      if (!revision && change === 'outage') throw new Error('HTTP 503 current');
      const e = entity();
      if (!revision && change === 'value') e.claims.P297[0].mainsnak.datavalue.value = 'YY';
      if (!revision && change === 'qualifiers') e.claims.P297[0].qualifiers = { P580: [] };
      return e;
    };
    const result = await checkEvidence(statement, fetcher);
    assert.equal(result.blocking, false, change);
    assert.notEqual(result.status, 'verified');
    assert.equal((await checkEvidence({ ...statement, expected: 'ZZ' }, fetcher)).status, 'mismatch');
  }
  const pinnedOutage = await checkEvidence(statement, async () => { throw new Error('HTTP 503 pinned'); });
  assert.equal(pinnedOutage.status, 'infrastructure-error');
  assert.notEqual(pinnedOutage.blocking, false);
  const policy = await checkEvidence({ ...request(), kind: 'local-policy' }, async () => entity());
  assert.notEqual(policy.blocking, false);
});

test('source spellings in local code namespaces require review while translated names remain upstream imports', async () => {
  const e = entity(); e.aliases = { en: [{ value: 'XX' }] }; e.labels.fr = { value: 'Exemple' };
  const local = await checkEvidence({ ...request(), id: 'Q1:policy:unofficial:XX', kind: 'alias', expected: 'XX' }, async () => e);
  assert.equal(local.status, 'needs-review');
  assert.notEqual(local.blocking, false);
  const translated = await checkEvidence({ ...request(), id: 'Q1:policy:name:Exemple', language: 'fr', expected: 'Exemple' }, async () => e);
  assert.equal(translated.status, 'source-match');
  assert.equal(translated.blocking, false);
});

test('policy markers inside alias text are source names and continent projections stay advisory', async () => {
  const e = entity(); e.aliases = { en: [{ value: 'Foo:policy:Bar' }] };
  assert.equal((await checkEvidence({ ...request(), id: 'Q1:alias:en:Foo:policy:Bar', kind: 'alias', expected: 'Foo:policy:Bar' }, async () => e)).status, 'source-match');
  e.claims.P30 = [
    { id: 'Q1$continent', rank: 'normal', mainsnak: { datavalue: { value: { id: 'Q46' } } } },
    { id: 'Q1$other-continent', rank: 'normal', mainsnak: { datavalue: { value: { id: 'Q48' } } }, qualifiers: { P518: [] } },
  ];
  const result = await checkEvidence({ ...request(), kind: 'statement', property: 'P30', statementId: 'Q1$continent', expected: { id: 'Q46' }, qualifiers: {} }, async () => e);
  assert.equal(result.status, 'source-match');
  assert.equal(result.blocking, false);
  assert.ok(result.advisories?.includes('single-continent-projection'));
  assert.ok(result.advisories?.includes('qualified-continent-projection'));
});
