import { observeLookup } from '../src/compatibility.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CountryRegistry } from '../src/index.ts';
import { spawnSync } from 'node:child_process';

async function changedBuild(change: (entity: any, policy: any, fixture: any) => void, args: string[] = []) {
  const dir = await mkdtemp(join(tmpdir(), 'country-build-test-'));
  try {
    await cp('sources', join(dir, 'sources'), { recursive: true });
    const manifest = JSON.parse(await readFile(join(dir, 'sources/manifest.json'), 'utf8'));
    const entry = manifest.find((m: any) => m.id === 'Q43');
    const snapshot = JSON.parse(await readFile(join(dir, entry.file), 'utf8'));
    const policy = JSON.parse(await readFile(join(dir, 'sources/policy.json'), 'utf8'));
    const fixture = JSON.parse(await readFile(join(dir, 'sources/accepted-inputs.json'), 'utf8'));
    change(snapshot.entities.Q43, policy, fixture);
    await writeFile(join(dir, 'sources/accepted-inputs.json'), JSON.stringify(fixture));
    const text = JSON.stringify(snapshot);
    entry.sha256 = createHash('sha256').update(text).digest('hex');
    await writeFile(join(dir, entry.file), text);
    await writeFile(join(dir, 'sources/manifest.json'), JSON.stringify(manifest));
    await writeFile(join(dir, 'sources/policy.json'), JSON.stringify(policy));
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/build.ts'), ...args], { cwd: dir, encoding: 'utf8' });
    return { ...result, fixture: JSON.parse(await readFile(join(dir, 'sources/accepted-inputs.json'), 'utf8')), bytes: result.status === 0 && !args.length ? await readFile(join(dir, 'data/countries.crdb')) : undefined };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('build rejects supplied temporal claims it cannot interpret', async () => {
  for (const qualifier of [
    { snaktype: 'somevalue' },
    { datavalue: { value: { time: '+1980-13-00T00:00:00Z', precision: 10, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' } } },
    { datavalue: { value: { time: '+1980-01-01T00:00:00Z', precision: 11, calendarmodel: 'julian' } } },
  ]) {
    const result = await changedBuild(e => { e.claims.P297[0].qualifiers = { P582: [qualifier] }; });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /Unsupported Wikidata time|Invalid calendar date/);
  }
  const result = await changedBuild(e => { e.claims.P576 = [{ mainsnak: { snaktype: 'somevalue' } }]; });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported Wikidata time|Invalid calendar date/);
});

test('build rejects policy aliases for entities outside its corpus', async () => {
  const result = await changedBuild((_, policy) => { policy.aliases.push({ ...policy.aliases[0], entity: 'Q999999999' }); });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown alias entity/);
});

test('a source refresh cannot silently remove an accepted spelling', async () => {
  const result = await changedBuild(e => { e.aliases.en = e.aliases.en.filter((a: any) => a.value !== 'Republic of Turkey'); });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Accepted input missing/);
});

test('accepted inputs keep their answers when a source adds a competitor or deprecates a code', async () => {
  const deprecated = await changedBuild(e => { e.claims.P297[0].rank = 'deprecated'; });
  assert.notEqual(deprecated.status, 0);
  assert.match(deprecated.stderr, /Compatibility answer changed/);
  const ambiguous = await changedBuild((e, policy) => { policy.aliases.push({ entity: 'Q213', namespace: 'name', value: 'Turkey', kind: 'local-policy' }); });
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /Compatibility answer changed|New input requires/);
});

test('new exact day qualifiers require review of the full compatibility contract', async () => {
  const result = await changedBuild(e => {
    const time = (value: string) => ({ datavalue: { value: { time: `+${value}T00:00:00Z`, precision: 11, before: 0, after: 0, timezone: 0, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' } } });
    e.claims.P297[0].qualifiers = { P580: [time('2000-05-01')], P582: [time('2010-10-10')] };
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Compatibility answer changed/);
});

test('deprecated entity facts and mismatched policy spellings stop ingestion', async () => {
  const deprecated = await changedBuild(e => { e.claims.P30[0].rank = 'deprecated'; });
  assert.notEqual(deprecated.status, 0);
  assert.match(deprecated.stderr, /Unsupported deprecated entity claim/);
  const spelling = await changedBuild(e => { e.labels.tr.value = 'Changed'; });
  assert.notEqual(spelling.status, 0);
  assert.match(spelling.stderr, /Policy spelling differs/);
});

test('every added input requires namespaced and default lookup expectations', async () => {
  const result = await changedBuild((_, policy, fixture) => {
    policy.aliases.push({ entity: 'Q213', namespace: 'name', value: 'TR', kind: 'local-policy' });
    fixture.inputs.push({ entity: 'Q213', namespace: 'name', value: 'TR' });
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing compatibility lookup/);
});


test('explicit preferred continent can exclude deprecated alternatives without bypassing compatibility', async () => {
  const result = await changedBuild(e => {
    e.claims.P30[0].rank = 'deprecated';
    e.claims.P30[1].rank = 'preferred';
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Compatibility answer changed/);
  const multiple = await changedBuild(e => { e.claims.P30.forEach((c: any) => { c.rank = 'preferred'; }); });
  assert.notEqual(multiple.status, 0);
  assert.match(multiple.stderr, /Unsupported multiple preferred continent claims/);
});


test('explicit fixture extension preserves old observations and rejects changed old answers', async () => {
  const original = JSON.parse(await readFile('sources/accepted-inputs.json', 'utf8'));
  const added = await changedBuild(e => { e.aliases.en.push({ language: 'en', value: 'A new pinned spelling' }); }, ['--extend-accepted-inputs']);
  assert.equal(added.status, 0, added.stdout + added.stderr);
  assert.deepEqual(added.fixture.inputs.slice(0, original.inputs.length), original.inputs);
  assert.deepEqual(added.fixture.lookups.slice(0, original.lookups.length), original.lookups);
  assert.equal(added.fixture.inputs.length, original.inputs.length + 1);
  assert.equal(added.fixture.lookups.length, original.lookups.length + 2);
  const changed = await changedBuild(e => { e.claims.P297[0].rank = 'deprecated'; }, ['--extend-accepted-inputs']);
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /Compatibility answer changed/);
  assert.deepEqual(changed.fixture, original);
});

test('restricted alias scope keeps required spellings while legacy policy admits all aliases', async () => {
  const result = await changedBuild((e, policy) => {
    policy.fullEnglishAliasEntities = [];
    e.aliases.en.push({ language: 'en', value: 'Incidental alias excluded' });
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Accepted input missing/);
});

test('the source audit reports unmapped and unfetched inputs without replacing runtime data', async () => {
  const dir=await mkdtemp(join(tmpdir(),'country-audit-'));
  try {
    await cp('sources',join(dir,'sources'),{recursive:true});
    const path=join(dir,'sources/slackwater-required.json');
    const inventory=JSON.parse(await readFile(path,'utf8'));
    inventory.required.push({input:'Not a country',records:1},{input:'Unfetched country',records:1,candidateEntity:'Q999999999'},{input:'Congo',records:1,candidateEntity:'Q971'});
    inventory.records+=3;
    await writeFile(path,JSON.stringify(inventory));
    const run=spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/build.ts'),'--audit-slackwater'],{cwd:dir,encoding:'utf8'});
    assert.equal(run.status,0,run.stdout+run.stderr);
    const audit=JSON.parse(await readFile(join(dir,'sources/slackwater-source-audit.json'),'utf8'));
    assert.equal(audit.summary.inputs,inventory.required.length);
    assert.equal(audit.required.find((r: any)=>r.input==='Not a country').functionalStatus,'missing-source-mapping');
    assert.equal(audit.required.find((r: any)=>r.input==='Unfetched country').functionalStatus,'missing-source-snapshot');
    assert.equal(audit.required.find((r: any)=>r.input==='Congo').functionalStatus,'ambiguous-source-name');
    assert.equal(audit.summary.verifiedInputs,0);
    const sourced = audit.required.filter((r: any) => r.functionalStatus === 'source-backed-unreviewed');
    assert.ok(sourced.length > 0);
    for (const row of sourced) {
      assert.deepEqual(row.blockers, []);
      assert.ok(row.qualityFlags.length > 0);
    }
    await assert.rejects(readFile(join(dir,'data/countries.crdb')));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('method-shaped cases cannot stand in for required default and namespaced resolve cases', async () => {
  const reader=CountryRegistry.open(await readFile('data/countries.crdb'));
  const result=await changedBuild((_, _policy, fixture)=>{
    for(const c of fixture.lookups) if(c.input==='Turkey' && c.date===undefined && c.dateTime===undefined) {
      c.operation='assignments';
      c.result=observeLookup(reader,c).result;
    }
  });
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  assert.match(result.stderr,/Missing compatibility lookup/);
});

test('the committed source audit reproduces the current snapshots and policy', async () => {
  const dir=await mkdtemp(join(tmpdir(),'country-audit-freshness-'));
  try {
    await cp('sources',join(dir,'sources'),{recursive:true});
    const run=spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/build.ts'),'--audit-slackwater'],{cwd:dir,encoding:'utf8'});
    assert.equal(run.status,0,run.stdout+run.stderr);
    assert.deepEqual(JSON.parse(await readFile(join(dir,'sources/slackwater-source-audit.json'),'utf8')),JSON.parse(await readFile('sources/slackwater-source-audit.json','utf8')));
  } finally {await rm(dir,{recursive:true,force:true});}
});
