import { observeLookup } from '../src/compatibility.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CountryRegistry } from '../src/index.ts';
import { Registry } from '../src/generated/country-spike.ts';
import { ByteBuffer } from 'flatbuffers';
import { MIN_DAY } from '../src/common.ts';
import { spawnSync } from 'node:child_process';

async function changedBuild(change: (entity: any, policy: any, fixture: any) => void, args: string[] = [], entityId = 'Q43', startingFixture?: any) {
  const dir = await mkdtemp(join(tmpdir(), 'country-build-test-'));
  try {
    await cp('sources', join(dir, 'sources'), { recursive: true });
    const manifest = JSON.parse(await readFile(join(dir, 'sources/manifest.json'), 'utf8'));
    const entry = manifest.find((m: any) => m.id === entityId);
    const snapshot = JSON.parse(await readFile(join(dir, entry.file), 'utf8'));
    const policy = JSON.parse(await readFile(join(dir, 'sources/policy.json'), 'utf8'));
    const fixture = startingFixture ?? JSON.parse(await readFile(join(dir, 'sources/accepted-inputs.json'), 'utf8'));
    change(snapshot.entities[entityId], policy, fixture);
    await writeFile(join(dir, 'sources/accepted-inputs.json'), JSON.stringify(fixture));
    const text = JSON.stringify(snapshot);
    entry.sha256 = createHash('sha256').update(text).digest('hex');
    await writeFile(join(dir, entry.file), text);
    await writeFile(join(dir, 'sources/manifest.json'), JSON.stringify(manifest));
    await writeFile(join(dir, 'sources/policy.json'), JSON.stringify(policy));
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/build.ts'), ...args], { cwd: dir, encoding: 'utf8' });
    return { ...result, fixture: JSON.parse(await readFile(join(dir, 'sources/accepted-inputs.json'), 'utf8')), bytes: result.status === 0 && !args.length ? await readFile(join(dir, 'data/countries.crdb')) : undefined, evidence: result.status === 0 && !args.length ? JSON.parse(await readFile(join(dir, 'data/evidence.json'), 'utf8')) : undefined };
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
      assert.deepEqual(row.blockers, row.candidateEntity === 'Q5689' ? ['No admitted continent classification for candidate entity'] : []);
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


test('an explicitly unknown ISO start date retains temporal uncertainty', async () => {
  const result = await changedBuild(e => { e.claims.P297[0].qualifiers = { P580: [{ snaktype: 'somevalue', property: 'P580', datatype: 'time' }] }; });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.evidence.requests.find((r: any) => r.qid === 'Q43' && r.property === 'P297').qualifiers.P580, [{ snaktype: 'somevalue', property: 'P580', datatype: 'time' }]);
  const registry = CountryRegistry.open(result.bytes as Uint8Array);
  const current = registry.resolve('TR', { namespace: 'iso-alpha2' });
  assert.equal(current.preferred?.id, 'Q43');
  assert.equal(current.preferred?.applicability, 'uncertain');
  assert.equal(current.preferred?.temporalReviewed, false);
  assert.equal(current.temporalAmbiguity, true);
  const absent = await changedBuild(e => { e.claims.P297[0].qualifiers = { P580: [{ snaktype: 'novalue', property: 'P580', datatype: 'time' }] }; });
  assert.notEqual(absent.status, 0);
  assert.match(absent.stderr, /Unsupported Wikidata time/);
});


test('an unknown start does not bypass multiple qualifier rejection', async () => {
  const result = await changedBuild(e => { e.claims.P297[0].qualifiers = { P580: [{ snaktype: 'somevalue' }, { snaktype: 'somevalue' }] }; });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported Wikidata time qualifiers/);
});


test('an unknown start with a known end cannot invent a certain interval', async () => {
  const result = await changedBuild(e => { e.claims.P297[0].qualifiers = { ...e.claims.P297[0].qualifiers, P580: [{ snaktype: 'somevalue', property: 'P580', datatype: 'time' }] }; }, [], 'Q25227');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const bytes = result.bytes as Uint8Array;
  const root = Registry.getRootAsRegistry(new ByteBuffer(bytes));
  const assignment = Array.from({length: root.assignmentsLength()}, (_, i) => root.assignments(i)!).find(a => a.namespace() === 'iso-alpha2' && a.value() === 'AN')!;
  assert.equal(assignment.fromDay(), MIN_DAY);
  assert.equal(assignment.fromLatestDay(), MIN_DAY);
  const answer = CountryRegistry.open(bytes).resolve('AN', { namespace: 'iso-alpha2', date: '2005-01-01' });
  assert.equal(answer.preferred, undefined);
  assert.equal(answer.selection, 'uncertain');
});

test('unknown starts reject unsupported companion bounds and contradictory date values', async () => {
  for (const property of ['P1319', 'P1326', 'P8555', 'P8554', 'P12506']) {
    const result = await changedBuild(e => { e.claims.P297[0].qualifiers = { P580: [{ snaktype: 'somevalue' }], [property]: [{ datavalue: { value: { time: ['P8554', 'P12506'].includes(property) ? '+2010-01-01T00:00:00Z' : '+2030-01-01T00:00:00Z', precision: 11, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' } } }] }; });
    assert.notEqual(result.status, 0, property);
    assert.match(result.stderr, /Unsupported Wikidata time/);
  }
  const malformed = await changedBuild(e => { e.claims.P297[0].qualifiers = { P580: [{ snaktype: 'somevalue', datavalue: { value: { time: '+1980-01-01T00:00:00Z', precision: 11, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' } } }] }; });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /Unsupported Wikidata time/);
});


test('a newly supplied known start requires dated compatibility coverage', async () => {
  const result = await changedBuild(e => { e.claims.P297[0].qualifiers = { P580: [{ snaktype: 'value', datavalue: { value: { time: '+1995-01-01T00:00:00Z', precision: 11, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' } } }] }; }, [], 'Q17');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing dated compatibility lookup/);
});

test('extension pins new starts on existing inputs and detects loss of the date', async () => {
  const knownStart = (e: any) => { e.claims.P297[0].qualifiers = { P580: [{ snaktype: 'value', datavalue: { value: { time: '+1995-01-01T00:00:00Z', precision: 11, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' } } }] }; };
  const extended = await changedBuild(knownStart, ['--extend-accepted-inputs'], 'Q17');
  assert.equal(extended.status, 0, extended.stdout + extended.stderr);
  for (const namespace of ['iso-alpha2', undefined]) {
    for (const date of ['1994-12-31', '1995-01-01', '1995-01-02']) {
      assert(extended.fixture.lookups.some((c: any) => c.input === 'JP' && c.namespace === namespace && c.date === date), `${namespace} ${date}`);
    }
  }
  const repeated = await changedBuild(knownStart, ['--extend-accepted-inputs'], 'Q17', structuredClone(extended.fixture));
  assert.equal(repeated.status, 0, repeated.stdout + repeated.stderr);
  assert.deepEqual(repeated.fixture, extended.fixture);
  const lost = await changedBuild(e => { e.claims.P297[0].qualifiers = { P580: [{ snaktype: 'somevalue' }] }; }, [], 'Q17', structuredClone(extended.fixture));
  assert.notEqual(lost.status, 0);
  assert.match(lost.stderr, /Compatibility answer changed: JP 1994-12-31/);
});


test('malformed temporal snaks cannot hide a value behind an unknown or absent marker', async () => {
  for (const property of ['P580', 'P582', 'P576']) {
    const result = await changedBuild(e => {
      const snak = { snaktype: property === 'P580' ? 'novalue' : 'somevalue', datavalue: { value: { time: '+2099-01-01T00:00:00Z', precision: 11, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' } } };
      if (property === 'P576') e.claims.P576 = [{ mainsnak: snak }];
      else e.claims.P297[0].qualifiers = { [property]: [snak] };
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported Wikidata time/);
  }
});

test('normal builds reject a missing first-day observation for an existing precise start', async () => {
  const result = await changedBuild((_entity, _policy, fixture) => {
    fixture.lookups = fixture.lookups.filter((c: any) => !(c.input === 'BL' && c.date === '2007-09-21'));
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing dated compatibility lookup: BL/);
});


test('unsupported ISO end bounds are rejected even without an unknown start', async () => {
  for (const start of ['absent', 'known']) for (const property of ['P8554', 'P12506']) {
    const result = await changedBuild(e => {
      const time = { snaktype: 'value', datavalue: { value: { time: '+1900-01-01T00:00:00Z', precision: 11, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' } } };
      e.claims.P297[0].qualifiers = { [property]: [time], ...(start === 'known' ? { P580: [time] } : {}) };
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported Wikidata time bounds/);
  }
});
