I found 2 medium and 7 low findings. The base commit is empty, so the whole tree is new code. I read every source, script, test, the workflow, the docs and the fixtures. Bash was denied for ad-hoc commands, so I could not run anything. Counts and pass results below come from the repo's own reports, not from runs of mine. Every scenario is traced from the code by hand.

## Findings

**1. Medium: the reader-compatibility check only tests a small part of the reader's behavior.** `scripts/observe-reader.ts:16`, `scripts/check-evidence.ts:75`
- **What it checks:** each case records only the preferred id, the selection and the candidate ids. The 235 base cases cover the exact stored spellings at the reference date, plus three dated `CS` lookups.
- **What it misses:** `coverage`, `temporalAmbiguity`, each candidate's `applicability`, `successors`, `name`, `matchedBy` and `evidence`. It also never tries normalization (whitespace, NFD, case) or dated lookups other than `CS`.
- **Scenario:** a code-only PR changes `src/common.ts:18` to `value.normalize('NFC')` (no trim) and `src/index.ts:165` to always return `coverage: 'partial'`. It also edits `test/registry.test.ts:28,91` in the same PR. The data stays byte-identical, and `open()`'s key check still passes because stored values have no surrounding spaces.
  - `build-and-test` passes.
  - `wikidata-evidence` passes: facts and fixture are equal, so there are no findings.
  - `reader-compatibility` passes all 235 cases.
  - Afterwards `resolve(' Turkey ')` returns `none`, and lookups dated 1970 report `partial` coverage.
- **Why it matters:** CONTRIBUTING:38 asks for reader behavior to be checked against base expectations for code-only changes.
- **Fix:** add the result fields above to the observation schema, and add base cases for whitespace, NFD and case variants, outside-coverage dates, and dated name lookups.
- **What the fix changes:** `sources/accepted-inputs.json`; the comparison in `scripts/build.ts:96-100`; the hand-built observation files in the `missing or duplicated observations` and `mutating the observation job fixture` tests (`test/evidence-cli.test.ts:130,157`); README:76; CONTRIBUTING:23.

**2. Medium: the "trusted base" jobs are defined by the PR's own workflow file.** `.github/workflows/check.yml:55-58,93-96`
- On `pull_request`, GitHub runs the workflow file from the PR's merge commit.
- **Scenario:** a PR changes the `harness`/`trusted` checkouts to `ref: ${{ github.sha }}`, or replaces the step at line 108 with `run: true`. The verdict now runs proposed code, or nothing.
- The trusted checker flags fixture edits (`check-evidence.ts:56`) but never flags changes to `.github/`, `scripts/check-evidence.ts` or `scripts/observe-reader.ts`.
- README:78 says workflow changes need maintainer review. CONTRIBUTING:23,38 still describe the verdict as protected base expectations.
- **Fix:** run the verdict from a base-defined `workflow_run` workflow, or have the trusted checker emit a `needs-review` finding for diffs to those paths.
- **What the fix changes:** no tests; README:76-78.

**3. Low: a changed binary can keep the same dataset version.** `scripts/check-evidence.ts:30-41,87`
- The `facts` comparison leaves out the order of assignment indexes inside each key. The base and proposed `binarySha256` are computed but never compared.
- **Scenario:** a PR changes `src/compile.ts:43` to prepend instead of push, or bumps `flatbuffers` and the layout shifts. It commits the regenerated `data/` and keeps `datasetVersion` at 2. Every gate passes.
- **Effect:**
  - `release.json` now carries a new `sha256` for dataset 2.
  - Old dataset-2 holders get `different` if they compare with the hash and `current` without it.
  - When one entity has two assignments under one key, `preferred.matchedBy`/`evidence` silently swap.
- **Contradicts:** findings.md:61 ("Changed runtime artifacts require an increased dataset version") and the binary-identity item in CONTRIBUTING:38.
- **Fix:** compare `binarySha256` alongside `facts`.
- **What the fix changes:** the statement in findings.md:11 about code-only changes. The `fixture-only changes` test copies identical data, so it is unaffected.

**4. Low: the PR that introduces this cannot pass its own gates.** `check.yml:55-75,93-111`
- Any base that predates this change (committed HEAD `c0e0e27`, or `39c420e`) lacks the new pieces. Against such a base, each PR job fails:
  - `reader-observations` fails because `scripts/observe-reader.ts` is missing.
  - `reader-compatibility`'s guard fails because the base checker ignores `--reader-results` and reports `pinned-snapshots-only`.
  - `wikidata-evidence` crashes on an uncaught `CompatibilityError` (base `FORMAT_VERSION = 1`, no try/catch) and uploads no report.
- This fails closed, but only a fresh install is tested; the upgrade in place was never run. Plan an admin bootstrap merge.
- **What a fix changes:** nothing in tests.

**5. Low: duplicate policy aliases can break the evidence job for every later PR.** `scripts/build.ts:79`
- **Scenario:** two `policy.aliases` entries share entity, namespace and value but differ in `kind` (e.g. Q43 `Türkiye` as `label` and as `local-policy`). The build produces the same request id `Q43:policy:name:Türkiye` twice and succeeds.
- `check-evidence.ts:28` then throws `Duplicate evidence IDs`. Once that is merged, `load(base)` fails, so every later PR's `wikidata-evidence` fails as a `corpus-error`.
- **Fix:** reject duplicate request ids in the build. What it changes: no tests.

**6. Low: the compatibility report names the wrong binary.** `check-evidence.ts:124`, `check.yml:108`
- In reader mode, `binarySha256`/`datasetVersion` describe the trusted base corpus (`--corpus .`), not the proposed binary that was observed.
- Observations carry no binary identity, so the approved artifact shows the base hash.
- **What a fix changes:** no tests.

**7. Low: no timeout on the evidence job, and its fetches are sequential.** `check.yml:22-48`, `check-evidence.ts:122`
- `load()` only binds requests that assignments reference, and base mode checks every changed proposed request.
- **Scenario:** a PR adds 10,000 unreferenced requests with distinct revisions. That means 10,000 sequential Wikidata fetches at up to 30 s each, against the default 6 h job limit and Wikidata rate limits.
- `fetch-wikidata.ts:14` also has no response-size cap, unlike `check-evidence.ts:113`.

**8. Low: stale claims and hand-copied values.**
- `reports/review-2026-11-15.md` is out of date:
  - :72 describes a `--reader` mode that imports proposed code; it is now refused (`check-evidence.ts:46`).
  - :90 says the two PR jobs use different checkouts; both now use `github.sha` (`check.yml:33,62`).
  - :1 says a fifth round is still pending.
- Values copied by hand, with no check tying them together:
  - README:25 copies `policy.json:2,44` and `common.ts:5`.
  - `package.json:3` copies `READER_VERSION` (`common.ts:4`).
  - findings.md:3,59,61 copy build and test counts.
  - `verify.ts:3-7` copies the field order in `schema/countries.fbs` (already acknowledged).

**9. Low: the Slackwater inventory can drift.** `scripts/benchmark.ts:75`
- Running with a source directory rewrites `reports/benchmark.json` without recording the Slackwater revision.
- `sources/slackwater-required.json` (revision pinned by hand, `inventorySource: reports/benchmark.json`) is not regenerated, and nothing checks the two agree.

## Step 1 map

**Binary `data/countries.crdb`**
- Writer: `scripts/build.ts:102`, using `src/compile.ts:13-56`.
- Readers:
  - `src/index.ts:47-98` (reached through `dist/` and the `./data` export, `package.json:15`)
  - `scripts/check-evidence.ts:20-42`, both the evidence and verdict jobs
  - `scripts/observe-reader.ts:10`
  - `scripts/benchmark.ts:13,68`
  - `scripts/demo.ts:3`
  - tests: `registry:8`, `verifier-work:34`, `evidence-cli:22,44`, `package:12,35`
- Gate: `check.yml:21`.

**Schema and layout**
- Generated bindings `src/generated/*` from `schema/countries.fbs` (`package.json:18`, no drift check).
- Shapes hand-copied in `src/verify.ts:3-7`.

**`data/evidence.json`**
- Writer: `build.ts:103`.
- Readers: `check-evidence.ts:22-28`, `benchmark.ts:74`.
- Its digest is embedded at `build.ts:93` and checked at `check-evidence.ts:23`.

**`data/release.json`**
- Writer: `build.ts:104`.
- Readers: `compareRelease` (`index.ts:102-112`), `verifier-work.test:10,41`, `registry.test:187`.
- No trusted checker reads it.

**Sources and fixtures**
- `sources/manifest.json`
  - Writer: `fetch-wikidata.ts:28`.
  - Readers: `build.ts:8`, `check-evidence.ts:101` (offline mode), `refresh.test:13`, `build.test:14`.
  - Shipped: `package.json:47`.
- `sources/wikidata/*`
  - Writer: `fetch-wikidata.ts:24`.
  - Readers: `build.ts:42`, `check-evidence.ts:104`.
- `sources/policy.json`
  - Readers: `build.ts:10,33,75,92-93`, `build.test:17`.
- `sources/accepted-inputs.json`
  - Readers: `build.ts:84-100`, `check-evidence.ts:54-55,62,71`, `observe-reader.ts:8`, `check.yml:75`, `evidence-cli.test:21,62,133,161`, `build.test:18`.
- `sources/slackwater-required.json`
  - Written by hand; excluded from the package (`package.test:39`).
- `reports/benchmark.json`
  - Writer: `benchmark.ts:75`.
  - Excluded from the package (`package.test:40`).
- `reports/evidence.json`
  - Copied by hand from the checker output (`check-evidence.ts:125`).
- `sources/licenses/country-code-lookup-MIT.txt`
  - `package.json:50`, `package.test:41`.

**Shared constants and functions**
- `FORMAT_VERSION`/`READER_VERSION` (`common.ts:4-5`) are used at `index.ts:56,111`, `compile.ts:16`, `build.ts:93`, `check-evidence.ts:110` and `fetch-wikidata.ts:6`, and mirrored in `package.json:3`, `policy.json:44` and README:25.
- `MAX_ENTITY_ID_LENGTH` is enforced at `compile.ts:24` and `index.ts:63`.
- `normalize`/`keyFor` are used at `compile.ts:34,42`, `index.ts:70,83,131` and `checkEvidence`.

**Evidence and reader-check CLI**
- `--corpus/--base/--reader-results/--offline/--output` are used at `check.yml:42,108` and in the `evidence-cli` tests.
- The observation JSON schema is produced at `observe-reader.ts:18` and consumed at `check-evidence.ts:61-80`.
- Report fields `mode`, `passed` and `checkedLookups` are read at `check.yml:111`.

**CI jobs**
- `build-and-test`: `check.yml:8-21`.
- `wikidata-evidence`: `check.yml:22-48`.
- `reader-observations`: `check.yml:50-81`; runs proposed `build:reader` and `dist`; no secrets.
- `reader-compatibility`: `check.yml:83-116`.
- `dist/`: built by `tsconfig.build.json` through `package.json:23,27-28`; ignored at `.gitignore:3`.

**External services**
- Wikidata `Special:EntityData`, called from `fetch-wikidata.ts:11` and `check-evidence.ts:108`.

**Data-license conditions**
- Wikidata CC0: no conditions.
- country-code-lookup MIT notice: shipped in the package and tested.
- DATA_LICENSE:13 asks for Slackwater per-source license records before distributing the inventory. Nothing records them; only package exclusion enforces the condition (`package.test:39-40`), and git clones still carry the inventory.

**Docs checked against code**
- README, CONTRIBUTING (including its Review checks), DATA_LICENSE, `reports/findings.md`, `reports/review-2026-11-15.md`, and the commit messages.
