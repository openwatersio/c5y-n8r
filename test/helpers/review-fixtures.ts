import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewDigest, statementState } from '../../src/overrides.ts';

export function record(): any {
  const baseline = statementState({ id: 'Q43$test', rank: 'normal', mainsnak: { datavalue: { value: 'TR' } }, qualifiers: {}, references: [] });
  const source = (url: string) => ({ url, title: 'Geography', location: 'Section 2', passage: 'Relevant country assertion', retrieved: '2026-11-16', publicationDate: '2001-10-01' });
  return { id: 'turkey-review', qid: 'Q43', property: 'P297', statementId: 'Q43$test', revision: 12,
    baseline, baselineDigest: reviewDigest(baseline), mode: 'evidence', scope: 'Current country code',
    primary: source('https://primary.example/report'), corroborating: [source('https://fao.example/report'), source('https://journal.example/paper')],
    independence: 'Separate publications; underlying measurements may share sources.', approval: { by: 'clarkbw', date: '2026-11-16', issue: 'https://github.com/openwatersio/c5y-n8r/issues/2' },
    upstream: { status: 'blocked', reason: 'Semi-protected page' } };
}

export async function reviewedCorpus(run: (dir: string, r: any, approvals: Record<string, string>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'reviewed-corpus-'));
  try {
    await cp('sources', join(dir, 'sources'), { recursive: true });
    const manifest = JSON.parse(await readFile(join(dir, 'sources/manifest.json'), 'utf8'));
    const entry = manifest.find((e: any) => e.id === 'Q43');
    const entity = JSON.parse(await readFile(join(dir, entry.file), 'utf8')).entities.Q43;
    const r = { ...record(), property: 'P30', statementId: entity.claims.P30[0].id, revision: entry.revision, baseline: statementState(entity.claims.P30[0]) };
    r.baselineDigest = reviewDigest(r.baseline);
    const approvals = { [r.id]: reviewDigest(r) };
    await writeFile(join(dir, 'sources/reviewed-overrides.json'), JSON.stringify({ schemaVersion: 1, records: [r] }));
    await writeFile(join(dir, 'sources/review-approvals.json'), JSON.stringify(approvals));
    await writeFile(join(dir, 'sources/override-activation.json'), JSON.stringify({ active: [r.id], retired: [] }));
    const policy = JSON.parse(await readFile(join(dir, 'sources/policy.json'), 'utf8')); policy.datasetVersion++;
    await writeFile(join(dir, 'sources/policy.json'), JSON.stringify(policy));
    await run(dir, r, approvals);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

