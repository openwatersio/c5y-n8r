import { CONTINENTS } from './continent-values.ts';
import { buildCorpus, readCorpusFile } from './source.ts';
import { canonical } from './evidence.ts';
import { observeLookup } from './compatibility.ts';
import type { SourceData } from './compile.ts';
import type { CountryRegistry } from './index.ts';

export interface ContinentCorrection { qid: string; property: 'P30'; beforeRevision: number; revision: number; before: string | null; after: string | null }

const withoutContinent = (source: SourceData) => {
  const { datasetVersion, builtAt, evidenceDigest, ...metadata } = source.metadata;
  return { metadata, assignments: source.assignments, entities: source.entities.map(({ continent, ...entity }) => entity) };
};
const assertion = ({ revision, ...request }: any) => request;

/** A refreshed P30 may change continent answers, never identities or unrelated observations. */
export async function validateContinentCorrection(corpus: string, base: string, proposed: { source: SourceData; evidenceText: string; registry: CountryRegistry }): Promise<ContinentCorrection[]> {
  const read = async (dir: string, file: string) => JSON.parse(await readCorpusFile(dir, file));
  const before = await buildCorpus(base);
  if (proposed.source.metadata.datasetVersion <= before.source.metadata.datasetVersion) throw new Error('Continent corrections require an increased datasetVersion');
  if (canonical(withoutContinent(before.source)) !== canonical(withoutContinent(proposed.source))) throw new Error('Continent correction changes protected non-continent facts');
  for (const file of ['policy.json', 'slackwater-required.json', 'reviewed-overrides.json', 'override-activation.json', 'review-approvals.json']) {
    const old = await read(base, `sources/${file}`), next = await read(corpus, `sources/${file}`);
    if (file === 'policy.json') { delete old.datasetVersion; delete next.datasetVersion; }
    if (canonical(old) !== canonical(next)) throw new Error('Continent correction changes local policy');
  }
  const oldRequests = JSON.parse(before.evidenceText).requests, nextRequests = JSON.parse(proposed.evidenceText).requests;
  const protectedRequests = (requests: any[]) => requests.filter(r => r.property !== 'P30').map(assertion);
  if (canonical(protectedRequests(oldRequests)) !== canonical(protectedRequests(nextRequests))) throw new Error('Continent correction changes protected evidence');
  const oldManifest = await read(base, 'sources/manifest.json'), nextManifest = await read(corpus, 'sources/manifest.json');
  if (canonical(oldManifest.map((m: any) => m.id)) !== canonical(nextManifest.map((m: any) => m.id))) throw new Error('Continent correction changes entity inventory');
  const corrections: ContinentCorrection[] = [];
  for (const pin of nextManifest) {
    const oldPin = oldManifest.find((p: any) => p.id === pin.id);
    const oldEntity = (await read(base, oldPin.file)).entities[pin.id], nextEntity = (await read(corpus, pin.file)).entities[pin.id];
    for (const property of ['P297', 'P298', 'P299']) {
      const identity = (claims: any[] = []) => claims.map(({ id, mainsnak, rank, qualifiers }) => ({ id, mainsnak, rank, qualifiers: qualifiers ?? {} }));
      if (canonical(identity(oldEntity.claims[property])) !== canonical(identity(nextEntity.claims[property]))) throw new Error('Continent correction changes ISO identity, rank or qualifiers');
    }
    const old = before.source.entities.find(e => e.id === pin.id)!;
    const entity = proposed.source.entities.find(e => e.id === pin.id)!;
    if (canonical(oldEntity.claims.P30 ?? []) === canonical(nextEntity.claims.P30 ?? [])) {
      if (old.continent !== entity.continent) throw new Error('Continent correction requires changed Wikidata P30 claims');
      continue;
    }
    // Scope applies to every changed P30, even if its selected value stays the same.
    if (pin.revision <= oldPin.revision) throw new Error('Continent correction requires a newer Wikidata revision');
    const oldSelected = oldRequests.find((r: any) => r.qid === pin.id && r.property === 'P30')?.id;
    const selected = nextRequests.find((r: any) => r.qid === pin.id && r.property === 'P30')?.id;
    for (const claim of nextEntity.claims.P30 ?? []) {
      const oldClaim = (oldEntity.claims.P30 ?? []).find((old: any) => old.id === claim.id);
      const meaning = (c: any) => ({ mainsnak: c.mainsnak, rank: c.rank, qualifiers: c.qualifiers ?? {} });
      if (oldClaim && canonical(meaning(oldClaim)) === canonical(meaning(claim)) && (claim.id !== selected || selected === oldSelected)) continue;
      const snak = claim.mainsnak, value = snak?.datavalue?.value;
      if (snak?.snaktype !== 'value' || snak.property !== 'P30' || snak.datatype !== 'wikibase-item' || snak.datavalue?.type !== 'wikibase-entityid' || typeof value?.id !== 'string' || !Object.hasOwn(CONTINENTS, value.id)) throw new Error('Unsupported continent claim');
      if (canonical(claim.qualifiers ?? {}) !== canonical(oldClaim?.qualifiers ?? {})) throw new Error('Continent correction changes P30 qualifiers');
      if (Object.keys(claim.qualifiers ?? {}).some(key => key !== 'P518')) throw new Error('Unsupported qualified continent correction');
    }
    if ((nextEntity.claims.P30 ?? []).length && !entity.continent) throw new Error('Unsupported continent classification');
    if ([...oldRequests, ...nextRequests].some(r => r.qid === entity.id && r.property === 'P30' && r.review)) throw new Error('Continent correction cannot replace a local review');
    if (old.continent !== entity.continent) corrections.push({ qid: entity.id, property: 'P30', beforeRevision: oldPin.revision, revision: pin.revision, before: old.continent ?? null, after: entity.continent ?? null });
  }
  if (!corrections.length) throw new Error('No Wikidata continent correction found');
  const changed = new Set(corrections.map(c => c.qid));
  const protectedResult = (value: any): any => Array.isArray(value) ? value.map(protectedResult) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'continent' || !changed.has(value.id)).map(([key, item]) => [key, protectedResult(item)])) : value;
  for (const file of ['accepted-inputs.json', 'accepted-methods.json']) {
    const old = await read(base, `sources/${file}`), next = await read(corpus, `sources/${file}`);
    const field = file === 'accepted-inputs.json' ? 'lookups' : 'cases';
    const query = ({ result, ...fields }: any) => canonical(fields);
    const { [field]: oldCases, ...oldRest } = old, { [field]: nextCases, ...nextRest } = next;
    if (canonical(oldRest) !== canonical(nextRest) || !Array.isArray(nextCases)) throw new Error('Continent correction changes fixture identity');
    const queries = new Set(nextCases.map(query));
    if (queries.size !== nextCases.length || oldCases.length !== nextCases.length || !oldCases.every((c: any) => queries.has(query(c)))) throw new Error('Continent correction changes protected queries');
    for (const expected of oldCases) {
      const actual = observeLookup(proposed.registry, expected).result;
      if (canonical(protectedResult(actual)) !== canonical(protectedResult(expected.result))) throw new Error('Continent correction changes an unrelated lookup answer');
    }
  }
  return corrections;
}
