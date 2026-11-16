import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, rm, symlink, access } from 'node:fs/promises';
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

test('a fresh packed install prepares its reader and excludes the pending consumer inventory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-install-test-'));
  try {
    const checkout = join(dir, 'checkout'), consumer = join(dir, 'consumer');
    await mkdir(checkout);
    for (const path of ['src', 'data', 'sources', 'schema', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md', 'LICENSE', 'DATA_LICENSE.md']) await cp(path, join(checkout, path), { recursive: true });
    await symlink(resolve('node_modules'), join(checkout, 'node_modules'), 'dir');
    const packed = spawnSync('npm', ['pack', '--pack-destination', dir, '--cache', join(dir, 'cache')], { cwd: checkout, encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stdout + packed.stderr);
    const archive = (await readdir(dir)).find(name => name.endsWith('.tgz'))!;
    const target = join(consumer, 'node_modules/@openwaters/c5y-n8r'); await mkdir(target, { recursive: true });
    const unpacked = spawnSync('tar', ['-xzf', join(dir, archive), '-C', target, '--strip-components=1'], { encoding: 'utf8' });
    assert.equal(unpacked.status, 0, unpacked.stderr);
    await symlink(resolve('node_modules/flatbuffers'), join(consumer, 'node_modules/flatbuffers'), 'dir');
    const loaded = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { CountryRegistry } from '@openwaters/c5y-n8r';
      import { readFileSync } from 'node:fs';
      const db = CountryRegistry.open(readFileSync(new URL(import.meta.resolve('@openwaters/c5y-n8r/data'))));
      if (db.resolve('Turkey').preferred?.id !== 'Q43') throw new Error('Packed lookup failed');
    `], { cwd: consumer, encoding: 'utf8' });
    assert.equal(loaded.status, 0, loaded.stdout + loaded.stderr);
    await assert.rejects(access(join(target, 'sources/slackwater-required.json')));
    await assert.rejects(access(join(target, 'reports/benchmark.json')));
    await access(join(target, 'sources/licenses/country-code-lookup-MIT.txt'));
    for (const file of ['reviewed-overrides.json', 'review-approvals.json', 'override-activation.json']) await access(join(target, 'sources', file));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
