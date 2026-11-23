import type { SourceAssignment } from './compile.ts';
import type { LookupCase } from './compatibility.ts';
import { day } from './common.ts';

export function temporalLookupCases(assignments: readonly SourceAssignment[]): LookupCase[] {
  const cases = new Map<string, LookupCase>();
  for (const assignment of assignments) {
    if (!assignment.namespace.startsWith('iso-')) continue;
    const boundaries = new Set<number>();
    if (assignment.from) {
      const first = day(assignment.from), last = day(assignment.fromLatest ?? assignment.from);
      for (const boundary of [first - 1, first, last, last + 1]) boundaries.add(boundary);
    }
    if (assignment.until) {
      const first = day(assignment.untilEarliest ?? assignment.until), last = day(assignment.until);
      for (const boundary of [first - 1, first, last - 1, last]) boundaries.add(boundary);
    }
    for (const boundary of boundaries) {
      const date = new Date(boundary * 86_400_000).toISOString().split('T')[0]!;
      for (const namespace of [assignment.namespace, undefined]) {
        const lookup = { input: assignment.value, namespace, date };
        cases.set(JSON.stringify([lookup.input, namespace ?? null, date]), lookup);
      }
    }
  }
  return [...cases.values()];
}
