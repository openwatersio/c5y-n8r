import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Builder, ByteBuffer } from 'flatbuffers';
import { Registry } from '../src/generated/country-spike.js';

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
    assert.equal(report.datasetVersion, 2);
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
    assert.equal(report.checkedLookups, fixture.lookups.length);
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
      writeFileSync(a[a.indexOf('--output')+1],JSON.stringify({schemaVersion:2,cases:fixture.lookups}));
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
