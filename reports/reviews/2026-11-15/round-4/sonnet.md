I found seven issues, none above medium. The one medium: the reader-compatibility CI job runs the PR's own code inside the checker that decides pass/fail, so a PR can forge a pass. The rest are low-severity doc, test and consistency gaps.

I only read files. The Bash tool was denied partway through, so I ran no tests or builds, and I didn't re-measure anything.

## Findings

All seven are in the structured report I submitted. The first four are code defects; the last three are documentation or hygiene gaps.

1. **Medium: the reader-compatibility gate runs proposed code inside the trusted checker.**
   - `.github/workflows/check.yml:57` and `scripts/check-evidence.ts:~47` import the PR's `dist/index.js` into the same Node process that decides the result and writes `report.json`.
   - A malicious reader can set `process.exitCode = 0` or write a forged report, which also defeats the `checkedLookups > 0` guard.
   - The README says the job isolates proposed code, but it isolates secrets only, not the verdict.
   - A fix would change the reader tests in `test/evidence-cli.test.ts`, the README job description, and `check.yml`.
2. **Low: the verifier shapes can drift from the schema.**
   - `src/verify.ts:3-7` hand-copies the layout in `schema/countries.fbs`, and `src/generated/*` is a third copy. CI never runs `flatc`, and no test compares them.
   - A schema field added without updating the verifier shape is never bounds-checked. A crafted file can then return `undefined` or `NaN` from the reader, and the `open()` comparisons treat that as valid.
   - `reports/findings.md` lists this as deferred; the change adds nothing that checks it.
3. **Low: `READER_VERSION` duplicates the package version.** `src/common.ts:3` holds `0.0.2` alongside `package.json`, `package-lock.json`, `sources/policy.json:44`, `data/release.json` and `README.md:25`. No test links them. A package bump to 0.0.3 without bumping `READER_VERSION` would make the shipped reader reject a dataset that requires 0.0.3.
4. **Low: duplicate policy aliases produce duplicate evidence IDs.** `scripts/build.ts:~73` never checks request IDs for uniqueness. Two identical alias entries pass the build and the CI build and test job, then fail the trusted evidence job with `Duplicate evidence IDs` (`scripts/check-evidence.ts:24`), reported only as a corpus error.
5. **Low: the checked-in benchmark is stale.** `reports/benchmark.json:6` records 28,256 bytes, the format-1 binary; the current binary is 28,276 bytes at format 2. The `findings.md` table is labelled dataset-version-1, but the file's recorded time (20:40) is after the format-2 build (20:22:46). The cost of the new double-verify `open()` is unmeasured.
6. **Low: the license condition on the Slackwater inventory has little enforcement.**
   - `DATA_LICENSE.md:15` says per-source licensing is pending. The only enforcement is the `files` allowlist in `package.json` plus the packed-install test, so a git clone or shared CI artifact is unprotected.
   - The tarball ships the `country-code-lookup` MIT notice even though no shipped data derives from that package.
   - Related gaps: `check-evidence.ts:102` caps Wikidata responses at 4 MiB but `fetch-wikidata.ts:14` has no cap, and the `wikidata-evidence` job has no `timeout-minutes`.
7. **Low: a non-`x.y.z` `minimumReaderVersion` gives a generic error.** In `src/index.ts:55`, `versionParts()` throws a plain `Error` for a format-2 file with, say, `0.1.0-rc.1`. The checker then reports an infrastructure error with no metadata instead of the reader-compatibility report the README promises.

## Step 1 map

Writers and readers, by artifact:

- **`data/countries.crdb`**
  - Writer: `scripts/build.ts:102`.
  - Readers: `src/index.ts:46` (`open`), `scripts/check-evidence.ts:21-30`, `scripts/benchmark.ts:13,53,68`, `scripts/demo.ts:3`, the package export `./data` (`package.json`), and tests.
  - Tests that read or write it: `registry.test.ts`, `evidence-cli.test.ts`, `package.test.ts`, `verifier-work.test.ts`.
  - CI: the `git diff --exit-code -- data/` step in `check.yml`.
- **`data/evidence.json`**
  - Writer: `scripts/build.ts:103`.
  - Readers: `scripts/check-evidence.ts:23` (digest bound to the binary metadata), `scripts/benchmark.ts:74`, tests.
- **`data/release.json`**
  - Writer: `scripts/build.ts:104`.
  - Readers: `test/verifier-work.test.ts` and the docs.
  - `check-evidence.ts` never reads it, so its `sha256` is unchecked.
- **`sources/manifest.json` and `sources/wikidata/*`**
  - Writer: `scripts/fetch-wikidata.ts:24,28`.
  - Readers: `scripts/build.ts:8,42`, `scripts/check-evidence.ts:90-93` (offline mode), `test/refresh.test.ts`, `test/build.test.ts`.
- **`sources/policy.json`**
  - Writer: hand-edited.
  - Readers: `scripts/build.ts:10` (aliases, datasetVersion, minimumReaderVersion, coverage), `test/build.test.ts`.
- **`sources/accepted-inputs.json`**
  - Writer: hand-edited.
  - Readers: `scripts/build.ts:84`, `scripts/check-evidence.ts:54-55` (trusted base against proposed), the tests, and CONTRIBUTING.md.
- **`READER_VERSION` / `FORMAT_VERSION`**
  - `READER_VERSION`: defined at `src/common.ts:3`, used at `common.ts:40` and in the User-Agent at `fetch-wikidata.ts:6` and `check-evidence.ts:99`.
  - `FORMAT_VERSION`: used in `src/compile.ts:16`, `src/index.ts:55,102`, `scripts/build.ts`, `test/registry.test.ts`.
  - Duplicated literals: `package.json`, `package-lock.json`, `policy.json:44`, `release.json`, `README.md:25`.
- **Schema layout**
  - `schema/countries.fbs`, `src/generated/*`, and the shapes in `src/verify.ts:3-7`.
  - `src/compile.ts` writes it; `src/index.ts`, `scripts/check-evidence.ts:30` and `scripts/benchmark.ts:68` read it directly.
- **Evidence**
  - `src/evidence.ts` is called from `scripts/check-evidence.ts`, which writes `reports/*` and the CI artifacts.
  - The trusted base is checked out in `check.yml`.
- **Docs and licenses**
  - `README.md`, `CONTRIBUTING.md`, `DATA_LICENSE.md`, `reports/findings.md`, `reports/benchmark.json`, and `sources/slackwater-required.json` (kept out of the package by the `files` allowlist).
  - `sources/licenses/country-code-lookup-MIT.txt` is shipped.

## Steps 2–6: checked and not reported

- **Deployed state and rollback:** the base commit is empty, so nothing is deployed and there is no older build whose marker could go stale.
  - Format 1 is rejected explicitly. The `datasetVersion` bump is enforced only when facts change.
- **Verifier work bound:** it holds up against shared strings, vectors and tables. Every reader loop in `open()` is bounded by the charged work, and `seen` rejects duplicate key indexes.
- **Date handling:** month 13, day 00 and the precision-9/10/11 paths fail closed.
- **Tests and counts:** the 39 tests, 119 assignments, 136 evidence requests, 28,276-byte binary, and `reports/evidence.json`'s binary hash all match the docs. The `reports/evidence.json` check was against `data/release.json`'s `sha256`.
- **Review checks in CONTRIBUTING.md:** the base-expectation, default-lookup, and shared-reference-expansion checks are present in code.
  - The default-lookup rule is enforced in `build.ts` rather than by the trusted checker. A PR can change that, but any fixture change is flagged.
