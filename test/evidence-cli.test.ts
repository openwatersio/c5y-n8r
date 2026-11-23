import { CountryRegistry } from '../src/index.ts';
import { canonical } from '../src/evidence.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Builder, ByteBuffer } from 'flatbuffers';
import { Registry } from '../src/generated/country-spike.js';
import { createHash } from 'node:crypto';
import { buildCorpus } from '../src/source.ts';
import { observeLookup } from '../src/compatibility.ts';
import { requestDigest, type EvidenceReview, type EvidenceRequest } from '../src/evidence.ts';

function observeReader(entry: string, output: string, cases = 'sources/accepted-inputs.json') {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/observe-reader.ts', '--reader', entry, '--corpus', '.', '--cases', cases, '--output', output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return output;
}

test('coverage-only changes cannot bypass PR evidence review', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-evidence-test-'));
  try {
    await mkdir(join(dir, 'data'));
    await cp('sources', join(dir, 'sources'), { recursive: true });
    await cp('sources/accepted-inputs.json', join(dir, 'sources/accepted-inputs.json'));
    await cp('sources/accepted-methods.json', join(dir, 'sources/accepted-methods.json'));
    const bytes = await readFile('data/countries.crdb');
    const source = Registry.getRootAsRegistry(new ByteBuffer(bytes)).unpack();
    source.metadata!.coverageThrough = '2099-11-15';
    const builder = new Builder(); builder.finish(source.pack(builder), 'CRDB');
    await writeFile(join(dir, 'data/countries.crdb'), builder.asUint8Array());
    await writeFile(join(dir, 'data/evidence.json'), await readFile('data/evidence.json'));
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', dir, '--base', '.', '--output', join(dir, 'report')], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
    assert.equal(report.applicable, true);
    assert.match(report.findings[0].message, /differ from trusted source build/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unsupported readers produce an evidence report instead of crashing without an artifact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-compatibility-test-'));
  try {
    await mkdir(join(dir, 'data'));
    const source = Registry.getRootAsRegistry(new ByteBuffer(await readFile('data/countries.crdb'))).unpack();
    source.metadata!.minimumReaderVersion = '9.0.0';
    const builder = new Builder(); builder.finish(source.pack(builder), 'CRDB');
    await writeFile(join(dir, 'data/countries.crdb'), builder.asUint8Array());
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', dir, '--output', join(dir, 'report')], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
    assert.equal(report.passed, false);
    assert.equal(report.findings[0].id, 'reader-compatibility');
    assert.equal(report.findings[0].metadata.minimumReaderVersion, '9.0.0');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('fixture-only changes cannot pass the trusted evidence comparison', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-fixture-test-'));
  try {
    await cp('data', join(dir, 'data'), { recursive: true });
    await cp('sources', join(dir, 'sources'), { recursive: true });
    const fixture = JSON.parse(await readFile('sources/accepted-inputs.json', 'utf8'));
    fixture.lookups = fixture.lookups.filter((c: any) => !(c.input === 'CS' && c.namespace === 'iso-alpha2' && !c.date));
    await writeFile(join(dir, 'sources/accepted-inputs.json'), JSON.stringify(fixture));
    await cp('sources/accepted-methods.json', join(dir, 'sources/accepted-methods.json'));
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', dir, '--base', '.', '--output', join(dir, 'report')], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
    assert.equal(report.findings.some((f: any) => f.id === 'compatibility-fixture' && f.status === 'needs-review'), true);
    await writeFile(join(dir, 'sources/manifest.json'), JSON.stringify([{ id: 'Q999', revision: 1, file: '/dev/zero', sha256: '0'.repeat(64) }]));
    const unsafe = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', dir, '--base', '.', '--output', join(dir, 'unsafe')], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(unsafe.status, 1, unsafe.stdout + unsafe.stderr);
    const rejected = JSON.parse(await readFile(join(dir, 'unsafe/report.json'), 'utf8'));
    assert.ok(rejected.findings.some((f: any) => f.id === 'provenance:Q999' && /Invalid snapshot manifest path/.test(f.message)));
    const fixturePath = join(dir, 'sources/accepted-inputs.json'), target = join(dir, 'private-fixture-target');
    await writeFile(target, 'synthetic-private-fixture-marker'); await rm(fixturePath); await symlink(target, fixturePath);
    const symlinked = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', dir, '--base', '.', '--output', join(dir, 'symlinked')], { encoding: 'utf8' });
    assert.equal(symlinked.status, 1);
    assert.match(symlinked.stdout + symlinked.stderr, /Invalid.*corpus file/);
    assert.equal((symlinked.stdout + symlinked.stderr).includes('synthetic-private-fixture-marker'), false);


  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the trusted reader check detects changed behavior with unchanged data and fixtures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-reader-test-'));
  try {
    await cp('dist', join(dir, 'reader'), { recursive: true });
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await symlink(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
    const entry = join(dir, 'reader/index.js');
    const code = await readFile(entry, 'utf8');
    assert.match(code, /Math.max\(\.\.\.ended\)/);
    await writeFile(entry, code.replace('Math.max(...ended)', 'Math.min(...ended)'));
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', '.', '--base', '.', '--reader-results', observeReader(entry, join(dir, 'results.json')), '--output', join(dir, 'report')], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
    assert.equal(report.mode, 'reader-compatibility');
    assert.equal(report.findings.some((f: any) => f.id === 'reader-lookup' && f.status === 'mismatch' && f.input === 'CS'), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the reader compatibility mode executes and reports every trusted case', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-reader-pass-'));
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', '.', '--base', '.', '--reader-results', observeReader(resolve('dist/index.js'), join(dir, 'results.json')), '--output', dir], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
    const fixture = JSON.parse(await readFile('sources/accepted-inputs.json', 'utf8'));
    assert.equal(report.mode, 'reader-compatibility');
    assert.equal(report.passed, true);
    assert.equal(report.applicable, true);
    const methods = JSON.parse(await readFile('sources/accepted-methods.json', 'utf8'));
    assert.equal(report.checkedLookups, fixture.lookups.length + methods.cases.length);
    assert.equal(report.findings.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an untrusted artifact cannot submit a forged compatibility verdict', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-forged-results-'));
  try {
    const file = join(dir, 'results.json');
    await writeFile(file, JSON.stringify({ mode: 'reader-compatibility', checkedLookups: 235, passed: true, findings: [] }));
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', '.', '--base', '.', '--reader-results', file, '--output', join(dir, 'report')], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
    assert.equal(report.passed, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('early exit from a proposed reader cannot forge the separate verdict', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-exiting-reader-'));
  try {
    const entry = join(dir, 'reader.mjs'), output = join(dir, 'results.json');
    await writeFile(entry, `import {writeFileSync} from 'node:fs'; const a=process.argv; writeFileSync(a[a.indexOf('--output')+1], JSON.stringify({mode:'reader-compatibility',checkedLookups:235,passed:true})); process.exit(0);`);
    observeReader(entry, output);
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', '.', '--base', '.', '--reader-results', output, '--output', join(dir, 'verdict')], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(await readFile(join(dir, 'verdict/report.json'), 'utf8'));
    assert.equal(report.passed, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('missing or duplicated observations cannot stand in for all trusted cases', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-incomplete-results-'));
  try {
    const fixture = JSON.parse(await readFile('sources/accepted-inputs.json', 'utf8'));
    for (const cases of [fixture.lookups.slice(1), [fixture.lookups[0], ...fixture.lookups.slice(0, -1)]]) {
      const file = join(dir, 'results.json');
      await writeFile(file, JSON.stringify({ schemaVersion: 2, cases }));
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', '.', '--base', '.', '--reader-results', file, '--output', join(dir, 'verdict')], { encoding: 'utf8' });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      const report = JSON.parse(await readFile(join(dir, 'verdict/report.json'), 'utf8'));
      assert.equal(report.passed, false);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the verdict checker refuses to load proposed code through the old option', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-no-import-'));
  try {
    const marker = join(dir, 'executed'), entry = join(dir, 'reader.mjs');
    await writeFile(entry, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');`);
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--base', '.', '--reader', entry, '--output', join(dir, 'verdict')], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    await assert.rejects(access(marker));
    assert.match(result.stderr, /cannot load proposed reader code/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('mutating the observation job fixture cannot change the fresh verdict expectations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-mutated-harness-'));
  try {
    const cases = join(dir, 'cases.json'), entry = join(dir, 'reader.mjs'), output = join(dir, 'results.json');
    await cp('sources/accepted-inputs.json', cases);
    await writeFile(entry, `
      import {readFileSync,writeFileSync} from 'node:fs';
      const a=process.argv, path=a[a.indexOf('--cases')+1], fixture=JSON.parse(readFileSync(path,'utf8'));
      for(const c of fixture.lookups) if(c.input==='CS' && c.namespace==='iso-alpha2' && !c.date) c.result.preferred.id='Q33946';
      writeFileSync(path,JSON.stringify(fixture));
      const methods=JSON.parse(readFileSync('sources/accepted-methods.json','utf8'));
      writeFileSync(a[a.indexOf('--output')+1],JSON.stringify({schemaVersion:2,cases:[...fixture.lookups,...methods.cases]}));
      process.exit(0);
    `);
    observeReader(entry, output, cases);
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', '.', '--base', '.', '--reader-results', output, '--output', join(dir, 'verdict')], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(await readFile(join(dir, 'verdict/report.json'), 'utf8'));
    assert.equal(report.findings.some((f: any) => f.id === 'reader-lookup' && f.input === 'CS'), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const [file, before, after] of [
  ['common.js', "value.trim().normalize('NFC')", "value.normalize('NFC')"],
  ['index.js', "outsideCoverage ? 'outside-coverage' : 'partial'", "'partial'"],
]) test(`trusted full results reject ${file} normalization or coverage regression`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-contract-'));
  try {
    await cp('dist', join(dir, 'reader'), { recursive: true });
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await symlink(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
    const path = join(dir, 'reader', file), code = await readFile(path, 'utf8');
    assert.ok(code.includes(before));
    await writeFile(path, code.replace(before, after));
    const observations = observeReader(join(dir, 'reader/index.js'), join(dir, 'results.json'));
    const verdict = spawnSync(process.execPath, ['--import','tsx','scripts/check-evidence.ts','--offline','--base','.','--reader-results',observations,'--output',join(dir,'report')], {encoding:'utf8'});
    assert.equal(verdict.status, 1, verdict.stdout + verdict.stderr);
    const report = JSON.parse(await readFile(join(dir,'report/report.json'),'utf8'));
    assert.ok(report.findings.some((f: any) => f.id === 'reader-lookup'));
  } finally { await rm(dir, {recursive:true,force:true}); }
});

test('ledger-only readiness updates inspect unchanged requests without changing the evidence verdict', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-readiness-ledger-'));
  try {
    await cp('data', join(dir, 'data'), { recursive: true });
    await cp('sources', join(dir, 'sources'), { recursive: true });
    await cp('sources/accepted-inputs.json', join(dir, 'sources/accepted-inputs.json'));
    await cp('sources/accepted-methods.json', join(dir, 'sources/accepted-methods.json'));
    const evidence = JSON.parse(await readFile('data/evidence.json', 'utf8'));
    const request: EvidenceRequest = evidence.requests.find((r: EvidenceRequest) => r.kind === 'label' && !r.review);
    assert.ok(request);
    const manifest = JSON.parse(await readFile('sources/manifest.json', 'utf8'));
    const entry = manifest.find((m: any) => m.id === request.qid && m.revision === request.revision);
    const snapshot = JSON.parse(await readFile(entry.file, 'utf8'));
    const record: EvidenceReview = {
      id: request.id, requestDigest: requestDigest(request),
      statement: { property: 'P1448', id: `${request.qid}$readiness-test`, expected: request.expected },
      sources: [0, 1, 2, 3].map(i => ({ url: `https://publisher${i}.example/test-document`, publisher: `Test publisher ${i}`, role: i === 0 ? 'authority' : 'corroboration', passage: `Fixture name: ${request.expected}`, location: 'Fixture table', retrieved: '2026-01-01' })),
      reviewer: 'test fixture only', issue: 'https://example.com/test-issue', permalink: 'https://example.com/test-review', reviewedAt: '2026-01-01', independenceExplanation: 'Synthetic fixture; no actual source review is claimed',
    };
    const run = async (name: string) => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', dir, '--base', '.', '--output', join(dir, name)], { encoding: 'utf8' });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      return JSON.parse(await readFile(join(dir, name, 'report.json'), 'utf8'));
    };
    const before = await run('before');
    await writeFile(join(dir, 'sources/evidence-reviews.json'), JSON.stringify({ schemaVersion: 1, reviews: [record, { ...record, id: 'orphan-test-record' }] }));
    const after = await run('after');
    assert.equal(after.gatePassed, before.gatePassed);
    assert.deepEqual(after.findings, before.findings);
    assert.equal(after.readiness.length, evidence.requests.filter((r: EvidenceRequest) => !r.review).length + 1);
    const readiness = after.readiness.find((r: any) => r.id === request.id);
    assert.equal(readiness.status, 'incomplete');
    assert.ok(readiness.missing.includes('live-current-source-reference-check'));
    assert.ok(readiness.missing.includes('trusted-maintainer-attestation'));
    assert.deepEqual(after.readiness.find((r: any) => r.id === 'orphan-test-record').missing, ['unknown-request']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a convert-only regression fails the protected method observations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-convert-guard-'));
  try {
    await cp('dist', join(dir, 'reader'), {recursive:true});
    await writeFile(join(dir,'package.json'), '{"type":"module"}');
    await symlink(resolve('node_modules'), join(dir,'node_modules'), 'dir');
    const entry=join(dir,'reader/index.js');
    await writeFile(entry, (await readFile(entry,'utf8')) + "\nCountryRegistry.prototype.convert = function(value, options) { const source=this.resolve(value,{namespace:options.from,date:options.date}); return {source,target:{...source,preferred:undefined,candidates:[],selection:'none'}}; };\n");
    const output=observeReader(entry,join(dir,'observations.json'));
    const run=spawnSync(process.execPath,['--import','tsx','scripts/check-evidence.ts','--offline','--base','.','--reader-results',output,'--output',join(dir,'report')],{encoding:'utf8'});
    assert.equal(run.status,1,run.stdout+run.stderr);
    const report=JSON.parse(await readFile(join(dir,'report/report.json'),'utf8'));
    assert.ok(report.findings.some((f: any)=>f.id==='reader-lookup'));
    const original=JSON.parse(await readFile(output,'utf8'));
    const fixture=JSON.parse(await readFile('sources/accepted-inputs.json','utf8'));
    assert.deepEqual(original.cases.filter((c: any)=>!c.operation).map((c: any)=>c.result),fixture.lookups.map((c: any)=>c.result));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('a proposed method fixture cannot remove a protected expectation', async () => {
  const dir=await mkdtemp(join(tmpdir(),'country-method-fixture-'));
  try {
    await cp('data',join(dir,'data'),{recursive:true});
    await mkdir(join(dir,'sources'));
    await cp('sources/accepted-inputs.json',join(dir,'sources/accepted-inputs.json'));
    const methods=JSON.parse(await readFile('sources/accepted-methods.json','utf8'));
    methods.cases.pop();
    await writeFile(join(dir,'sources/accepted-methods.json'),JSON.stringify(methods));
    const results=observeReader(resolve('dist/index.js'),join(dir,'observations.json'));
    const run=spawnSync(process.execPath,['--import','tsx','scripts/check-evidence.ts','--offline','--base','.','--corpus',dir,'--reader-results',results,'--output',join(dir,'report')],{encoding:'utf8'});
    assert.equal(run.status,1,run.stdout+run.stderr);
    const report=JSON.parse(await readFile(join(dir,'report/report.json'),'utf8'));
    assert.ok(report.findings.some((f: any)=>f.id==='method-compatibility-fixture'));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('unreferenced Wikidata additions pass trusted ingestion; forged artifacts and new local policy block', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-upstream-ingestion-'));
  try {
    await cp('sources', join(dir, 'sources'), { recursive: true });
    await cp('data', join(dir, 'data'), { recursive: true });
    const manifestPath = join(dir, 'sources/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const item = manifest.find((m: any) => m.id === 'Q213');
    const snapshot = JSON.parse(await readFile(join(dir, item.file), 'utf8'));
    snapshot.entities.Q213.lastrevid++;
    const removedStatementId = snapshot.entities.Q213.claims.P30[0].id;
    snapshot.entities.Q213.claims.P30[0].id += '-replacement';
    snapshot.entities.Q213.aliases.en.push({ value: 'Fixture Czech name' });
    snapshot.entities.Q213.labels.zz = { value: 'ZZ' };
    for (const property of ['P297', 'P298', 'P299']) for (const claim of snapshot.entities.Q213.claims[property] ?? []) claim.references = [];
    item.revision++; item.file = `sources/wikidata/Q213-${item.revision}.json`;
    const raw = JSON.stringify(snapshot); item.sha256 = createHash('sha256').update(raw).digest('hex');
    await writeFile(join(dir, item.file), raw);
    for (const qid of ['Q43', 'Q145']) {
      const refresh = manifest.find((m: any) => m.id === qid);
      const body = JSON.parse(await readFile(join(dir, refresh.file), 'utf8')); body.entities[qid].lastrevid++;
      refresh.revision++; refresh.file = `sources/wikidata/${qid}-${refresh.revision}.json`;
      const refreshed = JSON.stringify(body); refresh.sha256 = createHash('sha256').update(refreshed).digest('hex');
      await writeFile(join(dir, refresh.file), refreshed);
    }
    await writeFile(manifestPath, JSON.stringify(manifest));
    const policyPath = join(dir, 'sources/policy.json'), policy = JSON.parse(await readFile(policyPath, 'utf8')); policy.datasetVersion++;
    await writeFile(policyPath, JSON.stringify(policy));
    const save = async () => {
      const expanded = await buildCorpus(dir, {}, { allowNewInputs: true });
      for (const assignment of expanded.addedInputs) {
        expanded.accepted.inputs.push({ entity: assignment.entity, namespace: assignment.namespace, value: assignment.value });
        for (const namespace of [assignment.namespace, undefined]) expanded.accepted.lookups.push(observeLookup(expanded.registry, { input: assignment.value, namespace }));
      }
      await writeFile(join(dir, 'sources/accepted-inputs.json'), JSON.stringify(expanded.accepted));
      const built = await buildCorpus(dir, {});
      await writeFile(join(dir, 'data/countries.crdb'), built.bytes);
      await writeFile(join(dir, 'data/evidence.json'), built.evidenceText);
      return built;
    };
    const built = await save();
    const preload = join(dir, 'wikidata-fixture.mjs');
    await writeFile(preload, `import {readFileSync} from 'node:fs'; const root=${JSON.stringify(dir)}; globalThis.fetch=async input=>{const url=new URL(input), qid=url.pathname.split('/').pop().replace('.json',''); const manifest=JSON.parse(readFileSync(root+'/sources/manifest.json','utf8')); const entry=manifest.find(m=>m.id===qid); return new Response(qid==='Q213'?${JSON.stringify(raw)}:readFileSync(root+'/'+entry.file,'utf8'));};`);
    const run = async (withBase: boolean | string = true, reader = false) => {
      const observations = join(dir, 'reader-results.json');
      if (reader) {
        const registry = CountryRegistry.open(await readFile(join(dir, 'data/countries.crdb')));
        const fixture = JSON.parse(await readFile('sources/accepted-inputs.json','utf8'));
        const methods = JSON.parse(await readFile('sources/accepted-methods.json','utf8'));
        await writeFile(observations,JSON.stringify({schemaVersion:2,cases:[...fixture.lookups,...methods.cases].map(c=>observeLookup(registry,c))}));
      }
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', preload, 'scripts/check-evidence.ts', ...(withBase ? ['--base', typeof withBase === 'string' ? withBase : '.'] : []), '--corpus', dir, ...(reader ? ['--reader-results', observations] : []), '--output', join(dir, 'report')], { encoding: 'utf8' });
      return { result, report: JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8')) };
    };
    const good = await run();
    assert.equal(good.result.status, 0, good.result.stdout + good.result.stderr);
    assert.equal(good.report.gatePassed, true);
    assert.equal(good.report.passed, false);
    assert.ok(good.report.findings.some((f: any) => f.status === 'source-match' && f.advisories?.includes('missing-statement-references')));
    assert.ok(good.report.findings.some((f: any) => f.advisories?.includes('inherited-trusted-local-policy')));
    for (const id of ['Q43:policy:name:Turkiye', 'Q145:policy:unofficial:UK']) assert.equal(good.report.findings.find((f: any) => f.id === id).blocking, false);
    assert.ok(good.report.findings.some((f: any) => f.id === removedStatementId && f.blocking === false && f.advisories.includes('upstream-assertion-removed')));
    const readerGood = await run(true, true);
    assert.equal(readerGood.result.status,0,readerGood.result.stdout+readerGood.result.stderr);
    assert.ok(readerGood.report.findings.some((f:any)=>f.id===removedStatementId&&f.blocking===false));
    policy.datasetVersion--; await writeFile(policyPath, JSON.stringify(policy)); await save();
    const unbumped = await run();
    assert.equal(unbumped.result.status, 1);
    assert.ok(unbumped.report.findings.some((f: any) => f.id === 'dataset-version' && f.status === 'mismatch'));
    policy.datasetVersion++; await writeFile(policyPath, JSON.stringify(policy)); await save();
    const coverage = policy.coverage; policy.coverage += ' (unreviewed declaration change)';
    await writeFile(policyPath, JSON.stringify(policy)); await save();
    const declaration = await run();
    assert.equal(declaration.result.status, 1);
    assert.ok(declaration.report.findings.some((f: any) => f.id === 'local-policy-declarations' && f.blocking !== false));
    const approval = declaration.report.findings.find((f: any) => f.id === 'local-policy-declarations');
    const approvalFile = 'sources/review-approvals.json';
    const originalApprovals = await readFile(approvalFile, 'utf8');
    const approved = { ...JSON.parse(originalApprovals), 'local-policy-transition': approval.message.split(' ').at(-1) };
    await writeFile(join(dir, approvalFile), JSON.stringify(approved));
    const selfApproval = await run();
    assert.ok(selfApproval.report.findings.some((f: any) => f.id === 'local-policy-declarations' && f.blocking !== false));
    assert.ok(selfApproval.report.findings.some((f: any) => f.id === 'local-policy-approval-staging' && f.blocking !== false));
    const trusted = join(dir, 'trusted');
    await cp('sources', join(trusted, 'sources'), { recursive: true });
    await cp('data', join(trusted, 'data'), { recursive: true });
    await writeFile(join(trusted, approvalFile), JSON.stringify(approved));
    assert.ok((await run(trusted)).report.findings.some((f: any) => f.id === 'unconsumed-approval:local-policy-transition'));
    await writeFile(join(dir, approvalFile), '{}');
    assert.equal((await run(trusted)).report.gatePassed, true);
    policy.coverage = coverage; await writeFile(policyPath, JSON.stringify(policy)); await save();

    await writeFile(join(dir, 'sources/evidence-reviews.json'), JSON.stringify({ schemaVersion: 99, reviews: [] }));
    const quality = await run();
    assert.equal(quality.result.status, 0, quality.result.stdout + quality.result.stderr);
    assert.equal(quality.report.gatePassed, true);
    assert.ok(quality.report.readiness.some((r: any) => r.missing.includes('invalid-readiness-ledger')));
    assert.ok(quality.report.readiness.some((r: any) => r.missing.includes('review-record')));
    await rm(join(dir, 'sources/evidence-reviews.json'));
    const fixturePath = join(dir, 'sources/accepted-inputs.json'), validFixture = await readFile(fixturePath, 'utf8');
    const forgedFixture = JSON.parse(validFixture); forgedFixture.lookups.at(-1).result.selection = 'invented';
    await writeFile(fixturePath, JSON.stringify(forgedFixture));
    const invented = await run();
    assert.equal(invented.result.status, 1);
    assert.match(invented.report.findings[0].message, /Compatibility answer changed/);
    await writeFile(fixturePath, validFixture);
    for (const mutate of [(f: any) => f.inputs.shift(), (f: any) => f.lookups.shift(), (f: any) => { f.lookups[0].result.selection = 'invented'; }]) {
      const fixture = JSON.parse(validFixture); mutate(fixture);
      await writeFile(fixturePath, JSON.stringify(fixture));
      const changed = await run();
      assert.equal(changed.result.status, 1);
      assert.ok(changed.report.findings.some((f: any) => f.id === 'compatibility-fixture'));
    }
    await writeFile(fixturePath, validFixture);

    const body = Registry.getRootAsRegistry(new ByteBuffer(built.bytes)).unpack(); body.entities[0].continent = 'Invented';
    const builder = new Builder(); builder.finish(body.pack(builder), 'CRDB');
    await writeFile(join(dir, 'data/countries.crdb'), builder.asUint8Array());
    const forged = await run();
    assert.equal(forged.result.status, 1);
    assert.match(forged.report.findings[0].message, /trusted source build/);
    await writeFile(join(dir, 'data/countries.crdb'), built.bytes);
    const rank = snapshot.entities.Q213.claims.P30[0].rank;
    snapshot.entities.Q213.claims.P30[0].rank = 'preferred';
    const forgedSource = JSON.stringify(snapshot); item.sha256 = createHash('sha256').update(forgedSource).digest('hex');
    await writeFile(join(dir, item.file), forgedSource); await writeFile(manifestPath, JSON.stringify(manifest)); await save();
    const noBase = await run(false);
    assert.equal(noBase.result.status, 1);
    assert.ok(noBase.report.findings.some((f: any) => f.id === 'provenance:Q213' && f.status === 'mismatch'));
    snapshot.entities.Q213.claims.P30[0].rank = rank; item.sha256 = createHash('sha256').update(raw).digest('hex');
    await writeFile(join(dir, item.file), raw); await writeFile(manifestPath, JSON.stringify(manifest)); await save();
    policy.aliases.push({ entity: 'Q213', namespace: 'unofficial', value: 'ZZ', kind: 'label', language: 'zz', reason: 'Unapproved test-only local rule' });
    await writeFile(policyPath, JSON.stringify(policy));
    await save();
    const local = await run();
    assert.equal(local.result.status, 1, local.result.stdout + local.result.stderr);
    assert.ok(local.report.findings.some((f: any) => f.id.endsWith(':ZZ') && f.status === 'needs-review' && f.blocking !== false));
    const readerLocal = await run(true, true);
    assert.equal(readerLocal.result.status,1,readerLocal.result.stdout+readerLocal.result.stderr);
    assert.ok(readerLocal.report.findings.some((f:any)=>f.id.endsWith(':ZZ')&&f.status==='needs-review'&&f.blocking!==false));
    const { requests } = JSON.parse(await readFile(join(dir, 'data/evidence.json'), 'utf8'));
    const request = requests.find((r: any) => r.id.endsWith(':ZZ'));
    const key = `local-policy-request:${request.id}`;
    const digest = createHash('sha256').update(canonical(request)).digest('hex');
    await writeFile(join(dir, approvalFile), JSON.stringify({ ...approved, [key]: digest }));
    assert.ok((await run()).report.findings.some((f: any) => f.id === request.id && f.blocking !== false));
    await writeFile(join(trusted, approvalFile), JSON.stringify({ ...approved, [key]: digest }));
    assert.ok((await run(trusted)).report.findings.some((f: any) => f.id === `unconsumed-approval:${key}`));
    await writeFile(join(dir, approvalFile), '{}');
    const approvedLocal = await run(trusted);
    assert.equal(approvedLocal.report.gatePassed, true);
    assert.ok(approvedLocal.report.findings.some((f: any) => f.id === request.id && f.advisories?.includes('approved-trusted-local-policy')));
    assert.equal((await run(trusted, true)).report.gatePassed, true);
    policy.aliases.at(-1).reason = 'Changed after approval';
    await writeFile(policyPath, JSON.stringify(policy)); await save();
    assert.ok((await run(trusted)).report.findings.some((f: any) => f.id === request.id && f.blocking !== false));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
