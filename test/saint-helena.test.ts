import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CountryRegistry } from '../src/index.ts';

const registry = CountryRegistry.open(await readFile('data/countries.crdb'));

test('SHN identifies the ISO-bearing territory without claiming complete temporal bounds', () => {
  for (const [input, from] of [['SH', 'iso-alpha2'], ['654', 'iso-numeric']] as const) {
    const converted = registry.convert(input, { from, to: 'iso-alpha2' });
    assert.equal(converted.source.preferred?.id, 'Q192184');
    assert.equal(converted.target.preferred?.value, 'SH');
  }
  const result = registry.convert('SHN', { from: 'iso-alpha3', to: 'iso-alpha2' });
  assert.equal(result.source.preferred?.id, 'Q192184');
  assert.equal(result.target.preferred?.id, 'Q192184');
  assert.equal(result.target.preferred?.value, 'SH');
  assert.equal(result.target.preferred?.tentative, true);
  assert.equal(result.target.temporalAmbiguity, true);
  assert.equal(registry.convert('SHN', { from: 'iso-alpha3', to: 'iso-alpha2', date: '2000-01-01' }).target.preferred, undefined);
});

test('Saint Helena island is distinct from the country-code territory', () => {
  const island = registry.convert('Saint Helena', { from: 'name', to: 'iso-alpha2' });
  assert.equal(island.source.preferred?.id, 'Q34497');
  assert.equal(island.target.preferred, undefined);
  assert.deepEqual(registry.assignments('Q34497', { namespace: 'iso-alpha2' }).candidates, []);
  const territory = registry.convert('Saint Helena, Ascension and Tristan da Cunha', { from: 'name', to: 'iso-alpha2' });
  assert.equal(territory.source.preferred?.id, 'Q192184');
  assert.equal(territory.target.preferred?.value, 'SH');
});
