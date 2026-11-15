import { readFile } from 'node:fs/promises';
import { CountryRegistry } from '../src/index.ts';
const countries = CountryRegistry.open(await readFile('data/countries.crdb'));
console.log(countries.metadata());
for (const [input, options] of [['Turkiye', {}], ['CS', { namespace: 'iso-alpha2', date: '1990-01-01' }], ['CS', { namespace: 'iso-alpha2', date: '2005-01-01' }], ['CS', { namespace: 'iso-alpha2' }], ['AN', { namespace: 'iso-alpha2' }], ['Congo', {}], ['UK', {}]] as const) {
  const result = countries.resolve(input, options);
  console.log(JSON.stringify({ input, options, preferred: result.preferred?.id, selection: result.selection, coverage: result.coverage, evidenceStatus: result.evidenceStatus, temporalAmbiguity: result.temporalAmbiguity, candidates: result.candidates.map(c => ({ id: c.id, name: c.name, matchedBy: c.matchedBy, applicability: c.applicability, successors: c.successors })) }));
}
