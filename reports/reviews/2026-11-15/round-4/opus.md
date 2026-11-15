Two findings matter most:

1. **The reader-compatibility gate can be beaten by the code it is meant to check.** This is the PR-only CI job that builds the proposed reader and runs it against the base branch's lookup expectations.
2. **`compareRelease()` judges freshness by `datasetVersion` alone.** After a rollback, two different binaries can carry the same version number, and a stale copy reports as `current`.

The rest are low-severity gaps. All of this comes from reading the code, the data and the workflow. The tool policy denied me ad-hoc script execution, so I ran nothing.

## Findings

### 1. Medium: the reader-compatibility job runs PR code before and inside the "trusted" checker
`.github/workflows/check.yml:62-77`, `scripts/check-evidence.ts:57-69`

**What happens.** The job steps run in this order:
- Check out the base as `trusted/`.
- Check out the PR as `proposed/`.
- Run `npm run build:reader` inside `proposed/` (line 69). The command comes from the PR's own `package.json`, so it can be anything. It runs as the same runner user and can write to `../trusted/` and `../compatibility-report/`.
- Run the trusted checker, which `import()`s `proposed/dist/index.js` into its own process (check-evidence.ts:58).

**Failure scenario.**
- A PR changes `selectLatest` to prefer the older CS holder. It does not touch `sources/accepted-inputs.json`.
- It sets `"build:reader": "tsc -p tsconfig.build.json && node -e \"<rewrite ../trusted/sources/accepted-inputs.json lookups to the new answers>\""`.
- It edits `scripts/build.ts` so the build-and-test job skips its own lookup check. That job runs PR code anyway.
- Results:
  - **wikidata-evidence:** sees byte-identical data and an unchanged proposed fixture, so it exits 0.
  - **reader-compatibility:** compares against the rewritten "trusted" fixture and passes with `checkedLookups > 0`.
- A simpler route: the imported reader registers `process.on('exit')` and writes its own `report.json` with `passed: true`.

**Why it matters.** The `Review checks` rule "Changing the proposed fixture must not hide a changed answer" is defeated. These claims are false against adversarial code:
- README:76 ("lookup expectations from the trusted base", "requires a report proving that compatibility cases ran")
- `reports/findings.md` ("The CI workflow isolates trusted checker code from proposed artifacts")
- CONTRIBUTING:23

The job only catches honest regressions.

**Fix.**
- Run the proposed reader in an untrusted job. It should write nothing but a results JSON, uploaded as an artifact.
- Compare that artifact against the base fixture in a separate job (`needs:`) that never runs PR code.
- Alternatively, at least state in the docs that the check is not adversarial.

**Pins the fix touches.** The tests at `test/evidence-cli.test.ts:66-97` exercise `--reader` in a single process; they still pass if the comparison moves to a later job. Update the README:76, CONTRIBUTING:23 and findings.md prose.

### 2. Low-medium: `compareRelease` ignores content identity, so a reused `datasetVersion` reads as `current`
`src/index.ts:99-103`, `scripts/check-evidence.ts:77`

The only version rule is "proposed > base" in the PR evidence job.

**Rollback walk-through.**
- Main ships dataset 3 (binary B) and a consumer caches it.
- A revert restores dataset 2 (binary A).
- A later PR ships a different dataset 3 (binary C). The check passes because 3 > 2.
- The consumer holding B calls `compareRelease(releaseC)` and gets `freshness: 'current'`, although B and C differ.

`data/release.json` already carries `sha256` and `evidenceDigest`, but nothing compares them. Nothing records versions that were already used either.

**Fix.** Compare `evidenceDigest` (plus `sha256` when supplied) and report something like `different` on a mismatch.

**Pins.** `test/registry.test.ts:16-21` passes the same metadata object (`{...m}`), so it is unaffected. No test covers a reused version.

### 3. Low: some incompatible metadata is reported as a generic error, not `CompatibilityError`
`src/index.ts:51-55`, `src/common.ts:33`

The digest regex, date, `builtAt` and coverage checks run before the format/reader check at line 55. `readerSupports` also throws a plain `Error` for anything that is not `x.y.z`.

**Failure scenarios.**
- A future format that switches to a 128-hex digest makes this reader throw `Invalid metadata`.
- `minimumReaderVersion: "0.1.0-rc.1"` throws `Expected stable major.minor.patch`.
- In both cases `check-evidence.ts:119-120` reports `corpus-error`/`infrastructure-error` instead of `reader-compatibility`. That contradicts README:61 ("reports unsupported format/reader requirements through `CompatibilityError`") and README:76 ("an unsupported checker must report the incompatibility").

**Fix.** Check `formatVersion` and `minimumReaderVersion` first, and turn a version parse failure into `CompatibilityError`.

**Pins.** `test/registry.test.ts:161-177` and `test/evidence-cli.test.ts:34-49` still pass.

### 4. Low: nothing ever marks a claim as temporally reviewed, so dated lookups of current countries never return an answer
`scripts/build.ts:68,74,81` and `src/compile.ts:27`

- Every assignment is written with `temporalReviewed: false`, and every entity with `temporal_reviewed = false`. Neither `policy.json` nor any other input can set them.
- So every unqualified ISO code takes the `unknownCodeBounds` path (`index.ts:133`).
- Example: `resolve('TR', { date: '2020-01-01' })` and `resolve('TR', { namespace: 'iso-alpha2', date: '2020-01-01' })` both return `preferred: undefined, selection: 'uncertain'`.
- The README milestone ("every required input must resolve to its reviewed country identity") has no mechanism that could ever satisfy it.

**Fix.** Add a reviewed-temporal input, such as a per-statement list in policy.

**Pins.** `test/registry.test.ts:120-129` and the dated cases in `accepted-inputs.json` (e.g. CS at `2003-06-01`) depend on the current behaviour.

### 5. Low: `source:fetch` can pin a cached or older revision without saying so
`scripts/fetch-wikidata.ts:11-25`

It fetches `Special:EntityData/<id>.json` without a `revision` parameter, and that response may be served from cache. It also never checks that `lastrevid` is at least the revision already in the manifest.

**Failure scenarios.**
- A contributor edits Q43 (new revision N+1) per CONTRIBUTING step 2, then runs `source:fetch`. A cached response returns N, the script prints `Q43 N unchanged`, and the edit is missing from the build.
- If the cache returns an older revision than the manifest's, the script writes that file and the manifest moves backwards.

**Fix.** Ask the API for the latest revision ID, then fetch with `?revision=`. Reject a revision lower than the manifest's.

**Pins.** `test/refresh.test.ts` stubs `fetch` with the pinned files, so it is unaffected. No test covers a regressing revision.

### 6. Low: the evidence job checks `head.sha` but the compatibility job checks the merge commit
`.github/workflows/check.yml:33` vs `:59-62`

The second proposed checkout has no `ref:`, so it gets `refs/pull/N/merge`.

**Failure scenario.**
- Main advances to dataset 3 with new inputs while a code-only PR branch is still at dataset 2.
- wikidata-evidence diffs the old head against the new base. It reports every request main added as "removed" and raises `dataset-version` mismatch (2 ≤ 3), so the PR fails for changes it didn't make.
- reader-compatibility tests the merged tree instead.

**Fix.** Use the same tree in both jobs, preferably the merge commit.

**Pins.** None.

### 7. Low: the benchmark reports an entity's first alpha-2 assignment, whatever its status or dates
`scripts/benchmark.ts:67-72`

`codesByQid` returns the first `iso-alpha2` assignment it finds, ignoring status and dates. If an entity has a deprecated or historical alpha-2 ahead of its current one in claim order, the coverage report shows the old code and its `mismatch` flag is wrong. No entity in the current corpus has two, so this is latent.

**Fix.** Use `resolve(code, { namespace: 'iso-alpha2' })`, or choose the active non-deprecated assignment.

**Pins.** None; `reports/benchmark.json` is a historical dataset-1 snapshot.

### 8. Low: hand-copied version values have no check tying them together
`READER_VERSION` (`src/common.ts:3`) is copied in several places, and no check ties the copies together:
- `package.json` `"version": "0.0.2"`
- `sources/policy.json` `minimumReaderVersion`
- README:25 ("requires reader 0.0.2")
- the User-Agent strings in `fetch-wikidata.ts:6` and `check-evidence.ts:99`

The README:25 and findings.md prose also restates `FORMAT_VERSION` 2 by hand. Bumping `package.json` alone leaves the User-Agent and `readerSupports` on the old number. Tests that pin values by hand are excluded from this.

### Checked and not reported
- **Verifier work bound:** shared tables, vectors and strings are charged on every reference (`verify.ts:42-52,62-63`). The semantic passes in `open()` and in check-evidence `load()` stay within that bound: `seen` dedupes key→assignment, and `validateDirect` throws on the first mismatch.
- **Edge inputs I tried:** `\0` in name keys; month 13 or day 31 in Wikidata times (`day()` round-trips them, `build.test.ts:34`); year-precision bounds; duplicate request IDs (`check-evidence.ts:29`); empty fixture (`build.ts:85`). None broke.
- **Rollback to format 1:** a format-2 reader raises `CompatibilityError`. The old checker, with no `--reader` support, makes the compatibility job fail.
- **Licensing:** the pending Slackwater inventory and `reports/benchmark.json` are excluded from the package, and `test/package.test.ts:39-40` enforces it. The `country-code-lookup` MIT notice ships with the package.
- **Already disclosed:** the continent comes from the first P30 claim (Q43 lists Asia, then Europe), noted in `reports/findings.md`.

## Step 1 map

**Runtime artifact `data/countries.crdb`**
- Writer: `scripts/build.ts:102`
- Readers: `scripts/check-evidence.ts:21-22,30`; `scripts/benchmark.ts:13,68`; `scripts/demo.ts:3`; `test/registry.test.ts:8`; `test/evidence-cli.test.ts:16,38`; `test/package.test.ts:12,35` (via `package.json` export `./data`)
- CI: `.github/workflows/check.yml:21` (`git diff -- data/`) and `:42,74` (`--corpus`)
- Docs: README:42-52

**`data/evidence.json`**
- Writer: `scripts/build.ts:92,103`
- Readers: `scripts/check-evidence.ts:23-29`; `scripts/benchmark.ts:74`; `test/evidence-cli.test.ts:21`

**`data/release.json`**
- Writer: `scripts/build.ts:104`
- Readers: `test/verifier-work.test.ts:9`. There is no runtime reader; `compareRelease` (`src/index.ts:99`) takes its input from the caller.

**`sources/manifest.json`**
- Writer: `scripts/fetch-wikidata.ts:8,18-28`
- Readers: `scripts/build.ts:8-9,15,41-45,93`; `scripts/check-evidence.ts:90-94` (offline); `test/build.test.ts:14-24`; `test/refresh.test.ts:13-24`; `package.json` files

**`sources/wikidata/*.json`**
- Writer: `scripts/fetch-wikidata.ts:24`
- Readers: `scripts/fetch-wikidata.ts:20`; `scripts/build.ts:42-44`; `scripts/check-evidence.ts:93-95`; `test/build.test.ts:16,23`; `test/refresh.test.ts:19`

**`sources/policy.json`** (hand-maintained)
- Readers: `scripts/build.ts:10,33,75-81,92-93`; `test/build.test.ts:17,25`

**`sources/accepted-inputs.json`** (hand-maintained)
- Readers: `scripts/build.ts:84-100`; `scripts/check-evidence.ts:54-69`; `test/evidence-cli.test.ts:15,56-58,90`; `test/build.test.ts:18-20`
- Docs: CONTRIBUTING:23, README:92, DATA_LICENSE:15

**`sources/slackwater-required.json`** (hand-maintained; its stated source is `reports/benchmark.json`)
- No code reader
- Exclusion enforced: `test/package.test.ts:39`
- Docs: CONTRIBUTING:3, DATA_LICENSE:13

**`reports/benchmark.json`**
- Writer: `scripts/benchmark.ts:75-77` (only when a source directory is given; otherwise `reports/local/`)
- Readers: `test/package.test.ts:40`; `reports/findings.md:23`

**`reports/evidence.json`**
- Written by a manual `npm run evidence --output` run
- Read by `reports/findings.md:7`
- Default output path: `scripts/check-evidence.ts:17`

**`dist/`**
- Writers: `package.json` `build:reader`/`prepare`, `tsconfig.build.json`
- Readers: `package.json` exports; `check.yml:69,74`; `test/evidence-cli.test.ts:69,87`; `test/package.test.ts`

**Shared constants and functions**
- `READER_VERSION` (`common.ts:3`): `common.ts:39-41`, `fetch-wikidata.ts:6`, `check-evidence.ts:99`
- `FORMAT_VERSION` (`common.ts:4`): `compile.ts:16`, `index.ts:55,102`, `build.ts:93`, `test/registry.test.ts:10`
- `MIN_DAY`/`MAX_DAY`: `compile.ts:25,34`, `index.ts:133,146`; schema defaults at `schema/countries.fbs:19-20,30-35`
- `normalize`/`keyFor`: `compile.ts:33,41`, `index.ts:67,80,122`
- `alpha2Slot`: `compile.ts:48`, `index.ts:91,160`
- `day()`: `compile.ts:17-18,25,34-35`, `index.ts:44,52-53,118`, `build.ts:25,29,68`
- `versionParts`/`readerSupports`: `compile.ts:17`, `index.ts:55,102`
- `verify` (shapes mirror the schema): called at `index.ts:47,56`
- `canonical`: `evidence.ts:14`, `check-evidence.ts:56,65`
- `checkEvidence`: `check-evidence.ts:111`, `test/evidence.test.ts`
- `CompatibilityError`: `index.ts:12,55`, `check-evidence.ts:119`, tests

**Binary fields**
- `status` — written at `build.ts:68,74,81`; read at `index.ts:23,135`, `test/registry.test.ts:152`
- `temporal_reviewed` — always written false (`build.ts:68,74,81`, `compile.ts:27`); read at `index.ts:24,133`
- `from_latest`/`until_earliest` — written at `build.ts:68`, `compile.ts:35`; read at `index.ts:67,134`
- `evidence` IDs — written at `build.ts:47,72-73,79`; read at `check-evidence.ts:34-38`, `index.ts:26`
- Metadata fields — written at `compile.ts:51`; read at `index.ts:50-55` and `check-evidence.ts:31,77`

**CI jobs** (`check.yml`)
- `build-and-test`: lines 8-21
- `wikidata-evidence`: lines 22-48 (base and head checkouts at 28 and 33)
- `reader-compatibility`: lines 50-82 (base at 57; PR at 62 with no ref; PR build at 69; checker at 74; report check at 76)

**External services and env vars**
- Wikidata `Special:EntityData`: `fetch-wikidata.ts:11-12`, `check-evidence.ts:97-99`
- No environment variables, secrets, migrations or scheduled jobs.

**Docs that make claims about this change:** README:25,57-61,72-76,92; CONTRIBUTING:23,36-38; DATA_LICENSE:13-15; `reports/findings.md`; `reports/review-2026-11-15.md`.
