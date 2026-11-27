import { readCorpusBytes } from '../src/corpus-files.ts';
import { observeLookup } from '../src/compatibility.ts';
import { READER_VERSION } from '../src/common.ts';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ByteBuffer } from 'flatbuffers';
import { Registry } from '../src/generated/country-spike.js';
import { CountryRegistry, CompatibilityError } from '../src/index.ts';
import { canonical, checkEvidence, parseReviewManifest, reviewReadiness, type ReviewManifest, type EvidenceRequest, type WikiEntity, type Finding } from '../src/evidence.ts';
import { buildCorpus, readCorpusFile } from '../src/source.ts';

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const corpus = resolve(option('--corpus') ?? '.');
const base = option('--base');
const readerResults = option('--reader-results');
const offline = args.includes('--offline');
const reportDir = resolve(option('--output') ?? 'reports/local/evidence');
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const json = async (dir: string, file: string) => JSON.parse(await readCorpusFile(dir, file));
async function approvals(dir: string): Promise<Record<string, string>> {
  return json(dir, 'sources/review-approvals.json').catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
}
async function selectedActivation(dir: string): Promise<boolean> {
  const activation = await json(dir, 'sources/override-activation.json').catch(error => { if (error.code === 'ENOENT') return { active: [], retired: [] }; throw error; });
  if (!activation || !Array.isArray(activation.active) || !Array.isArray(activation.retired)) throw new Error('Invalid review activation');
  return activation.active.length > 0 || activation.retired.length > 0;
}

const caseKey = (c: any) => canonical([c.input, c.namespace ?? null, c.date ?? null, c.dateTime ?? null, c.operation ?? 'resolve', c.from ?? null, c.to ?? null]);
function preservesCases(before: any[], proposed: any[], correction = false): boolean {
  const protectedCase = (c: any) => { const {result, ...query} = c; return canonical(correction ? query : c); };
  if (!Array.isArray(before) || !Array.isArray(proposed)) return false;
  const next = new Map(proposed.map(c => [caseKey(c), protectedCase(c)]));
  return next.size === proposed.length && before.every(c => next.get(caseKey(c)) === protectedCase(c));
}
function preservesFixture(before: any, proposed: any, correction = false): boolean {
  const { inputs: oldInputs, lookups: oldLookups, ...oldRest } = before;
  const { inputs: newInputs, lookups: newLookups, ...newRest } = proposed;
  const newInputKeys = new Set(Array.isArray(newInputs) ? newInputs.map(canonical) : []);
  return canonical(oldRest) === canonical(newRest) && Array.isArray(oldInputs) && Array.isArray(newInputs) && oldInputs.every((c: any) => newInputKeys.has(canonical(c))) && preservesCases(oldLookups, newLookups, correction);
}

async function snapshotEntity(entry: { id: string; revision: number; file: string; sha256?: string }): Promise<WikiEntity> {
  if (!/^Q[1-9][0-9]*$/.test(entry.id) || !Number.isSafeInteger(entry.revision) || entry.revision < 1 || entry.file !== `sources/wikidata/${entry.id}-${entry.revision}.json`) throw new Error('Invalid snapshot manifest path or identity');
  const raw = await readCorpusFile(corpus, entry.file);
  if (sha(raw) !== entry.sha256) throw new Error('Snapshot digest mismatch');
  const entity = JSON.parse(raw).entities[entry.id];
  if (!entity || entity.id !== entry.id || entity.lastrevid !== entry.revision) throw new Error('Snapshot revision mismatch');
  return entity;
}

async function load(dir: string) {
  const bytes = await readCorpusBytes(dir, 'data/countries.crdb', 32 * 1024 * 1024);
  const registry = CountryRegistry.open(bytes);
  const text = await readCorpusFile(dir, 'data/evidence.json');
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
  return { requests, facts, metadata: registry.metadata(), binarySha256: sha(bytes), bytes, registry };
}

try {
if (args.includes('--reader')) throw new Error('The verdict checker cannot load proposed reader code; supply --reader-results from an isolated job');
if (readerResults && !base) throw new Error('--reader-results requires a trusted --base');
const proposed = await load(corpus);
const hasReviews = proposed.requests.some(r => r.review) || await selectedActivation(corpus);
if (hasReviews && !base) throw new Error('Reviewed evidence requires a trusted --base');
const approvedReviews = base ? await approvals(resolve(base)) : {};
let generated: Awaited<ReturnType<typeof buildCorpus>> | undefined;
if (hasReviews || (!base && !readerResults)) {
  generated = await buildCorpus(corpus, approvedReviews);
  if (!Buffer.from(generated.bytes).equals(proposed.bytes) || generated.evidenceText !== await readCorpusFile(corpus, 'data/evidence.json')) throw new Error('Artifacts differ from trusted source build');
}
let requests = proposed.requests;
const preflight: Finding[] = [];
let checkedLookups = 0;
let continentCorrections: Awaited<ReturnType<typeof buildCorpus>>['continentCorrections'] = [];
let temporalCorrections: Awaited<ReturnType<typeof buildCorpus>>['temporalCorrections'] = [];
let correctionRejection = '';
let unchangedArtifacts = false;
const inheritedPolicies = new Set<string>();
const approvedPolicies = new Set<string>();
const unchangedAssertions = new Set<string>();
const needsLocalApproval = (request: EvidenceRequest) => ['local-policy', 'ascii-label'].includes(request.kind) || /^(?:Q[1-9][0-9]*):policy:(?!name:)/.test(request.id);
const assertion = ({ revision, ...value }: EvidenceRequest) => canonical(value);
const provenanceSnapshots: { id: string; revision: number; file: string; sha256?: string }[] = [];
if (base) {
  const before = await load(resolve(base));
  unchangedArtifacts = before.binarySha256 === proposed.binarySha256;
  const beforeFixture = await json(resolve(base), 'sources/accepted-inputs.json');
  const proposedFixture = await json(corpus, 'sources/accepted-inputs.json');
  const methodCases = async (dir: string) => {
    const fixture = await json(dir, 'sources/accepted-methods.json').catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (fixture && (fixture.schemaVersion !== 1 || !Array.isArray(fixture.cases))) throw new Error('Invalid method compatibility fixture');
    return fixture?.cases;
  };
  const oldRequestsById = new Map(before.requests.map(r => [r.id,r]));
  const dates = (r: EvidenceRequest) => { const qualifiers = r.qualifiers as Record<string, unknown> | undefined; return canonical([qualifiers?.P580 ?? null,qualifiers?.P582 ?? null]); };
  const changedDates = proposed.requests.some(r => ['P297','P298','P299'].includes(r.property ?? '') && oldRequestsById.has(r.id) && dates(oldRequestsById.get(r.id)!) !== dates(r));
  const existingEntities = new Set(before.requests.map(r => r.qid));
  const continentRequests = (requests: EvidenceRequest[]) => requests.filter(r => r.property === 'P30' && existingEntities.has(r.qid)).map(assertion);
  const changedContinents = canonical(continentRequests(before.requests)) !== canonical(continentRequests(proposed.requests));
  if (!unchangedArtifacts && (changedDates || changedContinents) && proposed.metadata.datasetVersion > before.metadata.datasetVersion) {
    try {
      const candidate = await buildCorpus(corpus, approvedReviews, changedDates ? { temporalBase: resolve(base) } : { continentBase: resolve(base) });
      temporalCorrections = candidate.temporalCorrections;
      continentCorrections = candidate.continentCorrections;
      generated = await buildCorpus(corpus, approvedReviews);
      if (!Buffer.from(generated.bytes).equals(proposed.bytes) || generated.evidenceText !== await readCorpusFile(corpus, 'data/evidence.json')) throw new Error('Artifacts differ from trusted source build');
    } catch (error) {
      temporalCorrections = [];
      continentCorrections = [];
      correctionRejection = error instanceof Error ? error.message : String(error);
    }
  }
  const correction = temporalCorrections.length > 0 || continentCorrections.length > 0;
  const beforeMethods = await methodCases(resolve(base));
  const proposedMethods = await methodCases(corpus);
  if (beforeMethods && !preservesCases(beforeMethods, proposedMethods ?? [], correction)) preflight.push({ id: 'method-compatibility-fixture', status: 'needs-review', link: '', message: `Protected method expectations changed; source correction rejected: ${correctionRejection || 'no eligible versioned source correction'}`, references: [] });
  const expectedCases = [...beforeFixture.lookups, ...(beforeMethods ?? [])];
  if (!preservesFixture(beforeFixture, proposedFixture, correction)) preflight.push({ id: 'compatibility-fixture', status: 'needs-review', link: '', message: `Protected compatibility expectations changed or disappeared; source correction rejected: ${correctionRejection || 'no eligible versioned source correction'}`, references: [] });
  if (readerResults) {
    const file = resolve(readerResults);
    if ((await stat(file)).size > 4 * 1024 * 1024) throw new Error('Oversized reader observations');
    const observations = JSON.parse(await readFile(file, 'utf8'));
    if (!observations || observations.schemaVersion !== 2 || Object.keys(observations).sort().join(',') !== 'cases,schemaVersion' || !Array.isArray(observations.cases)) throw new Error('Invalid reader observations');
    if (!Array.isArray(beforeFixture.lookups) || !beforeFixture.lookups.length || observations.cases.length !== expectedCases.length) throw new Error('Missing reader observation cases');
    const key = (c: any) => canonical([c.input, c.namespace ?? null, c.date ?? null, c.dateTime ?? null, c.operation ?? 'resolve', c.from ?? null, c.to ?? null]);
    const observed = new Map<string, any>();
    for (const result of observations.cases) {
      if (!result || typeof result.input !== 'string' || result.input.length > 1024 || !result.result || typeof result.result !== 'object') throw new Error('Invalid reader observation case');
      const id = key(result);
      if (observed.has(id)) throw new Error('Duplicate reader observation case');
      observed.set(id, result);
    }
    for (const expected of expectedCases) {
      const result = observed.get(key(expected));
      if (!result) throw new Error('Missing trusted reader observation');
      checkedLookups++;
      if (canonical(result.result) !== canonical(correction ? observeLookup(proposed.registry, expected).result : expected.result)) {
        const finding = { id: 'reader-lookup', status: 'mismatch' as const, link: '', message: 'Observed reader result violates the trusted lookup expectation', references: [], input: expected.input, namespace: expected.namespace, date: expected.date };
        preflight.push(finding);
      }
    }
    requests = [];
  }
  if (!readerResults || !preflight.length) {
    if (!preflight.length) {
      generated ??= await buildCorpus(corpus, approvedReviews);
      if (!Buffer.from(generated.bytes).equals(proposed.bytes) || generated.evidenceText !== await readCorpusFile(corpus, 'data/evidence.json')) throw new Error('Artifacts differ from trusted source build');
    }
    const proposedApprovals = await approvals(corpus);
    if (!unchangedArtifacts && Object.keys(proposedApprovals).some(key => /^local-policy-(?:transition$|request:|withdrawal:)/.test(key) && proposedApprovals[key] !== approvedReviews[key])) {
      preflight.push({ id: 'local-policy-approval-staging', status: 'needs-review', link: '', message: 'Stage local policy approvals separately from runtime data changes', references: [] });
    }
    const usesApproval = (key: string, digest: string) => {
      if (approvedReviews[key] !== digest) return false;
      if (!Object.hasOwn(proposedApprovals, key)) return true;
      preflight.push({ id: `unconsumed-approval:${key}`, status: 'needs-review', link: '', message: 'Remove the used approval in the activation PR', references: [] });
      return false;
    };
    const oldPolicy = await json(resolve(base), 'sources/policy.json'), newPolicy = await json(corpus, 'sources/policy.json');
    for (const policy of [oldPolicy, newPolicy]) {
      delete policy.datasetVersion;
      delete policy.aliases;
    }
    if (canonical(oldPolicy) !== canonical(newPolicy)) {
      const digest = sha(canonical({ before: oldPolicy, after: newPolicy }));
      if (!usesApproval('local-policy-transition', digest)) preflight.push({ id: 'local-policy-declarations', status: 'needs-review', link: '', message: `Local policy declarations require trusted approval for transition digest ${digest}`, references: [] });
    }
    const oldManifest = await json(resolve(base), 'sources/manifest.json'), newManifest = await json(corpus, 'sources/manifest.json');
    provenanceSnapshots.push(...newManifest.filter((m: any) => canonical(oldManifest.find((o: any) => o.id === m.id)) !== canonical(m)));
    const oldRequests = new Map(before.requests.map(r => [r.id, r]));
    for (const request of proposed.requests) {
      const isLocal = /^Q[1-9][0-9]*:policy:/.test(request.id) || ['local-policy', 'ascii-label'].includes(request.kind);
      const old = oldRequests.get(request.id);
      if (readerResults && isLocal && !request.review && (!old || assertion(old) !== assertion(request))) requests.push(request);
      if (needsLocalApproval(request) && !request.review && !(old && assertion(old) === assertion(request)) && usesApproval(`local-policy-request:${request.id}`, sha(canonical(request)))) approvedPolicies.add(request.id);
      if (!old) continue;
      if (isLocal && assertion(old) === assertion(request)) inheritedPolicies.add(request.id);
      if (unchangedArtifacts && canonical(old) === canonical(request)) unchangedAssertions.add(request.id);
    }
    for (const old of before.requests) if (old.review && !proposed.requests.find(r => r.id === old.id)?.review) preflight.push({ id: `withdrawn-review:${old.id}`, status: 'needs-review', link: '', message: 'A previously approved local review was withdrawn; requires explicit trusted review', references: [] });
    const removed = before.requests.filter(r => !proposed.requests.some(n => n.id === r.id));
    for (const r of removed) {
      const approvedWithdrawal = generated && !r.review && (needsLocalApproval(r) || /^Q[1-9][0-9]*:policy:name:/.test(r.id)) && usesApproval(`local-policy-withdrawal:${r.id}`, sha(canonical(r)));
      const upstreamRemoval = generated && !r.review && !/^Q[1-9][0-9]*:policy:/.test(r.id) && ['statement', 'label', 'alias'].includes(r.kind);
      preflight.push({ id: r.id, status: 'needs-review',
        ...(approvedWithdrawal ? { blocking: false, advisories: ['approved-trusted-local-policy-withdrawal'] } : upstreamRemoval ? { blocking: false, advisories: ['upstream-assertion-removed'] } : {}),
        link: `https://www.wikidata.org/wiki/${r.qid}`, message: 'Assertion removed; protected lookup expectations and trusted rebuilding still apply', references: [] });
    }
    if (before.binarySha256 !== proposed.binarySha256) {
      if (proposed.metadata.datasetVersion <= before.metadata.datasetVersion) preflight.push({ id: 'dataset-version', status: 'mismatch', link: '', message: 'Changed runtime artifacts require an increased datasetVersion', references: [] });
    }
  }
}
if (!base && !readerResults) provenanceSnapshots.push(...await json(corpus, 'sources/manifest.json'));
await mkdir(reportDir, { recursive: true });
const cache = new Map<string, Promise<WikiEntity>>();
const authenticationBudgetMs = Math.min(600_000, Math.max(90_000, Math.ceil(provenanceSnapshots.length / 8) * 30_000 + requests.length * 60_000));
const readerDeadline = readerResults ? AbortSignal.timeout(authenticationBudgetMs) : undefined;
async function fetchEntity(qid: string, revision?: number): Promise<WikiEntity> {
  const key = `${qid}-${revision ?? 'current'}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    if (offline) {
      const manifest = await json(corpus, 'sources/manifest.json');
      const entry = manifest.find((m: any) => m.id === qid && (!revision || m.revision === revision));
      if (!entry) throw new Error('Missing cached revision');
      return snapshotEntity(entry);
    }
    const url = new URL(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    if (revision) url.searchParams.set('revision', String(revision));
    const response = await fetch(url, { headers: { 'User-Agent': `OpenWatersCountryRegistrySpike/${READER_VERSION} (https://github.com/openwatersio/c5y-n8r)` }, signal: readerDeadline ? AbortSignal.any([readerDeadline, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
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
async function reviews(dir: string): Promise<ReviewManifest> {
  try { return parseReviewManifest(await json(dir, 'sources/evidence-reviews.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, reviews: [] }; throw error; }
}
const readiness = [];
if (!readerResults) {
  const loadReviews = async (dir: string, id: string): Promise<ReviewManifest> => {
    try { return await reviews(dir); }
    catch (error) {
      readiness.push({ id, requestDigest: '', status: 'incomplete', missing: ['invalid-readiness-ledger'], message: error instanceof Error ? error.message : String(error) });
      return { schemaVersion: 1, reviews: [] };
    }
  };
  const proposedReviews = await loadReviews(corpus, 'readiness-ledger');
  const trustedReviews = base ? await loadReviews(resolve(base), 'trusted-readiness-ledger') : { schemaVersion: 1 as const, reviews: [] };
  const known = new Set(proposed.requests.map(r => r.id));
  for (const record of proposedReviews.reviews.filter(r => !known.has(r.id))) readiness.push({ id: record.id, requestDigest: record.requestDigest, status: 'incomplete', missing: ['unknown-request'] });
  for (const request of proposed.requests) {
    const record = proposedReviews.reviews.find(r => r.id === request.id);
    if (request.review && !record) continue;
    readiness.push(await reviewReadiness(request, record, trustedReviews.reviews.find(r => r.id === request.id), fetchEntity, { offline }));
  }
}
const findings = [...preflight];
async function authenticateSnapshot(snapshot: typeof provenanceSnapshots[number]) {
  const results: Finding[] = [];
  try {
    const expected = await snapshotEntity(snapshot);
    const actual = await fetchEntity(snapshot.id, snapshot.revision);
    const matches = actual.id === snapshot.id && actual.lastrevid === snapshot.revision && canonical(actual) === canonical(expected);
    results.push({ id: `provenance:${snapshot.id}`, status: offline ? 'needs-review' : matches ? 'source-match' : 'mismatch', blocking: !matches || offline, link: `https://www.wikidata.org/w/index.php?title=${snapshot.id}&oldid=${snapshot.revision}`, message: offline ? 'Offline snapshots cannot authenticate a refreshed upstream revision' : matches ? 'Refreshed snapshot matches the live pinned revision; this authenticates provenance, not independent accuracy' : 'Refreshed snapshot differs from its live pinned revision', references: [] });
  } catch (error) { results.push({ id: `provenance:${snapshot.id}`, status: 'infrastructure-error', link: '', message: String(error), references: [] }); }
  return results;
}
for (let i = 0; i < provenanceSnapshots.length; i += 8) {
  const batch = await Promise.all(provenanceSnapshots.slice(i, i + 8).map(authenticateSnapshot));
  findings.push(...batch.flat());
}

for (const request of requests) {
  const finding = await checkEvidence(request, fetchEntity, approvedReviews);
  if (generated && inheritedPolicies.has(request.id) && finding.status === 'needs-review') { finding.blocking = false; finding.advisories = ['inherited-trusted-local-policy']; }
  if (generated && approvedPolicies.has(request.id) && finding.status === 'needs-review') { finding.blocking = false; finding.advisories = ['approved-trusted-local-policy']; }
  if (unchangedAssertions.has(request.id) && finding.status === 'infrastructure-error' && finding.advisories?.includes('pinned-source-unavailable')) { finding.blocking = false; finding.advisories.push('unchanged-trusted-assertion'); }
  if (unchangedArtifacts && request.review && (finding.status === 'needs-review' || (finding.status === 'infrastructure-error' && finding.advisories?.includes('review-current-source-unavailable')))) finding.blocking = false;
  findings.push(finding);
}
const counts = findings.reduce<Record<string, number>>((out, f) => { out[f.status] = (out[f.status] ?? 0) + 1; return out; }, {});
const acceptable = findings.filter(f => f.blocking !== false).every(f => f.status === 'verified' || f.status === 'source-match');
const gatePassed = readerResults ? acceptable && (!(temporalCorrections.length || continentCorrections.length) || !offline) : !offline && acceptable;
const report = { gatePassed, authenticationBudgetMs: readerResults ? authenticationBudgetMs : undefined, temporalCorrections, continentCorrections, datasetVersion: proposed.metadata.datasetVersion, binarySha256: proposed.binarySha256, evidenceDigest: proposed.metadata.evidenceDigest, mode: readerResults ? 'reader-compatibility' : offline ? 'pinned-snapshots-only' : 'live-pinned-and-current', checkedLookups, applicable: !!readerResults || findings.length > 0, passed: readerResults ? gatePassed : !offline && findings.every(f => f.status === 'verified'), counts, findings, readiness, limitation: 'Reference passages are interpreted by maintainers. Wikidata source matches are accepted for ingestion, not independent certification. Approved local overrides retain exact record digest controls. Quality findings and current upstream drift are advisory after pinned authentication; offline checks cannot authenticate live upstream state.' };
await writeFile(resolve(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, findings: undefined, readiness: undefined, reviewReadinessCounts: readiness.reduce<Record<string, number>>((counts, item) => { counts[item.status] = (counts[item.status] ?? 0) + 1; return counts; }, {}), report: resolve(reportDir, 'report.json') }, null, 2));
process.exitCode = findings.length && !gatePassed ? 1 : 0;

} catch (error) {
  const incompatible = error instanceof CompatibilityError;
  const finding = { id: incompatible ? 'reader-compatibility' : 'corpus-error', status: incompatible ? 'needs-review' : 'infrastructure-error', link: '', message: error instanceof Error ? error.message : String(error), references: [], ...(incompatible ? { metadata: error.metadata } : {}) };
  const report = { mode: readerResults ? 'reader-compatibility' : offline ? 'pinned-snapshots-only' : 'live-pinned-and-current', applicable: true, passed: false, counts: { [finding.status]: 1 }, findings: [finding] };
  await mkdir(reportDir, { recursive: true });
  await writeFile(resolve(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
