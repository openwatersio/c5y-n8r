export interface EvidenceRequest {
  id: string; qid: string; revision: number;
  kind: 'statement' | 'label' | 'alias' | 'ascii-label' | 'local-policy';
  expected: unknown; property?: string; statementId?: string; language?: string;
  qualifiers?: unknown; reason?: string;
}
export interface Finding {
  id: string; status: 'verified' | 'source-match' | 'needs-review' | 'mismatch' | 'infrastructure-error';
  link: string; message: string; references: string[];
}
export type WikiEntity = { id: string; lastrevid: number; labels: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]>; claims: Record<string, any[]> };
export type FetchEntity = (qid: string, revision?: number) => Promise<WikiEntity>;

export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function claimValue(claim: any) { return claim?.mainsnak?.datavalue?.value; }

export async function checkEvidence(request: EvidenceRequest, fetchEntity: FetchEntity): Promise<Finding> {
  const link = `https://www.wikidata.org/w/index.php?title=${request.qid}&oldid=${request.revision}`;
  const finding = (status: Finding['status'], message: string, references: string[] = []): Finding => ({ id: request.id, status, link, message, references });
  try {
    if (!/^Q[1-9][0-9]*$/.test(request.qid) || !Number.isSafeInteger(request.revision) || request.revision < 1 || !['statement', 'label', 'alias', 'ascii-label', 'local-policy'].includes(request.kind)) return finding('mismatch', 'Invalid evidence identity or kind');
    if (request.kind === 'local-policy') return finding('needs-review', request.reason || 'Local alias policy needs independent evidence');
    const pinned = await fetchEntity(request.qid, request.revision);
    if (pinned.id !== request.qid || pinned.lastrevid !== request.revision) return finding('mismatch', 'Retrieved entity or revision differs');
    const current = await fetchEntity(request.qid);
    if (current.id !== request.qid) return finding('mismatch', 'Current entity differs from supplied identity');
    let value: unknown, currentValue: unknown, references: string[] = [], needsReview = false;
    if (request.kind === 'statement') {
      const claim = pinned.claims[request.property ?? '']?.find(c => c.id === request.statementId);
      const live = current.claims[request.property ?? '']?.find(c => c.id === request.statementId);
      if (!claim) return finding('mismatch', 'Statement missing at supplied revision');
      value = claimValue(claim); currentValue = claimValue(live);
      if (canonical(claim.qualifiers ?? {}) !== canonical(request.qualifiers ?? {})) return finding('mismatch', 'Supplied date or qualifier differs from statement');
      if (canonical(live?.qualifiers ?? {}) !== canonical(claim.qualifiers ?? {}) || live?.rank !== claim.rank) return finding('needs-review', 'Qualifiers or rank changed upstream');
      references = (claim.references ?? []).flatMap((ref: any) => Object.entries(ref.snaks ?? {}).flatMap(([property, snaks]) => (snaks as any[]).flatMap(s => property === 'P854' ? [s.datavalue?.value].filter(v => typeof v === 'string' && /^https?:\/\//.test(v)) : property === 'P248' && s.datavalue?.value?.id ? [`https://www.wikidata.org/wiki/${s.datavalue.value.id}`] : [])));
      // Primary-document interpretation is deliberately unresolved in this spike.
      needsReview = true;
    } else {
      const lang = request.language ?? 'en';
      if (request.kind === 'alias') {
        value = pinned.aliases?.[lang]?.find(a => a.value === request.expected)?.value;
        currentValue = current.aliases?.[lang]?.find(a => a.value === request.expected)?.value;
      } else {
        value = pinned.labels[lang]?.value; currentValue = current.labels[lang]?.value;
        if (request.kind === 'ascii-label') {
          value = typeof value === 'string' ? value.normalize('NFD').replace(/\p{M}/gu, '') : value;
          currentValue = typeof currentValue === 'string' ? currentValue.normalize('NFD').replace(/\p{M}/gu, '') : currentValue;
        }
      }
    }
    if (value === undefined || canonical(value) !== canonical(request.expected)) return finding('mismatch', 'Proposed value not found in supplied source');
    if (canonical(value) !== canonical(currentValue)) return finding('needs-review', 'Value changed or disappeared upstream', references);
    return finding(needsReview || request.kind === 'ascii-label' ? 'needs-review' : 'source-match', request.kind === 'statement' ? 'Statement found; primary references, rank, or date interpretation require review' : request.kind === 'ascii-label' ? 'Derived spelling is local policy and requires review' : 'Spelling matches Wikidata; independent source verification remains required', references);
  } catch (error) { return finding('infrastructure-error', error instanceof Error ? error.message : String(error)); }
}

export function passing(findings: Finding[]): boolean { return findings.length > 0 && findings.every(f => f.status === 'verified'); }
