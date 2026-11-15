import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Builder, ByteBuffer } from 'flatbuffers';
import { Registry } from '../src/generated/country-spike.js';

test('coverage-only changes cannot bypass PR evidence review', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-evidence-test-'));
  try {
    await mkdir(join(dir, 'data'));
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
    assert.equal(report.findings.some((f: any) => f.id === 'binary-diff' && f.status === 'needs-review'), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
