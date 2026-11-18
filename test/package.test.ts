import { builtinModules } from 'node:module';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, rm, symlink, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('the package export loads and reads its binary in plain Node', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { CountryRegistry } from '@openwaters/c5y-n8r';
    import { readFileSync } from 'node:fs';
    const db = CountryRegistry.open(readFileSync(new URL(import.meta.resolve('@openwaters/c5y-n8r/data'))));
    if (db.resolve('Turkey').preferred?.id !== 'Q43') throw new Error('Country lookup failed');
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('a prepared tarball installs with scripts disabled and preserves its notices', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-install-test-'));
  try {
    const checkout = join(dir, 'checkout'), consumer = join(dir, 'consumer');
    await mkdir(checkout);
    for (const path of ['src', 'scripts', 'data', 'sources', 'schema', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md', 'LICENSE', 'DATA_LICENSE.md']) await cp(path, join(checkout, path), { recursive: true });
    await symlink(resolve('node_modules'), join(checkout, 'node_modules'), 'dir');
    const initialized = spawnSync('git', ['init', '-q'], { cwd: checkout, encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr);
    const committed = spawnSync('git', ['-c', 'user.name=Packaging test', '-c', 'user.email=packaging@example.invalid', 'commit', '--allow-empty', '-qm', 'Packaging fixture'], { cwd: checkout, encoding: 'utf8' });
    assert.equal(committed.status, 0, committed.stderr);
    const packed = spawnSync('npm', ['run', 'distribution', '--', dir], { cwd: checkout, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(dir, 'pack-cache') } });
    assert.equal(packed.status, 0, packed.stdout + packed.stderr);
    const archive = (await readdir(dir)).find(name => name.endsWith('.tgz'))!;
    const dependencyPack = spawnSync('npm', ['pack', resolve('node_modules/flatbuffers'), '--ignore-scripts', '--pack-destination', dir, '--cache', join(dir, 'dependency-cache')], { encoding: 'utf8' });
    assert.equal(dependencyPack.status, 0, dependencyPack.stdout + dependencyPack.stderr);
    const dependency = (await readdir(dir)).find(name => name.startsWith('flatbuffers-') && name.endsWith('.tgz'))!;
    await mkdir(consumer);
    const installed = spawnSync('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--cache', join(dir, 'empty-cache'), join(dir, archive), join(dir, dependency)], { cwd: consumer, encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const target = join(consumer, 'node_modules/@openwaters/c5y-n8r');
    const manifest = JSON.parse(await readFile(join(dir, 'distribution.json'), 'utf8'));
    assert.match(manifest.commit, /^[a-f0-9]{40}$/);
    const repacked = spawnSync(process.execPath, ['scripts/pack-distribution.mjs', dir], { cwd: checkout, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(dir, 'pack-cache') } });
    assert.equal(repacked.status, 0, repacked.stdout + repacked.stderr);
    assert.equal(JSON.parse(await readFile(join(dir, 'distribution.json'), 'utf8')).sha256, manifest.sha256);
    const { createHash } = await import('node:crypto');
    assert.equal(manifest.sha256, createHash('sha256').update(await readFile(join(dir, archive))).digest('hex'));
    const readerFiles = await readdir(join(target, 'dist'), { recursive: true });
    for (const file of readerFiles.filter(name => name.endsWith('.js'))) {
      const code = await readFile(join(target, 'dist', file), 'utf8');
      const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
      for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)) assert.ok(!match[1].startsWith('node:') && !builtins.has(match[1]), `${file}: Node builtin ${match[1]}`);
    }
    const loaded = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { CountryRegistry } from '@openwaters/c5y-n8r';
      import { readFileSync } from 'node:fs';
      const db = CountryRegistry.open(readFileSync(new URL(import.meta.resolve('@openwaters/c5y-n8r/data'))));
      if (db.resolve('Turkey').preferred?.id !== 'Q43') throw new Error('Packed lookup failed');
    `], { cwd: consumer, encoding: 'utf8' });
    assert.equal(loaded.status, 0, loaded.stdout + loaded.stderr);
    const binary = await readFile(join(target, 'data/countries.crdb'));
    const workerResult = await new Promise((resolveResult, reject) => {
      const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(`
        import { parentPort, workerData } from 'node:worker_threads';
        import { CountryRegistry } from ${JSON.stringify(pathToFileURL(join(target, 'dist/index.js')).href)};
        const response = await fetch(workerData.url);
        const db = CountryRegistry.open(new Uint8Array(await response.arrayBuffer()));
        parentPort.postMessage(db.resolve('Turkey').preferred?.id);
      `)), { workerData: { url: 'data:application/octet-stream;base64,' + binary.toString('base64') } });
      worker.once('message', resolveResult);
      worker.once('error', reject);
      worker.once('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
    });
    assert.equal(workerResult, 'Q43');
    await assert.rejects(access(join(target, 'sources/slackwater-required.json')));
    await assert.rejects(access(join(target, 'sources/slackwater-source-audit.json')));
    await assert.rejects(access(join(target, 'reports/benchmark.json')));
    await access(join(target, 'sources/licenses/country-code-lookup-MIT.txt'));
    for (const file of ['reviewed-overrides.json', 'review-approvals.json', 'override-activation.json']) await access(join(target, 'sources', file));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
