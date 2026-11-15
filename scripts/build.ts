import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compile, type SourceData, type SourceAssignment } from '../src/compile.ts';
import { day } from '../src/common.ts';
import type { EvidenceRequest, WikiEntity } from '../src/evidence.ts';

const manifestText = await readFile('sources/manifest.json', 'utf8');
const manifest = JSON.parse(manifestText);
const policy = JSON.parse(await readFile('sources/policy.json', 'utf8'));
const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const requests: EvidenceRequest[] = [];
const assignments: SourceAssignment[] = [];
const entities: SourceData['entities'] = [];
const allIds = new Set<string>(manifest.map((m: any) => m.id));
const continents: Record<string, string> = { Q15: 'Africa', Q46: 'Europe', Q48: 'Asia', Q49: 'North America', Q18: 'South America', Q538: 'Oceania', Q51: 'Antarctica' };

function timeBounds(value: any): { first: string; after: string } | undefined {
  if (!value || value.calendarmodel !== 'http://www.wikidata.org/entity/Q1985727' || value.before || value.after) return;
  const match = /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(value.time);
  if (!match || value.precision < 9) return;
  const [, y, m, d] = match;
  if (value.precision === 9) return { first: `${y}-01-01`, after: `${Number(y) + 1}-01-01` };
  if (value.precision === 10) {
    const next = new Date(`${y}-${m}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
    return { first: `${y}-${m}-01`, after: next.toISOString().slice(0, 10) };
  }
  const first = `${y}-${m}-${d}`; const next = new Date((day(first) + 1) * 86_400_000);
  return { first, after: next.toISOString().slice(0, 10) };
}

for (const item of manifest) {
  const raw = await readFile(item.file, 'utf8');
  if (digest(raw) !== item.sha256) throw new Error(`Snapshot digest mismatch: ${item.id}`);
  const e: WikiEntity = JSON.parse(raw).entities[item.id];
  if (e.lastrevid !== item.revision) throw new Error('Snapshot revision mismatch');
  const request = (claim: any, property: string) => {
    if (!requests.some(r => r.id === claim.id)) requests.push({ id: claim.id, qid: e.id, revision: e.lastrevid, kind: 'statement', property, statementId: claim.id, expected: claim.mainsnak.datavalue?.value, qualifiers: claim.qualifiers ?? {} });
    return claim.id;
  };
  const endClaim = e.claims.P576?.find(c => c.mainsnak.datavalue?.value?.precision === 11);
  const end = endClaim && timeBounds(endClaim.mainsnak.datavalue.value);
  const continentClaim = e.claims.P30?.[0];
  if (continentClaim) request(continentClaim, 'P30');
  if (endClaim) request(endClaim, 'P576');
  const successorClaims = (e.claims.P1366 ?? []).filter(c => allIds.has(c.mainsnak.datavalue?.value?.id));
  successorClaims.forEach(c => request(c, 'P1366'));
  entities.push({ id: e.id, name: e.labels.en.value, continent: continents[continentClaim?.mainsnak.datavalue?.value?.id], until: end?.after, successors: successorClaims.map(c => c.mainsnak.datavalue.value.id) });
  for (const [property, namespace] of [['P297', 'iso-alpha2'], ['P298', 'iso-alpha3'], ['P299', 'iso-numeric']] as const) {
    for (const c of e.claims[property] ?? []) {
      const value = c.mainsnak.datavalue?.value;
      if (typeof value !== 'string') continue;
      const start = timeBounds(c.qualifiers?.P580?.[0]?.datavalue?.value);
      const finish = timeBounds(c.qualifiers?.P582?.[0]?.datavalue?.value);
      assignments.push({ entity: e.id, namespace, value, status: c.rank === 'deprecated' ? 'deprecated-claim' : finish ? 'historical-code' : 'iso-code', from: start?.first, fromLatest: start?.after, until: finish?.after, untilEarliest: finish?.first, temporalReviewed: false, evidence: [request(c, property)] });
    }
  }
  const names = new Map<string, EvidenceRequest>();
  names.set(e.labels.en.value, { id: `${e.id}:label:en`, qid: e.id, revision: e.lastrevid, kind: 'label', language: 'en', expected: e.labels.en.value });
  for (const a of e.aliases?.en ?? []) if (!names.has(a.value)) names.set(a.value, { id: `${e.id}:alias:en:${a.value}`, qid: e.id, revision: e.lastrevid, kind: 'alias', language: 'en', expected: a.value });
  for (const [value, r] of names) { requests.push(r); assignments.push({ entity: e.id, namespace: 'name', value, status: r.kind, temporalReviewed: false, evidence: [r.id] }); }
  for (const extra of policy.aliases.filter((a: any) => a.entity === e.id)) {
    const id = `${e.id}:policy:${extra.namespace}:${extra.value}`;
    requests.push({ id, qid: e.id, revision: e.lastrevid, kind: extra.kind, language: extra.language, expected: extra.value, reason: extra.reason });
    assignments.push({ entity: e.id, namespace: extra.namespace, value: extra.value, status: extra.kind, temporalReviewed: false, evidence: [id] });
  }
}
const evidenceText = JSON.stringify({ datasetVersion: policy.datasetVersion, snapshotManifestDigest: digest(manifestText), requests }, null, 2) + '\n';
const source: SourceData = { metadata: { datasetVersion: policy.datasetVersion, formatVersion: 1, minimumReaderVersion: '0.0.1', referenceDate: policy.referenceDate, builtAt: manifest.map((m: any) => m.retrievedAt).sort().at(-1), evidenceDigest: digest(evidenceText), corpus: policy.coverage, coverageFrom: policy.coverageFrom, coverageThrough: policy.coverageThrough }, entities, assignments };
const bytes = compile(source);
await mkdir('data', { recursive: true });
await writeFile('data/countries.crdb', bytes);
await writeFile('data/evidence.json', evidenceText);
await writeFile('data/release.json', JSON.stringify({ ...source.metadata, sha256: digest(bytes) }, null, 2) + '\n');
console.log(JSON.stringify({ bytes: bytes.length, entities: entities.length, assignments: assignments.length, evidence: requests.length }));
