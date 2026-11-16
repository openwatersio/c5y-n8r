import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Builder, ByteBuffer } from 'flatbuffers';
import { Registry } from '../src/generated/country-spike.js';
import { buildCorpus } from '../src/source.ts';
import { checkEvidence, type EvidenceRequest } from '../src/evidence.ts';
import { reviewedCorpus } from './helpers/review-fixtures.ts';
import { reviewDigest, statementState } from '../src/overrides.ts';

async function save(dir: string, approvals: Record<string, string>) {
  const generated = await buildCorpus(dir, approvals);
  const { mkdir } = await import('node:fs/promises'); await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'data/countries.crdb'), generated.bytes);
  await writeFile(join(dir, 'data/evidence.json'), generated.evidenceText);
  return generated;
}
function cli(dir: string, base: string, preload?: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', ...(preload ? ['--import', preload] : []), 'scripts/check-evidence.ts', ...(preload ? [] : ['--offline']), '--corpus', dir, '--base', base, '--output', join(dir, 'report')], { encoding: 'utf8' });
}

test('review verification binds the requested claim and cannot authenticate proposed approval fields', async () => {
  await reviewedCorpus(async (dir, r, approvals) => {
    const built = await buildCorpus(dir, approvals);
    const request: EvidenceRequest = JSON.parse(built.evidenceText).requests.find((q: any) => q.id === r.statementId);
    const manifest = JSON.parse(await readFile(join(dir, 'sources/manifest.json'), 'utf8'));
    const entry = manifest.find((m: any) => m.id === 'Q43');
    const original = JSON.parse(await readFile(join(dir, entry.file), 'utf8')).entities.Q43;
    assert.equal((await checkEvidence(request, async () => original, approvals)).status, 'verified');
    assert.notEqual((await checkEvidence(request, async () => original)).status, 'verified');
    assert.equal((await checkEvidence({ ...request, expected: 'forged' }, async () => original, approvals)).status, 'mismatch');
    const drifted = structuredClone(original); drifted.claims.P30[0].rank = 'preferred';
    assert.equal((await checkEvidence(request, async (_, revision) => revision ? original : drifted, approvals)).status, 'needs-review');
  });
});

test('a proposed corpus cannot approve its own local review', async () => {
  await reviewedCorpus(async (dir, _, approvals) => {
    await save(dir, approvals);
    const result = cli(dir, '.');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
    assert.match(JSON.stringify(report), /not approved/);
    const noBase = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', dir, '--output', join(dir, 'untrusted-report')], { encoding: 'utf8' });
    assert.equal(noBase.status, 1);
    assert.match(noBase.stdout + noBase.stderr, /requires a trusted --base/);
  });
});

test('selected activation triggers trusted rebuilding even when artifacts contain no reviews', async () => {
  await reviewedCorpus(async (dir, r, approvals) => {
    const { cp, mkdtemp, rm } = await import('node:fs/promises');
    const base = await mkdtemp(join(dir, 'base-'));
    try {
      await cp('sources', join(base, 'sources'), { recursive: true });
      await cp('data', join(base, 'data'), { recursive: true });
      await writeFile(join(base, 'sources/review-approvals.json'), JSON.stringify(approvals));
      await writeFile(join(base, 'sources/reviewed-overrides.json'), JSON.stringify({ schemaVersion: 1, records: [r] }));
      await writeFile(join(dir, 'sources/policy.json'), await readFile(join(base, 'sources/policy.json')));
      await cp('data', join(dir, 'data'), { recursive: true });
      const stale = cli(dir, base);
      assert.equal(stale.status, 1);
      assert.match(stale.stdout + stale.stderr, /differ from trusted source build/);
      await writeFile(join(base, 'sources/review-approvals.json'), '{}');
      const unapproved = cli(dir, base);
      assert.equal(unapproved.status, 1);
      assert.match(unapproved.stdout + unapproved.stderr, /not approved/);
      r.primary.url = r.baseline.references[0].snaks.P854[0].datavalue.value;
      await writeFile(join(dir, 'sources/reviewed-overrides.json'), JSON.stringify({ schemaVersion: 1, records: [r] }));
      await writeFile(join(base, 'sources/review-approvals.json'), JSON.stringify({ [r.id]: reviewDigest(r) }));
      await writeFile(join(dir, 'sources/override-activation.json'), JSON.stringify({ active: [], retired: [r.id] }));
      const retired = cli(dir, base);
      assert.equal(retired.status, 1);
      assert.match(retired.stdout + retired.stderr, /differ from trusted source build/);
      await writeFile(join(dir, 'sources/override-activation.json'), JSON.stringify({ active: [], retired: [] }));
      await writeFile(join(base, 'sources/override-activation.json'), JSON.stringify({ active: [r.id], retired: [] }));
      await writeFile(join(base, 'sources/reviewed-overrides.json'), JSON.stringify({ schemaVersion: 1, records: [r] }));
      const policyPath = join(dir, 'sources/policy.json'), policy = JSON.parse(await readFile(policyPath, 'utf8')); policy.datasetVersion++;
      await writeFile(policyPath, JSON.stringify(policy));
      const baseSelected = cli(dir, base);
      assert.equal(baseSelected.status, 1);
      assert.match(baseSelected.stdout + baseSelected.stderr, /differ from trusted source build/);
    } finally { await rm(base, { recursive: true, force: true }); }
  });
});

test('the checker rejects symlinked activation inputs before parsing their target', async () => {
  await reviewedCorpus(async (dir) => {
    const { cp, rm, symlink, mkdtemp } = await import('node:fs/promises');
    await cp('data', join(dir, 'data'), { recursive: true });
    const input = join(dir, 'sources/override-activation.json'), target = join(dir, 'synthetic-private-data');
    await writeFile(target, 'synthetic-private-marker');
    await rm(input); await symlink(target, input);
    const result = cli(dir, '.');
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /Invalid.*corpus file/);
    assert.equal((result.stdout + result.stderr).includes('synthetic-private-marker'), false);
    const outside = await mkdtemp(join(dir, '../outside-review-config-'));
    try {
      await writeFile(join(outside, 'override-activation.json'), '{"active":[],"retired":[]}');
      await rm(join(dir, 'sources'), { recursive: true, force: true });
      await symlink(outside, join(dir, 'sources'), 'dir');
      const escaped = cli(dir, '.');
      assert.equal(escaped.status, 1);
      assert.match(escaped.stdout + escaped.stderr, /Invalid.*corpus file/);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});

test('unchanged reviewed artifacts report live drift without blocking a maintenance PR', async () => {
  await reviewedCorpus(async (dir, r, approvals) => {
    await save(dir, approvals);
    const manifest = JSON.parse(await readFile(join(dir, 'sources/manifest.json'), 'utf8'));
    const m = manifest.find((m: any) => m.id === 'Q43');
    const preload = join(dir, 'unchanged-drift.mjs');
    await writeFile(preload, `import {readFileSync} from 'node:fs'; const raw=readFileSync(${JSON.stringify(join(dir, m.file))}, 'utf8'); globalThis.fetch=async input=>{ const data=JSON.parse(raw); if(!new URL(input).searchParams.has('revision')) data.entities.Q43.claims.P30[0].rank='preferred'; return new Response(JSON.stringify(data)); };`);
    assert.equal(cli(dir, dir, preload).status, 0);
    const report = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
    assert.equal(report.passed, false);
    assert.equal(report.gatePassed, true);
    assert.equal(report.findings.find((f: any) => f.id === r.statementId).blocking, false);
  });
});

test('retirement after an upstream reference addition preserves effective facts and passes the scoped gate', async () => {
  await reviewedCorpus(async (dir, r, approvals) => {
    const { cp, mkdtemp, rm } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    const base = await mkdtemp(join(dir, 'base-'));
    try {
      await save(dir, approvals);
      await cp(join(dir, 'sources'), join(base, 'sources'), { recursive: true });
      await cp(join(dir, 'data'), join(base, 'data'), { recursive: true });
      const manifest = JSON.parse(await readFile(join(dir, 'sources/manifest.json'), 'utf8'));
      const m = manifest.find((m: any) => m.id === 'Q43');
      const snapshot = JSON.parse(await readFile(join(dir, m.file), 'utf8'));
      snapshot.entities.Q43.lastrevid++;
      snapshot.entities.Q43.claims.P30[0].references.push({ snaks: { P854: [{ datavalue: { value: r.primary.url } }] } });
      m.revision++; m.file = `sources/wikidata/Q43-${m.revision}.json`;
      const raw = JSON.stringify(snapshot); m.sha256 = createHash('sha256').update(raw).digest('hex');
      await writeFile(join(dir, m.file), raw);
      await writeFile(join(dir, 'sources/manifest.json'), JSON.stringify(manifest));
      await writeFile(join(dir, 'sources/override-activation.json'), JSON.stringify({ active: [], retired: [r.id] }));
      const path = join(dir, 'sources/policy.json'), policy = JSON.parse(await readFile(path, 'utf8')); policy.datasetVersion++;
      await writeFile(path, JSON.stringify(policy));
      await save(dir, approvals);
      const preload = join(dir, 'adopted.mjs');
      await writeFile(preload, `globalThis.fetch=async()=>new Response(${JSON.stringify(raw)});`);
      const result = cli(dir, base, preload);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const report = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
      assert.equal(report.findings.find((f: any) => f.id === r.statementId).provenance.kind, 'upstream-reviewed');
      assert.equal(report.findings.find((f: any) => f.id === r.statementId).link.endsWith(`oldid=${m.revision}`), true);
      assert.equal(report.findings.find((f: any) => f.id === 'provenance:Q43').status, 'source-match');
      snapshot.entities.Q43.descriptions.en.value = 'Invented non-runtime source content';
      const forged = JSON.stringify(snapshot); m.sha256 = createHash('sha256').update(forged).digest('hex');
      await writeFile(join(dir, m.file), forged);
      await writeFile(join(dir, 'sources/manifest.json'), JSON.stringify(manifest));
      await save(dir, approvals);
      assert.equal(cli(dir, base, preload).status, 1);
      const rejected = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
      assert.equal(rejected.findings.find((f: any) => f.id === 'provenance:Q43').status, 'mismatch');
    } finally { await rm(base, { recursive: true, force: true }); }
  });
});

test('trusted activation limits rechecking to reviewed differences but offline mode cannot certify live state', async () => {
  await reviewedCorpus(async (dir, r, approvals) => {
    const { cp, mkdtemp, rm } = await import('node:fs/promises');
    const base = await mkdtemp(join(dir, 'base-'));
    try {
      await cp('sources', join(base, 'sources'), { recursive: true });
      await cp('data', join(base, 'data'), { recursive: true });
      await writeFile(join(base, 'sources/review-approvals.json'), JSON.stringify(approvals));
      await save(dir, approvals);
      const result = cli(dir, base);
      assert.equal(result.status, 1);
      const report = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
      assert.equal(report.findings.length, 1);
      assert.equal(report.findings[0].id, r.statementId);
      assert.equal(report.findings[0].status, 'verified');
      assert.equal(report.passed, false);
      assert.equal(report.findings[0].provenance.kind, 'local-review');
      const fixturePath = join(dir, 'sources/accepted-inputs.json'), originalFixture = await readFile(fixturePath, 'utf8');
      await writeFile(fixturePath, JSON.stringify({ ...JSON.parse(originalFixture), reviewNote: 'Changed fixture during activation' }));
      assert.equal(cli(dir, base).status, 1);
      const fixtureReport = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
      assert.equal(fixtureReport.findings.some((f: any) => f.id === 'compatibility-fixture' && f.status === 'needs-review'), true);
      await writeFile(fixturePath, originalFixture);
      const valid = await readFile(join(dir, 'data/countries.crdb'));
      for (const mutate of [(body: any) => { body.entities[0].continent = 'Invented'; }, (body: any) => { body.assignments[0].fromDay = -10000; body.assignments[0].fromLatestDay = -10000; }]) {
        const body = Registry.getRootAsRegistry(new ByteBuffer(valid)).unpack();
        mutate(body);
        const b = new Builder(); b.finish(body.pack(b), 'CRDB');
        await writeFile(join(dir, 'data/countries.crdb'), b.asUint8Array());
        const forged = cli(dir, base);
        assert.equal(forged.status, 1);
        assert.match(forged.stdout + forged.stderr, /trusted source build/);
      }
    } finally { await rm(base, { recursive: true, force: true }); }
  });
});

test('a reviewed transition cannot hide a forged new revision on an unrelated country', async () => {
  await reviewedCorpus(async (dir, r, approvals) => {
    const { cp, mkdtemp, rm } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    const base = await mkdtemp(join(dir, 'base-'));
    try {
      await save(dir, approvals);
      await cp(join(dir, 'sources'), join(base, 'sources'), { recursive: true });
      await cp(join(dir, 'data'), join(base, 'data'), { recursive: true });
      const manifest = JSON.parse(await readFile(join(dir, 'sources/manifest.json'), 'utf8'));
      const m = manifest.find((m: any) => m.id === 'Q213');
      const snapshot = JSON.parse(await readFile(join(dir, m.file), 'utf8')); snapshot.entities.Q213.lastrevid++;
      m.revision++; m.file = `sources/wikidata/Q213-${m.revision}.json`;
      const raw = JSON.stringify(snapshot); m.sha256 = createHash('sha256').update(raw).digest('hex');
      await writeFile(join(dir, m.file), raw);
      await writeFile(join(dir, 'sources/manifest.json'), JSON.stringify(manifest));
      const policyPath = join(dir, 'sources/policy.json'), policy = JSON.parse(await readFile(policyPath, 'utf8')); policy.datasetVersion++;
      await writeFile(policyPath, JSON.stringify(policy));
      await save(dir, approvals);
      const q43 = manifest.find((m: any) => m.id === 'Q43'), preload = join(dir, 'only-reviewed-current.mjs');
      await writeFile(preload, `import {readFileSync} from 'node:fs'; const raw=readFileSync(${JSON.stringify(join(dir, q43.file))}, 'utf8'); globalThis.fetch=async()=>new Response(raw);`);
      assert.equal(cli(dir, base, preload).status, 1);
      const report = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
      assert.equal(report.findings.some((f: any) => f.id === 'binary-diff'), true);
    } finally { await rm(base, { recursive: true, force: true }); }
  });
});

test('a scoped transition still rechecks unchanged active reviews for upstream drift', async () => {
  await reviewedCorpus(async (dir, r, approvals) => {
    const { cp, mkdtemp, rm } = await import('node:fs/promises');
    const base = await mkdtemp(join(dir, 'base-'));
    try {
      const manifest = JSON.parse(await readFile(join(dir, 'sources/manifest.json'), 'utf8'));
      const m = manifest.find((m: any) => m.id === 'Q43');
      const entity = JSON.parse(await readFile(join(dir, m.file), 'utf8')).entities.Q43;
      const second = { ...structuredClone(r), id: 'second-review', property: 'P297', statementId: entity.claims.P297[0].id, baseline: statementState(entity.claims.P297[0]) };
      second.baselineDigest = reviewDigest(second.baseline);
      approvals[second.id] = reviewDigest(second);
      await writeFile(join(dir, 'sources/reviewed-overrides.json'), JSON.stringify({ schemaVersion: 1, records: [r, second] }));
      await writeFile(join(dir, 'sources/review-approvals.json'), JSON.stringify(approvals));
      await save(dir, approvals);
      await cp(join(dir, 'sources'), join(base, 'sources'), { recursive: true });
      await cp(join(dir, 'data'), join(base, 'data'), { recursive: true });
      await writeFile(join(dir, 'sources/override-activation.json'), JSON.stringify({ active: [r.id, second.id], retired: [] }));
      const policyPath = join(dir, 'sources/policy.json'), policy = JSON.parse(await readFile(policyPath, 'utf8')); policy.datasetVersion++;
      await writeFile(policyPath, JSON.stringify(policy));
      await save(dir, approvals);
      cli(dir, base);
      const report = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
      assert.deepEqual(new Set(report.findings.map((f: any) => f.id)), new Set([r.statementId, second.statementId]));
      const preload = join(dir, 'current-drift.mjs');
      await writeFile(preload, `
        import {readFileSync} from 'node:fs';
        const raw = readFileSync(${JSON.stringify(join(dir, m.file))}, 'utf8');
        globalThis.fetch = async input => {
          const data = JSON.parse(raw), url = new URL(input);
          if (!url.searchParams.has('revision')) data.entities.Q43.claims.P30[0].rank = 'preferred';
          return new Response(JSON.stringify(data), {status:200});
        };
      `);
      assert.equal(cli(dir, base, preload).status, 1);
      const live = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
      assert.equal(live.passed, false);
      assert.equal(live.findings.find((f: any) => f.id === r.statementId).status, 'needs-review');
      assert.equal(live.findings.find((f: any) => f.id === second.statementId).status, 'verified');
    } finally { await rm(base, { recursive: true, force: true }); }
  });
});
