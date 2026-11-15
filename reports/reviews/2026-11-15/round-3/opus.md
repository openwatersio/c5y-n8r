I found no critical defects. There are two medium findings, both gaps in the compatibility guard that CONTRIBUTING.md and the README lean on, plus several low ones. This was a read-only review: I didn't run the tests, the build, the benchmark or the evidence checker. The base commit `39c420e` is empty, so the whole tree is new code.

## Findings

**1. Medium: a PR can change answers and edit the expected-answer fixture without any check flagging it.** `scripts/build.ts:84-97`, `scripts/check-evidence.ts:48-60`, `.github/workflows/check.yml:19-43`
- CONTRIBUTING.md:23 says "Changes to expected answers or fixture removal require explicit review against the base revision." No code compares `sources/accepted-inputs.json`, or the reader's answers, to the base.
- **Scenario:** a PR edits `resolve()` in `src/index.ts:142-152` so an undated `CS` lookup prefers Q33946 instead of Q37024, and edits the `CS` entry in `accepted-inputs.json` to match.
  - The build/test job runs the PR's own reader against the PR's own fixture, so it passes.
  - The rebuilt binary is byte-identical, so `git diff -- data/` is clean.
  - The evidence job sees the same facts and the same requests. It reports `applicable: false` and exits 0.
- Deleting individual `lookups` entries also passes. The build only requires `lookups` to be non-empty (`build.ts:85`).
- **Fix:** in the build/test job, diff `accepted-inputs.json` against the merge base and fail, or require a label, when an entry is removed or an expected value changes.
  - This changes no existing tests.
  - The README:72 contract, where an unchanged `--base` run exits 0, and the evidence-cli tests stay valid if this is a separate step.

**2. Medium-low: new inputs need no expected-answer entry, and every entry pins a namespace, but real callers pass none.** `scripts/build.ts:86`, `scripts/benchmark.ts:60`
- The README says the build rejects "changed answers, including a new competitor". That only holds for the namespaced lookups already in the fixture.
- The README example, `demo.ts:5` and the Slackwater coverage path (`benchmark.ts:60`, `countries.resolve(name)`) all call `resolve()` without a namespace. All 120 fixture lookups set one.
- **Scenario:** a refresh adds an English alias `TR` to Q213. The build demands only an `inputs` entry `{Q213, name, TR}`.
  - The pinned `TR` / `iso-alpha2` lookup is unchanged, so the build passes.
  - The un-namespaced `resolve('TR')` now gets an `active` name candidate (Q213) plus an `uncertain` code candidate (Q43). Its answer changes from Q43 to no preferred answer and `ambiguous`.
- This already diverges today: un-namespaced `resolve('cs')` prefers Q37024, because the retired CS code with the latest end wins. The pinned `cs` / `name` answer is Q33946.
- **Fix:** require a lookup for every new input, and pin un-namespaced lookups for inputs of 2–3 characters. This adds fixture entries and changes no existing tests.

**3. Low: the evidence checker rejects entities over 4 MB, but the fetcher accepts any size.** `scripts/check-evidence.ts:79` vs `scripts/fetch-wikidata.ts:14`
- The largest pinned snapshots today are about 1.1 MB (Q43, Q145). The first milestone is 129 Slackwater countries, which includes large entities such as Q30, Q183 and Q142.
- If any of those exceeds 4 MB, `source:fetch` and the build accept it. The CI evidence job then reports every request for that country as an infrastructure error, permanently. The check only runs after the full body has downloaded.
- Before expanding, measure with something like `curl -s https://www.wikidata.org/wiki/Special:EntityData/Q30.json | wc -c` for each required country.
- No tests pin the 4 MB limit.

**4. Low: a mixed-precision start and end in the same year aborts the build, even though the data is consistent.** `scripts/build.ts:68`, `src/compile.ts:36`
- **Scenario:** a year-precision start of 2000 and a day-precision end of 2000-03-01.
  - The build computes the latest possible start as 2000-12-31 and the end bound as 2000-03-02.
  - `fromLatest > until` then throws "Invalid assignment interval".
- **Fix:** clamp the latest start to `until - 1` and the earliest end to `from + 1`.
- The `registry.test.ts` "overlapping imprecise bounds" fixture and the `build.test.ts` exact-day test are unaffected.

**5. Low: the evidence job on this branch's own PR cannot produce a report.** `.github/workflows/check.yml:26-43`
- The trusted checkout is the base SHA. Main is `39c420e`, which has no `package.json`, so `npm ci` fails and no artifact is uploaded.
- If `c0e0e27` were the base instead, its checker has no try/catch and would crash on the format-2 binary without writing a report. README:74 says an unsupported checker "must report the incompatibility".
- The first data PR therefore needs a manual evidence run.

**6. Low: a local `--base` run against an older-format base is reported as if the proposed data were incompatible.** `scripts/check-evidence.ts:49, 96-97`
- **Scenario:** a maintainer runs the new checker with `--base` pointing at a `c0e0e27` checkout, following CONTRIBUTING's "review against the base revision".
- `load(base)` throws `CompatibilityError`, which is reported as `reader-compatibility` with the base's metadata. Nothing says which side failed.

**7. Low: the Slackwater inventory has an undocumented second copy, and the packaged license doc has a dangling link.** `DATA_LICENSE.md:13,15`, `package.json:42-50`
- `reports/benchmark.json` repeats the per-value Slackwater country strings and counts. DATA_LICENSE names only `sources/slackwater-required.json` as the pending-license inventory.
- Only the `files` whitelist keeps `benchmark.json` out of the package, and only the inventory file's exclusion is tested (`package.test.ts:36`).
- The packaged `DATA_LICENSE.md` links to `sources/licenses/country-code-lookup-MIT.txt`, which the package does not include.

**8. Low: the source refresh rewrites the manifest with current revisions only.** `scripts/fetch-wikidata.ts:9-28`
- README:63 says "Historical snapshot files remain available for provenance." Older snapshot files stay on disk, but no manifest indexes them, so the build, the offline checker and the package can't find them.
- A failed fetch partway through leaves new snapshot files with no manifest entry.

**9. Low: what real callers will hit at runtime.**
- From 2026-11-16, any dated call past the reference date, such as `resolve(x, { date: new Date() })`, falls outside coverage and returns no preferred answer (`src/index.ts:118-119,152`; `registry.test.ts:92` pins this).
- Git installs made with `--ignore-scripts` skip the `prepare` step, so `dist/` is missing and the package export fails to load.
- No code path returns `verified` any more (`src/evidence.ts:57`), so every data PR's evidence job is red regardless of content. That is documented, but it means the job gives no pass/fail signal for data PRs.

**Copies of values that have a source:**
- README:24 repeats "dataset 2 / format 2 / reader 0.0.2" from `common.ts:3-4` and `policy.json:2,44`.
- `accepted-inputs.json` has `"baselineDatasetVersion": 2`, which no code reads.
- `package.json` `"version": "0.0.2"` is not tied to `READER_VERSION`.
- README:84, findings.md:44 and `slackwater-required.json:5` copy the 129 / 8,728 / 4 counts from `reports/benchmark.json`. That report was recorded with the dataset-1 reader (`"bytes": 28256`), and nothing regenerates or checks it.

## Step 1 map

| Artifact / symbol | Writers | Readers / consumers |
|---|---|---|
| `data/countries.crdb` | `scripts/build.ts:99` via `src/compile.ts:13-55` | `src/index.ts:46`; `check-evidence.ts:19,28`; `benchmark.ts:13,68`; `demo.ts:3`; `registry.test.ts:8`; `evidence-cli.test.ts:15,35`; `package.test.ts` (via the `./data` export, `package.json:15`); `check.yml:21` |
| `data/evidence.json` | `build.ts:100` | `check-evidence.ts:21-27`; `benchmark.ts:74`; `evidence-cli.test.ts:19` |
| `data/release.json` | `build.ts:101` | no code reader (`compareRelease` uses metadata the caller supplies, `index.ts:99`); `check.yml:21` |
| `sources/manifest.json` | `fetch-wikidata.ts:28` | `build.ts:8,15,41-45,90`; `check-evidence.ts:67-71` (offline only); `build.test.ts`; `refresh.test.ts`; shipped by `package.json:46` |
| `sources/wikidata/*.json` | `fetch-wikidata.ts:24` | `build.ts:42`; `check-evidence.ts:70` |
| `sources/policy.json` | hand-edited; temp copies in `build.test.ts:22` | `build.ts:10,33,75-81,89-90` |
| `sources/accepted-inputs.json` | hand-edited (no generator) | `build.ts:84-97` only |
| `sources/slackwater-required.json` | hand-made from `reports/benchmark.json` | no code reader; `package.test.ts:36` asserts it is excluded |
| `reports/benchmark.json` / `reports/local/` | `benchmark.ts:75-77` | docs: README:84, findings.md |
| `reports/evidence.json` | copied by hand from `check-evidence.ts:91` output | findings.md:7 |
| `FORMAT_VERSION` (`common.ts:4`) | — | `compile.ts:16`; `index.ts:55,102`; `build.ts:90`; `registry.test.ts:10`; README:24 |
| `READER_VERSION` (`common.ts:3`) | — | `common.ts:40`; User-Agent strings in `fetch-wikidata.ts:6` and `check-evidence.ts:76` |
| `minimumReaderVersion` | `policy.json:44` → `build.ts:90` | `compile.ts:17,51`; `index.ts:50,55,102` |
| `datasetVersion` | `policy.json:2` → `build.ts:89-90` | `compile.ts:15`; `index.ts:51,102`; `check-evidence.ts:24,55,90`; tests |
| Assignment `status` strings | `build.ts:68,74,81` | `index.ts:23` (`matchedBy`), `index.ts:135` (`deprecated-claim`); `compile.ts:33`; `check-evidence.ts:38` |
| `verify(bytes, envelopeOnly)` | — | `index.ts:47,56` only |
| `applicability`, `tentative`, `selection` | `index.ts:130-156` | `build.ts:96`; `demo.ts:7`; `benchmark.ts:61`; tests |
| Finding status `source-match`, `passing()` | `evidence.ts:57,61` | `check-evidence.ts:88-93`; `evidence.test.ts` |
| `CompatibilityError` | `index.ts:12,55` | `check-evidence.ts:96`; `registry.test.ts`; `evidence-cli.test.ts:42-46` |
| Package export / `dist/` | `tsconfig.build.json`; `package.json` scripts `build:reader` and `prepare`; ignored in `.gitignore` | `package.test.ts`; README:46,57 |
| Network endpoint | Wikidata `Special:EntityData`: `fetch-wikidata.ts:11`, `check-evidence.ts:74` | — |

There are no env vars, databases, scheduled jobs or migrations. The CI workflow is `check.yml`, with a build/test job and a PR-only evidence job. CONTRIBUTING.md has no "Review checks" section.
