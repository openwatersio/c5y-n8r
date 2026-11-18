import { observeLookup } from '../src/compatibility.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw new Error(`Missing ${name}`); return args[i + 1]; };
const output = resolve(option('--output'));
const fixture = JSON.parse(await readFile(resolve(option('--cases')), 'utf8'));
if (!Array.isArray(fixture.lookups) || !fixture.lookups.length) throw new Error('Missing lookup cases');
const bytes = await readFile(resolve(option('--corpus'), 'data/countries.crdb'));
// This process is untrusted; only a separate job may judge its observations.
const Reader = (await import(pathToFileURL(resolve(option('--reader'))).href)).CountryRegistry;
const reader = Reader.open(bytes);
const methodFixture = JSON.parse(await readFile(resolve('sources/accepted-methods.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return '{"schemaVersion":1,"cases":[]}'; throw error; }));
if (methodFixture.schemaVersion !== 1 || !Array.isArray(methodFixture.cases)) throw new Error('Invalid method compatibility fixture');
const cases = [...fixture.lookups, ...methodFixture.cases].map((input: any) => observeLookup(reader, input));
await writeFile(output, JSON.stringify({ schemaVersion: 2, cases }, null, 2) + '\n');
