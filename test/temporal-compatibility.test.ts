import { test } from 'node:test';
import assert from 'node:assert/strict';
import { temporalLookupCases } from '../src/temporal-compatibility.ts';

test('month and year windows retain both edges and default numeric lookup spellings', () => {
  const assignment = { entity: 'synthetic', namespace: 'iso-numeric' as const, value: '004', status: 'iso-code', temporalReviewed: false, evidence: [] };
  const month = temporalLookupCases([{ ...assignment, from: '1980-02-01', fromLatest: '1980-02-29' }]);
  assert.deepEqual(month.map(c => [c.input, c.namespace ?? 'default', c.date]), [
    ['004', 'iso-numeric', '1980-01-31'], ['004', 'default', '1980-01-31'],
    ['004', 'iso-numeric', '1980-02-01'], ['004', 'default', '1980-02-01'],
    ['004', 'iso-numeric', '1980-02-29'], ['004', 'default', '1980-02-29'],
    ['004', 'iso-numeric', '1980-03-01'], ['004', 'default', '1980-03-01'],
  ]);
  const year = temporalLookupCases([{ ...assignment, from: '1980-01-01', fromLatest: '1980-12-31' }]);
  assert.deepEqual([...new Set(year.map(c => c.date))], ['1979-12-31', '1980-01-01', '1980-12-31', '1981-01-01']);
});


test('end windows retain their inclusive last days and exclusive following days', () => {
  const assignment = { entity:'synthetic', namespace:'iso-alpha2' as const, value:'ZZ', status:'historical-code', temporalReviewed:false, evidence:[], untilEarliest:'1980-02-02', until:'1980-03-01' };
  const cases = temporalLookupCases([assignment, assignment]);
  assert.deepEqual([...new Set(cases.map(c => c.date))], ['1980-02-01','1980-02-02','1980-02-29','1980-03-01']);
  assert.equal(cases.length,8);
});
