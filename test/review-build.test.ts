import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCorpus } from '../src/source.ts';
import { reviewDigest, selectedReviews } from '../src/overrides.ts';
import { reviewedCorpus } from './helpers/review-fixtures.ts';
import { CountryRegistry } from '../src/index.ts';


test('no active reviews reproduce the pinned artifacts exactly', async () => {
  const result = await buildCorpus('.');
  assert.deepEqual(Buffer.from(result.bytes), await readFile('data/countries.crdb'));
  assert.equal(result.evidenceText, await readFile('data/evidence.json', 'utf8'));
});

test('the staged Turkey review is complete and its approval binds the shipped record', async () => {
  const bundle = JSON.parse(await readFile('sources/reviewed-overrides.json', 'utf8'));
  const approvals = JSON.parse(await readFile('sources/review-approvals.json', 'utf8'));
  const reviews = selectedReviews(bundle, { active: [bundle.records[0].id], retired: [] }, approvals);
  assert.equal(reviews[0].record.qid, 'Q43');
  assert.equal(reviews[0].record.mode, 'evidence');
  assert.equal(reviews[0].record.corroborating.length, 2);
  const { cp, mkdtemp, rm } = await import('node:fs/promises'), { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'real-turkey-review-'));
  try {
    await cp('sources', join(dir, 'sources'), { recursive: true });
    await writeFile(join(dir, 'sources/override-activation.json'), JSON.stringify({ active: [reviews[0].record.id], retired: [] }));
    const generated = await buildCorpus(dir, approvals);
    assert.equal(JSON.parse(generated.evidenceText).requests.find((r: any) => r.id === reviews[0].record.statementId).review.record.id, reviews[0].record.id);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the trusted builder rejects noncanonical snapshot paths and symbolic-link inputs', async () => {
  await reviewedCorpus(async (dir, _, approvals) => {
    const { symlink, rm } = await import('node:fs/promises');
    const path = join(dir, 'sources/manifest.json'), manifest = JSON.parse(await readFile(path, 'utf8'));
    const original = manifest[0].file;
    manifest[0].file = 'sources/unexpected.json';
    await writeFile(path, JSON.stringify(manifest));
    await assert.rejects(buildCorpus(dir, approvals), /manifest path/);
    manifest[0].file = original;
    await writeFile(path, JSON.stringify(manifest));
    const originalPolicy = join(dir, 'sources/policy.json'), policyText = await readFile(originalPolicy);
    const target = join(dir, 'outside-policy.json'); await writeFile(target, policyText);
    await rm(originalPolicy); await symlink(target, originalPolicy);
    await assert.rejects(buildCorpus(dir, approvals), /Invalid.*corpus file/);
  });
});

test('an evidence-only build binds the review but preserves country answers and snapshots', async () => {
  await reviewedCorpus(async (dir, r, approvals) => {
    const before = await readFile(join(dir, 'sources/manifest.json'), 'utf8');
    const result = await buildCorpus(dir, approvals);
    const evidence = JSON.parse(result.evidenceText);
    assert.equal(evidence.requests.find((q: any) => q.id === r.statementId).review.record.id, r.id);
    assert.equal(CountryRegistry.open(result.bytes).resolve('Turkey').preferred?.continent, 'Asia');
    assert.equal(before, await readFile(join(dir, 'sources/manifest.json'), 'utf8'));
    await assert.rejects(buildCorpus(dir, {}), /approved/);
  });
});

test('a factual correction is derived from the effective source and cannot silently change accepted answers', async () => {
  await reviewedCorpus(async (dir, r) => {
    r.mode = 'correction'; r.proposed = { value: { 'entity-type': 'item', 'numeric-id': 46, id: 'Q46' }, qualifiers: {}, rank: 'normal' };
    await writeFile(join(dir, 'sources/reviewed-overrides.json'), JSON.stringify({ schemaVersion: 1, records: [r] }));
    await assert.rejects(buildCorpus(dir, { [r.id]: reviewDigest(r) }), /Compatibility answer changed/);
    const path = join(dir, 'sources/accepted-inputs.json'), fixture = JSON.parse(await readFile(path, 'utf8'));
    const update = (value: any) => {
      if (!value || typeof value !== 'object') return;
      if (value.id === 'Q43' && value.continent === 'Asia') value.continent = 'Europe';
      for (const child of Object.values(value)) update(child);
    };
    update(fixture);
    await writeFile(path, JSON.stringify(fixture));
    const corrected = await buildCorpus(dir, { [r.id]: reviewDigest(r) });
    assert.equal(CountryRegistry.open(corrected.bytes).resolve('Turkey').preferred?.continent, 'Europe');
    const evidence = JSON.parse(corrected.evidenceText).requests.find((q: any) => q.id === r.statementId);
    assert.equal(evidence.expected.id, 'Q46');
    assert.equal(evidence.review.record.baseline.value.id, 'Q48');
  });
});
