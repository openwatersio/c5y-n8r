import { createHash } from 'node:crypto';
import { reviewFinding, statementState, effectiveValue, sameStatementValue, selectedReviews, type AppliedReview } from './overrides.ts';

export interface EvidenceRequest {
  id: string; qid: string; revision: number;
  kind: 'statement' | 'label' | 'alias' | 'ascii-label' | 'local-policy';
  expected: unknown; property?: string; statementId?: string; language?: string;
  qualifiers?: unknown; reason?: string;
  review?: AppliedReview;
}
export interface Finding {
  id: string; status: 'verified' | 'source-match' | 'needs-review' | 'mismatch' | 'infrastructure-error';
  link: string; message: string; references: string[];
  provenance?: { kind: 'local-review' | 'upstream-reviewed'; reviewId: string; reviewDigest: string; issue: string };
  blocking?: boolean;
  advisories?: string[];
}
export type WikiEntity = { id: string; lastrevid: number; labels: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]>; claims: Record<string, any[]> };
export type FetchEntity = (qid: string, revision?: number) => Promise<WikiEntity>;

export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function claimValue(claim: any) { return claim?.mainsnak?.datavalue?.value; }

export async function checkEvidence(request: EvidenceRequest, fetchEntity: FetchEntity, approvedReviews: Record<string, string> = {}): Promise<Finding> {
  const link = `https://www.wikidata.org/w/index.php?title=${request.qid}&oldid=${request.revision}`;
  const finding = (status: Finding['status'], message: string, references: string[] = []): Finding => ({ id: request.id, status, link, message, references });
  try {
    if (!/^Q[1-9][0-9]*$/.test(request.qid) || !Number.isSafeInteger(request.revision) || request.revision < 1 || !['statement', 'label', 'alias', 'ascii-label', 'local-policy'].includes(request.kind)) return finding('mismatch', 'Invalid evidence identity or kind');
    if (request.kind === 'local-policy') return finding('needs-review', request.reason || 'Local alias policy needs independent evidence');
    let pinned: WikiEntity;
    try { pinned = await fetchEntity(request.qid, request.revision); }
    catch (error) { return { ...finding('infrastructure-error', error instanceof Error ? error.message : String(error)), advisories: ['pinned-source-unavailable'] }; }
    if (pinned.id !== request.qid || pinned.lastrevid !== request.revision) return finding('mismatch', 'Retrieved entity or revision differs');
    if (request.review) {
      const { record, state } = request.review;
      selectedReviews({ schemaVersion: 1, records: [record] }, { active: state === 'active' ? [record.id] : [], retired: state === 'retired' ? [record.id] : [] }, approvedReviews);
      if (!['active', 'retired'].includes(state) || request.kind !== 'statement' || request.qid !== record.qid || request.property !== record.property || request.statementId !== record.statementId || !sameStatementValue({ value: request.expected, qualifiers: request.qualifiers as Record<string, unknown> ?? {}, rank: effectiveValue(record).rank }, effectiveValue(record))) return finding('mismatch', 'Review does not bind the requested assertion');
      const claim = pinned.claims[record.property]?.find(c => c.id === record.statementId);
      if (state === 'active' ? !claim || pinned.lastrevid < record.revision || canonical(statementState(claim)) !== canonical(record.baseline) : reviewFinding(record, 'retired', pinned).status !== 'verified') return finding('mismatch', 'Review baseline differs from pinned assertion');
      try {
        const current = await fetchEntity(request.qid);
        if (current.id !== request.qid) return finding('mismatch', 'Current entity differs from supplied identity');
        return { ...reviewFinding(record, state, current), id: request.id, link };
      } catch (error) {
        return { ...finding('infrastructure-error', `Reviewed assertion current source unavailable: ${error instanceof Error ? error.message : String(error)}`), advisories: ['review-current-source-unavailable'] };
      }
    }
    let value: unknown, claim: any;
    const references: string[] = [];
    if (request.kind === 'statement') {
      claim = pinned.claims[request.property ?? '']?.find(c => c.id === request.statementId);
      if (!claim) return finding('mismatch', 'Statement missing at supplied revision');
      value = claimValue(claim);
      if (canonical(claim.qualifiers ?? {}) !== canonical(request.qualifiers ?? {})) return finding('mismatch', 'Supplied date or qualifier differs from statement');
      references.push(...referenceLinks(claim));
    } else {
      const lang = request.language ?? 'en';
      value = request.kind === 'alias' ? pinned.aliases?.[lang]?.find(a => a.value === request.expected)?.value : pinned.labels[lang]?.value;
      if (request.kind === 'ascii-label' && typeof value === 'string') value = value.normalize('NFD').replace(/\p{M}/gu, '');
    }
    if (value === undefined || canonical(value) !== canonical(request.expected)) return finding('mismatch', 'Proposed value not found in supplied source');
    if (request.kind === 'ascii-label' || (/^Q[1-9][0-9]*:policy:/.test(request.id) && !/^Q[1-9][0-9]*:policy:name:/.test(request.id))) return finding('needs-review', 'Local matching declaration requires explicit trusted review', references);
    const advisories = request.kind === 'statement' && !references.length ? ['missing-statement-references'] : [];
    if (request.kind === 'statement' && request.property === 'P30') {
      if ((pinned.claims.P30?.length ?? 0) > 1) advisories.push('single-continent-projection');
      if ((pinned.claims.P30 ?? []).some(c => Object.keys(c.qualifiers ?? {}).length > 0)) advisories.push('qualified-continent-projection');
    }
    // Current upstream health does not invalidate an already authenticated pinned import.
    try {
      const current = await fetchEntity(request.qid);
      if (current.id !== request.qid) throw new Error('Current entity differs from supplied identity');
      const lang = request.language ?? 'en';
      const live = request.kind === 'statement' ? current.claims[request.property ?? '']?.find(c => c.id === request.statementId) : undefined;
      const currentValue = request.kind === 'statement' ? claimValue(live) : request.kind === 'alias' ? current.aliases?.[lang]?.find(a => a.value === request.expected)?.value : current.labels[lang]?.value;
      if (canonical(value) !== canonical(currentValue) || (claim && canonical(statementState(live)) !== canonical(statementState(claim)))) {
        return { ...finding('needs-review', 'Pinned Wikidata assertion matches; current upstream value, scope, rank or references changed', references), blocking: false, advisories: [...advisories, 'upstream-drift'] };
      }
    } catch (error) {
      return { ...finding('infrastructure-error', `Pinned Wikidata assertion matches; current source unavailable: ${error instanceof Error ? error.message : String(error)}`, references), blocking: false, advisories: [...advisories, 'current-source-unavailable'] };
    }
    return { ...finding('source-match', 'Assertion matches pinned and current Wikidata; independent certification is not required for ingestion', references), blocking: false, advisories };

  } catch (error) { return finding('infrastructure-error', error instanceof Error ? error.message : String(error)); }
}

export function passing(findings: Finding[]): boolean { return findings.length > 0 && findings.every(f => f.status === 'verified'); }

// Review records describe work to inspect; they never change the evidence verdict.
export interface EvidenceReview {
  id: string;
  requestDigest: string;
  statement: { property: string; id: string; expected: unknown };
  sources: { url: string; publisher: string; role: 'authority' | 'corroboration'; passage: string; location: string; retrieved: string }[];
  reviewer: string;
  issue: string;
  permalink: string;
  reviewedAt: string;
  independenceExplanation: string;
}
export interface ReviewManifest { schemaVersion: 1; reviews: EvidenceReview[] }
export function requestDigest(request: EvidenceRequest): string {
  return createHash('sha256').update(canonical(request)).digest('hex');
}
export function parseReviewManifest(value: unknown): ReviewManifest {
  const manifest = value as ReviewManifest;
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.reviews)) throw new Error('Invalid evidence review manifest');
  const ids = new Set<string>();
  for (const review of manifest.reviews) {
    if (!review || typeof review.id !== 'string' || !review.id || ids.has(review.id)) throw new Error('Missing or duplicate evidence review ID');
    ids.add(review.id);
  }
  return manifest;
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const webLink = (value: unknown): value is string => {
  try { return typeof value === 'string' && ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
};
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const sourceUrl = (value: unknown): string => {
  if (!webLink(value)) return '';
  const url = new URL(value); url.hash = ''; return url.href;
};
const nameProperties = new Set(['P1448', 'P1449', 'P2561', 'P1705', 'P1813']);
function referenceLinks(claim: any): string[] {
  return (claim?.references ?? []).flatMap((ref: any) => Object.entries(ref.snaks ?? {}).flatMap(([property, snaks]) => (snaks as any[]).flatMap(s => property === 'P854' && webLink(s.datavalue?.value) ? [s.datavalue.value] : property === 'P248' && s.datavalue?.value?.id ? [`https://www.wikidata.org/wiki/${s.datavalue.value.id}`] : [])));
}
export async function reviewReadiness(request: EvidenceRequest, review: EvidenceReview | undefined, trusted: EvidenceReview | undefined, fetchEntity: FetchEntity, context: { offline?: boolean } = {}) {
  const missing: string[] = context.offline ? ['live-current-source-reference-check'] : [];
  const result = () => ({ id: request.id, requestDigest: requestDigest(request), status: missing.length ? 'incomplete' : 'ready-for-human-review', missing });
  if (request.review) { missing.push('unsupported-reviewed-override-request'); return result(); }
  if (request.kind === 'ascii-label' || request.kind === 'local-policy') { missing.push('unsupported-derived-name-policy'); return result(); }
  if (!review) {
    missing.push('review-record', 'source-passages', 'independent-publisher-review', 'referenced-name-or-value-statement', 'trusted-maintainer-attestation');
    return result();
  }
  if (review.id !== request.id || review.requestDigest !== requestDigest(request)) missing.push('stale-or-mismatched-request');
  if (!trusted || canonical(review) !== canonical(trusted)) missing.push('trusted-maintainer-attestation');
  if (![review.reviewer, review.independenceExplanation].every(nonempty) || !webLink(review.issue) || !webLink(review.permalink) || !date(review.reviewedAt)) missing.push('review-provenance');
  const sources = Array.isArray(review.sources) ? review.sources : [];
  if (sources.length < 4 || sources.some(s => !s || !webLink(s.url) || !nonempty(s.passage) || !nonempty(s.location) || !date(s.retrieved))) missing.push('source-passages');
  const urls = sources.map(s => sourceUrl(s?.url));
  const publishers = sources.map(s => typeof s?.publisher === 'string' ? s.publisher.trim().toLowerCase() : '');
  if (sources.filter(s => s?.role === 'authority').length !== 1 || sources.filter(s => s?.role === 'corroboration').length < 3 || publishers.some(p => !p) || new Set(urls).size !== sources.length || new Set(publishers).size !== sources.length || !nonempty(review.independenceExplanation)) missing.push('independent-publisher-review');
  const pointer = review.statement;
  if (!pointer || ((request.kind === 'label' || request.kind === 'alias') && !nameProperties.has(pointer.property)) || !/^P[1-9][0-9]*$/.test(pointer.property) || !nonempty(pointer.id) || canonical(pointer.expected) !== canonical(request.expected) || (request.kind === 'statement' && (pointer.id !== request.statementId || pointer.property !== request.property))) {
    missing.push('referenced-name-or-value-statement');
    return result();
  }
  try {
    let pinnedClaim: any;
    for (const revision of context.offline ? [request.revision] : [request.revision, undefined]) {
      const entity = await fetchEntity(request.qid, revision);
      const claim = entity.claims[pointer.property]?.find(c => c.id === pointer.id);
      if (revision !== undefined) pinnedClaim = claim;
      if (revision === undefined && claim && pinnedClaim && !sameStatementValue(statementState(claim), statementState(pinnedClaim))) missing.push('current-statement-scope-or-rank');
      if (request.kind === 'statement' && canonical(claim?.qualifiers ?? {}) !== canonical(request.qualifiers ?? {})) missing.push(revision === undefined ? 'current-statement-scope' : 'pinned-statement-scope');
      const links = referenceLinks(claim).map(sourceUrl);
      // Monolingual name statements carry text; labels and aliases themselves cannot carry references.
      const value = claimValue(claim);
      const nameRequest = request.kind === 'label' || request.kind === 'alias';
      const monolingual = value && typeof value === 'object' && typeof value.text === 'string' && value.language === (request.language ?? 'en');
      const comparable = nameRequest && monolingual ? value.text : value;
      if (entity.id !== request.qid || (revision !== undefined && entity.lastrevid !== revision) || !claim || (nameRequest && !monolingual) || claim.rank === 'deprecated' || canonical(comparable) !== canonical(pointer.expected) || (value && typeof value === 'object' && 'text' in value && value.language !== (request.language ?? 'en')) || !sources.length || sources.some(s => !links.includes(sourceUrl(s?.url)))) {
        missing.push(revision === undefined ? 'current-statement-references' : 'pinned-statement-references');
      }
    }
  } catch { missing.push('statement-reference-infrastructure'); }
  return result();
}
