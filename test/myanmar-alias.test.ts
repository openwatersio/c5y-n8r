import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CountryRegistry } from '../src/index.ts';

test('the exact Myanmar compatibility name and original TICON ISO code identify the same country', async () => {
  const registry = CountryRegistry.open(await readFile('data/countries.crdb'));
  const named = registry.convert('Myanmar (Burma)', { from: 'name', to: 'iso-alpha2' });
  const coded = registry.convert('MMR', { from: 'iso-alpha3', to: 'iso-alpha2' });
  assert.equal(named.source.preferred?.id, 'Q836');
  assert.equal(named.source.preferred?.value, 'Myanmar (Burma)');
  assert.equal(named.source.preferred?.matchedBy, 'policy-local-policy');
  assert.deepEqual(named.source.preferred?.evidence, ['Q836:policy:name:Myanmar (Burma)']);
  assert.equal(named.target.preferred?.value, 'MM');
  assert.equal(named.target.preferred?.id, coded.target.preferred?.id);
  assert.equal(coded.target.preferred?.value, 'MM');
  assert.equal(named.target.temporalAmbiguity, coded.target.temporalAmbiguity);
  assert.equal(named.target.preferred?.tentative, coded.target.preferred?.tentative);
  assert.equal(registry.resolve('  MYANMAR (BURMA)  ', { namespace: 'name' }).preferred?.id, 'Q836');
  assert.equal(registry.resolve('Myanmar(Burma)', { namespace: 'name' }).selection, 'none');
  assert.equal(registry.resolve('Myanmar (unlisted spelling)', { namespace: 'name' }).selection, 'none');
  const dated = registry.convert('Myanmar (Burma)', { from: 'name', to: 'iso-alpha2', date: '1989-06-01' });
  assert.equal(dated.target.preferred, undefined);
  assert.ok(dated.target.candidates.some(c => c.value === 'BU'));
  assert.ok(dated.target.candidates.some(c => c.value === 'MM'));
});
