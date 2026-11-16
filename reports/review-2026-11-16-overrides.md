# Reviewed overrides: pre-push review

This branch is a draft with one confirmed blocking finding. The local review stopped after the third completed round, as required by the Open Waters review workflow.

## Open blocker

The trusted rebuild in `scripts/check-evidence.ts` is triggered by review fields in committed artifacts, rather than by selected activation records. When both base and proposed artifacts contain no reviews, a proposal can select an active review without rebuilding the artifacts and the trusted evidence gate reports success. The proposed build job normally catches the stale artifacts, but that job runs proposed code and cannot substitute for the trusted check.

Reproduced with a temporary copy of the current sources and data: set the real Turkey review ID active, leave `data/` unchanged, then run the checker against this branch as the base. The result was exit 0, `passed: true`, `gatePassed: true`, `applicable: false`, with zero findings. The checker must consider selected activation state when deciding whether to rebuild. No production-code fix was made after this third-round finding.

## Completed rounds

1. Codex, Copilot, Claude Opus and Claude Sonnet. Codex found no concrete defect, ran 35 read-only tests, and confirmed an in-memory rebuild. Copilot flagged standalone self-approval and a supposed fixture bypass; the standalone command requires a trusted base, and the fixture preflight plus a combined activation/fixture regression refute the bypass. Sonnet and Opus identified recovery friction, exact reference matching and drift blocking maintenance PRs. Fixes distinguish maintenance gating from evidence certification, support staged replacement records and approved equivalent URLs, and preserve the source review after retirement. Untrusted builder inputs are restricted to bounded regular files and canonical snapshot paths.
2. Opus and Sonnet. Opus identified skipped authentication of revised source snapshots and qualifier/reference adoption gaps. The scoped refresh path is restricted to selected reviewed entities and compares each complete changed entity with its live pinned revision. Unrelated refreshes retain the broader gate. Semantic qualifier comparisons ignore generated snak hashes, and explicit approved P248 document items are supported. Sonnet's suspicion about the academic source was checked against the PDF: it is the journal article, and printed page 2753 contains footnote 1 with the cited area statement.
3. Opus and Sonnet. Sonnet reported no blocking code defect. Opus identified the stale-activation blocker reproduced above. Both repeated the concern that code-owner review might not be enforced; that claim was checked against the live GitHub protection API and dismissed. The wildcard CODEOWNERS rule covers all review files, and main requires one approval, code-owner review, stale-review dismissal and approval of the last push.

The initial sandbox attempt could not initialize Codex/Copilot or reach the Claude APIs. It is not counted as a completed round; all four reviewers completed the retry outside the sandbox.

## Limits and lower-severity findings

Claude and Copilot used static inspection; their restricted tools did not run the suite. Codex's read-only subset did not cover filesystem-writing integration tests. Source independence, interpretation of passages, licensing of cited text and equivalence of document URLs/items require maintainer judgment. The current review record uses paraphrases and retains the uncertainty about underlying geographic measurements. The full journal PDF was not copied into the repository.

Malformed staged records intentionally fail validation. A primary reference already present upstream calls for a retired source review rather than an active overlay. Retired findings link to the checked pinned revision. The build's Node-only helpers are not exported by the runtime reader package. The fetch script still refreshes the whole inventory; a narrowly scoped retirement may require preserving unrelated manifest entries. Reference changes on retired records do not require reapproval while the semantic assertion and primary reference remain present. Rejection of an upstream proposal must be recorded by a maintainer; discussion-page decisions are not polled automatically.

## Verification

`npm run check`: 79 passed, 0 failed, 0 skipped. `npm run build` reproduces the checked-in binary, evidence companion and release metadata byte-for-byte. Tests include the real Turkey review applied in a temporary corpus, forged revisions on unrelated countries, forged refreshed entity content, live drift on unchanged reviews, reviewed retirement, corrected runtime facts, fixture changes and binary date/entity tampering.

The staged corpus remains inactive. The offline full-corpus report retains unresolved evidence; a passing code suite does not certify the dataset. Hosted CI results belong in the PR description.
