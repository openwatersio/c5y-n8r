I read the whole tree against the empty base. I didn't run anything, because Bash was denied for the test and build commands. The counts below come from grep, not from running the checks.

## Findings

1. **Medium — `src/index.ts:46-50` (`open`), `src/verify.ts:9-62`: a future-format file never reaches `CompatibilityError`.**
   - `open()` runs `verify()` with the v1 layout and then decodes metadata. Only after that does it check `formatVersion` and `minimumReaderVersion`.
   - A file from a later format that changes a table or field layout fails inside `verify()` with a generic error ("Conflicting table types" or "Invalid field offset"). The caller never sees `CompatibilityError` or the metadata that error carries.
   - Concrete input: `formatVersion: 2` with an extra field in the `Entity` table, or `minimumReaderVersion: "0.1.0"`.
   - The `CompatibilityError`, `readerSupports` and `compareRelease` machinery only works when the new file is still structurally valid v1.
   - A fix would put the version gate before the full verify, reading only the root and metadata with minimal bounds checks. It would touch the "embedded version compatibility" tests in `test/registry.test.ts` and the README and findings text.

2. **Medium — `scripts/build.ts:82` with `scripts/fetch-wikidata.ts:20`: a no-op refresh rewrites the binary and forces a version bump.**
   - `builtAt` is the latest `retrievedAt` in `manifest.json`, and fetch stamps `new Date()` on every run.
   - Running `npm run source:fetch` again with no upstream change gives a new `builtAt`, so `countries.crdb`, `evidence.json`'s digest and `release.json` all change.
   - `scripts/check-evidence.ts:50` puts metadata in `facts`, so the PR check then reports a `dataset-version` mismatch unless `datasetVersion` is bumped by hand. It also rechecks every request live and adds `binary-diff`.
   - Nothing in `build.ts` enforces a bump either.

3. **Low/Medium — `scripts/build.ts:82` and `src/common.ts:3`: the minimum reader version is the build tool's own version.**
   - `minimumReaderVersion` is set to `READER_VERSION`, which is also in `package.json` and the README ("dataset 2 requires reader 0.0.2").
   - Bumping the package version for an unrelated code fix makes every rebuilt binary require the new reader, even though the format is unchanged. The CI step `git diff --exit-code -- data/` then fails until the data is rebuilt.
   - After a rollback, an older reader rejects a binary rebuilt by the newer version, which says nothing about the data.
   - The version string is also copied into the two User-Agent strings. The README, `package.json` and `src/common.ts` hold three copies with no check that they agree.

4. **Medium — `scripts/build.ts:15` (accepted-inputs check) against `CONTRIBUTING.md:23` and `README.md:92`: the compatibility guard is weaker than the docs say.**
   - The build only checks that each pinned (entity, namespace, value) triple exists somewhere in the assignments.
   - It does not check that the input still resolves to that entity, so adding a second entity with the same spelling passes.
   - It does not check the status, dates or evidence kind, so a refresh can change `CS`/Q33946's date window and still pass.
   - Nothing compares `accepted-inputs.json` to the base branch. A PR can delete a pin and the missing assignment together. That is the move the README says not to make, and only prose forbids it.
   - Nothing requires newly accepted inputs to be added to the fixture, despite "add compatibility fixtures for newly accepted inputs".
   - `accepted-inputs.json` is derived from the same snapshots it protects, so a self-consistent refresh passes.

5. **Medium — `scripts/check-evidence.ts:34-38`: evidence binding covers only the value.**
   - The check compares `request.qid`, `request.expected` and the property. It does not compare the assignment's `from`, `fromLatest`, `until`, `untilEarliest` or `status` to the request's qualifiers.
   - The same gap exists for entity `until`, `successors` and `continent`.
   - A hand-edited binary that moves a code's end date, with a matching `evidence.json`, passes the binding. Only the generic `binary-diff` needs-review finding and the CI rebuild diff catch it.
   - The docs admit that temporal interpretation is manual. They do not say the binding ignores the dates entirely.
   - `statement` findings are always `needs-review`, and nothing returns `verified`, so `passed` can never be true.

6. **Low/Medium — `scripts/build.ts:52` and `reports/findings.md:19`: continent comes from whichever P30 claim is first.**
   - The build ignores rank and takes `claims.P30[0]`. Q43 has multiple continents.
   - Reordering or adding a claim upstream silently changes `Candidate.continent`, which was the compatibility concern behind this project.
   - Only that first claim gets an evidence request. The findings doc admits the gap, but no check or test pins the choice.

7. **Low — `src/verify.ts:42-58`: the verifier can be made to do quadratic work.**
   - It deduplicates tables by offset but not vectors.
   - A crafted file of up to 32 MB can have up to about 8M distinct tables that all point at one 8M-entry vector, which is a CPU-time attack.
   - The PR job runs `CountryRegistry.open` on the PR-supplied `countries.crdb` (`scripts/check-evidence.ts:15`). The CI evidence job in `.github/workflows/check.yml` therefore parses untrusted bytes, with only the runner's own time limit as a bound.
   - There is no malformed-corpus test beyond a few hand cases. `reports/findings.md:53` concedes the verifier needs hardening.

8. **Low — `scripts/fetch-wikidata.ts:15`: old snapshots are never removed.**
   - Snapshot files are named `Q-<rev>.json`. A refresh writes a new file and rewrites the manifest, but it leaves the previous revision's file in `sources/wikidata/`.
   - Orphans accumulate with nothing reporting them. Nothing checks that every file in `sources/wikidata/` is referenced by the manifest.

9. **Low — docs and claims.**
   - `reports/findings.md:3` says 136 evidence requests. By grep, `data/evidence.json` has 154 `"id":` matches, and some of those may be nested objects rather than requests, so I did not confirm the mismatch.
   - Dataset-1 benchmark figures and the "four of 129" coverage claim cannot be reproduced from the repo without a Slackwater checkout.
   - `resolve()` with no date uses the embedded `referenceDate`, not today's date. A code that ended after 2026-11-15 stays "active" indefinitely. The README only says "through the database reference date".

10. **Low — `package.json:12-16` and `.gitignore`: the package export depends on a build that CI doesn't separately check.**
    - The export points at `dist/`, which is gitignored, so a fresh clone fails to import until `build:reader` runs.
    - `test/package.test.ts` covers the built output only because `npm test` builds first, and running `node --test` directly skips that.
    - `tsc` does not clean `dist/`, so a removed source file leaves its stale output behind.

## Step 1 map

| Item | Writers | Readers |
|---|---|---|
| `data/countries.crdb` | `scripts/build.ts:84` | `src/index.ts` (`open`); `scripts/check-evidence.ts:15`; `scripts/benchmark.ts:13`; the `./data` export in `package.json`; `test/evidence-cli.test.ts:14`; `test/registry.test.ts`; `test/package.test.ts`; CI `git diff -- data/` |
| `data/evidence.json` | `scripts/build.ts:85` | `scripts/check-evidence.ts:16`; `scripts/benchmark.ts:74`; the digest embedded in the binary |
| `data/release.json` | `scripts/build.ts:86` | No code reads it. `compareRelease` expects the caller to supply it. |
| `sources/manifest.json` | `scripts/fetch-wikidata.ts:21` | `scripts/build.ts:7`; `scripts/check-evidence.ts:63` (offline mode); `test/build.test.ts` |
| `sources/wikidata/*.json` | `scripts/fetch-wikidata.ts:17` | `scripts/build.ts:35`; `scripts/check-evidence.ts:66` |
| `sources/policy.json` | hand-edited | `scripts/build.ts:8` (includes `datasetVersion`, `referenceDate` and coverage) |
| `sources/accepted-inputs.json` | hand-edited | `scripts/build.ts:70` only |
| `sources/slackwater-required.json`, `sources/licenses/` | hand-edited | nothing in code; documented in `DATA_LICENSE.md` |
| `reports/*.json`, `reports/findings.md` | `scripts/benchmark.ts:75`, hand-written | nothing in code |
| `READER_VERSION` and `FORMAT_VERSION` in `src/common.ts` | constants | `build.ts`, `fetch-wikidata.ts` and `check-evidence.ts` (User-Agent), `src/index.ts` (compatibility); the same version is also in `package.json` and the README |
| `src/generated/*` | `npm run generate` (`flatc`, not in CI) | `index.ts`, `compile.ts`, `check-evidence.ts`, `benchmark.ts`, tests |
| `dist/` | `build:reader` (tsc) | the package export; `test/package.test.ts` |
| `.github/workflows/check.yml` | — | runs `check`, `build` and `evidence` |
| Docs (`README.md`, `CONTRIBUTING.md`, `DATA_LICENSE.md`, `reports/findings.md`) | hand-edited | — |

Old-writer and upgrade paths: the base commit is the empty initial commit, so there is no earlier deployed data or schema, and the in-place upgrade questions do not apply. The spike is private and unpublished.

I did not review `test/registry.test.ts` or the resolver's semantics in depth.
