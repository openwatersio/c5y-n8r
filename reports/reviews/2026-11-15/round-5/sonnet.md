I found six problems and no blockers. All are in how the new reader and CI checks meet the data and the rest of the repo. I did not run the build or tests, because Bash was denied for the combined run. Everything below comes from reading the code and the data files.

## Findings

1. **Medium: a replay can pass the reader-compatibility check.**
   - Where: `scripts/observe-reader.ts:12-17`, `.github/workflows/check.yml` (job `reader-observations`).
   - The proposed reader is imported into the same process that builds and writes the observations. It gets the base fixture path in `process.argv` (`--cases`).
   - A PR reader can read that file and return the expected `preferred`, `selection` and `candidates` for exactly those inputs. It can behave differently on everything else.
   - The verdict job then reports `passed: true` with `checkedLookups > 0`. The README (`README.md:78`) admits a deceptive reader isn't caught.
   - But `CONTRIBUTING.md:38` ("Keep proposed code out of the verdict job") is met only for the verdict job. Observation integrity rests on maintainer review.
   - Fix: run the reader in a separate child process that is not given the fixture path. Feed it inputs over stdin, and have the harness write the results.
   - Tests that pin the current behaviour: `test/evidence-cli.test.ts:117` and `:157`. Both change.

2. **Medium: successors outside the corpus are dropped without any marker.**
   - Where: `scripts/build.ts` (`successorClaims` filter on `allIds`).
   - `Q33946` (Czechoslovakia) has a successor `Q214` in its pinned snapshot. `Q214` is not in the manifest, so the claim is filtered out. It has no evidence request (`data/evidence.json` has no `Q214`) and no `successors` entry in the binary.
   - `resolve('CS', {date:'1990-01-01'}).preferred.successors` therefore lists only `Q213`. The reader, the evidence check, and `facts` in `check-evidence` all treat that as complete.
   - Nothing reports the truncation. `README.md:58` and `test/registry.test.ts` ("retains … multiple successor pointers") only pin `AN`.
   - Fix: record skipped successors in the build output, or fail the build when an out-of-corpus successor is dropped. This changes `test/registry.test.ts` and `test/build.test.ts` only if they assert on successors.

3. **Medium: a dated lookup of a current code never returns a preferred answer.**
   - Where: `src/index.ts` (`unknownCodeBounds`) combined with `scripts/build.ts` (`temporalReviewed: false` is hard-coded).
   - The old rule marked a dated lookup uncertain only when both bounds were missing. It now does so when either bound is missing.
   - Every ISO code that is still in use has no end date. For example, `resolve('CZ', {date:'2020-01-01'})` gives `selection: 'uncertain'` and no `preferred`, even though the entity is valid on that date.
   - The accepted-inputs fixture has dated cases only for `CS` (3 of ~235 lookups). The only tests are `test/registry.test.ts:120` and the `CS` lookups, so this regression isn't pinned.
   - Open-ended and unknown-end are conflated. This may be intended, but then the README should say that any dated lookup of a current code is uncertain until `temporalReviewed` is set.

4. **Low: the reader-compatibility report describes the wrong binary.**
   - Where: `.github/workflows/check.yml` (job `reader-compatibility`, `--corpus . --base .`) and `scripts/check-evidence.ts` (`report`).
   - Both `corpus` and `base` are the base checkout. `datasetVersion`, `binarySha256` and `evidenceDigest` in the report are the base's, not the proposed binary the reader was observed on.
   - The observations file carries no binary or reader digest, so nothing ties the verdict to what was observed.
   - Fix: have `observe-reader` record the sha256 of the corpus binary and of the reader entry file, and have the verdict check them.

5. **Low: `compareRelease` changed from sync to async, and callers fail silently.**
   - Where: `src/index.ts` (`compareRelease`), versus `c0e0e27:src/index.ts`.
   - A 0.0.1-style caller that does `reg.compareRelease(m).freshness` gets `undefined` from the Promise. There is no error or type failure in plain JS.
   - The package is private and the README documents it. Only the version bump to 0.0.2 signals the break.
   - Separately, with no `sha256` in the supplied release, equal metadata returns `current` even if the bytes differ. The "binary identity" check in `CONTRIBUTING.md:38` only applies when the caller supplies `sha256`.

6. **Low: a package test assertion cannot fail.**
   - Where: `test/package.test.ts`, the assertion that `reports/benchmark.json` is absent from the pack.
   - The test never copies `reports/` into the temporary checkout, so that assertion always passes. Only `files` actually keeps the file out. The `sources/slackwater-required.json` assertion is real.

## Checked and not a finding

- **Verifier work limit:** the 8× limit and the cached-reference charging in `src/verify.ts` hold. Strings, vectors and tables are all charged on cache hits, and cycles are bounded by the depth limit.
- **Workflow secrets:** `check.yml` grants only `contents: read` and checks out with `persist-credentials: false`. Proposed code runs only in `reader-observations`, with no secrets.
- **Rollback:** an old 0.0.1 reader opening the new binary throws `CompatibilityError` because `formatVersion` is 2.
- **Upgrade from the previous release (v1):** `datasetVersion` and `formatVersion` both went from 1 to 2, so the freshness marker still describes the data. The in-place upgrade is tested only by the v1-rejection test and by fresh builds.

## Step 1 map

**Format and reader version constants** (`FORMAT_VERSION`, `READER_VERSION`, `minimumReaderVersion`)
- Written: `src/common.ts:4-5`, `sources/policy.json` (`minimumReaderVersion`), `data/release.json`, `package.json` (`version`).
- Read: `src/compile.ts` (validation and metadata), `src/index.ts` (compatibility check and `compareRelease`), `scripts/build.ts`, `scripts/fetch-wikidata.ts` and `scripts/check-evidence.ts` (User-Agent), `test/registry.test.ts`, `README.md:25`.

**Binary `data/countries.crdb`**
- Written: `scripts/build.ts` via `src/compile.ts`, using the generated bindings in `src/generated/*`.
- Read: `src/index.ts` and `src/verify.ts` (`open`), `scripts/check-evidence.ts` (`load`), `scripts/benchmark.ts` (also reads the raw bytes), `scripts/demo.ts`, `scripts/observe-reader.ts`, `test/*`, the `./data` export in `package.json`.

**`data/evidence.json`**
- Written: `scripts/build.ts`.
- Read: `scripts/check-evidence.ts` (digest-checked against the binary's metadata), `scripts/benchmark.ts` (size only), `test/evidence-cli.test.ts`, `test/verifier-work.test.ts`.

**`data/release.json`**
- Written: `scripts/build.ts`.
- Read: `test/registry.test.ts`, `test/verifier-work.test.ts`, consumers of `compareRelease`.

**Sources**
- `sources/manifest.json` and `sources/wikidata/*`: written by `scripts/fetch-wikidata.ts`. Read by `scripts/build.ts`, `scripts/check-evidence.ts` (offline mode), and the `files` list in `package.json`. Old snapshot files are never removed.
- `sources/policy.json`: read by `scripts/build.ts` only.
- `sources/accepted-inputs.json`: read by `scripts/build.ts`, `scripts/observe-reader.ts`, `scripts/check-evidence.ts`, `test/build.test.ts`, `test/evidence-cli.test.ts`, and the workflow (`--cases`). Not in `files`.
- `sources/slackwater-required.json`: read by `scripts/benchmark.ts` only. Excluded from the package.
- `sources/licenses/country-code-lookup-MIT.txt`: listed in `files`, referenced by `DATA_LICENSE.md:15`.

**`reports/*`**
- Written: `scripts/benchmark.ts`, `scripts/check-evidence.ts`.
- Read: docs only.

**Shared functions**
- `normalize` / `keyFor` / `alpha2Slot` / `day` in `src/common.ts` are used by `src/compile.ts`, `src/index.ts` (including the open-time validation and `findKey`), `scripts/build.ts` (`day`) and `test/registry.test.ts`.
- `canonical` in `src/evidence.ts` is used by `scripts/check-evidence.ts` only.
- `verify` in `src/verify.ts` is called from `src/index.ts` twice (once envelope-only, once full).

**Package export**
- `.` now points to `dist/index.js`, produced by `build:reader`, which runs from `prepare`, `build` and `test`, and in the workflow's `reader-observations` job.
- `dist/` is gitignored. Readers: `test/package.test.ts`, `test/evidence-cli.test.ts`, `scripts/observe-reader.ts` (via `--reader`).

**CI** (`.github/workflows/check.yml`)
- `build-and-test`: `npm ci --ignore-scripts`, then `npm run check` and `npm run build`, then `git diff --exit-code -- data/`.
- `wikidata-evidence`, `reader-observations` and `reader-compatibility`: pull requests only.
- No path filters, so manifests, lockfiles and the workflow file are not skipped.

**Docs that restate the above**
- `README.md:25,57-61,76-78,96`, `CONTRIBUTING.md:23,38`, `DATA_LICENSE.md:13-15`, `reports/findings.md`, `reports/review-2026-11-15.md`. All the others carry the version and format literals as prose.
