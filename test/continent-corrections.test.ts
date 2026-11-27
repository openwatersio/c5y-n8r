import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CountryRegistry } from '../src/index.ts';
import { observeLookup } from '../src/compatibility.ts';

async function prepare(change?: (entity: any, policy: any) => void, qid = 'Q5689') {
  const root = await mkdtemp(join(tmpdir(), 'temporal-correction-'));
  const base = join(root, 'base'), proposed = join(root, 'proposed');
  for (const dir of [base, proposed]) for (const name of ['sources', 'data']) await cp(name, join(dir, name), { recursive: true });
  const manifest = JSON.parse(await readFile(join(proposed, 'sources/manifest.json'), 'utf8'));
  const pin = manifest.find((p: any) => p.id === qid);
  const raw = JSON.parse(await readFile(join(proposed, pin.file), 'utf8'));
  const entity = raw.entities[qid]; entity.lastrevid++;
  entity.claims.P30 = [{ id: `${qid}$continent-correction`, rank: 'normal', mainsnak: { snaktype: 'value', property: 'P30', datatype: 'wikibase-item', datavalue: { type: 'wikibase-entityid', value: { 'entity-type': 'item', 'numeric-id': 46, id: 'Q46' } } } }];
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
  return spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/build.ts'), '--refresh-continent-lookups', '--base', base], { cwd: proposed, encoding: 'utf8' });
}
async function checker(f: {root: string; base: string; proposed: string}, options: {offline?: boolean; forgedPin?: boolean; observations?: string} = {}) {
  const preload = join(f.root, 'wikidata.mjs');
  const openCounter = join(f.root, 'reader-opens.txt');
  await writeFile(preload, `import {readFileSync,writeFileSync} from 'node:fs'; import {CountryRegistry} from ${JSON.stringify(new URL('../src/index.ts',import.meta.url).href)}; let opens=0; const original=CountryRegistry.open; CountryRegistry.open=function(...args){opens++;return original.apply(this,args)}; process.on('exit',()=>writeFileSync(${JSON.stringify(openCounter)},String(opens))); globalThis.fetch=async input=>{const u=new URL(input), id=u.pathname.split('/').pop().replace('.json','');const m=JSON.parse(readFileSync(${JSON.stringify(f.proposed)}+'/sources/manifest.json','utf8'));const p=m.find(x=>x.id===id);const data=JSON.parse(readFileSync(${JSON.stringify(f.proposed)}+'/'+p.file,'utf8'));if(${Boolean(options.forgedPin)}&&id==='Q5689')data.entities[id].descriptions.en.value='Forged pin';return new Response(JSON.stringify(data));};`);
  const output = join(f.root, 'report');
  const run = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', preload, resolve('scripts/check-evidence.ts'), '--corpus', f.proposed, '--base', f.base, '--output', output, ...(options.offline ? ['--offline'] : []), ...(options.observations ? ['--reader-results', options.observations] : [])], { encoding: 'utf8' });
  return { ...run, openCount:Number(await readFile(openCounter,'utf8')), report: JSON.parse(await readFile(join(output, 'report.json'), 'utf8')) };
}

test('an authenticated continent correction preserves queries and unrelated answers', async () => {
  const f = await prepare();
  try {
    const run = refresh(f.base, f.proposed); assert.equal(run.status, 0, run.stdout + run.stderr);
    const before = JSON.parse(await readFile(join(f.base, 'sources/accepted-inputs.json'), 'utf8'));
    const after = JSON.parse(await readFile(join(f.proposed, 'sources/accepted-inputs.json'), 'utf8'));
    const query = ({result, ...key}: any) => JSON.stringify(key);
    assert.deepEqual(after.inputs, before.inputs);
    assert.deepEqual(after.lookups.map(query), before.lookups.map(query));
    const reader = CountryRegistry.open(await readFile(join(f.proposed, 'data/countries.crdb')));
    for (const [input, namespace] of [['AX','iso-alpha2'],['ALA','iso-alpha3'],['248','iso-numeric'],['Åland','name']] as const)
      assert.equal(reader.resolve(input, {namespace}).preferred?.continent, 'Europe');
    const checked = await checker(f); assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    assert.deepEqual(checked.report.continentCorrections.map((c:any)=>[c.qid,c.before,c.after]), [['Q5689',null,'Europe']]);
    assert.equal((await checker(f, {offline:true})).status, 1);
    assert.equal((await checker(f, {forgedPin:true})).status, 1);
    const methods = JSON.parse(await readFile(join(f.base,'sources/accepted-methods.json'),'utf8'));
    const cases = [...before.lookups,...methods.cases].map(c=>observeLookup(reader,c));
    const observations = join(f.root,'observations.json');
    await writeFile(observations,JSON.stringify({schemaVersion:2,cases}));
    const verdict = await checker(f,{observations}); assert.equal(verdict.status,0,verdict.stdout+verdict.stderr);
    const wrong = cases.find((c:any)=>c.result.preferred?.id==='Q5689')!;
    (wrong.result as any).preferred.continent='Asia';
    await writeFile(observations,JSON.stringify({schemaVersion:2,cases}));
    assert.equal((await checker(f,{observations})).status,1,'forged reader continent must fail');
    after.lookups.shift();
    await writeFile(join(f.proposed,'sources/accepted-inputs.json'),JSON.stringify(after));
    assert.equal((await checker(f)).status,1,'protected query removal must fail');
  } finally {await rm(f.root,{recursive:true,force:true});}
});

test('continent refresh rejects mixed corrections and unversioned or older pins before writing', async () => {
  for (const change of [
    (e:any)=>{e.claims.P297[0].mainsnak.datavalue.value='ZZ';},
    (e:any)=>{e.claims.P297[0].rank='deprecated';},
    (e:any)=>{e.claims.P297[0].rank='preferred';},
    (e:any)=>{e.labels.en.value='Changed name';},
    (e:any)=>{e.claims.P297[0].qualifiers={P580:[{snaktype:'somevalue',property:'P580'}]};},
    (_e:any,p:any)=>{p.datasetVersion--;},
    (_e:any,p:any)=>{p.coverage+=' changed';},
    (e:any)=>{e.lastrevid-=2;},
    (e:any)=>{delete e.claims.P30;},
    (e:any)=>{e.claims.P30[0].qualifiers={P580:[{snaktype:'somevalue',property:'P580'}]};},
    (e:any)=>{e.claims.P30[0].mainsnak.datavalue.value.id='Q123456';},
  ]) {
    const f=await prepare(change);
    try {
      const fixture=await readFile(join(f.proposed,'sources/accepted-inputs.json'),'utf8');
      const binary=await readFile(join(f.proposed,'data/countries.crdb'));
      const run=refresh(f.base,f.proposed);assert.notEqual(run.status,0,run.stdout+run.stderr);
      assert.equal(await readFile(join(f.proposed,'sources/accepted-inputs.json'),'utf8'),fixture);
      assert.deepEqual(await readFile(join(f.proposed,'data/countries.crdb')),binary);
    } finally {await rm(f.root,{recursive:true,force:true});}
  }
});

test('forged expectation changes remain blocked by the trusted rebuild',async()=>{
  const f=await prepare();
  try {
    const run=refresh(f.base,f.proposed);assert.equal(run.status,0,run.stdout+run.stderr);
    const path=join(f.proposed,'sources/accepted-inputs.json');
    const fixture=JSON.parse(await readFile(path,'utf8'));
    const unrelated=fixture.lookups.find((c:any)=>c.result.preferred?.id!=='Q5689'&&c.result.preferred);
    unrelated.result.preferred.continent='Forged continent';
    await writeFile(path,JSON.stringify(fixture));
    assert.notEqual((await checker(f)).status,0);
  } finally {await rm(f.root,{recursive:true,force:true});}
});


test('a source continent withdrawal and multi-continent preferred selection can be corrected', async () => {
  const manifest=JSON.parse(await readFile('sources/manifest.json','utf8'));
  const tf=manifest.find((p:any)=>p.id==='Q129003');
  const claims=JSON.parse(await readFile(tf.file,'utf8')).entities.Q129003.claims.P30;
  for (const [qid, change, expected] of [
    ['Q843',(e:any)=>{delete e.claims.P30;},''],
    ['Q129003',(e:any)=>{e.claims.P30=structuredClone(claims);e.claims.P30[1].rank='preferred';},'Antarctica'],
  ] as const) {
    const f=await prepare(change,qid);
    try {
      const run=refresh(f.base,f.proposed);assert.equal(run.status,0,run.stdout+run.stderr);
      const reader=CountryRegistry.open(await readFile(join(f.proposed,'data/countries.crdb')));
      assert.equal(reader.resolve(qid === 'Q843' ? 'PK' : 'TF',{namespace:'iso-alpha2'}).preferred?.continent,expected);
      const checked=await checker(f);assert.equal(checked.status,0,checked.stdout+checked.stderr);
    } finally {await rm(f.root,{recursive:true,force:true});}
  }
});


test('a compound correction cannot smuggle qualified P30 edits on an unchanged continent',async()=>{
  const f=await prepare();
  try {
    const path=join(f.proposed,'sources/manifest.json');
    const manifest=JSON.parse(await readFile(path,'utf8'));
    const pin=manifest.find((p:any)=>p.id==='Q843');
    const raw=JSON.parse(await readFile(join(f.proposed,pin.file),'utf8'));
    const entity=raw.entities.Q843;entity.lastrevid++;
    entity.claims.P30[0].qualifiers={P580:[{snaktype:'somevalue',property:'P580'}]};
    pin.revision=entity.lastrevid;pin.file=`sources/wikidata/Q843-${pin.revision}.json`;
    pin.permanentLink=`https://www.wikidata.org/w/index.php?title=Q843&oldid=${pin.revision}`;
    const text=JSON.stringify(raw);pin.sha256=createHash('sha256').update(text).digest('hex');
    await writeFile(join(f.proposed,pin.file),text);
    await writeFile(path,JSON.stringify(manifest));
    const before=await readFile(join(f.proposed,'sources/accepted-inputs.json'),'utf8');
    const run=refresh(f.base,f.proposed);
    assert.notEqual(run.status,0,'an unchanged selected continent must not bypass P30 scope checks');
    assert.equal(await readFile(join(f.proposed,'sources/accepted-inputs.json'),'utf8'),before);
  } finally {await rm(f.root,{recursive:true,force:true});}
});

test('continent and date maintenance flags are mutually exclusive',async()=>{
  const run=spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/build.ts'),'--refresh-continent-lookups','--refresh-temporal-lookups','--base',resolve('.')],{encoding:'utf8'});
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/Choose one source correction mode/);
});

test('an unselected unsupported P30 cannot hide behind a supported continent',async()=>{
  const f=await prepare();
  try {
    const path=join(f.proposed,'sources/manifest.json');
    const manifest=JSON.parse(await readFile(path,'utf8'));
    const pin=manifest.find((p:any)=>p.id==='Q843');
    const raw=JSON.parse(await readFile(join(f.proposed,pin.file),'utf8'));
    const entity=raw.entities.Q843;entity.lastrevid++;
    const extra=structuredClone(entity.claims.P30[0]);extra.id='Q843$unsupported-extra';extra.rank='normal';extra.mainsnak.datavalue.value.id='Q123456';extra.mainsnak.datavalue.value['numeric-id']=123456;entity.claims.P30.push(extra);
    pin.revision=entity.lastrevid;pin.file=`sources/wikidata/Q843-${pin.revision}.json`;
    pin.permanentLink=`https://www.wikidata.org/w/index.php?title=Q843&oldid=${pin.revision}`;
    const text=JSON.stringify(raw);pin.sha256=createHash('sha256').update(text).digest('hex');
    await writeFile(join(f.proposed,pin.file),text);
    await writeFile(path,JSON.stringify(manifest));
    const before=await readFile(join(f.proposed,'sources/accepted-inputs.json'),'utf8');
    const run=refresh(f.base,f.proposed);
    assert.notEqual(run.status,0,'an unselected unsupported P30 must not bypass scope checks');
    assert.equal(await readFile(join(f.proposed,'sources/accepted-inputs.json'),'utf8'),before);
  } finally {await rm(f.root,{recursive:true,force:true});}
});


test('unchanged admitted continent alternatives survive another source correction',async()=>{
  const f=await prepare();
  try {
    const path=join(f.proposed,'sources/manifest.json');
    const manifest=JSON.parse(await readFile(path,'utf8'));
    const pin=manifest.find((p:any)=>p.id==='Q408');
    const raw=JSON.parse(await readFile(join(f.proposed,pin.file),'utf8'));
    const entity=raw.entities.Q408;entity.lastrevid++;
    const preferred=entity.claims.P30.find((c:any)=>c.rank==='preferred');preferred.mainsnak.datavalue.value.id='Q538';preferred.mainsnak.datavalue.value['numeric-id']=538;
    pin.revision=entity.lastrevid;pin.file=`sources/wikidata/Q408-${pin.revision}.json`;
    pin.permanentLink=`https://www.wikidata.org/w/index.php?title=Q408&oldid=${pin.revision}`;
    const text=JSON.stringify(raw);pin.sha256=createHash('sha256').update(text).digest('hex');
    await writeFile(join(f.proposed,pin.file),text);
    await writeFile(path,JSON.stringify(manifest));
    const run=refresh(f.base,f.proposed);
    assert.equal(run.status,0,run.stdout+run.stderr);
    const checked=await checker(f);assert.equal(checked.status,0,checked.stdout+checked.stderr);
  } finally {await rm(f.root,{recursive:true,force:true});}
});
