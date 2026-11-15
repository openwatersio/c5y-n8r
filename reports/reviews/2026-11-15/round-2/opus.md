I found ten issues: four medium, two low-to-medium and four low. The base commit `39c420e` is an empty tree, so everything here is new. I treated HEAD `c0e0e27` (dataset 1, reader 0.0.1) as the deployed state, and the working tree (dataset 2, reader 0.0.2) as the change. My shell couldn't run `node` or the tests, so every result below comes from reading the code and the checked-in artifacts.

## Findings

### 1. Medium: the new reader misreads dataset 1, and the version gate lets it, while rejecting an old reader that would work
`src/index.ts:134`, `scripts/build.ts:65`, `scripts/build.ts:82`, `src/common.ts:3`

- **What changed:** the meaning of the status `deprecated-claim` changed without a format or version gate.
  - In `c0e0e27`, `build.ts` wrote `deprecated-claim` for every deprecated code claim, including both `CS` claims. Both are rank `deprecated` with qualifier P2241 = Q110770329 (Q33946 `83d631a6…`, Q37024 `1E270954…`).
  - Dataset 2 writes `withdrawn-code` for those two claims.
  - Reader 0.0.2 now treats `deprecated-claim` as never preferable.
- **New reader on dataset 1 (roll forward or partial rollback):** dataset 1 has `minimumReaderVersion: "0.0.1"`, so `readerSupports` accepts it. Then:
  - `resolve('CS', {namespace:'iso-alpha2', date:'1990-01-01'})` gives both candidates as `deprecated`, `preferred` undefined and selection `none`. Reader 0.0.1 returned Q33946 here.
  - Undated `resolve('CS', …)` loses Q37024 the same way.
  - `compareRelease` still reports `compatible: true`.
  - This happens whenever a consumer pairs the new package with a dataset-1 binary.
- **Old reader on dataset 2:** dataset 2 sets `minimumReaderVersion = READER_VERSION = 0.0.2`, so reader 0.0.1 throws `CompatibilityError`. Yet 0.0.1 ignores `status` and would answer dataset 2 exactly as before.
- **Net effect:** the gate locks out the reader that works and admits the reader that misreads old data.
- **Tests:** none opens a dataset-1 binary with the new reader. The fixture at `test/registry.test.ts:10` uses `minimumReaderVersion: '0.0.1'` but has no deprecated rows.
- **Fix options:**
  - Bump `FORMAT_VERSION`.
  - Or have the reader require a minimum dataset or format version for status-dependent behavior.
  - Or have the build write a new status token (e.g. `deprecated-v2`) so old binaries keep their old meaning.
- **What the fix would change:**
  - `test/registry.test.ts:10,24,113` (they pin format 1 / reader 0.0.1 as openable).
  - `README.md:25` ("dataset 2 requires reader 0.0.2").
  - `data/release.json` and the binary.

### 2. Medium: the trusted-base evidence job crashes, rather than reporting, whenever a PR bumps the reader version
`scripts/build.ts:82`, `scripts/check-evidence.ts:20`, `src/index.ts:55`, `.github/workflows/check.yml:39-42`

- **Cause:** `minimumReaderVersion` is now tied to `READER_VERSION`. The `wikidata-evidence` job runs the base branch's checker, and `load(corpus)` calls the base's `CountryRegistry.open` on the proposed binary.
- **Scenario:** with main at `c0e0e27` (reader 0.0.1), a PR carrying this working tree (dataset 2, requires 0.0.2) gets an uncaught `CompatibilityError: Database requires a different reader`. No `report.json` is written, so the uploaded artifact is empty. Every future reader bump hits the same wall.
- **Today:** main resolves to `39c420e`, an empty tree. The trusted `npm ci` there fails on the missing `package.json`, so the first PR's evidence job fails before checking anything.
- **Tests:** `test/evidence-cli.test.ts` runs the same checker version on both sides, so it can't catch this.
- **Fix:** decouple `minimumReaderVersion` from `READER_VERSION` (make it a policy value, changed only when the format meaning changes). Have the checker turn `CompatibilityError` into a finding.
- **What the fix would change:** `README.md:25` and `data/release.json`. No test pins the coupling.

### 3. Medium: the accepted-inputs guard checks that a row exists, not that the input still resolves
`scripts/build.ts:78-79`

`README.md:92` says "The build rejects a refresh that drops one". The build only looks for a matching entity/namespace/value row. These refreshes all pass the build while the accepted input stops resolving:

- **Deprecated claim:** Wikidata deprecates Q43's `TR` claim with any reason other than Q110770329. The row stays, with status `deprecated-claim`. `resolve('TR')` then returns no preferred answer and the build still passes.
- **New competitor:** another corpus entity gains the English alias "Turkey". The pair (Q43, name, Turkey) is still present, but `resolve('Turkey')` becomes `ambiguous`.
- **Emptied fixture:** `"inputs": []` passes silently. Nothing checks the fixture against `baselineDatasetVersion` or against the base branch.
  - "Do not delete the fixture" (`README.md:92`, `CONTRIBUTING.md:23`) is therefore unenforced, apart from the evidence job's `removed` needs-review finding, which is buried in an always-failing report.

**Fix:** store the expected answer per input and check it after `compile()` by calling `resolve`. Inputs that are ambiguous on purpose (Congo on Q971 and Q974, undated `CS`) need an explicit expected `selection`.

**What the fix would change:** `sources/accepted-inputs.json` (new fields), `test/build.test.ts:48-52` (still passes; add cases for deprecation and a new competitor), and `README.md:92`.

### 4. Medium: the package export points at gitignored `dist/` and nothing builds it on install
`package.json:10-14`, `.gitignore:3`

- **Cause:** `"."` now resolves to `./dist/index.js`, but `dist/` is gitignored and there is no `prepare` script.
- **Scenario:** the package is `private: true`, so a consumer such as Slackwater can only install it from git, a file path or a workspace. npm runs `prepare` for git dependencies, and there isn't one, so `import { CountryRegistry } from '@openwaters/c5y-n8r'` fails with `ERR_MODULE_NOT_FOUND`.
- **Claim this breaks:** `README.md:57` says "Node consumers use the package export without a TypeScript loader".
- **Tests:** `test/package.test.ts` only checks a self-reference inside the repo, after `npm test` has run `build:reader`.
- **Fix:** add `"prepare": "npm run build:reader"`.
  - It changes no existing test.
  - CI's `npm ci --ignore-scripts` (`check.yml:18,39`) skips `prepare`, so CI is unaffected.
  - An install fixture (`npm pack` then install into a temp dir) would prove the claim.

### 5. Low–Medium: the CS transition window returns `ambiguous`, contradicting the README
`src/index.ts:155`

- **Claim:** `README.md:59` says "Single-entity date uncertainty uses `selection: "uncertain"`; ambiguity is reserved for competing entities."
- **Trace for `resolve('CS', {namespace:'iso-alpha2', date:'2003-06-01'})`:**
  - Q33946 is `outside-date` (its entity ends 1993-01-01).
  - Q37024 is `uncertain`.
  - `ids` is empty, `plausibleIds` = {Q37024}, and `uncertainOther && differentEntities` is true.
  - Result: `ambiguous`, though only one entity is plausible.
- **Why tests miss it:** the boundary test at `test/registry.test.ts:61-63` never asserts `selection`.
- **Fix:** require a real competitor, e.g. `uncertainOther && ids.size > 0`.
- **What the fix would change:**
  - `test/registry.test.ts:73-82` stays `ambiguous`, because the retired entity A is in `ids`.
  - `test/registry.test.ts:595-604` is unaffected.
  - Add a `selection === 'uncertain'` assertion to the boundary test.

### 6. Low: deprecated claims still drive entity-level facts
`scripts/build.ts:49-58`

- **The rule:** the new statement that deprecated claims "cannot be preferred" (`README.md:92`) is applied only to P297/P298/P299.
- **What ignores rank:**
  - P576 dissolution: the only claim is used whatever its rank.
  - P1366 successors.
  - P30 continent: `[0]` is taken.
- **Scenario:** a refresh where a country's only P576 is rank `deprecated` (a disputed date) sets the entity's `until`. Every code and name for it becomes `retired` or `outside-date` after that date, with no review finding.
- **Fix:** filter by rank, or fail.
- **What the fix would change:** no existing test. Today's corpus has no deprecated P576/P1366/P30 claims.

### 7. Low: day and month precision bounds are marked uncertain one day too long
`scripts/build.ts:22-29`, `scripts/build.ts:65`

- **Cause:** `fromLatest = start.after` and `untilEarliest = finish.first`.
- **Day-precision start (P580 = 2000-05-01):** `fromLatest` becomes 2000-05-02, so `resolve(code, {date:'2000-05-01'})` is `uncertain` with no preferred answer, even though the start is exact.
- **Day-precision end (P582 = 2010-10-10):** this maps to `until` 2010-10-11 (end day inclusive) but `untilEarliest` 2010-10-10. So the last day, which is certainly active under the build's own reading, is uncertain.
- **Scope:** month precision is off by one at the edge in the same way. The current corpus uses only year-precision qualifiers, so it's latent.
- **Tests:** none covers it. The fix changes none of `test/registry.test.ts:617-623` (which feeds the bounds directly).

### 8. Low: `label`-kind policy aliases are emitted without checking the snapshot
`scripts/build.ts:72-76`

- **Behavior:** `{entity:'Q43', value:'Türkiye', kind:'label', language:'tr'}` becomes a `policy-label` assignment even if `labels.tr` in the pinned snapshot is different.
- **Scenario:** a refresh where Q43's Turkish label changes still builds, and the accepted-inputs guard passes, because the policy row exists.
  - This contradicts `CONTRIBUTING.md:20`: "a local data patch cannot substitute for fixing upstream".
  - Only the evidence job reports the `mismatch`, inside a report that always fails.
- **Fix:** check `e.labels[language].value === extra.value` at build time.
- **What the fix would change:** no existing test.

### 9. Low: the Slackwater inventory and its licensing condition have no code behind them
`scripts/benchmark.ts:45-77`, `sources/slackwater-required.json:3-4`

- **Unchecked pin:** nothing reads `slackwater-required.json`.
  - Its `revision` (f9c3d42…) is typed by hand.
  - Its `inventorySource`, `reports/benchmark.json`, records no Slackwater revision.
  - Re-running `npm run benchmark <other checkout>` overwrites that file with no record of which checkout produced it.
  - No test checks "every required input" (`README.md:86`).
- **Unenforced license condition:** `DATA_LICENSE.md:13` says per-source licensing records must be preserved before an inventory derived from those files is distributed, and that inventory is still pending. Nothing enforces it.
  - `package.json` has no `files` list, so `npm pack` would ship both `sources/slackwater-required.json` and `reports/benchmark.json`.
  - `private: true` is the only barrier, and it blocks only `npm publish`.

### 10. Low: values copied by hand instead of referenced
- `README.md:25` "dataset 2 requires reader 0.0.2" copies `sources/policy.json:2` and `src/common.ts:3`.
- `package.json:3` `"version": "0.0.2"` duplicates `READER_VERSION`, and nothing ties the two together.
- `reports/findings.md:3` (28,276 bytes, 119 assignments, 136 requests), `:7` (81/55), `:59` (25 tests) and `:61` (119) are copied from build and test output. They're correct today and go stale on the next rebuild.
- `README.md:84` and `findings.md:44` ("four inputs resolve", 8,554 uncovered records) come from a benchmark run on the dataset-1 binary (`reports/benchmark.json` `bytes` 28,256).

## Step 1 map

| Item | Writers | Readers / consumers | Docs |
|---|---|---|---|
| `sources/manifest.json` | `scripts/fetch-wikidata.ts:21` | `scripts/build.ts:7,14,40-44,82`; `scripts/check-evidence.ts:66-70` (offline); `test/build.test.ts:13-21` | README:63; CONTRIBUTING:20; DATA_LICENSE:5 |
| `sources/wikidata/*.json` | `fetch-wikidata.ts:16-17` | `build.ts:41-43`; `check-evidence.ts:69-71`; `test/build.test.ts:15-20` | README:63 |
| `sources/policy.json` (datasetVersion, referenceDate, coverage*, aliases) | hand-edited; `test/build.test.ts:22` (temp copy) | `build.ts:9,32,72-76,81-82` | README:63; findings.md |
| `sources/accepted-inputs.json` | hand-edited | `build.ts:78-79` only | README:92; CONTRIBUTING:23; DATA_LICENSE:15; findings.md:61; `test/build.test.ts:48-52` |
| `sources/slackwater-required.json` | hand-edited (no script) | none in code | CONTRIBUTING:3; DATA_LICENSE:13; README:84-86 |
| `sources/licenses/country-code-lookup-MIT.txt` | hand-added | none | DATA_LICENSE:15 |
| `data/countries.crdb` | `build.ts:85` | `src/index.ts:46` (`open`); `check-evidence.ts:19,28`; `benchmark.ts:13,68`; `demo.ts:3`; `test/registry.test.ts:8`; `test/evidence-cli.test.ts:14`; `test/package.test.ts:9` via `package.json:15` `./data`; `check.yml:21` | README:48,63 |
| `data/evidence.json` | `build.ts:81,86` | `check-evidence.ts:21-27`; `benchmark.ts:74`; `test/evidence-cli.test.ts:19` | README:63 |
| `data/release.json` | `build.ts:87` | no code reader (`compareRelease` takes caller input, `index.ts:98`) | README:25,54,63 |
| `reports/evidence.json` | copied by hand from `check-evidence.ts:90` (default `reports/local/evidence`, `:15`) | none | findings.md:7; CONTRIBUTING:21 |
| `reports/benchmark.json` | `benchmark.ts:75-77` (only with sourceDir) | `slackwater-required.json:4` (declared source) | findings.md:23,44; README:57,84 |
| Metadata `datasetVersion` / `formatVersion` / `minimumReaderVersion` | `build.ts:82`; `compile.ts:15-19,51` | `index.ts:50-55,98-102`; `check-evidence.ts:24,54,89` | README:25; tests `registry.test.ts:14-24`, `evidence-cli.test.ts:24-27` |
| `READER_VERSION` / `FORMAT_VERSION` (`common.ts:3-4`) | — | `common.ts:39-43`; `build.ts:82`; `check-evidence.ts:75`; `fetch-wikidata.ts:6`; `index.ts:55,101`; `compile.ts:16` | `package.json:3` (copy); README:25 |
| Assignment `status` values (`iso-code`, `historical-code`, `withdrawn-code`, `deprecated-claim`, `label`/`alias`, `policy-*`) | `build.ts:65,71,75` | `index.ts:134` (`deprecated-claim`); `index.ts:23` `matchedBy` → `demo.ts:7`; `check-evidence.ts:38` (facts) | README:92; `registry.test.ts:151` |
| `from`/`fromLatest`/`until`/`untilEarliest`, `timeBounds`, `qualifierTime` | `build.ts:17-38,65`; `compile.ts:34-37` | `index.ts:66` (validate), `index.ts:131-133` (resolve) | README:30,59; findings.md:15-17,49; tests `registry.test.ts:595-623`, `build.test.ts:27-40` |
| Entity `until` / successors / continent (P576/P1366/P30) | `build.ts:49-58`; `compile.ts:25-29` | `index.ts:25,27,60-62,131` | README:28 |
| Evidence request kinds and IDs | `build.ts:45-47,69-70,73-74` | `evidence.ts:25-57`; `check-evidence.ts:26-36,49-52` | README:72 |
| Finding statuses (`source-match` etc.), `passing` | `evidence.ts:8,57` | `check-evidence.ts:88-92`; `evidence.ts:61` | README:72; findings.md:7,11; `evidence.test.ts` |
| `Result.selection` / `Candidate.applicability` / `tentative` | `index.ts:17,34,129-155` | `demo.ts:7`; `benchmark.ts:30-43,60-61` | README:59; findings.md:15-17 |
| Package exports / `dist/` | `tsconfig.build.json` via `package.json:27`, run by `package.json:20-21` | `test/package.test.ts:7-9`; external git/file installs | README:46,57; `.gitignore:3` |
| CI jobs | `.github/workflows/check.yml:8-21` (build/test/diff `data/`), `:22-48` (trusted-base evidence) | — | README:74; findings.md:11 |
| Wikidata HTTP fetch (User-Agent, 30 s timeout, 4 MB cap) | `fetch-wikidata.ts:10-13`; `check-evidence.ts:73-79` | — | README:72 |
