import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildCorpus } from '../src/source.ts';

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

test('preferred Oceania references resolve through pinned taxonomy without adding country entities', async () => {
  const taxonomy = JSON.parse(await readFile('sources/continent-taxonomy.json', 'utf8'));
  assert.equal(taxonomy.verificationStatus, 'pending');
  for (const entry of taxonomy.snapshots) {
    const raw = await readFile(entry.file);
    assert.equal(digest(raw), entry.sha256);
    const entity = JSON.parse(raw.toString()).entities[entry.id];
    assert.equal(entity.lastrevid, entry.revision);
    assert.equal(entity.labels.en.value, entry.id === 'Q55643' ? 'Oceania' : 'Insular Oceania');
  }
  const built = await buildCorpus('.');
  for (const name of ['Australia', 'Federated States of Micronesia', 'Guam', 'Marshall Islands', 'Nauru', 'New Zealand', 'Papua New Guinea', 'Samoa', 'Solomon Islands', 'Tonga']) {
    assert.equal(built.registry.convert(name, { from: 'name', to: 'iso-alpha2' }).target.preferred?.continent, 'Oceania', name);
  }
  assert(!built.source.entities.some(e => ['Q55643', 'Q538'].includes(e.id)));
  const audit = JSON.parse(await readFile('sources/slackwater-source-audit.json', 'utf8'));
  assert.equal(audit.summary.sourceBackedInputs, 126);
  assert.equal(audit.summary.metadataIncompleteInputs, 0);
  assert(audit.required.filter((r: any) => r.functionalStatus === 'source-backed-unreviewed').every((r: any) => r.continent && r.metadataStatus === 'source-backed-unreviewed'));
});

test('Antarctica self-continent policy retains its actual P31 evidence and rejects lost source support', async () => {
  const built = await buildCorpus('.');
  assert.equal(built.registry.convert('Antarctica', { from: 'name', to: 'iso-alpha2' }).target.preferred?.continent, 'Antarctica');
  const evidence = JSON.parse(built.evidenceText).requests;
  assert(evidence.some((r: any) => r.qid === 'Q51' && r.property === 'P31' && r.expected.id === 'Q5107'));
  assert(!evidence.some((r: any) => r.qid === 'Q51' && r.property === 'P30'));
  const policy = evidence.find((r: any) => r.id === 'Q51:policy:continent:Antarctica');
  assert.equal(policy.kind, 'local-policy');
  assert.match(policy.reason, /referenceDate/);
  const dir = await mkdtemp(join(tmpdir(), 'continent-policy-test-'));
  try {
    await cp('sources', join(dir, 'sources'), { recursive: true });
    const manifest = JSON.parse(await readFile(join(dir, 'sources/manifest.json'), 'utf8'));
    const item = manifest.find((r: any) => r.id === 'Q51');
    const snapshot = JSON.parse(await readFile(join(dir, item.file), 'utf8'));
    snapshot.entities.Q51.claims.P31.find((c: any) => c.mainsnak.datavalue?.value?.id === 'Q5107').rank = 'deprecated';
    const raw = JSON.stringify(snapshot);
    item.sha256 = digest(raw);
    await writeFile(join(dir, item.file), raw);
    await writeFile(join(dir, 'sources/manifest.json'), JSON.stringify(manifest));
    await assert.rejects(buildCorpus(dir), /Unsupported self-continent policy/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('candidate evidence has exact issue tracking and research pointers bind real snapshots', async () => {
  const raw = await readFile('data/evidence.json');
  const tracker = JSON.parse(await readFile('sources/evidence-review-issues.json', 'utf8'));
  assert.equal(tracker.candidateEvidenceSha256, digest(raw));
  assert.deepEqual(Object.keys(tracker.evidenceIssues).sort(), JSON.parse(raw.toString()).requests.map((r: any) => r.id).sort());
  assert.equal(tracker.totalEvidenceItems, 765);
  const research = JSON.parse(await readFile('sources/slackwater-candidate-research.json', 'utf8'));
  const manifest = JSON.parse(await readFile('sources/manifest.json', 'utf8'));
  for (const item of research.proposals) {
    if (item.status === 'admitted-unreviewed-candidate-correction') {
      const active = manifest.find((m: any) => m.id === item.id);
      assert.equal(active.revision, item.revision);
      assert.equal(active.sha256, item.sha256);
    }
    const snapshot = await readFile(item.file);
    assert.equal(digest(snapshot), item.sha256);
    assert.equal(JSON.parse(snapshot.toString()).entities[item.id].lastrevid, item.revision);
  }
});


test('Oceania P30 assertions can enter the reviewed-override workflow without activating them', async () => {
  const { validateReviews, reviewDigest } = await import('../src/overrides.ts');
  const { record } = await import('./helpers/review-fixtures.ts');
  const review = record();
  review.property = 'P30';
  review.baseline.value = { 'entity-type': 'item', 'numeric-id': 55643, id: 'Q55643' };
  review.baselineDigest = reviewDigest(review.baseline);
  assert.doesNotThrow(() => validateReviews({ schemaVersion: 1, records: [review] }));
  review.baseline.value = { 'entity-type': 'item', 'numeric-id': 999999, id: 'Q999999' };
  review.baselineDigest = reviewDigest(review.baseline);
  assert.throws(() => validateReviews({ schemaVersion: 1, records: [review] }), /Invalid review property value/);
});


test('issue tracker refresh handles version changes but never invents mappings', async () => {
  const { spawnSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'issue-map-refresh-test-'));
  try {
    await cp('data', join(dir, 'data'), { recursive: true });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, 'sources'));
    await cp('sources/evidence-review-issues.json', join(dir, 'sources/evidence-review-issues.json'));
    const path = join(dir, 'data/evidence.json');
    const evidence = JSON.parse(await readFile(path, 'utf8'));
    evidence.datasetVersion++;
    await writeFile(path, JSON.stringify(evidence));
    const run = () => spawnSync(process.execPath, [resolve('scripts/refresh-evidence-issues.mjs')], { cwd: dir, encoding: 'utf8' });
    assert.equal(run().status, 0);
    const before = await readFile(join(dir, 'sources/evidence-review-issues.json'), 'utf8');
    assert.equal(JSON.parse(before).datasetVersion, evidence.datasetVersion);
    assert.equal(JSON.parse(before).candidateEvidenceSha256, digest(await readFile(path)));
    evidence.requests.push({ id: 'unmapped-new-assertion' });
    await writeFile(path, JSON.stringify(evidence));
    const missing = run();
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Update issue mappings explicitly/);
    assert.equal(await readFile(join(dir, 'sources/evidence-review-issues.json'), 'utf8'), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
