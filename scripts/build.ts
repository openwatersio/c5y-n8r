import { mkdir, writeFile } from 'node:fs/promises';
import { temporalLookupCases } from '../src/temporal-compatibility.ts';
import { observeLookup } from '../src/compatibility.ts';
import { createHash } from 'node:crypto';
import { buildCorpus, readCorpusFile } from '../src/source.ts';

const refreshTemporal = process.argv.includes('--refresh-temporal-lookups');
const baseIndex = process.argv.indexOf('--base');
const temporalBase = refreshTemporal && baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined;
if (refreshTemporal && (!temporalBase || process.argv.includes('--extend-accepted-inputs') || process.argv.includes('--audit-slackwater'))) throw new Error('Temporal refresh requires --base and an exclusive maintenance mode');
const extendInputs = process.argv.includes('--extend-accepted-inputs');
if (extendInputs && process.argv.includes('--audit-slackwater')) throw new Error('Choose one source maintenance mode');
const { bytes, evidenceText, source, release, registry, accepted, addedInputs } = await buildCorpus('.', undefined, { allowNewInputs: extendInputs, temporalBase });
if (process.argv.includes('--audit-slackwater')) {
  const inventory = JSON.parse(await readCorpusFile('.', 'sources/slackwater-required.json'));
  const manifestText = await readCorpusFile('.', 'sources/manifest.json');
  const manifest = JSON.parse(manifestText);
  const required = [];
  for (const input of inventory.required) {
    const namespace = input.consumerNamespace ?? 'name';
    if (!['name', 'iso-alpha2'].includes(namespace)) throw new Error('Unsupported consumer inventory namespace');
    if (input.consumerNamespace && input.consumerPath !== inventory.geocoderInventory.path) throw new Error('Unknown geocoder inventory path');
    const value = namespace === 'iso-alpha2' ? input.baselineAlpha2 : input.input;
    const result = registry.resolve(value, { namespace });
    const candidateEntity = input.candidateEntity ?? result.preferred?.id;
    const item = manifest.find((m: any) => m.id === candidateEntity);
    const entity = item ? JSON.parse(await readCorpusFile('.', item.file)).entities[item.id] : undefined;
    const conversion = registry.convert(value, { from: namespace, to: 'iso-alpha2' });
    const currentCode = conversion.target.preferred;
    const hasCode = currentCode !== undefined && currentCode.id === candidateEntity && !['retired', 'outside-date', 'deprecated'].includes(currentCode.applicability);
    const continent = source.entities.find(e => e.id === candidateEntity)?.continent;
    const preferredContinents = (entity?.claims.P30 ?? []).filter((c: any) => c.rank === 'preferred');
    const continentSelection = preferredContinents.length ? 'preferred-source-statement' : (entity?.claims.P30?.length ?? 0) > 1 ? 'first-source-statement-unreviewed' : entity?.claims.P30?.length ? 'single-source-statement' : continent ? 'local-policy' : 'missing';
    const codeClaims = (entity?.claims.P297 ?? []).map((claim: any) => ({
      statementId: claim.id, value: claim.mainsnak.datavalue?.value, rank: claim.rank,
      references: (claim.references ?? []).map((reference: any) => ({ hash: reference.hash, snaks: reference.snaks })),
    }));
    required.push({ input: input.input, records: input.records, candidateEntity,
      ...(input.consumerNamespace ? { consumerNamespace: namespace, consumerValue: value, consumerPath: input.consumerPath, inventoryRevision: inventory.geocoderInventory.revision } : {}),
      functionalStatus: !candidateEntity ? 'missing-source-mapping' : !item ? 'missing-source-snapshot' : result.selection === 'ambiguous' ? namespace === 'name' ? 'ambiguous-source-name' : 'ambiguous-source-code' : result.preferred?.id !== candidateEntity ? namespace === 'name' ? 'missing-source-spelling' : 'missing-source-code' : hasCode ? 'source-backed-unreviewed' : 'missing-current-iso-code',
      continent, continentSelection, metadataStatus: continent ? 'source-backed-unreviewed' : 'missing-continent',
      verificationStatus: 'pending', revision: item?.revision, permanentLink: item?.permanentLink, snapshotSha256: item?.sha256,
      [namespace === 'name' ? 'nameEvidence' : 'codeEvidence']: result.candidates.filter(c => c.id === candidateEntity).flatMap(c => c.evidence), codeClaims,
      blockers: [...(!candidateEntity ? ['No source-backed candidate mapping; discover and review the entity before fetching'] : !item ? ['Mapped entity snapshot missing; run source:fetch before auditing its claims'] : []), ...(result.selection === 'ambiguous' ? [namespace === 'name' ? 'Source spelling has competing country meanings; provide reviewed context' : 'Source code has competing country meanings; provide reviewed context'] : candidateEntity && result.preferred?.id === candidateEntity ? [] : [namespace === 'name' ? 'Exact spelling absent from admitted source labels and aliases' : 'Code absent from admitted source assignments']),
        ...(hasCode ? [] : ['No unambiguous usable alpha-2 assignment for the selected entity; review geographic scope and temporal alternatives']),
        ...(continent ? [] : ['No admitted continent classification for candidate entity'])],
      qualityFlags: ['Independent evidence research is pending; it is advisory once functional source coverage is established'],
    });
  }
  const matched = required.filter(r => r.functionalStatus === 'source-backed-unreviewed');
  const report = { sourceCounts: { entities: source.entities.length, assignments: source.assignments.length, evidence: JSON.parse(evidenceText).requests.length }, inventoryRevision: inventory.revision, snapshotManifestDigest: createHash('sha256').update(manifestText).digest('hex'), verificationStatus: 'pending',
    summary: { inputs: required.length, records: inventory.records, sourceBackedInputs: matched.length,
      metadataIncompleteInputs: matched.filter(r => r.metadataStatus === 'missing-continent').length,
      sourceBackedRecords: matched.reduce((sum, r) => sum + r.records, 0), verifiedInputs: 0 }, required };
  await writeFile('sources/slackwater-source-audit.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report.summary, ...report.sourceCounts }));
  process.exit(0);
}
if (refreshTemporal) {
  accepted.lookups = accepted.lookups.map((c: any) => ({ ...c, result: observeLookup(registry, c).result }));
  const methods = JSON.parse(await readCorpusFile('.', 'sources/accepted-methods.json'));
  methods.cases = methods.cases.map((c: any) => ({ ...c, result: observeLookup(registry, c).result }));
  await writeFile('sources/accepted-methods.json', JSON.stringify(methods, null, 2) + '\n');
}
if (extendInputs || refreshTemporal) {
  for (const assignment of addedInputs) {
    accepted.inputs.push({ entity: assignment.entity, namespace: assignment.namespace, value: assignment.value });
    for (const namespace of [assignment.namespace, undefined]) {
      if (!accepted.lookups.some((lookup: any) => lookup.input === assignment.value && lookup.namespace === namespace && lookup.operation === undefined && lookup.date === undefined && lookup.dateTime === undefined)) {
        accepted.lookups.push(observeLookup(registry, { input: assignment.value, namespace }));
      }
    }
  }
  for (const lookup of temporalLookupCases(source.assignments)) {
    if (!accepted.lookups.some((existing: any) => existing.input === lookup.input && existing.namespace === lookup.namespace && existing.date === lookup.date && existing.operation === undefined && existing.dateTime === undefined)) {
      accepted.lookups.push(observeLookup(registry, lookup));
    }
  }
  await writeFile('sources/accepted-inputs.json', JSON.stringify(accepted, null, 2) + '\n');
  console.log(JSON.stringify({ addedInputs: addedInputs.length, preservedLookups: accepted.lookups.length }));
  if (!refreshTemporal) process.exit(0);
}

await mkdir('data', { recursive: true });
await writeFile('data/countries.crdb', bytes);
await writeFile('data/evidence.json', evidenceText);
await writeFile('data/release.json', JSON.stringify(release, null, 2) + '\n');
console.log(JSON.stringify({ bytes: bytes.length, entities: source.entities.length, assignments: source.assignments.length, evidence: JSON.parse(evidenceText).requests.length }));
