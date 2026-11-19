import { mkdir, writeFile } from 'node:fs/promises';
import { observeLookup } from '../src/compatibility.ts';
import { createHash } from 'node:crypto';
import { buildCorpus, readCorpusFile } from '../src/source.ts';

const extendInputs = process.argv.includes('--extend-accepted-inputs');
if (extendInputs && process.argv.includes('--audit-slackwater')) throw new Error('Choose one source maintenance mode');
const { bytes, evidenceText, source, release, registry, accepted, addedInputs } = await buildCorpus('.', undefined, { allowNewInputs: extendInputs });
if (process.argv.includes('--audit-slackwater')) {
  const inventory = JSON.parse(await readCorpusFile('.', 'sources/slackwater-required.json'));
  const manifestText = await readCorpusFile('.', 'sources/manifest.json');
  const manifest = JSON.parse(manifestText);
  const required = [];
  for (const input of inventory.required) {
    const result = registry.resolve(input.input, { namespace: 'name' });
    const candidateEntity = input.candidateEntity ?? result.preferred?.id;
    const item = manifest.find((m: any) => m.id === candidateEntity);
    const entity = item ? JSON.parse(await readCorpusFile('.', item.file)).entities[item.id] : undefined;
    const conversion = registry.convert(input.input, { from: 'name', to: 'iso-alpha2' });
    const currentCode = conversion.target.preferred;
    const hasCode = currentCode !== undefined && currentCode.id === candidateEntity && !['retired', 'outside-date', 'deprecated'].includes(currentCode.applicability);
    const codeClaims = (entity?.claims.P297 ?? []).map((claim: any) => ({
      statementId: claim.id, value: claim.mainsnak.datavalue?.value, rank: claim.rank,
      references: (claim.references ?? []).map((reference: any) => ({ hash: reference.hash, snaks: reference.snaks })),
    }));
    required.push({ input: input.input, records: input.records, candidateEntity,
      functionalStatus: !candidateEntity ? 'missing-source-mapping' : !item ? 'missing-source-snapshot' : result.selection === 'ambiguous' ? 'ambiguous-source-name' : result.preferred?.id !== candidateEntity ? 'missing-source-spelling' : hasCode ? 'source-backed-unreviewed' : 'missing-current-iso-code',
      verificationStatus: 'pending', revision: item?.revision, permanentLink: item?.permanentLink, snapshotSha256: item?.sha256,
      nameEvidence: result.candidates.filter(c => c.id === candidateEntity).flatMap(c => c.evidence), codeClaims,
      blockers: [...(!candidateEntity ? ['No source-backed candidate mapping; discover and review the entity before fetching'] : !item ? ['Mapped entity snapshot missing; run source:fetch before auditing its claims'] : []), ...(result.selection === 'ambiguous' ? ['Source spelling has competing country meanings; provide reviewed context'] : candidateEntity && result.preferred?.id === candidateEntity ? [] : ['Exact spelling absent from admitted source labels and aliases']),
        ...(hasCode ? [] : ['No unambiguous usable alpha-2 assignment for the selected entity; review geographic scope and temporal alternatives'])],
      qualityFlags: ['Independent evidence research is pending; it is advisory once functional source coverage is established'],
    });
  }
  const matched = required.filter(r => r.functionalStatus === 'source-backed-unreviewed');
  const report = { sourceCounts: { entities: source.entities.length, assignments: source.assignments.length, evidence: JSON.parse(evidenceText).requests.length }, inventoryRevision: inventory.revision, snapshotManifestDigest: createHash('sha256').update(manifestText).digest('hex'), verificationStatus: 'pending',
    summary: { inputs: required.length, records: inventory.records, sourceBackedInputs: matched.length,
      sourceBackedRecords: matched.reduce((sum, r) => sum + r.records, 0), verifiedInputs: 0 }, required };
  await writeFile('sources/slackwater-source-audit.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report.summary, ...report.sourceCounts }));
  process.exit(0);
}
if (extendInputs) {
  for (const assignment of addedInputs) {
    accepted.inputs.push({ entity: assignment.entity, namespace: assignment.namespace, value: assignment.value });
    for (const namespace of [assignment.namespace, undefined]) {
      if (!accepted.lookups.some((lookup: any) => lookup.input === assignment.value && lookup.namespace === namespace && lookup.operation === undefined && lookup.date === undefined && lookup.dateTime === undefined)) {
        accepted.lookups.push(observeLookup(registry, { input: assignment.value, namespace }));
      }
    }
  }
  await writeFile('sources/accepted-inputs.json', JSON.stringify(accepted, null, 2) + '\n');
  console.log(JSON.stringify({ addedInputs: addedInputs.length, preservedLookups: accepted.lookups.length }));
  process.exit(0);
}

await mkdir('data', { recursive: true });
await writeFile('data/countries.crdb', bytes);
await writeFile('data/evidence.json', evidenceText);
await writeFile('data/release.json', JSON.stringify(release, null, 2) + '\n');
console.log(JSON.stringify({ bytes: bytes.length, entities: source.entities.length, assignments: source.assignments.length, evidence: JSON.parse(evidenceText).requests.length }));
