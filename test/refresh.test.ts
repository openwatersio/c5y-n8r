import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
      let calls=0; process.argv.push('source-fetch','--refresh');
      globalThis.fetch=async url => {
        calls++;
        const id=String(url).match(/(Q[0-9]+)\\.json/)[1];
        return new Response(readFileSync(manifest.find(m=>m.id===id).file,'utf8'));
      };
      await import(${JSON.stringify(pathToFileURL(resolve('scripts/fetch-wikidata.ts')).href)});
      if(calls!==manifest.length) throw Error('Refresh did not fetch every pinned entity');
    `], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(await readFile(join(dir, 'sources/manifest.json'), 'utf8'), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('source refresh rejects corrupted pinned snapshots before any network fetch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-refresh-corrupt-test-'));
  try {
    await cp('sources', join(dir, 'sources'), { recursive: true });
    const before = await readFile(join(dir, 'sources/manifest.json'), 'utf8');
    const first = JSON.parse(before)[0];
    await writeFile(join(dir, first.file), '{}');
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/fetch-wikidata.ts')], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pinned snapshot digest mismatch/);
    assert.equal(await readFile(join(dir, 'sources/manifest.json'), 'utf8'), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a targeted refresh updates only the selected revision and preserves the old snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-target-refresh-'));
  try {
    await cp('sources', join(dir, 'sources'), { recursive: true });
    const before = JSON.parse(await readFile(join(dir, 'sources/manifest.json'), 'utf8'));
    const original = before.find((m: any) => m.id === 'Q43');
    const originalText = await readFile(join(dir, original.file), 'utf8');
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', `
      import {readFileSync} from 'node:fs';
      const manifest=JSON.parse(readFileSync('sources/manifest.json','utf8'));
      const calls=[]; process.argv.push('source-fetch','--refresh','Q43');
      globalThis.fetch=async url => {
        const id=String(url).match(/(Q[0-9]+)\\.json/)[1]; calls.push(id);
        const data=JSON.parse(readFileSync(manifest.find(m=>m.id===id).file,'utf8'));
        data.entities[id].lastrevid++; return new Response(JSON.stringify(data));
      };
      await import(${JSON.stringify(pathToFileURL(resolve('scripts/fetch-wikidata.ts')).href)});
      if(JSON.stringify(calls)!=='["Q43"]') throw Error('Refreshed an unrelated entity');
    `], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const after = JSON.parse(await readFile(join(dir, 'sources/manifest.json'), 'utf8'));
    assert.equal(after.find((m: any) => m.id === 'Q43').revision, original.revision + 1);
    assert.deepEqual(after.filter((m: any) => m.id !== 'Q43'), before.filter((m: any) => m.id !== 'Q43'));
    assert.equal(await readFile(join(dir, original.file), 'utf8'), originalText);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
