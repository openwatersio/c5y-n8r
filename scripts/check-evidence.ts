import { READER_VERSION } from '../src/common.ts';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ByteBuffer } from 'flatbuffers';
import { Registry } from '../src/generated/country-spike.js';
import { CountryRegistry, CompatibilityError } from '../src/index.ts';
import { canonical, checkEvidence, type EvidenceRequest, type WikiEntity, type Finding } from '../src/evidence.ts';
import { buildCorpus } from '../src/source.ts';

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const corpus = resolve(option('--corpus') ?? '.');
const base = option('--base');
const readerResults = option('--reader-results');
const offline = args.includes('--offline');
const reportDir = resolve(option('--output') ?? 'reports/local/evidence');
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const json = async (dir: string, file: string) => JSON.parse(await readFile(resolve(dir, file), 'utf8'));
async function approvals(dir: string): Promise<Record<string, string>> {
  return json(dir, 'sources/review-approvals.json').catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
}

async function load(dir: string) {
  const bytes = await readFile(resolve(dir, 'data/countries.crdb'));
  const registry = CountryRegistry.open(bytes);
  const text = await readFile(resolve(dir, 'data/evidence.json'), 'utf8');
  if (sha(text) !== registry.metadata().evidenceDigest) throw new Error('Evidence companion digest mismatch');
  const evidence = JSON.parse(text);
  if (evidence.datasetVersion !== registry.metadata().datasetVersion || !Array.isArray(evidence.requests)) throw new Error('Evidence release mismatch');
  const requests = evidence.requests as EvidenceRequest[];
  const byId = new Map(requests.map(r => [r.id, r]));
  if (byId.size !== requests.length) throw new Error('Duplicate evidence IDs');
  const root = Registry.getRootAsRegistry(new ByteBuffer(bytes));
  const facts: string[] = [JSON.stringify(registry.metadata())];
  for (let i = 0; i < root.assignmentsLength(); i++) {
    const a = root.assignments(i)!, qid = root.entities(a.entity())!.id()!;
    for (let j = 0; j < a.evidenceLength(); j++) {
      const request = byId.get(a.evidence(j)!);
      if (!request || request.qid !== qid || request.expected !== a.value()) throw new Error('Binary assertion has missing or mismatched evidence');
      const properties: Record<string, string> = { 'iso-alpha2': 'P297', 'iso-alpha3': 'P298', 'iso-numeric': 'P299' };
      if (properties[a.namespace()!] && (request.property !== properties[a.namespace()!] || request.kind !== 'statement')) throw new Error('Code namespace differs from evidence');
    }
    facts.push(JSON.stringify([qid, a.unpack()]));
  }
  for (let i = 0; i < root.entitiesLength(); i++) facts.push(JSON.stringify(root.entities(i)!.unpack()));
  return { requests, facts, metadata: registry.metadata(), binarySha256: sha(bytes), bytes };
}

try {
if (args.includes('--reader')) throw new Error('The verdict checker cannot load proposed reader code; supply --reader-results from an isolated job');
if (readerResults && !base) throw new Error('--reader-results requires a trusted --base');
const proposed = await load(corpus);
const approvedReviews = await approvals(base ? resolve(base) : corpus);
const hasReviews = proposed.requests.some(r => r.review);
if (hasReviews) {
  const generated = await buildCorpus(corpus, approvedReviews);
  if (!Buffer.from(generated.bytes).equals(proposed.bytes) || generated.evidenceText !== await readFile(resolve(corpus, 'data/evidence.json'), 'utf8')) throw new Error('Reviewed artifacts differ from trusted source build');
}
let requests = proposed.requests;
const preflight: Finding[] = [];
let checkedLookups = 0;
if (base) {
  const before = await load(resolve(base));
  const beforeFixture = JSON.parse(await readFile(resolve(base, 'sources/accepted-inputs.json'), 'utf8'));
  const proposedFixture = JSON.parse(await readFile(resolve(corpus, 'sources/accepted-inputs.json'), 'utf8'));
  if (canonical(beforeFixture) !== canonical(proposedFixture)) preflight.push({ id: 'compatibility-fixture', status: 'needs-review', link: '', message: 'Compatibility expectations changed; review additions, removals and changed answers against the trusted base', references: [] });
  if (readerResults) {
    const file = resolve(readerResults);
    if ((await stat(file)).size > 4 * 1024 * 1024) throw new Error('Oversized reader observations');
    const observations = JSON.parse(await readFile(file, 'utf8'));
    if (!observations || observations.schemaVersion !== 2 || Object.keys(observations).sort().join(',') !== 'cases,schemaVersion' || !Array.isArray(observations.cases)) throw new Error('Invalid reader observations');
    if (!Array.isArray(beforeFixture.lookups) || !beforeFixture.lookups.length || observations.cases.length !== beforeFixture.lookups.length) throw new Error('Missing reader observation cases');
    const key = (c: any) => canonical([c.input, c.namespace ?? null, c.date ?? null, c.dateTime ?? null]);
    const observed = new Map<string, any>();
    for (const result of observations.cases) {
      if (!result || typeof result.input !== 'string' || result.input.length > 1024 || !result.result || typeof result.result !== 'object') throw new Error('Invalid reader observation case');
      const id = key(result);
      if (observed.has(id)) throw new Error('Duplicate reader observation case');
      observed.set(id, result);
    }
    for (const expected of beforeFixture.lookups) {
      const result = observed.get(key(expected));
      if (!result) throw new Error('Missing trusted reader observation');
      checkedLookups++;
      if (canonical(result.result) !== canonical(expected.result)) {
        const finding = { id: 'reader-lookup', status: 'mismatch' as const, link: '', message: 'Observed reader result violates the trusted lookup expectation', references: [], input: expected.input, namespace: expected.namespace, date: expected.date };
        preflight.push(finding);
      }
    }
    requests = [];
  } else {
  let reviewedTransition = false;
  if (hasReviews || before.requests.some(r => r.review)) {
    const generated = await buildCorpus(corpus, approvedReviews);
    if (!Buffer.from(generated.bytes).equals(proposed.bytes) || generated.evidenceText !== await readFile(resolve(corpus, 'data/evidence.json'), 'utf8')) throw new Error('Reviewed artifacts differ from trusted source build');
    const oldPolicy = await json(resolve(base), 'sources/policy.json'), newPolicy = await json(corpus, 'sources/policy.json');
    delete oldPolicy.datasetVersion; delete newPolicy.datasetVersion;
    reviewedTransition = canonical(oldPolicy) === canonical(newPolicy) && canonical(await json(resolve(base), 'sources/manifest.json')) === canonical(await json(corpus, 'sources/manifest.json'));
  }
  const oldRequests = new Map(before.requests.map(r => [r.id, JSON.stringify(r)]));
  requests = proposed.requests.filter(r => r.review || oldRequests.get(r.id) !== JSON.stringify(r));
  const removed = before.requests.filter(r => !proposed.requests.some(n => n.id === r.id));
  for (const r of removed) preflight.push({ id: r.id, status: 'needs-review', link: `https://www.wikidata.org/wiki/${r.qid}`, message: 'Evidence or accepted meaning removed; requires explicit review', references: [] });
  if (before.binarySha256 !== proposed.binarySha256) {
    if (proposed.metadata.datasetVersion <= before.metadata.datasetVersion) preflight.push({ id: 'dataset-version', status: 'mismatch', link: '', message: 'Changed runtime artifacts require an increased datasetVersion', references: [] });
    // The spike rechecks all claims when runtime facts change so omissions cannot hide behind unchanged requests.
    if (!reviewedTransition) {
      requests = proposed.requests;
      preflight.push({ id: 'binary-diff', status: 'needs-review', link: '', message: 'Runtime facts changed; inspect entity dates, relationships, and binary-to-source interpretation before approval', references: [] });
    }
  }
  }
}
await mkdir(reportDir, { recursive: true });
const cache = new Map<string, Promise<WikiEntity>>();
async function fetchEntity(qid: string, revision?: number): Promise<WikiEntity> {
  const key = `${qid}-${revision ?? 'current'}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    if (offline) {
      const manifest = JSON.parse(await readFile(resolve(corpus, 'sources/manifest.json'), 'utf8'));
      const entry = manifest.find((m: any) => m.id === qid && (!revision || m.revision === revision));
      if (!entry || !/^sources\/wikidata\/Q[1-9][0-9]*-[0-9]+\.json$/.test(entry.file)) throw new Error('Missing cached revision');
      const raw = await readFile(resolve(corpus, entry.file), 'utf8');
      if (sha(raw) !== entry.sha256) throw new Error('Snapshot digest mismatch');
      return JSON.parse(raw).entities[qid];
    }
    const url = new URL(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    if (revision) url.searchParams.set('revision', String(revision));
    const response = await fetch(url, { headers: { 'User-Agent': `OpenWatersCountryRegistrySpike/${READER_VERSION} (https://github.com/openwatersio/c5y-n8r)` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.text();
    if (raw.length > 4 * 1024 * 1024) throw new Error('Oversized Wikidata response');
    await writeFile(resolve(reportDir, `${key}.json`), raw);
    const entity = JSON.parse(raw).entities[qid];
    if (!entity || entity.id !== qid) throw new Error('Missing Wikidata entity');
    return entity;
  })());
  return cache.get(key)!;
}
const findings = [...preflight];
for (const request of requests) findings.push(await checkEvidence(request, fetchEntity, approvedReviews));
const counts = findings.reduce<Record<string, number>>((out, f) => { out[f.status] = (out[f.status] ?? 0) + 1; return out; }, {});
const report = { datasetVersion: proposed.metadata.datasetVersion, binarySha256: proposed.binarySha256, evidenceDigest: proposed.metadata.evidenceDigest, mode: readerResults ? 'reader-compatibility' : offline ? 'pinned-snapshots-only' : 'live-pinned-and-current', checkedLookups, applicable: !!readerResults || findings.length > 0, passed: readerResults ? findings.length === 0 : !offline && findings.every(f => f.status === 'verified'), counts, findings, limitation: 'Reference passages are interpreted by maintainers. Reviewed findings require an approved exact record digest; offline checks cannot certify live upstream state. Unreviewed assertions stay non-passing.' };
await writeFile(resolve(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, findings: undefined, report: resolve(reportDir, 'report.json') }, null, 2));
process.exitCode = findings.length && !report.passed ? 1 : 0;

} catch (error) {
  const incompatible = error instanceof CompatibilityError;
  const finding = { id: incompatible ? 'reader-compatibility' : 'corpus-error', status: incompatible ? 'needs-review' : 'infrastructure-error', link: '', message: error instanceof Error ? error.message : String(error), references: [], ...(incompatible ? { metadata: error.metadata } : {}) };
  const report = { mode: readerResults ? 'reader-compatibility' : offline ? 'pinned-snapshots-only' : 'live-pinned-and-current', applicable: true, passed: false, counts: { [finding.status]: 1 }, findings: [finding] };
  await mkdir(reportDir, { recursive: true });
  await writeFile(resolve(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
