import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

test('refreshing identical Wikidata revisions preserves the pinned source manifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-refresh-test-'));
  try {
    await cp('sources', join(dir, 'sources'), { recursive: true });
    const before = await readFile(join(dir, 'sources/manifest.json'), 'utf8');
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', `
      import {readFileSync} from 'node:fs';
      const manifest=JSON.parse(readFileSync('sources/manifest.json','utf8'));
      globalThis.fetch=async url => {
        const id=String(url).match(/(Q[0-9]+)\\.json/)[1];
        return new Response(readFileSync(manifest.find(m=>m.id===id).file,'utf8'));
      };
      await import(${JSON.stringify(pathToFileURL(resolve('scripts/fetch-wikidata.ts')).href)});
    `], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(await readFile(join(dir, 'sources/manifest.json'), 'utf8'), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
