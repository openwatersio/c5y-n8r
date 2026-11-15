import type { Candidate, CountryRegistry, Result } from './index.ts';
import type { Namespace } from './common.ts';
export interface LookupCase { input: string; namespace?: Namespace; date?: string; dateTime?: string }
type CandidateSnapshot = { [K in keyof Candidate]: Candidate[K] };
function candidate(c: Candidate): CandidateSnapshot {
  return { id: c.id, name: c.name, continent: c.continent, namespace: c.namespace, value: c.value, matchedBy: c.matchedBy, temporalReviewed: c.temporalReviewed, retiredAtDay: c.retiredAtDay, evidence: [...c.evidence].sort(), successors: [...c.successors].sort(), applicability: c.applicability, tentative: c.tentative };
}
type Snapshot = Omit<Result, 'preferred' | 'candidates'> & { preferred: CandidateSnapshot | null; candidates: CandidateSnapshot[] };
export function observeLookup(reader: Pick<CountryRegistry, 'resolve'>, c: LookupCase) {
  const key = { input: c.input, namespace: c.namespace, date: c.date, dateTime: c.dateTime };
  try {
    const r = reader.resolve(c.input, { namespace: c.namespace, date: c.dateTime === undefined ? c.date : new Date(c.dateTime) });
    const result: Snapshot = { preferred: r.preferred ? candidate(r.preferred) : null, candidates: r.candidates.map(candidate).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), selection: r.selection, temporalAmbiguity: r.temporalAmbiguity, coverage: r.coverage, evidenceStatus: r.evidenceStatus };
    return { ...key, result };
  } catch (error) {
    return { ...key, result: { error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) } } };
  }
}
