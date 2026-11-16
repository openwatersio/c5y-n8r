# Reviewed overrides implementation plan

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

- Baseline: 58 tests passing before implementation.
- Review validation, effective source generation and trusted evidence integration implemented with failing tests followed by passing tests.
- Final: fixed unchanged active reviews escaping live drift checks — scoped-transition regression RED→GREEN, including a simulated live rank change; suite 73/73.
- Independent final review found no other Critical or Important issues.
- Verification: typecheck and 73 tests pass; build reproduces all data artifacts byte-for-byte. Offline evidence report remains non-passing with 55 needs-review and 81 source-match findings, as expected for the staged corpus.
- No runtime data activation, Wikidata mutation, merge or publication is included.
