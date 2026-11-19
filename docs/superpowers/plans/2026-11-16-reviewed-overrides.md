# Reviewed overrides implementation plan

Scope: this document describes reviewed local overrides and their original rollout. Ordinary Wikidata imports follow the source-fidelity and asynchronous quality policy in [CONTRIBUTING.md](../../../CONTRIBUTING.md); independent certification is not an admission requirement. Archived reports retain their historical verdicts.

> Implement inline with executing-plans. Use test-driven-development and one final independent review.

**Goal:** Permit reviewed local statement corrections and evidence while retaining pinned Wikidata provenance.

**Architecture:** Validate separate review records, digest approvals and active IDs. Reuse the trusted source-to-binary builder for exact artifact verification. New approvals require a base-branch merge before activation.

**Tech stack:** TypeScript, Node, FlatBuffers; no new dependencies.

**Spec:** [Approved design](../specs/2026-11-16-reviewed-overrides-design.md).

- [x] Test and implement `src/overrides.ts`: validation, full-record digests, baseline matching, copy-on-apply, drift/adoption and trusted approval checks. Cover invalid sources, duplicate targets, unauthorized activation, modified records and retirement.
- [x] Extract deterministic `buildCorpus` from `scripts/build.ts` into `src/source.ts`; integrate overrides and include their provenance in evidence. Test unchanged rebuilds, evidence-only and factual application, stale baselines and binding of artifacts to effective source.
- [x] Extend `src/evidence.ts` and `scripts/check-evidence.ts` with reviewed findings, base-owned authorization and exact trusted rebuild comparison. Keep offline checks non-certifying and unchanged unresolved assertions non-passing. Test proposed self-approval, tampered entity/date fields, drift, acceptance and provenance-only transitions.
- [x] Add inactive Turkey review, its approved digest and empty activation list. Update contribution policy, README, licensing and package provenance inventory. Verify build reproducibility and full checks.
- [x] Independently review the whole change, fix material findings, verify and summarize activation requirements.

## Review focus

PR fields cannot authenticate themselves; approved record contents cannot change unnoticed; a valid review cannot hide unrelated binary edits; retirement retains source review; current upstream state must be checked before live certification.

## Execution ledger

- Design approved by maintainer in chat. Existing isolated worktree reused.
- Ruling: ship Turkey inactive in the initial branch because approval must first reach the trusted base; activation in that same PR would violate the approved trust model. Cost: one follow-up activation change after merge.

### Historical rollout record

The results and rulings below record the original overlay implementation. The current source-fidelity gate is described in CONTRIBUTING and the updated design; it replaces the former scoped-transition admission rules.

- Baseline: 58 tests passing before implementation.
- Review validation, effective source generation and trusted evidence integration implemented with failing tests followed by passing tests.
- Final: fixed unchanged active reviews escaping live drift checks — scoped-transition regression RED→GREEN, including a simulated live rank change; suite 73/73.
- Independent final review found no other Critical or Important issues.
- Verification: typecheck and 73 tests pass; build reproduces all data artifacts byte-for-byte. Offline evidence report remains non-passing with 55 needs-review and 81 source-match findings, as expected for the staged corpus.
- No runtime data activation, Wikidata mutation, merge or publication is included.

- Pre-push verification: 79 tests pass, none skipped; generated data stays byte-identical. Three Open Waters review rounds completed; see reports/review-2026-11-16-overrides.md.
- Ruling: unchanged-artifact maintenance PRs retain non-passing evidence findings as advisory, so a source-review repair can reach main. Activations still block on unresolved reviews; the cost is that a green maintenance gate does not certify live data.
- Ruling: a retirement refresh must preserve effective facts and unreviewed assertions, be limited to reviewed entities, and authenticate complete changed snapshots against live pinned revisions. The cost is that unrelated source updates require broader review.
- Open blocker: activation selected without regenerated review-carrying artifacts can skip the trusted rebuild. Reproduced after round 3; stop implementation and open the requested PR as a draft.

- Maintainer authorized a fourth round. Resolved the stale-activation trigger with a failing regression followed by a passing test; both review models confirmed no remaining trigger skip path in the working-tree fix.
- After model review, reproduced and fixed the low-severity symlink-input disclosure using a shared bounded corpus-file reader and a leaf/parent-directory symlink regression. No fifth model round is required for this low finding.
- Compatibility-changing corrections and workflow-definition attestation remain explicit limits; this patch does not relax protected lookup expectations or modify CI workflows.

- Final local verification for the fourth-round follow-up: 81 tests passed, no skips; `npm run build` reproduces data byte-for-byte. Push and hosted CI reconcile the prior HEAD/working-tree discrepancy.
