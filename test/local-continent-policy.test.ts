import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { canonical } from '../src/evidence.ts';
import { observeLookup } from '../src/compatibility.ts';
import { buildCorpus } from '../src/source.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

test('continent policy requires trusted withdrawal approval when a pinned P30 supersedes the local rule', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-continent-policy-'));
  try {
    await cp('sources', join(dir, 'sources'), { recursive: true });
    const syntheticIds = new Set(['Q51', 'Q408']);
    const manifestPath = join(dir, 'sources/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')).filter((entry: any) => !syntheticIds.has(entry.id));
    await writeFile(manifestPath, JSON.stringify(manifest));
    const fixturePath = join(dir, 'sources/accepted-inputs.json');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
    const unrelated = (lookup: unknown) => !/"Q(?:51|408)"/.test(JSON.stringify(lookup));
    fixture.inputs = fixture.inputs.filter((input: any) => !syntheticIds.has(input.entity));
    fixture.lookups = fixture.lookups.filter(unrelated);
    await writeFile(fixturePath, JSON.stringify(fixture));
    const methodsPath = join(dir, 'sources/accepted-methods.json');
    const methods = JSON.parse(await readFile(methodsPath, 'utf8'));
    methods.cases = methods.cases.filter(unrelated);
    await writeFile(methodsPath, JSON.stringify(methods));
    const policyPath = join(dir, 'sources/policy.json');
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    const claim = (id: string, value: string, rank = 'normal') => ({ id, rank, mainsnak: { datavalue: { value: { id: value } } } });
    const identity = claim('Q51$identity', 'Q5107');
    policy.selfContinent = { entity: 'Q51', value: 'Antarctica', statementId: identity.id, instanceOf: 'Q5107', scope: 'Reference-date display' };
    await writeFile(policyPath, JSON.stringify(policy));
    await assert.rejects(buildCorpus(dir), /Unknown self-continent entity/);
    const snapshot = async (id: string, name: string, claims: object, revision = 1) => {
      const file = `sources/wikidata/${id}-${revision}.json`;
      const raw = JSON.stringify({ entities: { [id]: { id, lastrevid: revision, labels: { en: { value: name } }, claims } } });
      await writeFile(join(dir, file), raw);
      const index = manifest.findIndex((entry: any) => entry.id === id);
      const entry = { id, revision, file, sha256: digest(raw), retrievedAt: '2026-11-15T00:00:00Z' };
      if (index < 0) manifest.push(entry); else manifest[index] = entry;
      await writeFile(manifestPath, JSON.stringify(manifest));
    };
    const build = () => buildCorpus(dir, {}, { allowNewInputs: true });
    await snapshot('Q51', 'Antarctica', { P31: [identity] });
    await snapshot('Q408', 'Australia', { P30: [claim('Q408$continent', 'Q55643')] });
    const built = await build();
    assert.equal(built.source.entities.find(e => e.id === 'Q408')?.continent, 'Oceania');
    assert.equal(built.source.entities.find(e => e.id === 'Q51')?.continent, 'Antarctica');
    const requests = JSON.parse(built.evidenceText).requests;
    assert.ok(requests.some((r: any) => r.id === identity.id && r.property === 'P31'));
    assert.ok(requests.some((r: any) => r.id === 'Q51:policy:continent:Antarctica' && r.kind === 'local-policy'));
    for (const claims of [
      { P31: [{ ...identity, rank: 'deprecated' }] },
      { P31: [identity], P30: [claim('Q51$continent', 'Q51')] },
    ]) {
      await snapshot('Q51', 'Antarctica', claims);
      await assert.rejects(build(), /Unsupported self-continent policy/);
    }

    await snapshot('Q51', 'Antarctica', { P31: [identity] });
    for (const input of built.addedInputs) {
      built.accepted.inputs.push({ entity: input.entity, namespace: input.namespace, value: input.value });
      for (const namespace of [input.namespace, undefined]) {
        built.accepted.lookups.push(observeLookup(built.registry, { input: input.value, namespace }));
      }
    }
    await writeFile(fixturePath, JSON.stringify(built.accepted));
    const trusted = await mkdtemp(join(tmpdir(), 'country-withdrawal-base-'));
    try {
      await cp(join(dir, 'sources'), join(trusted, 'sources'), { recursive: true });
      await cp('data', join(trusted, 'data'), { recursive: true });
      await cp('data', join(dir, 'data'), { recursive: true });
      const writeArtifacts = async (root: string) => {
        const corpus = await buildCorpus(root);
        await writeFile(join(root, 'data/countries.crdb'), corpus.bytes);
        await writeFile(join(root, 'data/evidence.json'), corpus.evidenceText);
      };
      await writeArtifacts(trusted);
      const declaration = ({ datasetVersion, aliases, ...rest }: typeof policy) => rest;
      const before = declaration(policy);
      const oldRequest = requests.find((r: any) => r.id === 'Q51:policy:continent:Antarctica');
      delete policy.selfContinent;
      policy.datasetVersion++;
      await writeFile(policyPath, JSON.stringify(policy));
      await snapshot('Q51', 'Antarctica', { P31: [identity], P30: [claim('Q51$continent', 'Q51')] }, 2);
      await writeArtifacts(dir);
      const approvalPath = 'sources/review-approvals.json';
      const approvals = JSON.parse(await readFile(join(trusted, approvalPath), 'utf8'));
      approvals['local-policy-transition'] = digest(canonical({ before, after: declaration(policy) }));
      const key = `local-policy-withdrawal:${oldRequest.id}`;
      const run = async () => {
        const output = join(dir, 'report');
        const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--base', trusted, '--corpus', dir, '--output', output], { encoding: 'utf8' });
        assert.equal(result.status, 1, result.stderr);
        const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
        const finding = report.findings.find((f: any) => f.id === oldRequest.id);
        assert.ok(finding, result.stdout + result.stderr);
        return { finding, findings: report.findings };
      };
      await writeFile(join(dir, approvalPath), '{}');
      await writeFile(join(trusted, approvalPath), JSON.stringify({ ...approvals, [key]: '0'.repeat(64) }));
      assert.notEqual((await run()).finding.blocking, false);
      approvals[key] = digest(canonical(oldRequest));
      await writeFile(join(trusted, approvalPath), JSON.stringify(approvals));
      await writeFile(join(dir, approvalPath), JSON.stringify({ [key]: approvals[key] }));
      const retained = await run();
      assert.notEqual(retained.finding.blocking, false);
      assert.ok(retained.findings.some((f: any) => f.id === `unconsumed-approval:${key}`));
      await writeFile(join(dir, approvalPath), '{}');
      const accepted = await run();
      assert.equal(accepted.finding.blocking, false);
      assert.ok(!accepted.findings.some((f: any) => f.id === 'compatibility-fixture' || f.id === 'local-policy-declarations'));
      assert.deepEqual(accepted.finding.advisories, ['approved-trusted-local-policy-withdrawal']);
    } finally { await rm(trusted, { recursive: true, force: true }); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
