A fifth round is authorized and pending. Local fixes now separate observation execution from the verdict job, bound entity IDs, and compare same-version release metadata and supplied binary hashes. The fifth-round outcome will supersede the historical open findings below.

Four rounds have completed, including the extra round explicitly authorized by the user. The three findings left open after round 3 have local fixes and regression coverage. The review remains unclean because round 4 found an adversarial compatibility-gate bypass, and further checks found semantic ID expansion and content-freshness gaps. All fixes remain local, uncommitted and unpushed. The original three-round record below is historical; the current findings are in the final section.

The Open Waters review ran three rounds against the full private spike, using initial commit `39c420e` as the diff base. The review is not clean. Changes and regression tests remain in the linked worktree, uncommitted and unpushed. The review stopped at the skill's three-round limit with the findings below still open.

The initial commit is the review baseline, not the current remote main or an actual pull request target. No pull request was created. Reviewers' claims that a PR necessarily targets the empty initial commit are incorrect for this repository's current state.

## Open findings

| Severity | Finding | Verified scenario | Required follow-up |
| --- | --- | --- | --- |
| Medium | Compatibility expectations can be edited alongside reader behavior without an independent check. `scripts/build.ts:84`, `scripts/check-evidence.ts:48` | In a temporary checkout, selecting the older retired CS holder and changing the fixture to match produced a successful build and byte-identical binary. The trusted checker returned exit 0, `applicable: false`, `passed: true`. Removing an alias and its fixture entries also allowed the build to pass. | Compare protected expectations against the trusted base, explicitly report removals/changed expectations, and exercise proposed reader behavior against the base contract. A data-only diff is insufficient for reader changes. |
| Medium | The structural verifier repeats work for shared strings and vectors. `src/verify.ts:34` | A bounded 32,804-byte malformed file with 4,000 references to one 16,384-byte string caused 65,536,698 bytes of UTF-8 decoding before `open` rejected missing indexes: about 1,998 times the input size. Larger inputs can monopolize the PR evidence job. No large denial-of-service workload was run. | Memoize verified shared structures and bound aggregate verification work; add adversarial shared-offset fixtures. The 32 MiB input cap does not bound this amplification. |
| Medium-low | New input triples need no corresponding lookup expectation, and fixture cases all select a namespace. `scripts/build.ts:86`, `scripts/benchmark.ts:60` | Adding a Q213 name alias `TR` and its input triple, without a lookup case, built successfully. Default `resolve('TR')` changed from Q43 to no preferred answer and `ambiguous`, while the namespaced ISO fixture remained unchanged. | Require expected answers for every new input and cover default cross-namespace resolution, including short aliases. |

These findings are corroborated across the final Opus and Sonnet reports and were reproduced independently. A passing existing suite does not cover them.

## Completed review attempts

| Round | Reviewers | Result and limits |
| --- | --- | --- |
| 1 | Codex, Copilot, Claude Opus; Claude Sonnet attempted | Codex, Copilot and Opus included their system maps. Sonnet omitted the required map and referred to unavailable earlier output, so that attempt does not count as a completed review. Its findings were checked, and Sonnet was rerun in round 2. |
| 2 | Claude Opus and Claude Sonnet | Both supplied findings and maps. Medium findings led to the second set of fixes. |
| 3 | Claude Opus and Claude Sonnet | Both supplied findings and maps. Open medium findings triggered the mandatory stop. |

The installed `review-branch` script supplied the same shared review prompt. The user explicitly authorized private repository content being sent to Codex, GitHub Copilot and Anthropic Claude. Raw reports are preserved under [reviews/2026-11-15](reviews/2026-11-15/); those reports are reviewer output, and the verified dispositions here take precedence over their unverified assertions.

Reviewers mostly performed static inspection because their read-only shell policies denied test/build commands. Codex ran the registry/evidence tests available without writing temporary files. The parent session executed the full suite and the independent reproductions listed here. External source passages and four-source corroboration were not audited or certified by this code review.

## Fixes and dispositions by reviewer

### Round 1

- **Codex:** fixed dated lookups that treated a single missing bound as certain. Fixed the Node export by emitting JavaScript/declarations, then added plain Node and fresh packed-install coverage.
- **Copilot:** fixed unsupported temporal values being discarded, deprecated-code preference, and stale name/license prose. Dated names and undated ISO claims deliberately retain uncertainty; the misleading single-entity selection label was corrected. The always-non-passing substantive evidence gate and manual four-source review are disclosed spike limits, not certification mechanisms. An unchanged base comparison has no applicable assertions and exits zero. Bootstrap claims based solely on the artificial review base were dismissed. Fixed snapshot refresh churn in round 2; retained historical files and fixed entity scope remain deliberate provenance/scope choices. Out-of-corpus successors remain explicitly incomplete. Report counts were checked through JSON parsing and execution rather than counting nested `id` fields.
- **Opus:** added accepted-input guards, then strengthened them with preferred-answer/candidate/date fixtures in round 2. Residual bypasses remain open above. Replaced factual `verified` labels for spelling matches with `source-match`; derived spelling stays `needs-review`, and policy origins are visible in assignments. Added explicit handling of historical deprecation versus rejected claims; unsupported dates and entity lifetime violations no longer become definite active matches. Fixed single-entity uncertainty, reference-date precision windows, package preparation, dataset version checks, benchmark overwrite, artifact report hashes, license notices and shared build version constants. Unknown unreviewed code bounds remain uncertain, including a current reused-code holder: choosing it definitively would violate the stated conservative contract. Locale-specific Turkish dotted-I matching requires an explicit alias; no global accent/case rewrite was introduced. Complete entity-field/date evidence binding, per-source Slackwater licensing, corpus expansion and production hardening remain outstanding limits.
- **Sonnet:** the first attempt was incomplete. Its supported-date overlap and unknown policy-entity findings were reproduced and fixed. The two-character unofficial-code namespace is an intentional scoped API; country nicknames belong in the name namespace. Shared-structure verifier amplification remained unresolved and was raised as medium in round 3.

### Round 2

- **Opus:** fixed the legacy status interpretation by introducing format 2 and rejecting format 1 explicitly. Added structured checker reports for compatibility errors; a previously deployed trusted checker cannot gain this behavior retroactively. Minimum reader compatibility is a dataset policy value rather than the package version. Added actual fresh-pack preparation and excluded the pending Slackwater inventory from package contents. Strengthened fixture answer checks; the missing trusted-base and default-namespace checks remain open. Corrected CS transition selection and exact-day uncertainty bounds. Deprecated entity claims and mismatched source-backed policy spellings stop ingestion. Inventory provenance and exhaustive licensing/coverage remain incomplete.
- **Sonnet:** added metadata-envelope validation before interpreting a supported body, and made unchanged revision syncs preserve their pinned manifest. Decoupled minimum reader policy from build version. Identity/value evidence binding remains intentionally narrower than source interpretation, with changed runtime facts still requiring review. The first continent claim convention remains unreviewed. Benchmark figures are explicitly historical dataset-1 measurements. The packed export is tested after preparation; installing a git source with scripts disabled still requires an explicit build. Verifier work amplification and fixture independence remain open.

### Round 3

- **Opus:** confirmed the trusted-fixture bypass and default-namespace/new-input gaps above. Remaining low findings concern inconsistent fetch/check response size limits, mixed-precision overlapping date bounds being rejected conservatively, diagnostics for older-format bases, incomplete source/license inventories and a packaged license-document link whose target is excluded. Historical snapshots are retained but only current revisions are indexed by the manifest. Coverage ends at the dataset reference date by design. Evidence approval still requires a maintainer-resolution mechanism.
- **Sonnet:** confirmed shared-structure verifier amplification and missing fixture change checks. Remaining low findings concern manual evidence report archival, the second private consumer inventory in `reports/benchmark.json`, mirrored version/schema values, retained unindexed snapshots and the trusted-checker upgrade boundary. Historical benchmark data is labeled dataset 1 rather than presented as a fresh format-2 measurement.

## Verification

- Node 24.20.0: TypeScript checking and **33 tests executed, 33 passed, 0 skipped** after the final code changes. Tests cover source refresh failures, aliases, exact/uncertain date bounds, retirement, ambiguity, format metadata and rejection, evidence errors, plain Node exports and fresh package preparation.
- A separate TypeScript consumer compiled against the emitted package declarations.
- Live pinned/current Wikidata evidence: **81 source matches, 55 needs-review**, exit 1 as intended. No assertions are certified as verified. `reports/evidence.json` includes the dataset version, binary hash and evidence digest.
- Dataset 2, format 2, minimum reader 0.0.2; 11 entities, 119 assignments, 136 evidence requests. Binary size: 28,276 bytes. The binary and evidence were rebuilt from pinned inputs.
- Regression tests failed before their corresponding fixes were applied. Final `git diff --check` is clean.
- CI for these uncommitted changes has not run. No branch protection was configured, no production migration occurred, and no Wikidata references were submitted by this review.

No implementation changes were made after the final model review. Only independent temporary reproductions, final verification, and this report/archive were produced afterward. The local fixes are not a clean review approval and have not been committed or pushed.

## Additional round authorized by the user

The fourth round reviews fixes for the three findings left open after round 3: bounded shared-reference verification work, trusted-base fixture-change reporting and proposed reader checks, and mandatory default lookup coverage. All 235 lookup expectations come from the existing unreviewed spike data; no country facts or coverage were promoted to verified. The Wikidata evidence job never loads proposed reader code; a separate PR job without secrets performs reader compatibility checks. The previous three-round stop remains part of the historical record above.

## Fourth-round outcome

Claude Opus and Sonnet both completed static reviews with system maps. Raw reports are in [round-4](reviews/2026-11-15/round-4/). Neither reviewer ran the suite; their tool policies denied ad-hoc execution. The parent session verified the concrete cases below.

### Findings resolved from round 3

- Shared string/vector/table verification now memoizes checked structures and charges expanded reference cost against an eight-times-file-size work budget. New regressions demonstrate rejection before semantic validation, including cached tables. This does not cover all semantic index expansion, as noted below.
- Fixture changes are explicitly reported by the trusted checker even with byte-identical binary data. Its `--reader` mode checks proposed reader behavior against immutable-in-memory base expectations. The local regression catches a reader selecting the older retired CS holder. The separate CI job has no secrets and requires evidence that lookup cases ran, but is not adversarially isolated from the code it checks.
- Every accepted input needs both namespaced and default expectations. There are now 235 lookup cases. A new cross-namespace competitor without matching cases fails the build.
- Fixed the packaged license-document link and explicitly excluded both private consumer inventory copies from the packed artifact; the install test checks all three conditions.

### Current open findings

| Severity | Finding and reproduction | Follow-up |
| --- | --- | --- |
| Medium | **The compatibility verdict can be forged by proposed code.** Both reviewers found this. The proposed build can modify the adjacent trusted checkout, and `--reader` imports proposed code into the process writing the verdict. A temporary reader wrote a fake `mode: reader-compatibility`, `checkedLookups: 235`, `passed: true` report and called `process.exit(0)`. The checker exited 0 and the workflow's report guard passed. | Keep execution of proposed code and comparison against protected base expectations in separate jobs. The verdict-producing job must never execute proposed code or share a writable checkout with its build. An untrusted reader can still fabricate its results; this is a regression check, not proof against deliberately deceptive implementations. |
| Medium | **Structural work charging does not bound repeated entity-ID decoding through numeric indexes.** Parent-session finding, missed by both model reviews' claims about semantic passes. A 35,420-byte accepted synthetic binary with a 16,385-byte entity ID and 128 assignments caused another 2,097,280 decoded bytes when the same assignment-to-entity reads used by `load()` were performed. No large attack was run. The ID length and assignment count can grow together. | Bound entity IDs and other scalar-index-referenced strings, or cache decoded identities in semantic readers with an aggregate budget. Add a regression at the `load()` boundary, not only at structural verification. |
| Low-medium | **Reused dataset versions ignore content identity in freshness checks.** Opus found the rollback scenario. With the same dataset version and a different evidence digest, the current reader returned `freshness: current`, `compatible: true`. A revert followed by version reuse can produce this state. | Compare the supplied content digests, and preserve a release/version uniqueness rule across rollback. Version ordering alone is insufficient. |

The non-adversarial compatibility regressions pass, but the gate must not be described as protected against hostile PR code. The Wikidata evidence job remains separate and does not import the proposed reader.

### Other findings and dispositions

- Sonnet's schema/verifier drift, duplicated version constants and duplicate policy alias/evidence IDs are valid low-priority gaps. Duplicate evidence is rejected by the evidence checker, but ingestion could fail earlier and more clearly. Full schema regeneration/drift checks remain deferred.
- Opus's metadata compatibility diagnostics for unsupported digest/version syntax and cache/regressing Wikidata revisions remain low-priority follow-ups. The stable-version-only parser is deliberate, but its error classification can be clearer. Current source sync still does not independently query a latest revision ID.
- The two PR jobs currently inspect different checkout forms: Wikidata evidence uses the head SHA, reader compatibility uses the merge checkout. Align them before relying on combined results for a branch behind its base.
- Mixed historical/current alpha-2 selection in the benchmark remains a latent reporting issue. Historical benchmark measurements are labeled dataset 1, not a current performance claim; do not use their recorded build/retrieval timestamp as a format-version identifier. No current performance budget was certified.
- Pending per-source Slackwater licensing, complete required-country coverage, temporal review inputs and four-source passage interpretation remain production milestones, rather than claims fulfilled by this review.

### Fourth-round verification

- Node 24.20.0: **39 tests executed, 39 passed, 0 skipped**. The new tests were observed failing before fixes.
- Local reader-compatibility mode: **235 cases executed, passed**. This is an honest-regression result, not adversarial verdict isolation.
- `actionlint .github/workflows/check.yml` passed. The new PR-only job has not run on GitHub; no PR or new commit was created.
- The rebuilt runtime artifact retains SHA-256 `a384b15c6c5a0f2af8c37ee0e9693f6dd2d6cec37e9c224a4299fc9c9116eadb`. No country data or coverage changed in this additional round.
- The previous live source report remains 81 source matches and 55 needs-review findings for the same binary. No country assertion was promoted to verified.
- No implementation changes were made after the fourth-round model review. Only temporary reproductions and this report/archive followed it. Changes remain uncommitted pending resolution of the open findings.

## Fifth round preparation

The user requested another round. Fixes target the fourth-round findings with 48 passing tests on Node 24 and a passing `actionlint` check. Proposed reader execution now occurs only in the observation job; a fresh job compares bounded JSON results against base expectations. Its verdict checker refuses executable reader paths. Forged verdicts, early process exits, duplicate cases and missing cases are rejected. This remains a regression check, not attestation that adversarial code produced honest observations. Entity IDs are bounded in compilation and loading. `compareRelease` is asynchronous and detects equal-version differences through embedded metadata and, when supplied, the release SHA-256 using Web Crypto. The runtime binary is unchanged.
