import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CountryRegistry } from '../src/index.ts';
import { observeLookup } from '../src/compatibility.ts';

async function prepare(change?: (entity: any, policy: any) => void, qid = 'Q843') {
  const root = await mkdtemp(join(tmpdir(), 'temporal-correction-'));
  const base = join(root, 'base'), proposed = join(root, 'proposed');
  for (const dir of [base, proposed]) for (const name of ['sources', 'data']) await cp(name, join(dir, name), { recursive: true });
  const manifest = JSON.parse(await readFile(join(proposed, 'sources/manifest.json'), 'utf8'));
  const pin = manifest.find((p: any) => p.id === qid);
  const raw = JSON.parse(await readFile(join(proposed, pin.file), 'utf8'));
  const entity = raw.entities[qid]; entity.lastrevid++;
  if (qid === 'Q843') delete entity.claims.P297.find((c: any) => c.mainsnak.datavalue?.value === 'PK').qualifiers.P580;
  const policy = JSON.parse(await readFile(join(proposed, 'sources/policy.json'), 'utf8')); policy.datasetVersion++;
  change?.(entity, policy);
  pin.revision = entity.lastrevid; pin.file = `sources/wikidata/${qid}-${pin.revision}.json`;
  pin.permanentLink = `https://www.wikidata.org/w/index.php?title=${qid}&oldid=${pin.revision}`;
  pin.retrievedAt = '2026-11-22T00:00:00.000Z';
  const text = JSON.stringify(raw); pin.sha256 = createHash('sha256').update(text).digest('hex');
  await writeFile(join(proposed, pin.file), text);
  await writeFile(join(proposed, 'sources/manifest.json'), JSON.stringify(manifest));
  await writeFile(join(proposed, 'sources/policy.json'), JSON.stringify(policy));
  return { root, base, proposed };
}
function refresh(base: string, proposed: string) {
  return spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/build.ts'), '--refresh-temporal-lookups', '--base', base], { cwd: proposed, encoding: 'utf8' });
}
async function checker(f: {root: string; base: string; proposed: string}, options: {offline?: boolean; forgedPin?: boolean; observations?: string} = {}) {
  const preload = join(f.root, 'wikidata.mjs');
  const openCounter = join(f.root, 'reader-opens.txt');
  await writeFile(preload, `import {readFileSync,writeFileSync} from 'node:fs'; import {CountryRegistry} from ${JSON.stringify(new URL('../src/index.ts',import.meta.url).href)}; let opens=0; const original=CountryRegistry.open; CountryRegistry.open=function(...args){opens++;return original.apply(this,args)}; process.on('exit',()=>writeFileSync(${JSON.stringify(openCounter)},String(opens))); globalThis.fetch=async input=>{const u=new URL(input), id=u.pathname.split('/').pop().replace('.json','');const m=JSON.parse(readFileSync(${JSON.stringify(f.proposed)}+'/sources/manifest.json','utf8'));const p=m.find(x=>x.id===id);const data=JSON.parse(readFileSync(${JSON.stringify(f.proposed)}+'/'+p.file,'utf8'));if(${Boolean(options.forgedPin)}&&id==='Q843')data.entities[id].labels.en.value='Forged pin';return new Response(JSON.stringify(data));};`);
  const output = join(f.root, 'report');
  const run = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', preload, resolve('scripts/check-evidence.ts'), '--corpus', f.proposed, '--base', f.base, '--output', output, ...(options.offline ? ['--offline'] : []), ...(options.observations ? ['--reader-results', options.observations] : [])], { encoding: 'utf8' });
  return { ...run, openCount:Number(await readFile(openCounter,'utf8')), report: JSON.parse(await readFile(join(output, 'report.json'), 'utf8')) };
}

test('a source date correction refreshes expectations without dropping protected queries', async () => {
  const f = await prepare();
  try {
    const run = refresh(f.base, f.proposed); assert.equal(run.status, 0, run.stdout + run.stderr);
    const before = JSON.parse(await readFile(join(f.base, 'sources/accepted-inputs.json'), 'utf8'));
    const after = JSON.parse(await readFile(join(f.proposed, 'sources/accepted-inputs.json'), 'utf8'));
    assert.deepEqual(after.inputs, before.inputs);
    const query = ({result, ...key}: any) => JSON.stringify(key);
    assert(before.lookups.every((c: any) => after.lookups.some((n: any) => query(c) === query(n))));
    const fixed = after.lookups.find((c: any) => c.input === 'PK' && c.namespace === 'iso-alpha2' && c.date === '2020-11-23');
    assert.equal(fixed.result.selection, 'uncertain');
    const checked = await checker(f); assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    assert.equal(checked.report.gatePassed, true);
    assert.ok(checked.report.temporalCorrections.some((c: any) => c.qid === 'Q843'));
    const fixturePath = join(f.proposed, 'sources/accepted-inputs.json');
    const saved = await readFile(fixturePath, 'utf8');
    after.lookups.shift();
    await writeFile(fixturePath, JSON.stringify(after));
    assert.equal((await checker(f)).status, 1, 'dropping a protected query must fail');
    await writeFile(fixturePath, saved);
    const offline = await checker(f, {offline:true}); assert.equal(offline.status, 1);
    const forged = await checker(f, {forgedPin:true}); assert.equal(forged.status, 1);
  } finally { await rm(f.root, {recursive:true, force:true}); }
});

test('temporal refresh rejects identity, rank, policy and unversioned changes before writing', async () => {
  for (const change of [
    (e: any) => { e.claims.P297[0].mainsnak.datavalue.value = 'ZZ'; },
    (e: any) => { e.claims.P297[0].rank = 'deprecated'; },
    (_e: any, p: any) => { p.coverage += ' changed'; },
    (_e: any, p: any) => { p.datasetVersion--; },
    (e: any) => { e.lastrevid -= 2; },
  ]) {
    const f = await prepare(change);
    try {
      const fixture = await readFile(join(f.proposed, 'sources/accepted-inputs.json'), 'utf8');
      const run = refresh(f.base, f.proposed); assert.notEqual(run.status, 0);
      assert.equal(await readFile(join(f.proposed, 'sources/accepted-inputs.json'), 'utf8'), fixture);
    } finally { await rm(f.root, {recursive:true, force:true}); }
  }
});

test('the isolated verdict derives corrected answers from trusted code and rejects forged observations', async () => {
  const f = await prepare();
  try {
    const run = refresh(f.base, f.proposed); assert.equal(run.status, 0, run.stdout + run.stderr);
    const fixture = JSON.parse(await readFile(join(f.base, 'sources/accepted-inputs.json'), 'utf8'));
    const methods = JSON.parse(await readFile(join(f.base, 'sources/accepted-methods.json'), 'utf8'));
    const reader = CountryRegistry.open(await readFile(join(f.proposed, 'data/countries.crdb')));
    const cases = [...fixture.lookups, ...methods.cases].map(c => observeLookup(reader,c));
    const path = join(f.root, 'observations.json');
    await writeFile(path, JSON.stringify({schemaVersion:2,cases}));
    const good = await checker(f, {observations:path}); assert.equal(good.status,0,good.stdout+good.stderr);
    assert.equal(good.report.checkedLookups,cases.length);
    assert(good.openCount < 20, `Verdict reopened the binary ${good.openCount} times for ${cases.length} cases`);
    assert.equal((await checker(f, {observations:path, offline:true})).status,1);
    assert.equal((await checker(f, {observations:path, forgedPin:true})).status,1);
    const fixturePath = join(f.proposed, 'sources/accepted-inputs.json');
    const fixtureText = await readFile(fixturePath, 'utf8');
    const forgedFixture = JSON.parse(fixtureText); forgedFixture.lookups[0].result = {error:{name:'Error',message:'forged'}};
    await writeFile(fixturePath, JSON.stringify(forgedFixture));
    assert.equal((await checker(f, {observations:path})).status,1, 'proposed expected results must match the trusted rebuild');
    await writeFile(fixturePath, fixtureText);
    cases[0]!.result = {error:{name:'Error',message:'forged'}} as any;
    await writeFile(path, JSON.stringify({schemaVersion:2,cases}));
    assert.equal((await checker(f, {observations:path})).status,1);
  } finally {await rm(f.root,{recursive:true,force:true});}
});


test('temporal refresh supports changed precision and end dates on existing ISO statements', async () => {
  for (const property of ['P580', 'P582']) {
    const f = await prepare(e => {
      const c = e.claims.P297.find((c: any) => c.mainsnak.datavalue?.value === 'PK');
      c.qualifiers[property] = [{snaktype:'value',property,datatype:'time',datavalue:{type:'time',value:{time:'+2020-00-00T00:00:00Z',timezone:0,before:0,after:0,precision:9,calendarmodel:'http://www.wikidata.org/entity/Q1985727'}}}];
    });
    try {
      const run = refresh(f.base, f.proposed); assert.equal(run.status,0,run.stdout+run.stderr);
      assert.equal((await checker(f)).status,0);
    } finally {await rm(f.root,{recursive:true,force:true});}
  }
});


test('a date correction cannot turn a withdrawn historical code into a deprecated claim', async () => {
  const f = await prepare(e => {
    const claim = e.claims.P297.find((c:any)=>c.rank==='deprecated'&&c.qualifiers?.P582&&c.qualifiers?.P2241?.[0]?.datavalue?.value?.id==='Q110770329');
    assert(claim,'fixture needs a withdrawn historical ISO code');
    delete claim.qualifiers.P582;
  }, 'Q33946');
  try {
    const before = await readFile(join(f.proposed,'sources/accepted-inputs.json'),'utf8');
    const run = refresh(f.base,f.proposed);
    assert.notEqual(run.status,0,run.stdout+run.stderr);
    assert.match(run.stderr,/protected non-temporal facts/);
    assert.equal(await readFile(join(f.proposed,'sources/accepted-inputs.json'),'utf8'),before);
  } finally {await rm(f.root,{recursive:true,force:true});}
});


test('bulk pinned authentication scales its deadline and checks every changed pin', async () => {
  const f = await prepare();
  try {
    const path = join(f.proposed,'sources/manifest.json');
    const manifest = JSON.parse(await readFile(path,'utf8'));
    for (const pin of manifest) pin.retrievedAt='2026-11-22T00:00:00.000Z';
    await writeFile(path,JSON.stringify(manifest));
    const run=refresh(f.base,f.proposed); assert.equal(run.status,0,run.stdout+run.stderr);
    const fixture=JSON.parse(await readFile(join(f.base,'sources/accepted-inputs.json'),'utf8'));
    const methods=JSON.parse(await readFile(join(f.base,'sources/accepted-methods.json'),'utf8'));
    const reader=CountryRegistry.open(await readFile(join(f.proposed,'data/countries.crdb')));
    const observations=join(f.root,'bulk-observations.json');
    await writeFile(observations,JSON.stringify({schemaVersion:2,cases:[...fixture.lookups,...methods.cases].map(c=>observeLookup(reader,c))}));
    const verdict=await checker(f,{observations});
    assert.equal(verdict.status,0,verdict.stdout+verdict.stderr);
    assert.equal(verdict.report.findings.filter((finding:any)=>finding.id.startsWith('provenance:')).length,manifest.length);
    assert(verdict.report.authenticationBudgetMs>90_000,'bulk pins need more than the single-batch deadline');
    assert(verdict.report.authenticationBudgetMs<=600_000,'authentication remains bounded');
  } finally {await rm(f.root,{recursive:true,force:true});}
});
