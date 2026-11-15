import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { join, dirname } from 'node:path';
import lookup from 'country-code-lookup';
import * as annexare from 'countries-list';
import * as synergy from 'country-codes-list';
import i18n from 'i18n-iso-countries';
import { CountryRegistry } from '../src/index.ts';
import { ByteBuffer } from 'flatbuffers';
import { Registry } from '../src/generated/country-spike.js';

const bytes = await readFile('data/countries.crdb');
const countries = CountryRegistry.open(bytes);
let sink = 0;
function measure(label: string, fn: (i: number) => unknown, batch = 1000) {
  for (let i = 0; i < 5000; i++) sink += Number(!!fn(i));
  const batches = [];
  for (let run = 0; run < 40; run++) {
    const start = performance.now();
    for (let i = 0; i < batch; i++) sink += Number(!!fn(i));
    batches.push((performance.now() - start) * 1e6 / batch);
  }
  batches.sort((a, b) => a - b);
  return { label, medianNsPerOperation: Math.round(batches[20]), p95BatchMeanNsPerOperation: Math.round(batches[38]), operations: 40 * batch };
}
const names = ['Turkey', 'Czech Republic', 'United Kingdom', 'Curaçao', 'Sint Maarten'];
const codes = ['TR', 'CZ', 'GB', 'CW', 'SX'];
const performanceResults = [
  measure('spike: alpha2, full resolver result', i => countries.resolve(codes[i % codes.length], { namespace: 'iso-alpha2' }).preferred?.id),
  measure('country-code-lookup: alpha2', i => lookup.byIso(codes[i % codes.length])?.iso2),
  measure('countries-list: alpha2', i => annexare.getCountryData(codes[i % codes.length] as any).iso2),
  measure('country-codes-list: alpha2', i => synergy.findOneByCode(codes[i % codes.length])?.countryCode),
  measure('i18n-iso-countries: alpha2 validation', i => i18n.isValid(codes[i % codes.length])),
  measure('spike: name, full resolver result', i => countries.resolve(names[i % names.length], { namespace: 'name' }).preferred?.id),
  measure('country-code-lookup: name', i => lookup.byCountry(names[i % names.length])?.iso2),
  measure('countries-list: name', i => annexare.getCountryCode(names[i % names.length])),
  measure('country-codes-list: name', i => synergy.findOne('countryNameEn', names[i % names.length])?.countryCode),
  measure('i18n-iso-countries: name', i => i18n.getAlpha2Code(names[i % names.length], 'en')),
  measure('spike: reused code with date', i => countries.resolve('CS', { namespace: 'iso-alpha2', date: i % 2 ? '1990-01-01' : '2005-01-01' }).preferred?.id),
  measure('spike: miss', () => countries.resolve('missing name').candidates.length),
  measure('spike: ambiguity', () => countries.resolve('Congo').candidates.length),
  measure('spike: open plus structural/index validation', () => CountryRegistry.open(bytes), 10),
];
const sourceDir = process.argv[2];
const compatibility: any = { scope: sourceDir ? 'Slackwater source country values; partial spike coverage, not a migration validation' : 'No Slackwater source directory supplied' };
if (sourceDir) {
  const rows: { country: string }[] = [];
  async function walk(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, e.name);
      if (e.isDirectory()) await walk(file);
      else if (e.name.endsWith('.json')) { const data = JSON.parse(await readFile(file, 'utf8')); if (typeof data.country === 'string') rows.push(data); }
    }
  }
  await walk(sourceDir);
  const counts = new Map<string, number>(); rows.forEach(r => counts.set(r.country, (counts.get(r.country) ?? 0) + 1));
  const matches = [...counts].map(([name, count]) => {
    const expected = lookup.byCountry(name)?.iso2 ?? (name === 'Cape Verde' ? 'CV' : name === 'Western Samoa' ? 'WS' : undefined);
    const result = countries.resolve(name);
    const entity = result.preferred?.id;
    const sourceCode = entity ? codesByQid(entity) : undefined;
    return { name, count, expected, entity, code: sourceCode, covered: !!entity, mismatch: !!sourceCode && sourceCode !== expected };
  });
  Object.assign(compatibility, { records: rows.length, distinctCountries: counts.size, coveredCountryValues: matches.filter(m => m.covered).length, uncoveredRecords: matches.filter(m => !m.covered).reduce((n, m) => n + m.count, 0), matches });
}
function codesByQid(qid: string) {
  const root = Registry.getRootAsRegistry(new ByteBuffer(bytes));
  for (let i = 0; i < root.assignmentsLength(); i++) {
    const a = root.assignments(i)!;
    if (a.namespace() === 'iso-alpha2' && root.entities(a.entity())!.id() === qid) return a.value()!;
  }
}
const report = { recordedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`, cpu: cpus()[0].model, bytes: bytes.length, evidenceBytes: (await readFile('data/evidence.json')).length, measured: performanceResults, compatibility, sink, limitations: ['Eleven entities in spike versus full catalogues in comparison libraries.', 'APIs do different work; i18n code measurement validates a code instead of returning a country record.', 'Some comparison names miss in some libraries; these are mixed hit/miss workload measurements.', 'Percentiles describe batch means, not individual lookup tail latency.', 'Open measurement uses warm file bytes; disk IO, first module import, retained-memory and allocation measurements are deferred.'] };
const reportFile = sourceDir ? 'reports/benchmark.json' : 'reports/local/benchmark.json';
await mkdir(dirname(reportFile), { recursive: true });
await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, compatibility: { ...compatibility, matches: undefined } }, null, 2));
