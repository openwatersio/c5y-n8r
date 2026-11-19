import { createHash } from 'node:crypto';
import { canonical, type Finding, type WikiEntity } from './evidence.ts';
import { day } from './common.ts';

export interface StatementValue { value: unknown; qualifiers: Record<string, unknown>; rank: string }
export interface StatementState extends StatementValue { references: unknown[] }
export interface ReviewSource { url: string; title: string; location: string; passage: string; retrieved: string; publicationDate?: string }
export interface ReviewRecord {
  id: string; qid: string; property: string; statementId: string; revision: number;
  baseline: StatementState; baselineDigest: string; mode: 'evidence' | 'correction'; proposed?: StatementValue;
  scope: string; primary: ReviewSource; corroborating: ReviewSource[]; independence: string;
  acceptedReferenceUrls?: string[];
  acceptedReferenceItems?: string[];
  approval: { by: string; date: string; issue: string };
  upstream: { status: 'blocked' | 'pending' | 'accepted' | 'rejected'; reason: string; url?: string };
}
export interface ReviewBundle { schemaVersion: 1; records: ReviewRecord[] }
export interface Activation { active: string[]; retired: string[] }
export interface AppliedReview { record: ReviewRecord; state: 'active' | 'retired' }
export const emptyReviews: ReviewBundle = { schemaVersion: 1, records: [] };
export const emptyActivation: Activation = { active: [], retired: [] };
const properties = new Set(['P30', 'P297', 'P298', 'P299', 'P576', 'P1366']);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const url = (v: unknown): v is string => { try { return text(v) && ['https:', 'http:'].includes(new URL(v).protocol); } catch { return false; } };
const date = (v: unknown) => { if (!text(v)) return false; try { day(v); return /^\d{4}-\d{2}-\d{2}$/.test(v); } catch { return false; } };

export function reviewDigest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function statementState(claim: any): StatementState {
  return { value: claim?.mainsnak?.datavalue?.value, qualifiers: claim?.qualifiers ?? {}, rank: claim?.rank ?? 'normal', references: claim?.references ?? [] };
}
export function statementValue(state: StatementValue): StatementValue { return { value: state.value, qualifiers: state.qualifiers, rank: state.rank }; }
export function effectiveValue(record: ReviewRecord): StatementValue { return statementValue(record.proposed ?? record.baseline); }
export function sameStatementValue(a: StatementValue, b: StatementValue): boolean {
  const semantic = (state: StatementValue) => ({ ...statementValue(state), qualifiers: Object.fromEntries(Object.entries(state.qualifiers).map(([property, snaks]) => [property, Array.isArray(snaks) ? snaks.map(snak => { const { hash, ...value } = snak; return value; }) : snaks])) });
  return canonical(semantic(a)) === canonical(semantic(b));
}
function validValue(value: any): boolean {
  return object(value) && value.value !== undefined && object(value.qualifiers) && ['normal', 'preferred', 'deprecated'].includes(value.rank);
}
function validPropertyValue(property: string, value: any): boolean {
  if (property === 'P297') return typeof value === 'string' && /^[A-Z]{2}$/.test(value);
  if (property === 'P298') return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
  if (property === 'P299') return typeof value === 'string' && /^\d{3}$/.test(value);
  if (property === 'P576') return object(value) && text(value.time) && value.precision === 11 && value.calendarmodel === 'http://www.wikidata.org/entity/Q1985727';
  return object(value) && value['entity-type'] === 'item' && /^Q[1-9][0-9]*$/.test(value.id) && value['numeric-id'] === Number(value.id.slice(1)) && (property !== 'P30' || ['Q15', 'Q46', 'Q48', 'Q49', 'Q18', 'Q538', 'Q55643', 'Q51'].includes(value.id));
}

export function validateReviews(value: unknown): ReviewBundle {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.records)) throw new Error('Invalid review schema');
  const ids = new Set<string>();
  for (const r of value.records) {
    if (!object(r) || !text(r.id) || !/^Q[1-9][0-9]*$/.test(r.qid) || !properties.has(r.property) || !text(r.statementId) || !r.statementId.toUpperCase().startsWith(`${r.qid}$`) || !Number.isSafeInteger(r.revision) || r.revision < 1) throw new Error('Invalid review identity');
    if (ids.has(r.id)) throw new Error('Duplicate review identity');
    ids.add(r.id);
    if (!validValue(r.baseline) || !Array.isArray(r.baseline.references) || r.baselineDigest !== reviewDigest(r.baseline) || !['evidence', 'correction'].includes(r.mode) || (r.mode === 'correction' ? !validValue(r.proposed) : r.proposed !== undefined)) throw new Error('Invalid review baseline or correction');
    if (!validPropertyValue(r.property, r.baseline.value) || (r.proposed && !validPropertyValue(r.property, r.proposed.value))) throw new Error('Invalid review property value');
    if (!text(r.scope) || !text(r.independence) || !object(r.approval) || !text(r.approval.by) || !date(r.approval.date) || !url(r.approval.issue) || !object(r.upstream) || !['blocked', 'pending', 'accepted', 'rejected'].includes(r.upstream.status) || !text(r.upstream.reason) || (r.upstream.url !== undefined && !url(r.upstream.url))) throw new Error('Missing review approval, scope or upstream state');
    if (!Array.isArray(r.corroborating) || r.corroborating.length < 2) throw new Error('Review requires two corroborating sources');
    if (r.acceptedReferenceUrls !== undefined && (!Array.isArray(r.acceptedReferenceUrls) || r.acceptedReferenceUrls.some((u: unknown) => !url(u)))) throw new Error('Invalid accepted reference URLs');
    if (r.acceptedReferenceItems !== undefined && (!Array.isArray(r.acceptedReferenceItems) || r.acceptedReferenceItems.some((id: unknown) => typeof id !== 'string' || !/^Q[1-9][0-9]*$/.test(id)))) throw new Error('Invalid accepted reference items');
    const sources = [r.primary, ...r.corroborating], urls = new Set<string>();
    for (const s of sources) {
      if (!object(s) || !url(s.url) || !text(s.title) || !text(s.location) || !text(s.passage) || !date(s.retrieved) || (s.publicationDate !== undefined && !date(s.publicationDate))) throw new Error('Invalid review source');
      const normalized = new URL(s.url); normalized.hash = '';
      if (urls.has(normalized.href)) throw new Error('Duplicate review source');
      urls.add(normalized.href);
    }
  }
  return value as unknown as ReviewBundle;
}

export function selectedReviews(bundle: ReviewBundle, activation: Activation, approvals: Record<string, string>): AppliedReview[] {
  validateReviews(bundle);
  if (!object(activation) || !Array.isArray(activation.active) || !Array.isArray(activation.retired) || !object(approvals)) throw new Error('Invalid review activation or approvals');
  const ids = [...activation.active, ...activation.retired];
  if (ids.some(id => !text(id)) || new Set(ids).size !== ids.length) throw new Error('Duplicate or invalid review activation');
  const targets = new Set<string>();
  return ids.map(id => {
    const record = bundle.records.find(r => r.id === id);
    if (!record) throw new Error(`Unknown review activation: ${id}`);
    if (targets.has(record.statementId.toUpperCase())) throw new Error('Duplicate selected review target');
    targets.add(record.statementId.toUpperCase());
    if (approvals[id] !== reviewDigest(record)) throw new Error(`Review is not approved by the trusted record digest: ${id}`);
    if (record.upstream.status === 'rejected') throw new Error(`Rejected upstream review requires reconsideration: ${id}`);
    return { record, state: activation.active.includes(id) ? 'active' : 'retired' };
  });
}

function hasPrimary(claim: any, record: ReviewRecord): boolean {
  const normalized = (value: unknown) => { if (!url(value)) return ''; const u = new URL(value); u.hash = ''; return u.href; };
  const accepted = [record.primary.url, ...(record.acceptedReferenceUrls ?? [])].map(normalized);
  return (claim?.references ?? []).some((ref: any) => (ref.snaks?.P854 ?? []).some((s: any) => accepted.includes(normalized(s.datavalue?.value))) || (ref.snaks?.P248 ?? []).some((s: any) => record.acceptedReferenceItems?.includes(s.datavalue?.value?.id)));
}
export function reviewFinding(record: ReviewRecord, state: AppliedReview['state'], current: WikiEntity): Finding {
  const claim = current.claims[record.property]?.find(c => c.id === record.statementId);
  const observed = statementState(claim);
  const sameValue = !!claim && sameStatementValue(observed, effectiveValue(record));
  const adopted = sameValue && hasPrimary(claim, record);
  const unchanged = !!claim && canonical(observed) === canonical(record.baseline);
  const verified = state === 'retired' ? adopted : unchanged && !adopted;
  return {
    id: record.statementId, status: verified ? 'verified' : 'needs-review',
    link: `https://www.wikidata.org/w/index.php?title=${record.qid}&oldid=${record.revision}`,
    message: state === 'active' && adopted ? 'Primary reference and assertion accepted upstream; retire the local override after review' : verified ? `${state === 'retired' ? 'Upstream assertion' : 'Local assertion'} verified by approved source review; document interpretation is a maintainer decision` : 'Reviewed statement changed upstream; review value, qualifiers, rank and references',
    references: [record.primary.url, ...record.corroborating.map(s => s.url)],
    provenance: { kind: state === 'retired' ? 'upstream-reviewed' : 'local-review', reviewId: record.id, reviewDigest: reviewDigest(record), issue: record.approval.issue },
  };
}

export function applyReviews(original: WikiEntity, bundle: ReviewBundle, activation: Activation, approvals: Record<string, string>): { entity: WikiEntity; reviews: Map<string, AppliedReview> } {
  const selected = selectedReviews(bundle, activation, approvals);
  const entity = structuredClone(original), reviews = new Map<string, AppliedReview>();
  for (const review of selected.filter(r => r.record.qid === original.id)) {
    const r = review.record, claim = entity.claims[r.property]?.find(c => c.id === r.statementId);
    if (!claim) throw new Error(`Review statement missing: ${r.id}`);
    if (review.state === 'retired') {
      if (reviewFinding(r, 'retired', original).status !== 'verified') throw new Error(`Retired review not accepted upstream: ${r.id}`);
    } else {
      if (original.lastrevid < r.revision || canonical(statementState(claim)) !== canonical(r.baseline)) throw new Error(`Review baseline differs from pinned snapshot: ${r.id}`);
      if (r.proposed) {
        claim.mainsnak.datavalue.value = structuredClone(r.proposed.value);
        claim.qualifiers = structuredClone(r.proposed.qualifiers);
        claim.rank = r.proposed.rank;
      }
    }
    reviews.set(r.statementId, review);
  }
  return { entity, reviews };
}
