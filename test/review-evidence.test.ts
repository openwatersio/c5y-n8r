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
