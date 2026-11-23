import { buildCorpus, readCorpusFile } from './source.ts';
import { canonical } from './evidence.ts';
import type { SourceData } from './compile.ts';

const iso = new Set(['P297', 'P298', 'P299']);
const withoutDates = (qualifiers: any = {}) => Object.fromEntries(Object.entries(qualifiers).filter(([key]) => !['P580', 'P582'].includes(key)));
const assertion = ({ revision, qualifiers, ...request }: any) => ({ ...request, ...(qualifiers === undefined ? {} : { qualifiers: iso.has(request.property) ? withoutDates(qualifiers) : qualifiers }) });
const stableSource = (source: SourceData) => {
  const { datasetVersion, builtAt, evidenceDigest, ...metadata } = source.metadata;
  return { metadata, entities: source.entities, assignments: source.assignments.map(a => {
    if (!['iso-alpha2', 'iso-alpha3', 'iso-numeric'].includes(a.namespace)) return a;
    const { from, fromLatest, until, untilEarliest, status, ...identity } = a;
    return { ...identity, status: ['iso-code', 'historical-code'].includes(status) ? 'normal' : status };
  }) };
};

/** Date corrections may change answers, but never the source identities or local policy. */
export async function validateTemporalCorrection(corpus: string, base: string, proposed: { source: SourceData; evidenceText: string }) {
  const read = async (dir: string, file: string) => JSON.parse(await readCorpusFile(dir, file));
  const before = await buildCorpus(base);
  if (proposed.source.metadata.datasetVersion <= before.source.metadata.datasetVersion) throw new Error('Temporal corrections require an increased datasetVersion');
  if (canonical(stableSource(before.source)) !== canonical(stableSource(proposed.source))) throw new Error('Temporal correction changes protected non-temporal facts');
  for (const file of ['policy.json', 'slackwater-required.json', 'reviewed-overrides.json', 'override-activation.json', 'review-approvals.json']) {
    const old = await read(base, `sources/${file}`), next = await read(corpus, `sources/${file}`);
    if (file === 'policy.json') { delete old.datasetVersion; delete next.datasetVersion; }
    if (canonical(old) !== canonical(next)) throw new Error('Temporal correction changes local policy');
  }
  for (const file of ['accepted-inputs.json', 'accepted-methods.json']) {
    const old = await read(base, `sources/${file}`), next = await read(corpus, `sources/${file}`);
    const field = file === 'accepted-inputs.json' ? 'lookups' : 'cases';
    const query = ({ result, ...fields }: any) => canonical(fields);
    const { [field]: oldCases, ...oldRest } = old, { [field]: nextCases, ...nextRest } = next;
    if (canonical(oldRest) !== canonical(nextRest) || !Array.isArray(nextCases)) throw new Error('Temporal correction changes fixture identity');
    const queries = new Set(nextCases.map(query));
    if (queries.size !== nextCases.length || !oldCases.every((c: any) => queries.has(query(c)))) throw new Error('Temporal correction drops or changes protected queries');
  }
  const oldRequests = JSON.parse(before.evidenceText).requests, nextRequests = JSON.parse(proposed.evidenceText).requests;
  if (canonical(oldRequests.map(assertion)) !== canonical(nextRequests.map(assertion))) throw new Error('Temporal correction changes protected evidence');
  const oldManifest = await read(base, 'sources/manifest.json'), nextManifest = await read(corpus, 'sources/manifest.json');
  if (canonical(oldManifest.map((m: any) => m.id)) !== canonical(nextManifest.map((m: any) => m.id))) throw new Error('Temporal correction changes entity inventory');
  const corrections = [];
  for (const pin of nextManifest) {
    const oldPin = oldManifest.find((m: any) => m.id === pin.id);
    const oldEntity = (await read(base, oldPin.file)).entities[pin.id], nextEntity = (await read(corpus, pin.file)).entities[pin.id];
    for (const property of iso) {
      const stable = (claims: any[] = []) => claims.map(c => ({ id:c.id, mainsnak:c.mainsnak, rank:c.rank, qualifiers:withoutDates(c.qualifiers) }));
      if (canonical(stable(oldEntity.claims[property])) !== canonical(stable(nextEntity.claims[property]))) throw new Error('Temporal correction changes ISO identity or rank');
      for (const claim of nextEntity.claims[property] ?? []) {
        const old = oldEntity.claims[property].find((c: any) => c.id === claim.id);
        const dates = (c: any) => ({ P580:c.qualifiers?.P580 ?? null, P582:c.qualifiers?.P582 ?? null });
        if (canonical(dates(old)) !== canonical(dates(claim))) {
          if (nextRequests.find((r: any) => r.id === claim.id)?.review) throw new Error('Temporal correction cannot replace a local review');
          if (pin.revision <= oldPin.revision) throw new Error('Temporal correction requires a newer Wikidata revision');
          corrections.push({ qid:pin.id, statementId:claim.id, beforeRevision:oldPin.revision, revision:pin.revision, before:dates(old), after:dates(claim) });
        }
      }
    }
  }
  if (!corrections.length) throw new Error('No Wikidata ISO date correction found');
  return corrections;
}
