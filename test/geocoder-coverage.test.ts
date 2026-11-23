import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CountryRegistry } from '../src/index.ts';

test('every additional Slackwater geocoder code selects its pinned upstream entity', async () => {
  const inventory = JSON.parse(await readFile('sources/slackwater-required.json', 'utf8'));
  const registry = CountryRegistry.open(await readFile('data/countries.crdb'));
  const additional = inventory.required.filter((r: any) => r.consumerNamespace === 'iso-alpha2');
  assert.equal(additional.length, 28);
  for (const row of additional) {
    const result = registry.convert(row.baselineAlpha2, { from: 'iso-alpha2', to: 'iso-alpha2' });
    assert.equal(result.source.preferred?.id, row.candidateEntity, row.baselineAlpha2);
    assert.equal(result.target.preferred?.value, row.baselineAlpha2, row.input);
    assert.equal(result.target.preferred?.name, row.input);
    assert.equal(result.target.preferred?.temporalReviewed, false);
  }
  assert.equal(registry.resolve('AX', { namespace: 'iso-alpha2' }).preferred?.continent, '');
});

test('the pinned geocoder code inventory is covered independently of its labels', async () => {
  const inventory = JSON.parse(await readFile('sources/slackwater-required.json', 'utf8'));
  const registry = CountryRegistry.open(await readFile('data/countries.crdb'));
  for (const code of inventory.geocoderInventory.countryCodes) {
    const result = registry.convert(code, { from: 'iso-alpha2', to: 'iso-alpha2' });
    assert.notEqual(result.source.selection, 'ambiguous', code);
    assert.notEqual(result.target.selection, 'ambiguous', code);
    assert.equal(result.target.preferred?.value, code, code);
    for (const candidate of [result.source.preferred, result.target.preferred]) {
      assert.ok(candidate, code);
      assert.ok(!['retired', 'outside-date', 'deprecated'].includes(candidate.applicability), code);
    }
  }
  const audit = JSON.parse(await readFile('sources/slackwater-source-audit.json', 'utf8'));
  for (const row of audit.required.filter((r: any) => r.consumerNamespace)) {
    assert.equal(row.consumerNamespace, 'iso-alpha2');
    assert.equal(row.inventoryRevision, inventory.geocoderInventory.revision);
    assert.equal(row.functionalStatus, 'source-backed-unreviewed');
  }
});

test('geocoder rows and license provenance agree with the pinned upstream inventory', async () => {
  const inventory = JSON.parse(await readFile('sources/slackwater-required.json', 'utf8'));
  const licenses = JSON.parse(await readFile('sources/slackwater-licenses.json', 'utf8'));
  const pin = inventory.geocoderInventory;
  const license = licenses.additionalInventories.find((r: any) => r.provider === 'GeoNames');
  assert.equal(license.revision, pin.revision);
  assert.equal(license.sha256, pin.sha256);
  assert.equal(license.path, pin.path);
  const codes = inventory.required.filter((r: any) => r.consumerNamespace).map((r: any) => r.baselineAlpha2);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.ok(pin.countryCodes.includes(code), code);
  const registry = CountryRegistry.open(await readFile('data/countries.crdb'));
  for (const [code, entity] of [['SH', 'Q192184'], ['VI', 'Q11703']]) {
    assert.equal(registry.convert(code!, { from: 'iso-alpha2', to: 'iso-alpha2' }).source.preferred?.id, entity);
  }
  const audit = JSON.parse(await readFile('sources/slackwater-source-audit.json', 'utf8'));
  for (const row of audit.required.filter((r: any) => r.consumerNamespace)) {
    assert.ok(row.codeEvidence.length > 0);
    assert.equal(row.nameEvidence, undefined);
  }
});
