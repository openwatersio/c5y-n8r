I read the code and docs but did not run anything. The shell denied `node` and `tsx`, so every finding below is from reading the code, not from a run.

## Findings

1. **Medium — `src/verify.ts:34`: a crafted binary can burn CPU in the PR evidence job.**
   - `verify()` memoizes tables (`visited`) but not strings or vectors. Every string reference is decoded again, up to the 32 MiB cap.
   - Failure scenario: a 32 MiB `data/countries.crdb` in a fork PR holds one ~16 MB string. An assignment's `evidence` vector (`vector<string>`) has about 4M offsets, all pointing at that string. The vector fits the bounds checks, and each element triggers a ~16 MB UTF-8 decode, which is roughly 10^13 bytes of work.
   - The `wikidata-evidence` job opens the proposed data with `CountryRegistry.open`, so it hangs until the Actions timeout. Any consumer that opens untrusted bytes is exposed in the same way.
   - A fix would track visited string and vector offsets, or cap the total bytes decoded. Related tests: `test/registry.test.ts:102` (malformed binaries) and `reports/findings.md` ("harden verifier"). It changes none of them.

2. **Medium — `scripts/build.ts:84-87` and `CONTRIBUTING.md:23`: the fixture-review claim has no enforcement.**
   - CONTRIBUTING says "Changes to expected answers or fixture removal require explicit review against the base revision." No code compares `sources/accepted-inputs.json` to the base, and `check-evidence.ts` never reads it.
   - Failure scenario: a PR drops a Wikidata alias (or a policy alias) and deletes the same line from `accepted-inputs.json`, or edits `lookups` to the new answer. `build` passes, because the fixture is the thing being edited.
   - The only backstop is the evidence job. It flags removed request IDs and changed runtime facts as `needs-review`, but it never flags a changed `lookups` answer. That job isn't branch-protected (`README.md`).
   - A fix would diff the fixture against the base in `check-evidence`. It changes `test/build.test.ts`, `test/evidence-cli.test.ts` and the README paragraph on the fixture.

3. **Low — `.github/workflows/check.yml`, `wikidata-evidence` job: it fails on this PR.**
   - The base commit (39c420e) has no `package.json`, `package-lock.json` or `scripts/check-evidence.ts`, so `npm ci` in `trusted` and `npm run evidence` fail.
   - This is a one-time bootstrap failure, but the job is red on the first PR. If the base's `data/` is ever absent or in an older format, `--base .` ends in `corpus-error` or `reader-compatibility` for every later PR.

4. **Low — `reports/benchmark.json:6` is stale against the data it describes.**
   - It records `bytes: 28256`, but `data/countries.crdb` is 28,276 bytes. `reports/findings.md` cites 28,276 for the binary and cites the benchmark file for its measurements.
   - The benchmark was recorded before the last rebuild. `reports/findings.md` labels it "dataset-version-1", so those figures don't describe the dataset-2 binary. Nothing in CI regenerates or checks `reports/`.

5. **Low — `CONTRIBUTING.md:24` vs `scripts/check-evidence.ts:15`: the documented evidence command doesn't produce the committed report.**
   - CONTRIBUTING says to run `npm run evidence` and include the report. The default output is `reports/local/evidence`, which is gitignored.
   - The committed `reports/evidence.json` has to be copied by hand. Its hashes match `data/release.json` today, but nothing keeps them in sync.

6. **Low — `DATA_LICENSE.md` Consumer compatibility section: it omits `reports/benchmark.json`.**
   - `reports/benchmark.json` is a second committed copy of Slackwater-derived country values and counts, plus `country-code-lookup` expected codes.
   - `DATA_LICENSE.md` names only `sources/slackwater-required.json` as the pending-license inventory.
   - `package.json` `files` and `test/package.test.ts` keep both out of the tarball, but the test checks only `slackwater-required.json`. The MIT notice in `sources/licenses/` is not in `files`. That is fine today, because no `country-code-lookup` content ships.

7. **Low — `src/common.ts:3`: `READER_VERSION` duplicates other values and no test pins them.**
   - The same value `0.0.2` also appears in `package.json` `version`, `sources/policy.json` `minimumReaderVersion` and README prose.
   - Bumping the package version without `READER_VERSION` makes the reader's compatibility gate and the User-Agent disagree with the package.

8. **Low — `src/verify.ts:4-9`: the structural shapes hand-copy `schema/countries.fbs`.**
   - Adding a field to the schema and regenerating bindings leaves the new field unverified, because nothing compares the two.

9. **Low — `scripts/fetch-wikidata.ts`: a failed sync leaves orphan snapshots.**
   - The manifest is written only after all 11 fetches. A mid-run HTTP failure leaves new `sources/wikidata/*-rev.json` files with no manifest entry, and `git status` shows them as untracked.
   - Unreferenced snapshots are never cleaned up.

I found nothing wrong with the date parsing (month 13, day 00, precision, calendar model), the key sort order, or the CI trust split. The trust split is a trusted checker with no secrets and `--ignore-scripts`.

## Step 1 map

**`data/countries.crdb`** (binary, schema `schema/countries.fbs`)
- Writers: `scripts/build.ts` (the `writeFile` near the end, via `src/compile.ts`).
- Readers:
  - `src/index.ts:44` (`open`)
  - `scripts/check-evidence.ts:17` (`load`)
  - `scripts/benchmark.ts:13`
  - `test/registry.test.ts:8`
  - `test/package.test.ts`
  - `test/evidence-cli.test.ts`
  - `package.json` `exports["./data"]`
  - the CI `git diff --exit-code -- data/`

**`data/evidence.json`**
- Writer: `scripts/build.ts`.
- Readers: `scripts/check-evidence.ts:19` (digest checked against the binary metadata), `scripts/benchmark.ts` (size), the CI diff.

**`data/release.json`**
- Writer: `scripts/build.ts`.
- Readers: none in code, only the CI diff and README prose.

**`sources/manifest.json` and `sources/wikidata/*`**
- Writers: `scripts/fetch-wikidata.ts`.
- Readers:
  - `scripts/build.ts`
  - `scripts/check-evidence.ts` (offline mode)
  - `test/build.test.ts`
  - `test/refresh.test.ts`
  - `package.json` `files`

**`sources/policy.json`**
- Writer: hand-edited.
- Readers: `scripts/build.ts`, `test/build.test.ts`.

**`sources/accepted-inputs.json`**
- Writer: hand-edited.
- Readers: `scripts/build.ts:84-87` only. It is not read by `check-evidence`, and it is not in `files`.

**`sources/slackwater-required.json` and `reports/benchmark.json`**
- Writers: `scripts/benchmark.ts` writes the benchmark report. The inventory is hand-maintained.
- Readers: the README, `DATA_LICENSE.md`, and `test/package.test.ts` (which asserts the inventory is excluded from the tarball).

**`reports/evidence.json` and `reports/findings.md`**
- Writers: hand-copied, no script.
- Readers: docs only.

**`src/common.ts`: `READER_VERSION`, `FORMAT_VERSION`, `normalize`/`keyFor`/`day`**
- Writers: `src/compile.ts`.
- Readers:
  - `src/index.ts`
  - `scripts/build.ts`
  - `scripts/fetch-wikidata.ts` (User-Agent)
  - `scripts/check-evidence.ts` (User-Agent)
  - `package.json` `version` (a copy)
  - `sources/policy.json` `minimumReaderVersion` (a copy)

**`src/verify.ts`** is called from `src/index.ts` (`open`, twice).

**`src/evidence.ts`** is called from `scripts/check-evidence.ts`. It is tested in `test/evidence.test.ts`.

**`.github/workflows/check.yml`**
- The `build-and-test` job runs `npm run check`, `npm run build` and the `data/` diff.
- The `wikidata-evidence` job runs the trusted `npm run evidence` against the proposed corpus.

**`package.json` scripts** (`prepare`, `build:reader` and `tsconfig.build.json` produce `dist/`).

**Docs stating the same rules:** `README.md`, `CONTRIBUTING.md`, `DATA_LICENSE.md`, `reports/findings.md`.

**Upgrade and rollback:**
- Format 1 files are rejected by the format 2 reader with `CompatibilityError`, and the README documents this.
- Older readers on format 2 binaries are not covered.
- In-place upgrade of a deployed consumer is untested. The package test covers only a fresh pack and install.
