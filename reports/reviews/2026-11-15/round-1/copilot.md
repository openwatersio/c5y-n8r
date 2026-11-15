Greenfield repo. Read the core code.

Output tool seems to always spill; view files directly.

**Findings**

1. **Medium — `src/index.ts:107-111`, `README.md` (the "Optional date lookup" bullet).** Any lookup that passes an explicit `date` can never return a preferred answer for a name, `unofficial` code or undated ISO code.
   - For a name or `unofficial` match, `name` is true, so the candidate is always `'uncertain'`.
   - For an ISO code with neither bound set, the `from === MIN_DAY && until === MAX_DAY` clause makes it `'uncertain'` too.
   - Examples: `resolve('Turkiye', {date:'2020-01-01'})` and `resolve('TR', {date:'2020-01-01'})`, where TR is an undated P297 claim.
   - Both return `preferred: undefined` with `selection: 'ambiguous'`, although there is exactly one candidate. `'ambiguous'` is the wrong label for a single candidate.
   - I did not run this because command execution was denied; it follows from the code. No test covers dated name or undated-code lookups: `test/registry.test.ts` only covers CS, the fixture ZZ, and an invalid date.
   - A fix to the label or rule would change the `'ambiguous'` assertion in `missing bounds cannot outrank…` only if it touched the undated no-`date` path. It leaves the other tests unchanged.

2. **Medium — `scripts/build.ts:47-53`, `scripts/build.ts:35-45`.** `timeBounds` returns `undefined` for any non-Gregorian calendar model, `before`/`after` ranges, or precision below 9.
   - The caller then treats the qualifier as absent. A P582 end date given in the Julian calendar becomes `status: 'iso-code'` with no end.
   - A P576 end date with an unsupported shape is skipped entirely.
   - Nothing logs this or fails the build. A retired code can then resolve as active, and the evidence request still records the qualifiers, so the evidence check passes.
   - `rank === 'deprecated'` claims are also compiled as candidates (`status 'deprecated-claim'`). A deprecated claim with no dates can become the sole preferred answer.
   - Fix: throw or mark the assignment unreviewed. It touches no existing test.

3. **Medium — `.github/workflows/check.yml:25-47`.** The `wikidata-evidence` job checks out the base commit into `trusted/` and runs `npm ci` and the checker there.
   - For this PR the base (`39c420e`) has no `package.json` or scripts, so `npm ci` fails. The check will be red for the bootstrap PR.
   - After that, the job fails for any data PR that touches a statement (see item 4).
   - The `build-and-test` job does not run `npm run evidence`.

4. **Low — `scripts/check-evidence.ts:84-86` versus `src/evidence.ts:48`.** Every `kind: 'statement'` request returns `needs-review` by design, so any PR that changes an ISO code, continent or successor can never pass. The README and CONTRIBUTING.md disclose this.
   - There is also no way to record a maintainer's resolution.
   - `--offline` always reports `passed: false`, but exits 0 when `findings.length` is 0 (`check-evidence.ts:87`). The README says both modes exit nonzero.

5. **Low — `CONTRIBUTING.md` (the "four sources" rule), `README.md` (First milestone).** The four-source and independence requirement has no enforcing code.
   - `src/evidence.ts` collects only P854 and P248 reference URLs and never counts them or checks independence.
   - CONTRIBUTING.md does say this openly ("does not … enforce independent corroboration").
   - The unverified claim is reachable at runtime: `evidenceStatus` is always the literal `'unreviewed-spike'`, so nothing downstream signals a verified dataset either.

6. **Low — `reports/findings.md:55`.** "Select the project name and license before any public release" is stale: commit 9d1a87d added `LICENSE` (MIT) and `DATA_LICENSE.md`.

7. **Low — `scripts/fetch-wikidata.ts:17,21`, `scripts/build.ts:75`.** `source:fetch` writes `sources/wikidata/Q…-<rev>.json` for each new revision and never removes the old ones. Stale snapshot files accumulate, and the manifest no longer references them.
   - `retrievedAt` is `new Date()`, and `builtAt` is the maximum of those values. Re-running fetch on unchanged data churns `manifest.json` and the binary (`builtAt`), so `git diff -- data/` fails even though no facts changed.
   - The same Wikidata list is also hardcoded in `fetch-wikidata.ts:4`, while `build.ts` takes `allIds` from the manifest. Adding a QID needs a code edit.

8. **Low — `scripts/build.ts:60-65`.** Successor pointers are silently dropped when the target is not in the manifest (`allIds.has(...)`). The findings report mentions this, but the build does not warn. A partial corpus can therefore ship an incomplete AN successor list without the evidence check flagging it.

9. **Info — `reports/findings.md` and `reports/evidence.json`.** The report counts (119 assignments, 136 requests, 82 verified and 54 review findings) are not reproducible in CI. I could not rerun them because execution was denied. They are hand-copied into prose that no check ties to the data.

**Checked, no issue found**
- `verify` and `open` structural bounds.
- The evidence-companion digest binding.
- The `--base` facts-diff gate, which `test/evidence-cli.test.ts` covers.
- Evidence file name construction: the `qid` is validated before `writeFile`.
- Date parsing: it rejects 2025-02-29 and month 13.
- Wikidata CC0 notices in `DATA_LICENSE.md`.
- No local paths or credentials in the committed reports.

**Step 1 map (system: greenfield; the base commit is empty)**
- **`data/countries.crdb`**
  - Written by `scripts/build.ts:81` through `src/compile.ts`.
  - Read by `src/index.ts:44` (`open`), `scripts/check-evidence.ts:14`, `scripts/benchmark.ts:13`, `scripts/demo.ts:3`, `test/registry.test.ts:8` and `test/evidence-cli.test.ts`.
  - Gated by `check.yml:23` (`git diff -- data/`) and exported as `./data` in `package.json`.
- **`data/evidence.json`**
  - Written by `build.ts:82`.
  - Read by `check-evidence.ts:15` (digest compared with the binary's `evidenceDigest`), `benchmark.ts` and the CLI test.
- **`data/release.json`**: written by `build.ts:83`. Nothing in the repo reads it.
- **`sources/manifest.json`**
  - Written by `scripts/fetch-wikidata.ts:21`.
  - Read by `build.ts:7` and by `check-evidence.ts` (offline mode, line 51).
- **`sources/wikidata/*.json`**: written by `fetch-wikidata.ts:16`. Read by `build.ts:30` and `check-evidence.ts:53`, both after digest checks.
- **`sources/policy.json`**: hand-edited. Read only by `build.ts:8`, which supplies the dataset version, reference date, coverage and aliases.
- **`sources/slackwater-required.json`**: written by hand or from a benchmark run. Read by `README.md` and `CONTRIBUTING.md` only; no code reads it.
- **`reports/benchmark.json`**: written by `benchmark.ts:76`. Read by `slackwater-required.json` (metadata) and `findings.md`.
- **`reports/evidence.json`**: a manual copy of the evidence output. No reader.
- **Shared functions**
  - `src/common.ts` (`day`, `normalize`, `keyFor`, `alpha2Slot`) is used by `compile.ts`, `index.ts`, `verify.ts` (no, not `verify.ts`) and the tests.
  - `compile.ts` is called by `build.ts` and the tests.
  - `verify.ts` is called only by `CountryRegistry.open`.
  - `evidence.ts` is called by `check-evidence.ts`, `build.ts` (types) and `test/evidence.test.ts`.
- **`schema/countries.fbs`**: generates `src/generated/*` through `npm run generate` (flatc is pinned in `.mise.toml`). No CI check verifies that the checked-in generated files match the schema.
- **CI (`.github/workflows/check.yml`)**: `build-and-test` runs `npm run check`, `npm run build` and `git diff -- data/`. `wikidata-evidence` runs the trusted checker against the proposed corpus on pull requests only.
- **Docs**: `README.md`, `CONTRIBUTING.md`, `DATA_LICENSE.md` and `reports/findings.md` restate the license, counts and exit-code behaviour that the code defines.
- **Upgrade and rollback**: there is no deployed version, no migration and no older reader. `minimumReaderVersion` and `formatVersion` are checked only within this repo (`index.ts:56`).

