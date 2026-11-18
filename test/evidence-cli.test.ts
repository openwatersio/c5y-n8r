import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Builder, ByteBuffer } from 'flatbuffers';
import { Registry } from '../src/generated/country-spike.js';
import { createHash } from 'node:crypto';
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
    await mkdir(join(dir, 'sources'));
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
    assert.equal(report.datasetVersion, 3);
    assert.match(report.binarySha256, /^[a-f0-9]{64}$/);
    assert.match(report.evidenceDigest, /^[a-f0-9]{64}$/);
    assert.equal(report.findings.some((f: any) => f.id === 'dataset-version' && f.status === 'mismatch'), true);
    assert.equal(report.findings.some((f: any) => f.id === 'binary-diff' && f.status === 'needs-review'), true);
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
    await mkdir(join(dir, 'sources'));
    const fixture = JSON.parse(await readFile('sources/accepted-inputs.json', 'utf8'));
    fixture.lookups = fixture.lookups.filter((c: any) => !(c.input === 'CS' && c.namespace === 'iso-alpha2' && !c.date));
    await writeFile(join(dir, 'sources/accepted-inputs.json'), JSON.stringify(fixture));
    await cp('sources/accepted-methods.json', join(dir, 'sources/accepted-methods.json'));
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--corpus', dir, '--base', '.', '--output', join(dir, 'report')], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(await readFile(join(dir, 'report/report.json'), 'utf8'));
    assert.equal(report.findings.some((f: any) => f.id === 'compatibility-fixture' && f.status === 'needs-review'), true);
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
    await mkdir(join(dir, 'sources/wikidata'), { recursive: true });
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
    snapshot.entities[request.qid].claims.P1448 ??= [];
    snapshot.entities[request.qid].claims.P1448.push({ id: record.statement.id, mainsnak: { datavalue: { value: { text: request.expected, language: request.language ?? 'en' } } }, references: record.sources.map(source => ({ snaks: { P854: [{ datavalue: { value: source.url } }] } })) });
    const raw = JSON.stringify(snapshot);
    await writeFile(join(dir, entry.file), raw);
    await writeFile(join(dir, 'sources/manifest.json'), JSON.stringify([{ ...entry, sha256: createHash('sha256').update(raw).digest('hex') }]));
    const run = async (name: string) => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-evidence.ts', '--offline', '--corpus', dir, '--base', '.', '--output', join(dir, name)], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
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
    assert.deepEqual(readiness.missing, ['live-current-source-reference-check', 'trusted-maintainer-attestation']);
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
