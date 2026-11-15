I reported 8 findings; none are data-loss or crash defects, and the most serious is that the resolver ignores Wikidata statement rank. They are all in the findings list I submitted, ranked there from most to least severe. I reviewed by reading only. Bash was denied partway through, so I ran no tests, builds or scripts.

The Step 1 map is in the message above the findings call. The merge base is the repo's first commit, so there was no earlier release to check an in-place upgrade or rollback against.

1. **Medium, deprecated claims** (`src/index.ts:88`): `resolve()` never looks at assignment status, so a deprecated-rank claim can be the preferred answer. `test/registry.test.ts:54-58` pins `CS` at 2005 as preferred, and `reports/findings.md` says `CS` carries deprecated ranks.
2. **Medium, date bounds** (`scripts/build.ts:20`): a code whose year-precision start and end fall in the same year makes `fromLatest` later than `untilEarliest`. That aborts the whole build. A year-9999 value does too.
3. **Medium, policy aliases** (`scripts/build.ts:62`): an alias whose entity isn't in the manifest is silently dropped, with no error and no evidence finding.
4. **Low, `unofficial` namespace** (`src/common.ts:24`): `normalize` treats it as a two-letter code, so an alias like `Holland` or `GBR` fails compile. `resolve` treats the same namespace like a name for dates.
5. **Low, evidence binding** (`scripts/check-evidence.ts:31`): the check ties assignments to evidence only by entity and value, not to dates or entity fields. Only the always-failing `binary-diff` preflight stops a hand-edited date today.
6. **Low, evidence job** (`.github/workflows/check.yml:25`): every statement request is `needs-review`, so any PR that changes facts exits 1. A base with no `data/countries.crdb` also fails.
7. **Low, fetch script** (`scripts/fetch-wikidata.ts:16`):
   - It leaves old snapshot files behind.
   - It hard-codes the entity list.
   - `retrievedAt` feeds `builtAt`, so re-syncing identical upstream data changes the binary and trips CI's `git diff -- data/` step.
8. **Low, verifier** (`src/verify.ts:45`): only tables are memoized. A file under the 32 MiB cap with many offsets to one large string forces repeated decoding.
