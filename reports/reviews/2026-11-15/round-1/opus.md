I found no blocking defects. That's because nothing is deployed and the base commit 39c420e is empty. The serious findings are about the project's central promise: keeping old spellings so they still resolve, and what the evidence check calls "verified".

I could only review statically. Running `npm test` was denied, so I did not execute anything. Every result below comes from reading the code and the checked-in data, the evidence report and the Wikidata snapshots.

## Findings

**1. Medium-High: a Wikidata sync can silently drop spellings Slackwater already relies on** (`scripts/build.ts:57-60`, `scripts/check-evidence.ts:46-51`)
- **Scenario:** a Wikidata editor removes the alias "DRC" from Q974, or changes Q43's English label from "Turkey" to "Türkiye". `npm run source:fetch` followed by `npm run build` then leaves that spelling out of `countries.crdb`.
- **Why nothing catches it:**
  - `npm run check` still passes. Only Turkey, Czech Republic, Czechia and Curaçao are pinned (`test/registry.test.ts:28-33`).
  - CI's `build-and-test` job only compares the rebuilt `data/` against the committed one.
  - The local `npm run evidence` has no `--base`, so removals never appear in it. CONTRIBUTING step 5 tells contributors to run exactly that.
  - Only the PR job reports `Evidence or accepted meaning removed`. That line sits among about 54 other needs-review findings that are always present, and the job is expected to fail anyway.
- **Doc conflict:** CONTRIBUTING requires "compatibility fixtures" and "retain old accepted spellings". No such fixtures exist, and the build only re-imports the current snapshot. This is the exact failure README's table names as the reason the project exists.
- **Fix:** commit a fixture of accepted inputs and have the build or tests fail when a key disappears. No existing test changes.

**2. Medium: the current holder of a reused ISO code never wins an undated lookup** (`src/index.ts:131`, `scripts/build.ts:54`)
- **Cause:** any code assignment with no end date is marked `uncertain` unless `temporalReviewed` is true, and every import path hard-codes it to false (`build.ts:54,60,64`).
- **Scenario:** at full coverage, AI (Afars and Issas → Anguilla), BQ (British Antarctic Territory → Caribbean Netherlands, Q27561 is already in the corpus) or GE (Gilbert and Ellice Islands → Georgia). The retired holder becomes eligible, the current one counts as `uncertainOther`, and the result is `ambiguous` with no preferred answer.
- **Inconsistency:** the same code with `date: referenceDate` resolves to the current holder. The milestone requires the current ISO code to resolve.
- **Tests affected by a fix:** `registry.test.ts:73` uses an assignment with both bounds missing, so treating "known start, open end" as active does not change it. The CS tests (`:54-64`) are unaffected.

**3. Medium: the evidence checker marks local normalization and zero-reference spellings as `verified`** (`src/evidence.ts:42-57`, `sources/policy.json:6-7`, `scripts/build.ts:61-64`)
- **ASCII folding:** the policy alias `Turkiye` is `kind: ascii-label`. It is local diacritic stripping (NFD, then remove marks), yet `reports/evidence.json:62-72` shows both Q43 policy aliases as `verified`. CONTRIBUTING says normalization "must be clearly identified as policy" and cannot "bypass source verification".
- **Hidden origin:** in the binary, the policy alias gets `matchedBy` = `label`, the same as an imported Wikidata label.
- **Any language accepted:** any label in any language can be added this way, e.g. a `tr` label for another entity.
- **Four-source rule cannot be met:** labels and aliases cannot carry references on Wikidata, so all 82 `verified` results have no references.
- **`unofficial` namespace unchecked:** `check-evidence.ts:34-35` limits evidence kinds only for the ISO namespaces. A PR can back `UK` with an `alias` request and get `verified` without the "independent code-system evidence" its own `reason` demands.
- **Tests affected by a fix:** `test/evidence.test.ts:8-13` pins label → `verified`.

**4. Medium: deprecated Wikidata claims are imported whatever the reason** (`scripts/build.ts:54`)
- A claim with deprecated rank only gets the status `deprecated-claim`; the reader never looks at status.
- CS works only because its deprecation reason (P2241) is Q110770329, which `reports/findings.md` describes as a withdrawn code.
- **Scenario:** a P297 statement deprecated as an incorrect value, with no dates, becomes the only `uncertain` candidate and is returned as `preferred` in an undated lookup.
- **Fix:** filter on P2241. No existing test changes.

**5. Medium: end dates that fail to parse become "still valid", and dated code lookups ignore dissolution** (`scripts/build.ts:18-20,40,52-54`, `src/index.ts:135`)
- **End qualifiers:** `timeBounds` returns `undefined` for an "unknown value" end (P582), a non-Gregorian calendar, precision below a year (e.g. "1990s"), or non-zero `before`/`after`. The assignment then gets `status: iso-code` with no end.
- **Dissolution dates:** the entity's dissolution date (P576) is used only at day precision. A dissolved state recorded with year precision never ends.
- **Dated lookups:** `index.ts:135` uses only the assignment's own bounds for codes. A dissolved entity's code with a known start and no end is therefore `active` at any later date.
- The current snapshots contain none of these shapes; I grepped `data/evidence.json`. The next sync can bring them in.
- **Fix:** make the build fail on these shapes, or keep them as explicitly unknown. No existing test changes.

**6. Low-Medium: dated name lookups report `ambiguous` with only one country involved** (`src/index.ts:137,152-156`)
- `resolve('Turkey', {date: '2020-01-01'})` marks every name candidate `uncertain`. The id set is empty, so `uncertainOther` is true and `selection` is `ambiguous`.
- The same happens for codes with no date qualifiers at all, e.g. `resolve('TR', {namespace: 'iso-alpha2', date: '2020-01-01'})`.
- No test covers dated name lookups.

**7. Low-Medium: an undated lookup ignores the uncertainty window that a lookup dated today respects** (`src/index.ts:131-132`)
- A code ended with year precision `+2026` has an end of 2027-01-01 and an earliest end of 2026-01-01.
- Undated, it is `active` and preferred; with `date: '2026-11-15'` it is `uncertain` with no answer. "Undated" is defined as the reference day, so the two should agree.

**8. Low-Medium: the package entry point only runs under tsx** (`package.json` exports, `src/index.ts:2,13,17,44`)
- `index.ts` uses TypeScript parameter properties, which Node 24's type stripping rejects with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
- It imports `./generated/country-spike.js`, but only a `.ts` file exists.
- Node also refuses to strip types inside `node_modules`.
- A Slackwater install via a git dependency, or plain `node` running the README example, fails. CI only ever runs through tsx.

**9. Low: no check that a data change bumps the dataset version** (`sources/policy.json:2`, `src/index.ts:101`)
- CONTRIBUTING requires "the dataset version change". A PR that changes facts but keeps `datasetVersion: 1` passes the build job.
- `compareRelease` then reports `current` against the older release, because it ignores `sha256` and `evidenceDigest`.

**10. Low: the uppercase Turkish spelling misses** (`src/common.ts:18`)
- `'TÜRKİYE'.toLowerCase()` gives `türki̇ye` (an extra combining dot), so it does not match.
- The test only covers `TÜRKIYE` with a dotless capital I.

**11. Low: `npm run benchmark` as shown in the README erases the Slackwater inventory** (`scripts/benchmark.ts:45-46,76`)
- With no directory argument it overwrites `reports/benchmark.json`, removing the 8,728-record inventory that `sources/slackwater-required.json` cites as its `inventorySource`.
- No code reads `slackwater-required.json`.

**12. Low: the source sync has its own entity list and leaves old files behind** (`scripts/fetch-wikidata.ts:4,15,20`)
- The ID list is hard-coded. A sync rewrites the manifest from it, dropping any entity added only to the manifest.
- Old `Q*-<rev>.json` snapshots are never deleted.

**13. Low: the PR evidence job breaks when the base has no corpus** (`.github/workflows/check.yml:39-42`)
- For this branch's first PR, the trusted checkout (empty 39c420e) has no `package.json`, so `npm ci` fails.
- `load(base)` also throws whenever the base has no `data/`.

**14. Low: docs that claim more than the code does**
- `reports/findings.md` still says "Select the project name and license", although commit 9d1a87d set them.
- README says the checker verifies "the binary/evidence binding". `load()` only binds assignments; entity name, continent, dissolution date and successors have no evidence pointer.
- `reports/evidence.json` records neither the evidence digest nor the binary hash, so nobody can tell whether it is stale.

**15. Low: an imported dataset has no license record** (`sources/slackwater-required.json`)
- It brings in Slackwater input values and country-code-lookup 0.2.1 baseline codes.
- DATA_LICENSE.md requires each imported dataset to record its license and notices. None is recorded, and nothing enforces it.

**16. Low: version values copied instead of shared**
- `build.ts:68` hard-codes `formatVersion: 1` and `'0.0.1'` instead of `FORMAT_VERSION` and `READER_VERSION` from `common.ts`.
- `READER_VERSION` copies the `package.json` version.
- The `0.0.1` in the User-Agent strings appears in two scripts.

## Step 1 map

**Snapshots** (`sources/wikidata/*.json`)
- Writer: `fetch-wikidata.ts:16`.
- Readers: `build.ts:32`, `check-evidence.ts:67` (offline mode).

**`sources/manifest.json`**
- Writer: `fetch-wikidata.ts:20`.
- Readers: `build.ts:7,14,31,67,68`, `check-evidence.ts:64`.
- Docs: README:61, DATA_LICENSE:5.

**`sources/policy.json`**
- Reader: `build.ts:9,61,67-68`.
- Docs: README:61.

**`sources/slackwater-required.json`**
- Hand-written; no reader.
- Docs: CONTRIBUTING:3.

**`data/countries.crdb`**
- Writer: `build.ts:71`; also a temporary copy in `evidence-cli.test.ts:18`.
- Readers: `index.ts:46`, `check-evidence.ts:18`, `benchmark.ts:13`, `demo.ts:3`, `registry.test.ts:8`, `evidence-cli.test.ts:14`, `package.json` `./data` export.
- CI: `check.yml:22`.

**`data/evidence.json`**
- Writer: `build.ts:72`.
- Readers: `check-evidence.ts:20`, `benchmark.ts:74`, `evidence-cli.test.ts:19`.

**`data/release.json`**
- Writer: `build.ts:73`.
- No reader; `compareRelease` (`index.ts:98`) expects the caller to supply it.

**Reports**
- `reports/benchmark.json`: writer `benchmark.ts:76`; referenced by `slackwater-required.json:4`.
- `reports/evidence.json`: committed copy of the `check-evidence.ts:88` output.
- `reports/local/`: default output of `check-evidence.ts:14`; listed in `.gitignore`.

**Binary metadata fields** (`datasetVersion`, `formatVersion`, `minimumReaderVersion`, `referenceDate`, `builtAt`, `evidenceDigest`, coverage)
- Written by `build.ts:68` and `compile.ts:15-19,51`.
- Read by `index.ts:50-55,101,117-118` and `check-evidence.ts:21,23,28`.
- Tests: `registry.test.ts:12-25`.

**Assignment fields** (`status`, `temporalReviewed`, date bounds, `evidence`)
- Written by `build.ts:54,60,64` and `compile.ts:31-37`.
- Read by `index.ts:23-26,66,131-137` and `check-evidence.ts:30-37`.

**Keys and direct indexes** (alpha-2, numeric)
- Written by `compile.ts:39-50`.
- Read by `index.ts:70-92,159-169`.

**Shared functions**
- `normalize` and `keyFor`: used by `compile.ts` and `index.ts`.
- `day`: used by `build.ts`, `compile.ts`, `index.ts` and `registry.test.ts`.
- `readerSupports`: `index.ts:55,101`.
- `checkEvidence` and `passing`: `check-evidence.ts:85`, `evidence.test.ts`.
- `verify`: `index.ts:47`.
- `schema/countries.fbs` is mirrored by `src/generated/*` (generated by `npm run generate`; CI never regenerates it) and by the hand-coded shapes in `verify.ts:3-7`.

**Network endpoint** (`Special:EntityData`)
- Called by `fetch-wikidata.ts:9` and `check-evidence.ts:71`, both with the User-Agent `OpenWatersCountryRegistrySpike/0.0.1`.

**CI** (`check.yml`)
- `build-and-test`: `npm ci --ignore-scripts`, `npm run check`, `npm run build`, then `git diff -- data/`.
- `wikidata-evidence`: runs the checker from the trusted base against the proposed artifacts.
- No secrets; `contents: read`.

**Environment and config**
- No environment variables or caches.
- Node version: `.mise.toml` pins 24.20.0, CI uses `24`, `package.json` engines says `>=24`.
- The `flatc` version is pinned only in `.mise.toml`.

**Docs that make claims about all of the above**
- README, CONTRIBUTING, DATA_LICENSE and `reports/findings.md`.
- There is no CONTRIBUTING "Review checks" section, no PR, and no deployed state or migrations. The base commit is empty, so there is nothing to upgrade or roll back.
