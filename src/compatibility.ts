import type { Candidate, CountryRegistry, Result } from './index.ts';
import type { Namespace } from './common.ts';
export interface LookupCase { input: string; operation?: 'resolve' | 'convert' | 'assignments'; from?: Namespace; to?: Namespace; namespace?: Namespace; date?: string; dateTime?: string }
type CandidateSnapshot = { [K in keyof Candidate]: Candidate[K] };
function candidate(c: Candidate): CandidateSnapshot {
  return { id: c.id, name: c.name, continent: c.continent, namespace: c.namespace, value: c.value, matchedBy: c.matchedBy, temporalReviewed: c.temporalReviewed, retiredAtDay: c.retiredAtDay, evidence: [...c.evidence].sort(), successors: [...c.successors].sort(), applicability: c.applicability, tentative: c.tentative };
}
type Snapshot = Omit<Result, 'preferred' | 'candidates'> & { preferred: CandidateSnapshot | null; candidates: CandidateSnapshot[] };
function snapshot(r: Result): Snapshot {
  return { preferred: r.preferred ? candidate(r.preferred) : null, candidates: r.candidates.map(candidate).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), selection: r.selection, temporalAmbiguity: r.temporalAmbiguity, coverage: r.coverage, evidenceStatus: r.evidenceStatus };
}
export function observeLookup(reader: Pick<CountryRegistry, 'resolve'> & Partial<Pick<CountryRegistry, 'convert' | 'assignments'>>, c: LookupCase) {
  const key = { ...(c.operation === undefined ? {} : { operation: c.operation }), ...(c.from === undefined ? {} : { from: c.from }), ...(c.to === undefined ? {} : { to: c.to }), input: c.input, namespace: c.namespace, date: c.date, dateTime: c.dateTime };
  try {
    const date = c.dateTime === undefined ? c.date : new Date(c.dateTime);
    if (c.operation === 'convert') {
      if (!reader.convert) throw new Error('Reader method unavailable: convert');
      if (!c.to) throw new Error('Missing conversion target');
      const r = reader.convert(c.input, { from: c.from, to: c.to, date });
      return { ...key, result: { source: snapshot(r.source), target: snapshot(r.target) } };
    }
    if (c.operation !== undefined && c.operation !== 'resolve' && c.operation !== 'assignments') throw new Error('Unknown lookup operation');
    if (c.operation === 'assignments' && !reader.assignments) throw new Error('Reader method unavailable: assignments');
    const r = c.operation === 'assignments' ? reader.assignments!(c.input, { namespace: c.namespace, date }) : reader.resolve(c.input, { namespace: c.namespace, date });
    const result = snapshot(r);
    return { ...key, result };
  } catch (error) {
    return { ...key, result: { error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) } } };
  }
}
