# Reviewed overrides: pre-push review

The maintainer authorized a fourth round after the third-round stop. That round is complete, and the rebuild-trigger finding is fixed with a regression. No remaining skip path was found in the working-tree fix.

## Rebuild-trigger regression

The third-round defect was that the trusted rebuild in `scripts/check-evidence.ts` depended only on review fields in committed artifacts, ignoring selected activation records. When both base and proposed artifacts contain no reviews, a proposal can select an active review without rebuilding the artifacts and the trusted evidence gate reports success. The proposed build job normally catches the stale artifacts, but that job runs proposed code and cannot substitute for the trusted check.

Reproduced with a temporary copy of the current sources and data: set the real Turkey review ID active, leave `data/` unchanged, then run the checker against this branch as the base. The result was exit 0, `passed: true`, `gatePassed: true`, `applicable: false`, with zero findings. The checker must consider selected activation state when deciding whether to rebuild. The checker also inspects selected activation in both the proposed and base sources. A regression covers stale active and retired selections, missing trusted approval and a selected base with stale proposed artifacts. The test failed before the fix and passes afterward.

## Completed rounds

1. Codex, Copilot, Claude Opus and Claude Sonnet. Codex found no concrete defect, ran 35 read-only tests, and confirmed an in-memory rebuild. Copilot flagged standalone self-approval and a supposed fixture bypass; the standalone command requires a trusted base, and the fixture preflight plus a combined activation/fixture regression refute the bypass. Sonnet and Opus identified recovery friction, exact reference matching and drift blocking maintenance PRs. Fixes distinguish maintenance gating from evidence certification, support staged replacement records and approved equivalent URLs, and preserve the source review after retirement. Untrusted builder inputs are restricted to bounded regular files and canonical snapshot paths.
2. Opus and Sonnet. Opus identified skipped authentication of revised source snapshots and qualifier/reference adoption gaps. The scoped refresh path is restricted to selected reviewed entities and compares each complete changed entity with its live pinned revision. Unrelated refreshes retain the broader gate. Semantic qualifier comparisons ignore generated snak hashes, and explicit approved P248 document items are supported. Sonnet's suspicion about the academic source was checked against the PDF: it is the journal article, and printed page 2753 contains footnote 1 with the cited area statement.
3. Opus and Sonnet. Sonnet reported no blocking code defect. Opus identified the stale-activation blocker reproduced above. Both repeated the concern that code-owner review might not be enforced; that claim was checked against the live GitHub protection API and dismissed. At that review, the wildcard CODEOWNERS rule covered all review files and main required one approval, code-owner review, stale-review dismissal and approval of the last push.

The initial sandbox attempt could not initialize Codex/Copilot or reach the Claude APIs. It is not counted as a completed round; all four reviewers completed the retry outside the sandbox.

## Limits and lower-severity findings

Claude and Copilot used static inspection; their restricted tools did not run the suite. Codex's read-only subset did not cover filesystem-writing integration tests. Source independence, interpretation of passages, licensing of cited text and equivalence of document URLs/items require maintainer judgment. The current review record uses paraphrases and retains the uncertainty about underlying geographic measurements. The full journal PDF was not copied into the repository.

Malformed staged records intentionally fail validation. A primary reference already present upstream calls for a retired source review rather than an active overlay. Retired findings link to the checked pinned revision. The build's Node-only helpers are not exported by the runtime reader package. The fetch script still refreshes the whole inventory; a narrowly scoped retirement may require preserving unrelated manifest entries. Reference changes on retired records do not require reapproval while the semantic assertion and primary reference remain present. Rejection of an upstream proposal must be recorded by a maintainer; discussion-page decisions are not polled automatically.

## Verification

`npm run check`: 80 passed, 0 failed, 0 skipped. `npm run build` reproduces the checked-in binary, evidence companion and release metadata byte-for-byte. Tests include the real Turkey review applied in a temporary corpus, forged revisions on unrelated countries, forged refreshed entity content, live drift on unchanged reviews, reviewed retirement, corrected runtime facts, fixture changes and binary date/entity tampering.

The staged corpus remains inactive. The offline full-corpus report retains unresolved evidence; a passing code suite does not certify the dataset. Hosted CI results belong in the PR description.

## Fourth round

Opus and Sonnet completed the maintainer-authorized fourth round using static inspection. Both confirmed the working-tree trigger fix; their reports noted that the pushed HEAD and hosted results were still the earlier revision because the workflow requires reviewing before committing. The follow-up commit and fresh hosted results resolve that procedural finding.

Opus highlighted the existing reliance on code-owner review for workflow edits, and the fact that answer-changing corrections remain blocked by the immutable compatibility fixture. Those are explicit limits in README and CONTRIBUTING; a new workflow-attestation or fixture-approval design is outside this patch. Sonnet’s scale concern is retained as a prototype limit: corpus and observation size bounds require review before expansion. Deactivation still receives an unresolved ordinary-statement finding, so omitting a binary-diff label does not approve withdrawal.

The low finding about symlinked activation input was reproduced after the model review: JSON errors quoted a prefix of a synthetic target. The checker and builder share a bounded regular-file reader that also rejects paths escaping the corpus through a directory symlink. A regression covers both leaf and parent-directory symlinks. This lower-severity fix and its tests were made after the fourth model review; no fifth review ran. Source-language and licensing judgments remain human-reviewed, and the Node-only internal build modules are not exported by the runtime API.

At the fourth review, GitHub main protection required one approval, code-owner review and approval of the last push. The rejected fourth-round launch was retried only after GitHub confirmed the repository is public; both reviewers completed the authorized retry. The source data and activation state remain unchanged.

Current verification after the fourth-round follow-up: 81 tests passed, 0 failed, 0 skipped; build artifacts are byte-identical. The stale-activation regression keeps dataset versions equal for the activation-only case and exercises unauthorized selection, retirement and the base-only trigger. The previously reported HEAD/CI mismatch is resolved by pushing this fix and recording its hosted run in the PR description.

## Current repository controls

After the model reviews, the maintainer explicitly requested self-merge capability. Main requires zero approving reviews, with code-owner and last-push approval requirements disabled. Build checks, the Country policy gate, strict up-to-date checks, conversation resolution, administrator enforcement and force-push/deletion restrictions remain enabled. PR #147 was confirmed CLEAN and MERGEABLE after the settings update. The merging maintainer is responsible for reviewing staged approval records; the two-PR digest rule remains enforced in code, but does not require two different humans.
