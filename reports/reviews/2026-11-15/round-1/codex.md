Found two P2 issues. No files were modified.

1. **P2 — Dated lookups promote missing assignment dates to definite matches** — `src/index.ts:137`

   The dated path marks bounds unknown only when **both** ends are missing. The undated path at `src/index.ts:131` correctly checks either missing end.

   Reproduced against the checked-in binary:

   ```ts
   registry.resolve('532', {
     namespace: 'iso-numeric',
     date: '1974-01-01',
   })
   // preferred.id === 'Q25227'
   // preferred.applicability === 'active'
   // selection === 'at-date'
   // temporalAmbiguity === false
   ```

   This assignment has an end qualifier but no start qualifier. Compilation represents the missing start as `MIN_DAY`; the reader then treats every earlier date within coverage as established applicability. `AN` has the same problem. This contradicts `README.md:30` and `reports/findings.md:17`, which say missing dates remain unknown and dated unknown applicability does not produce a preferred answer.

   Preserve uncertainty for an unreviewed missing bound, consistently with the undated path. Existing tests at `test/registry.test.ts:75` exercise undated uncertainty only; none pins this incorrect dated result. The checked-in binary and evidence fixtures need no change. The cited documentation already describes the intended behavior.

2. **P2 — The exported library cannot load under its declared Node runtime** — `package.json:11`, `src/index.ts:13`

   The package exports TypeScript directly and declares Node `>=24`, but its entry point uses TypeScript parameter properties. Plain Node 24.20.0 fails before the library can open a database:

   ```sh
   node --input-type=module -e \
     'import { CountryRegistry } from "./src/index.ts"'
   # ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
   ```

   There is also no emitted `src/generated/country-spike.js` for the entry point’s `.js` import at `src/index.ts:2`; the checked-in binding is `.ts`. The development `tsx` loader handles both problems, so every existing test and demo masks them.

   Provide a runnable exported artifact, or make the loader requirement explicit and available to consumers. No existing test pins loader-free import behavior. An emitted-artifact fix changes `package.json:11` and the build/export documentation at `README.md:34`; it changes no country fixtures or lookup expectations. `reports/findings.md:47` defers installation fixtures, but that does not make the current export runnable.

**Step 1 map**

The repository contains a new, self-contained spike. All tracked implementation files are additions against the supplied base; status reports no untracked files. There are no repository-local live ingest services, historical loaders, database migrations, scheduled jobs, HTTP clients of a service, persistent caches, environment variables, or deployed consumers beyond the paths below.

| Data or interface | Writers and producers | Readers and consumers |
|---|---|---|
| Wikidata entity JSON: `id`, `lastrevid`, labels, aliases, claims, ranks, snaks, qualifiers, references | `scripts/fetch-wikidata.ts:8`, `scripts/fetch-wikidata.ts:16` | `scripts/build.ts:32`, `scripts/check-evidence.ts:64`, `scripts/check-evidence.ts:77`, `src/evidence.ts:29` |
| Snapshot manifest: `id`, `revision`, `file`, `sha256`, `retrievedAt`, `permanentLink` | `scripts/fetch-wikidata.ts:17`, `scripts/fetch-wikidata.ts:20` | `scripts/build.ts:7`, `scripts/build.ts:31`, `scripts/build.ts:68`, `scripts/check-evidence.ts:64`; provenance contract at `DATA_LICENSE.md:5` |
| Policy: dataset version, reference date, coverage bounds/text, aliases’ entity/value/namespace/language/kind/reason | Hand-maintained `sources/policy.json:1` | `scripts/build.ts:9`, `scripts/build.ts:60`, `scripts/build.ts:67`, `scripts/build.ts:68`; described at `README.md:61` |
| Imported ISO properties `P297`, `P298`, `P299`; temporal qualifiers `P580`, `P582` | Snapshot fetch above; conversion at `scripts/build.ts:48` | `scripts/build.ts:49`, `scripts/build.ts:52`, `scripts/build.ts:53`; evidence namespace binding at `scripts/check-evidence.ts:34`; qualifier comparison at `src/evidence.ts:36` |
| Entity dissolution `P576`, continent `P30`, successors `P1366` | Snapshot fetch above; projection at `scripts/build.ts:40` | Entity construction at `scripts/build.ts:47`; evidence requests at `scripts/build.ts:43`; compiler at `src/compile.ts:23`; candidate views at `src/index.ts:18`; resolution at `src/index.ts:128` |
| Evidence requests: ID, QID, revision, kind, expected value, property, statement ID, language, qualifiers, reason | `scripts/build.ts:36`, `scripts/build.ts:57`, `scripts/build.ts:62`, `scripts/build.ts:67`; synthetic producers at `test/evidence.test.ts:5` | `scripts/check-evidence.ts:22`, `scripts/check-evidence.ts:30`, `scripts/check-evidence.ts:48`, `src/evidence.ts:21`; tests at `test/evidence.test.ts:8` |
| Evidence findings: ID, status, link, message, references | `src/evidence.ts:23`, `scripts/check-evidence.ts:51`, `scripts/check-evidence.ts:55` | `src/evidence.ts:61`, `scripts/check-evidence.ts:86`; report generation at `scripts/check-evidence.ts:87`; assertions at `test/evidence.test.ts:8` |
| `data/evidence.json`: dataset version, manifest digest, requests | `scripts/build.ts:67`, `scripts/build.ts:72`; temporary test copy at `test/evidence-cli.test.ts:19` | `scripts/check-evidence.ts:20`, `scripts/benchmark.ts:74`; evidence regression at `test/evidence-cli.test.ts:12` |
| Binary metadata: dataset/format/minimum-reader versions, reference/build dates, evidence digest, corpus, coverage dates | `schema/countries.fbs:3`, `src/generated/country-spike/metadata.ts:180`, `src/compile.ts:51`, `scripts/build.ts:68` | Structural shape at `src/verify.ts:3`; validation at `src/index.ts:49`; metadata/freshness API at `src/index.ts:96`; evidence comparison at `scripts/check-evidence.ts:28`; tests at `test/registry.test.ts:12`, `test/evidence-cli.test.ts:16` |
| Binary Entity table: ID, name, continent, start/end days, temporal-review flag, successor indexes | `schema/countries.fbs:15`, `src/generated/country-spike/entity.ts:9`, `src/compile.ts:23` | `src/verify.ts:4`, `src/index.ts:58`, `src/index.ts:18`, `src/index.ts:104`, `src/index.ts:128`, `scripts/check-evidence.ts:39` |
| Binary Assignment table: entity index, namespace, value, status, start/end days, review flag, evidence IDs, latest-start/earliest-end bounds | `schema/countries.fbs:25`, `src/generated/country-spike/assignment.ts:9`, `src/compile.ts:31` | `src/verify.ts:5`, `src/index.ts:64`, `src/index.ts:17`, `src/index.ts:128`, `scripts/check-evidence.ts:29`, `scripts/benchmark.ts:65` |
| Binary Key table: normalized key and assignment indexes | `schema/countries.fbs:38`, `src/generated/country-spike/key.ts:9`, `src/compile.ts:39` | `src/verify.ts:6`, `src/index.ts:70`, `src/index.ts:159` |
| Registry vectors: metadata, entities, assignments, keys, direct alpha-2 and numeric indexes | `schema/countries.fbs:43`, `src/generated/country-spike/registry.ts:250`, `src/compile.ts:45`, `src/compile.ts:51` | `src/verify.ts:7`, `src/index.ts:46`, `src/index.ts:159`; raw readers at `scripts/check-evidence.ts:27`, `scripts/benchmark.ts:65`, `test/evidence-cli.test.ts:15` |
| `data/countries.crdb`, `CRDB` identifier | `src/compile.ts:53`, `scripts/build.ts:71`; temporary mutation at `test/evidence-cli.test.ts:18` | `src/verify.ts:60`, `scripts/demo.ts:3`, `scripts/benchmark.ts:13`, `scripts/check-evidence.ts:18`, `test/registry.test.ts:8`, `test/evidence-cli.test.ts:14`; package export at `package.json:12` |
| Release metadata plus binary SHA-256 | `scripts/build.ts:73`, checked-in `data/release.json:1` | Caller-supplied comparison at `src/index.ts:98`; tests at `test/registry.test.ts:12`; no automatic release-file reader |
| Public candidate fields and result fields: preferred, candidates, selection, temporal ambiguity, coverage, evidence status | `src/index.ts:17`, `src/index.ts:156` | `scripts/demo.ts:7`, `scripts/benchmark.ts:30`, `scripts/benchmark.ts:58`, `test/registry.test.ts:27`; contracts at `README.md:22`, `README.md:57`, `reports/findings.md:15` |
| UTC date parser and day sentinels | `src/common.ts:1`, `src/common.ts:8` | `src/compile.ts:17`, `src/compile.ts:25`, `src/compile.ts:34`, `scripts/build.ts:27`, `src/index.ts:44`, `src/index.ts:117`, `src/index.ts:131`; tests at `test/registry.test.ts:84` |
| Normalization, namespace list, key encoding, alpha-2 slot calculation | `src/common.ts:6`, `src/common.ts:16`, `src/common.ts:24`, `src/common.ts:28` | `src/compile.ts:33`, `src/compile.ts:41`, `src/compile.ts:48`, `src/index.ts:66`, `src/index.ts:79`, `src/index.ts:89`, `src/index.ts:115`, `src/index.ts:121`, `src/index.ts:160` |
| Reader/format versions and version comparison | `src/common.ts:3`, `src/common.ts:32`, `src/common.ts:39`; copied build literals at `scripts/build.ts:68` | `src/compile.ts:16`, `src/index.ts:55`, `src/index.ts:101`; compatibility tests at `test/registry.test.ts:12` |
| Structural verifier and semantic validator | `src/verify.ts:9`, `src/index.ts:46` | All `CountryRegistry.open` callers listed above; malformed-input tests at `test/registry.test.ts:101` |
| In-memory caches/sets | Evidence fetch promises at `scripts/check-evidence.ts:60`; compiler maps at `src/compile.ts:21`, `src/compile.ts:39`; verifier visited tables at `src/verify.ts:13`; validation/lookup sets at `src/index.ts:69`, `src/index.ts:119` | Same invocation only; no persistence, max-age, migration marker, or cross-process state |
| Slackwater JSON `country` inputs and baseline ISO codes | External input traversal at `scripts/benchmark.ts:48`; comparison at `scripts/benchmark.ts:57` | Aggregation at `scripts/benchmark.ts:55`, report at `scripts/benchmark.ts:74`; hand-maintained inventory at `sources/slackwater-required.json:1`; milestone contract at `README.md:82` |
| Benchmark and evidence reports | `scripts/benchmark.ts:76`, `scripts/check-evidence.ts:88`; checked-in `reports/benchmark.json:1`, `reports/evidence.json:1` | `reports/findings.md:7`, `reports/findings.md:25`, `sources/slackwater-required.json:4`; CI upload at `.github/workflows/check.yml:44` |
| Runtime, dependencies, exports, scripts, compiler settings | `package.json:7`, `package.json:10`, `package.json:14`, `package.json:25`, `package-lock.json:1`, `.mise.toml:1`, `tsconfig.json:2` | CI at `.github/workflows/check.yml:14`, `.github/workflows/check.yml:18`, `.github/workflows/check.yml:36`; documented commands at `README.md:34` |
| Binding generation and re-exports | `package.json:15`, `schema/countries.fbs:1`; `src/generated/countries.ts:5`, `src/generated/country-spike.ts:5` | `src/compile.ts:2`, `src/index.ts:2`, `scripts/check-evidence.ts:5`, `scripts/benchmark.ts:11`, `test/evidence-cli.test.ts:8` |
| CLI arguments and network requests | Evidence options at `scripts/check-evidence.ts:9`; benchmark directory at `scripts/benchmark.ts:45`; fetch URL/header/30-second timeout at `scripts/fetch-wikidata.ts:9`; evidence request at `scripts/check-evidence.ts:71` | Evidence corpus/base/offline/output paths at `scripts/check-evidence.ts:17`, `scripts/check-evidence.ts:46`, `scripts/check-evidence.ts:63`; test invocation at `test/evidence-cli.test.ts:20`; CI invocation at `.github/workflows/check.yml:42` |
| Contribution, licensing, provenance, compatibility policy | `CONTRIBUTING.md:5`, `CONTRIBUTING.md:15`, `CONTRIBUTING.md:25`, `DATA_LICENSE.md:3`, `LICENSE:1` | Build/evidence paths above; maintainer review explicitly required at `CONTRIBUTING.md:34`. No `Review checks` section. The current data path has no opt-out, suppression, or re-identification condition; additional-source license compatibility and provenance distribution are manual policy requirements. |

The pinned snapshot files consumed through the manifest are:

- `sources/wikidata/Q43-2568776192.json:1`
- `sources/wikidata/Q213-2565433432.json:1`
- `sources/wikidata/Q33946-2563146998.json:1`
- `sources/wikidata/Q37024-2559703250.json:1`
- `sources/wikidata/Q25227-2568717309.json:1`
- `sources/wikidata/Q25279-2568773983.json:1`
- `sources/wikidata/Q26273-2568809430.json:1`
- `sources/wikidata/Q27561-2568773678.json:1`
- `sources/wikidata/Q145-2569133680.json:1`
- `sources/wikidata/Q971-2568810694.json:1`
- `sources/wikidata/Q974-2569319374.json:1`

**Validation and limits:** Typecheck and 15 registry/evidence tests passed. Both findings were reproduced with read-only commands. The CLI test creates temporary files, so it was not run; neither were build, fetch, benchmark, or evidence-report generation. No in-place upgrade or rollback test exists; this branch introduces the first implementation and declares no production consumer at `README.md:78`. External source passages and linked comparison-library claims were not independently verified.