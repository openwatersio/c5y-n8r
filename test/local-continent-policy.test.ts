import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildCorpus } from '../src/source.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

test('continent policy emits pinned identity evidence and rejects an invalidated local rule', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'country-continent-policy-'));
  try {
    await cp('sources', join(dir, 'sources'), { recursive: true });
    const policyPath = join(dir, 'sources/policy.json');
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    const claim = (id: string, value: string, rank = 'normal') => ({ id, rank, mainsnak: { datavalue: { value: { id: value } } } });
    const identity = claim('Q51$identity', 'Q5107');
    policy.selfContinent = { entity: 'Q51', value: 'Antarctica', statementId: identity.id, instanceOf: 'Q5107', scope: 'Reference-date display' };
    await writeFile(policyPath, JSON.stringify(policy));
    await assert.rejects(buildCorpus(dir), /Unknown self-continent entity/);
    const manifestPath = join(dir, 'sources/manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const snapshot = async (id: string, name: string, claims: object) => {
      const file = `sources/wikidata/${id}-1.json`;
      const raw = JSON.stringify({ entities: { [id]: { id, lastrevid: 1, labels: { en: { value: name } }, claims } } });
      await writeFile(join(dir, file), raw);
      const index = manifest.findIndex((entry: any) => entry.id === id);
      const entry = { id, revision: 1, file, sha256: digest(raw), retrievedAt: '2026-11-15T00:00:00Z' };
      if (index < 0) manifest.push(entry); else manifest[index] = entry;
      await writeFile(manifestPath, JSON.stringify(manifest));
    };
    const build = () => buildCorpus(dir, {}, { allowNewInputs: true });
    await snapshot('Q51', 'Antarctica', { P31: [identity] });
    await snapshot('Q408', 'Australia', { P30: [claim('Q408$continent', 'Q55643')] });
    const built = await build();
    assert.equal(built.source.entities.find(e => e.id === 'Q408')?.continent, 'Oceania');
    assert.equal(built.source.entities.find(e => e.id === 'Q51')?.continent, 'Antarctica');
    const requests = JSON.parse(built.evidenceText).requests;
    assert.ok(requests.some((r: any) => r.id === identity.id && r.property === 'P31'));
    assert.ok(requests.some((r: any) => r.id === 'Q51:policy:continent:Antarctica' && r.kind === 'local-policy'));
    for (const claims of [
      { P31: [{ ...identity, rank: 'deprecated' }] },
      { P31: [identity], P30: [claim('Q51$continent', 'Q51')] },
    ]) {
      await snapshot('Q51', 'Antarctica', claims);
      await assert.rejects(build(), /Unsupported self-continent policy/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
