import { observeLookup } from './compatibility.ts';
import { canonical } from './evidence.ts';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { applyReviews, selectedReviews, emptyReviews, emptyActivation, type ReviewBundle, type Activation } from './overrides.ts';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CountryRegistry } from './index.ts';
import { compile, type SourceData, type SourceAssignment } from './compile.ts';
import { day, FORMAT_VERSION } from './common.ts';
import type { EvidenceRequest, WikiEntity } from './evidence.ts';

export async function readCorpusFile(corpus: string, path: string): Promise<string> {
  const root = await realpath(corpus), file = resolve(root, path), info = await lstat(file);
  if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error(`Invalid or oversized corpus file: ${path}`);
  const location = relative(root, await realpath(file));
  if (location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)) throw new Error(`Invalid corpus file outside source directory: ${path}`);
  return readFile(file, 'utf8');
}

export async function buildCorpus(corpus: string, trustedApprovals?: Record<string, string>, options: { allowNewInputs?: boolean } = {}) {
const read = (path: string) => readCorpusFile(corpus, path);
const optional = async (path: string, fallback: unknown) => JSON.parse(await read(path).catch(error => { if (error.code === 'ENOENT') return JSON.stringify(fallback); throw error; }));
const reviews: ReviewBundle = await optional('sources/reviewed-overrides.json', emptyReviews);
const activation: Activation = await optional('sources/override-activation.json', emptyActivation);
const approvals = trustedApprovals ?? await optional('sources/review-approvals.json', {});
const selected = selectedReviews(reviews, activation, approvals);
const consumed = new Set<string>();
const manifestText = await read('sources/manifest.json');
const manifest = JSON.parse(manifestText);
const policy = JSON.parse(await read('sources/policy.json'));
const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const requiredInventory = await optional('sources/slackwater-required.json', { required: [] });
if (!Array.isArray(requiredInventory.required) || (policy.fullEnglishAliasEntities !== undefined && (!Array.isArray(policy.fullEnglishAliasEntities) || policy.fullEnglishAliasEntities.some((id: unknown) => typeof id !== 'string' || !/^Q[1-9][0-9]*$/.test(id))))) throw new Error('Invalid source alias scope or required inventory');
const requests: EvidenceRequest[] = [];
const assignments: SourceAssignment[] = [];
const entities: SourceData['entities'] = [];
const allIds = new Set<string>(manifest.map((m: any) => m.id));
const continents: Record<string, string> = { Q15: 'Africa', Q46: 'Europe', Q48: 'Asia', Q49: 'North America', Q18: 'South America', Q538: 'Oceania', Q51: 'Antarctica' };

function timeBounds(value: any): { first: string; after: string } | undefined {
  if (!value || value.calendarmodel !== 'http://www.wikidata.org/entity/Q1985727' || value.before || value.after || value.timezone) throw new Error('Unsupported Wikidata time');
  const match = /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(value.time);
  if (!match || ![9, 10, 11].includes(value.precision)) throw new Error('Unsupported Wikidata time');
  const [, y, m, d] = match;
  if (value.precision === 9) return { first: `${y}-01-01`, after: `${Number(y) + 1}-01-01` };
  if (value.precision === 10) {
    day(`${y}-${m}-01`);
    const next = new Date(`${y}-${m}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
    return { first: `${y}-${m}-01`, after: next.toISOString().slice(0, 10) };
  }
  const first = `${y}-${m}-${d}`; const next = new Date((day(first) + 1) * 86_400_000);
  return { first, after: next.toISOString().slice(0, 10) };
}

for (const alias of policy.aliases) if (!allIds.has(alias.entity)) throw new Error(`Unknown alias entity: ${alias.entity}`);
function qualifierTime(claim: any, property: string) {
  const snaks = claim.qualifiers?.[property];
  if (!snaks) return undefined;
  if (snaks.length !== 1) throw new Error('Unsupported Wikidata time qualifiers');
  return timeBounds(snaks[0]?.datavalue?.value);
}

for (const item of manifest) {
  if (!/^Q[1-9][0-9]*$/.test(item.id) || !Number.isSafeInteger(item.revision) || item.revision < 1 || item.file !== `sources/wikidata/${item.id}-${item.revision}.json`) throw new Error('Invalid snapshot manifest path or identity');
  const raw = await read(item.file);
  if (digest(raw) !== item.sha256) throw new Error(`Snapshot digest mismatch: ${item.id}`);
  const original: WikiEntity = JSON.parse(raw).entities[item.id];
  if (original.id !== item.id || original.lastrevid !== item.revision) throw new Error('Snapshot revision mismatch');
  const applied = applyReviews(original, reviews, activation, approvals), e = applied.entity;
  const request = (claim: any, property: string) => {
    const review = applied.reviews.get(claim.id);
    if (review) consumed.add(review.record.id);
    if (!requests.some(r => r.id === claim.id)) requests.push({ id: claim.id, qid: e.id, revision: e.lastrevid, kind: 'statement', property, statementId: claim.id, expected: claim.mainsnak.datavalue?.value, qualifiers: claim.qualifiers ?? {}, ...(review ? { review } : {}) });
    return claim.id;
  };
  if ((e.claims.P576?.length ?? 0) > 1) throw new Error('Unsupported Wikidata time: multiple dissolution claims');
  const preferredContinents = (e.claims.P30 ?? []).filter(c => c.rank === 'preferred');
  if (preferredContinents.length > 1) throw new Error('Unsupported multiple preferred continent claims');
  if (['P576', 'P1366'].some(property => e.claims[property]?.some(c => c.rank === 'deprecated')) ||
      (!preferredContinents.length && e.claims.P30?.some(c => c.rank === 'deprecated'))) throw new Error('Unsupported deprecated entity claim');
  const endClaim = e.claims.P576?.[0];
  const end = endClaim && timeBounds(endClaim.mainsnak.datavalue?.value);
  if (endClaim && endClaim.mainsnak.datavalue?.value?.precision !== 11) throw new Error('Unsupported Wikidata time: dissolution requires day precision');
  const continentClaim = preferredContinents[0] ?? e.claims.P30?.[0];
  if (continentClaim) request(continentClaim, 'P30');
  if (endClaim) request(endClaim, 'P576');
  const successorClaims = (e.claims.P1366 ?? []).filter(c => allIds.has(c.mainsnak.datavalue?.value?.id));
  successorClaims.forEach(c => request(c, 'P1366'));
  entities.push({ id: e.id, name: e.labels.en.value, continent: continents[continentClaim?.mainsnak.datavalue?.value?.id], until: end?.after, successors: successorClaims.map(c => c.mainsnak.datavalue.value.id) });
  for (const [property, namespace] of [['P297', 'iso-alpha2'], ['P298', 'iso-alpha3'], ['P299', 'iso-numeric']] as const) {
    for (const c of e.claims[property] ?? []) {
      const value = c.mainsnak.datavalue?.value;
      if (typeof value !== 'string') continue;
      const start = qualifierTime(c, 'P580');
      const finish = qualifierTime(c, 'P582');
      // This deprecation reason retains past values: https://www.wikidata.org/wiki/Q110770329.
      assignments.push({ entity: e.id, namespace, value, status: c.rank === 'deprecated' ? finish && c.qualifiers?.P2241?.length === 1 && c.qualifiers.P2241[0].datavalue?.value?.id === 'Q110770329' ? 'withdrawn-code' : 'deprecated-claim' : finish ? 'historical-code' : 'iso-code', from: start?.first, fromLatest: start ? new Date((day(start.after) - 1) * 86_400_000).toISOString().slice(0, 10) : undefined, until: finish?.after, untilEarliest: finish ? new Date((day(finish.first) + 1) * 86_400_000).toISOString().slice(0, 10) : undefined, temporalReviewed: false, evidence: [request(c, property)] });
    }
  }
  const names = new Map<string, EvidenceRequest>();
  names.set(e.labels.en.value, { id: `${e.id}:label:en`, qid: e.id, revision: e.lastrevid, kind: 'label', language: 'en', expected: e.labels.en.value });
  for (const a of e.aliases?.en ?? []) if (!names.has(a.value) && (policy.fullEnglishAliasEntities === undefined || policy.fullEnglishAliasEntities.includes(e.id) || requiredInventory.required.some((r: any) => r.candidateEntity === e.id && r.input === a.value))) names.set(a.value, { id: `${e.id}:alias:en:${a.value}`, qid: e.id, revision: e.lastrevid, kind: 'alias', language: 'en', expected: a.value });
  for (const [value, r] of names) { requests.push(r); assignments.push({ entity: e.id, namespace: 'name', value, status: r.kind, temporalReviewed: false, evidence: [r.id] }); }
  for (const extra of policy.aliases.filter((a: any) => a.entity === e.id)) {
    const label = e.labels[extra.language]?.value;
    const derived = extra.kind === 'ascii-label' && typeof label === 'string' ? label.normalize('NFD').replace(/\p{M}/gu, '') : label;
    if (['label', 'ascii-label'].includes(extra.kind) && derived !== extra.value) throw new Error(`Policy spelling differs from snapshot: ${extra.value}`);
    const id = `${e.id}:policy:${extra.namespace}:${extra.value}`;
    requests.push({ id, qid: e.id, revision: e.lastrevid, kind: extra.kind, language: extra.language, expected: extra.value, reason: extra.reason });
    assignments.push({ entity: e.id, namespace: extra.namespace, value: extra.value, status: `policy-${extra.kind}`, temporalReviewed: false, evidence: [id] });
  }
}
if (selected.some(r => !consumed.has(r.record.id))) throw new Error('Active review targets an unknown or unused statement');
const accepted = JSON.parse(await read('sources/accepted-inputs.json'));
if (!accepted.inputs?.length || !accepted.lookups?.length) throw new Error('Empty compatibility fixture');
for (const input of accepted.inputs) for (const namespace of [input.namespace, undefined]) {
  if (!accepted.lookups.some((lookup: any) => lookup.input === input.value && lookup.namespace === namespace && lookup.operation === undefined && lookup.date === undefined && lookup.dateTime === undefined)) throw new Error(`Missing compatibility lookup: ${input.value} ${namespace ?? 'default'}`);
}
const addedInputs = assignments.filter(assignment => !accepted.inputs.some((input: any) => input.entity === assignment.entity && input.namespace === assignment.namespace && input.value === assignment.value));
for (const assignment of assignments) if (!options.allowNewInputs && !accepted.inputs.some((input: any) => input.entity === assignment.entity && input.namespace === assignment.namespace && input.value === assignment.value)) throw new Error(`New input requires compatibility fixture: ${assignment.value}`);
for (const input of accepted.inputs) if (!assignments.some(a => a.entity === input.entity && a.namespace === input.namespace && a.value === input.value)) throw new Error(`Accepted input missing: ${input.entity} ${input.namespace} ${input.value}`);

const evidenceText = JSON.stringify({ datasetVersion: policy.datasetVersion, snapshotManifestDigest: digest(manifestText), requests }, null, 2) + '\n';
const source: SourceData = { metadata: { datasetVersion: policy.datasetVersion, formatVersion: FORMAT_VERSION, minimumReaderVersion: policy.minimumReaderVersion, referenceDate: policy.referenceDate, builtAt: manifest.map((m: any) => m.retrievedAt).sort().at(-1), evidenceDigest: digest(evidenceText), corpus: policy.coverage, coverageFrom: policy.coverageFrom, coverageThrough: policy.coverageThrough }, entities, assignments };
const bytes = compile(source);
const registry = CountryRegistry.open(bytes);
for (const expected of accepted.lookups) {
  if (canonical(observeLookup(registry, expected).result) !== canonical(expected.result)) throw new Error(`Compatibility answer changed: ${expected.input} ${expected.date ?? 'reference date'}`);
}
const methods = await optional('sources/accepted-methods.json', { schemaVersion: 1, cases: [] });
if (methods.schemaVersion !== 1 || !Array.isArray(methods.cases)) throw new Error('Invalid method compatibility fixture');
for (const expected of methods.cases) {
  if (!['convert', 'assignments'].includes(expected.operation) || typeof expected.input !== 'string' || !expected.result) throw new Error('Invalid method compatibility case');
  if (canonical(observeLookup(registry, expected).result) !== canonical(expected.result)) throw new Error(`Method compatibility answer changed: ${expected.operation} ${expected.input} ${expected.date ?? 'reference date'}`);
}
return { bytes, evidenceText, source, registry, accepted, addedInputs, release: { ...source.metadata, sha256: digest(bytes) }, reviews: selected };
}
