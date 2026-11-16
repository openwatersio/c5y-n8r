import { mkdir, writeFile } from 'node:fs/promises';
import { buildCorpus } from '../src/source.ts';

const { bytes, evidenceText, source, release } = await buildCorpus('.');
await mkdir('data', { recursive: true });
await writeFile('data/countries.crdb', bytes);
await writeFile('data/evidence.json', evidenceText);
await writeFile('data/release.json', JSON.stringify(release, null, 2) + '\n');
console.log(JSON.stringify({ bytes: bytes.length, entities: source.entities.length, assignments: source.assignments.length, evidence: JSON.parse(evidenceText).requests.length }));
