# c5y-n8r — country-normalizer

We don't want to own a country-code library. We didn't want to build one. Country-name changes in our dependency kept breaking Slackwater's database builds, and the alternatives we reviewed did not give us the compatibility contract we needed.

We would prefer to contribute to an existing project that preserves accepted names, represents historical meanings, and makes data changes traceable. This Open Waters spike tests what that would take. If an existing project can meet those requirements, moving this work upstream is preferable to maintaining another competing library.

## Libraries we compared

The table describes the pinned versions and release history we investigated, not every version of each project. `country-code-lookup` is the dependency that broke our builds; the other projects are evaluated alternatives. We appreciate the work behind them. The problem is whether their data and compatibility policies fit our consumers.

| Library | What it already does well | What we found | Why this spike exists alongside it |
| --- | --- | --- | --- |
| [country-code-lookup](https://github.com/richorama/country-code-lookup), 0.2.1 baseline / 0.2.2 update | Simple code/name lookup and continent data | The 0.2.2 patch removed accepted names, including source names used by Slackwater. [Build impact](https://github.com/openwatersio/slackwater-database/pull/396#issuecomment-6742529879), [documented alias removal](https://github.com/richorama/country-code-lookup#data-scope-and-review). | An updated preferred name must preserve the old input and its identity. |
| [i18n-iso-countries](https://github.com/michaelwittig/node-i18n-iso-countries), 7.14.0 | Localized names, aliases, and ISO conversions | The API was promising. At our review, the latest repository commit was the February 17, 2025 release, with long-standing open issues and PRs. [History](https://github.com/michaelwittig/node-i18n-iso-countries/commits/master/), [issues](https://github.com/michaelwittig/node-i18n-iso-countries/issues). | We need an actively maintained path for compatibility fixes and dated meanings. |
| [countries-list](https://github.com/annexare/Countries), 3.4.1 | Names, continents, ISO mappings, and historical-name aliases | Minor releases 3.3.0 and 3.4.0 broke old names. Version 3.4.1 repaired those lookups with aliases and tests. [3.4.0 notes](https://github.com/annexare/Countries/releases/tag/v3.4.0), [repair](https://github.com/annexare/Countries/pull/178). | Its repair is useful prior art. We also need historical code assignments and evidence for changed answers. |
| [country-codes-list](https://github.com/Synergy-Shock/country-codes-list), 3.2.0 | ISO conversions and rich country, currency, language, and phone metadata | The 3.2.0 minor changed `Turkey` to `Türkiye` without preserving the old name lookup. The contributing PR explicitly describes that failure and recommends a minor release. [PR #86](https://github.com/Synergy-Shock/country-codes-list/pull/86). | Recent activity alone does not establish backward compatibility for name-based inputs. |

The reviewed APIs did not provide the combination of dated resolution, explicit historical alternatives, bounded coverage, and claim-level evidence described in our design. Performance comparisons live in the benchmark report; FlatBuffers is a format choice, not a claim that this implementation beats those libraries.

## What the spike demonstrates

- One FlatBuffer artifact read directly by TypeScript. There is no separate JavaScript country table.
- Direct alpha-2/numeric indexes and binary search over UTF-8 name/alpha-3 keys. The reader builds a compact entity-to-assignment integer index once on open; country facts remain in the binary.
- Optional date lookup, retained historical candidates, retired entity pointers, and explicit ambiguity.
- Embedded dataset, format, and minimum-reader versions (dataset 6 uses format 2 and requires reader 0.0.4); freshness comparison against release metadata supplied by the caller.
- Pinned Wikidata snapshots, an evidence companion, a source-fidelity gate, and separate asynchronous evidence-quality diagnostics.

The candidate corpus contains 165 entities, including the historical demonstrations of renames, the reused `CS` code, the retired Netherlands Antilles, successor pointers, the unofficial `UK` code, and an ambiguous `Congo` shorthand. It is partial coverage from 1974 through the database reference date. All results expose `evidenceStatus: "unreviewed-spike"`; no historical completeness is asserted. The local-policy aliases deliberately require review.

Wikidata's English label for Q43 in the pinned snapshot is `Turkey`; its Turkish label is `Türkiye`. Both spellings resolve. The reader does not pretend that the English label alone proves when an official name changed. Year-precision code qualifiers remain uncertain across the boundary year, and missing assignment dates remain unknown. See [spike findings](reports/findings.md) for the remaining design work.

## Run it

Use Node 24 or newer. The checked-in FlatBuffers bindings and binary let you run the demo without installing the compiler. `mise install` installs the pinned development tools when regeneration is needed.

```sh
npm ci
npm run build
npm run check
npm run demo
npm run benchmark
```

```ts
import { readFile } from 'node:fs/promises';
import { CountryRegistry } from '@openwaters/c5y-n8r';

const countries = CountryRegistry.open(await readFile('data/countries.crdb'));
countries.resolve('Turkiye').preferred?.id; // Q43
countries.resolve('CS', { namespace: 'iso-alpha2', date: '1990-01-01' });
countries.resolve('CS', { namespace: 'iso-alpha2', date: '2005-01-01' });
countries.resolve('AN', { namespace: 'iso-alpha2' });
countries.metadata();
await countries.compareRelease(); // freshness unknown until release metadata is supplied
```

The package prepare step builds the reader for git installs and packing. The package file list excludes the Slackwater consumer inventory. The build emits JavaScript and TypeScript declarations for the reader in `dist/`; Node consumers use the package export without a TypeScript loader. The country dataset remains a single binary. A benchmark run without a Slackwater directory writes to `reports/local/benchmark.json` and preserves the checked-in compatibility inventory.

Entity IDs are limited to 64 UTF-16 code units in both compilation and loading, bounding later indexed identity reads. Verification memoizes shared structures and rejects expanded traversal work above eight times the file size, including cached references that later readers would traverse. Opening validates the stable metadata envelope first, reports unsupported format/reader requirements through `CompatibilityError`, then validates the supported body and semantic indexes. The root metadata field and existing metadata field layouts must remain stable across formats. Format 1 is rejected because its deprecated-claim status has a different meaning. Keep the supplied bytes immutable and alive while registry/result views are in use. Result fields decode on demand. Names use trimmed NFC Unicode lowercase matching; punctuation, accent, and locale-specific case variants (including Turkish dotted I) need explicit aliases. Single-entity date uncertainty uses `selection: "uncertain"`; name ambiguity denotes competing entities; assignment and conversion ambiguity also includes competing codes on one entity. Specify a namespace to avoid combining code and name meanings. Dates use UTC calendar days. A tentative undated code match with unknown bounds retains an uncertainty indication; it cannot outrank a different entity with an established historical assignment. Within one entity, an undated lookup can prefer a tentative code whose latest possible start is no earlier than the final day of the latest retired assignment's end window; unknown starts or earlier assignments cannot gain precedence from a missing end. Retired candidates remain visible. Conversion to a current namespace does not erase a retired source: consumers must inspect source applicability, and consumers must reject retired-source conversions when they require current input codes. Cache derived results by reader version as well as dataset identity because reader bug fixes can affect existing bytes. The convenience result object and API are provisional.

`compareRelease` is asynchronous. Equal dataset versions with different embedded metadata return `freshness: "different"`. When the supplied release includes `sha256`, it also compares the loaded binary hash using Web Crypto and caches that calculation. Lookups and opening remain synchronous; hashing occurs only when checking a release. Keep loaded bytes immutable for the registry's lifetime.

## Sources and PR evidence

`sources/manifest.json` records source revisions, hashes, retrieval times, and permanent links. `sources/wikidata/` contains the corresponding Wikidata JSON. `sources/policy.json` records local alias policy and the minimum compatible reader version; that threshold changes when interpretation requires it, rather than on every package patch. A sync preserves pinned files and retrieval times for unchanged revisions. Historical snapshot files remain available for provenance. `sources/reviewed-overrides.json` records reviewed statements, `sources/review-approvals.json` binds approvals to complete record digests, and `sources/override-activation.json` selects active or retired reviews. The Turkey review is staged and inactive. `npm run build` uses only these local inputs and produces `data/countries.crdb`, `data/evidence.json`, and `data/release.json`. The evidence companion and release manifest are supporting artifacts; the binary is the only runtime country dataset.

```sh
npm run source:fetch -- --refresh
npm run build
npm run evidence -- --base /path/to/trusted-main
npm run evidence -- --base /path/to/trusted-main --offline
```

Wikidata is the upstream source. Existing statements, labels and aliases can be included without independent certification or a minimum reference count. We can inherit upstream errors. The checker flags missing statement references automatically. Weak citations and suspected errors found during research are recorded in manually maintained issue follow-ups; they do not exclude otherwise source-backed data. Improve the information on Wikidata, sync the resulting revision, and release a new dataset version as corrections become available.

`source:fetch` preserves existing pins unless `--refresh` is supplied. `evidence` retrieves the pinned and current Wikidata revisions, checks that supplied values and qualifiers occur in the pinned source, and reports source links, references and discrepancies. A `source-match` proves provenance, not factual truth. Changes since the pin are asynchronous refresh work. Invalid pinned values, unsupported transformations, unapproved local corrections, versioning failures and compatibility breaks remain blocking. Offline mode checks cached inputs without authenticating live upstream provenance.

The evidence workflow runs the trusted base checker against proposed artifacts. Trusted rebuilding checks the full binary and companion, including entity fields and date interpretation; a separate job also tests reproducibility. Reader compatibility uses an untrusted observation job and a fresh trusted verdict job that compares JSON results against protected base expectations. For authenticated ISO date-only corrections, the verdict derives expected answers from the independently reproduced artifact instead of freezing the old date. A separate merge-input artifact records the exact merge and parents. Trusted jobs use that parent and the controller checks it against the current protected branch; GitHub’s recorded PR base field can lag. The verdict job never executes proposed reader code. Its isolated observations cover trusted base cases. Added cases run through the proposed reader during the ordinary build and through the trusted builder for expected-result checks; they do not yet receive separate isolated observations of the proposed reader. Finite observations do not authenticate a deliberately modified build harness. Existing answers and input identities cannot be silently changed by editing a proposed fixture; new observations do not certify facts.

The command exit code follows `gatePassed`, the ingestion verdict. Offline evidence checks report the pinned corpus but do not pass live authentication. For evidence reports, the legacy field `passed` retains its stricter independent-verification meaning and can be false while ingestion passes. For reader-compatibility reports, `passed` follows `gatePassed`; it means compatibility and source fidelity, not independent factual certification. Authenticated source matches and non-blocking approved withdrawals or upstream removals can pass while protected queries and local-approval checks still apply. Incomplete optional readiness records do not control either source fidelity or lookup selection.

Local corrections, unofficial aliases and inferred matching rules must be disclosed separately from Wikidata assertions. Reviewed overrides retain their exact trusted approval digests and two-stage activation workflow. Ordinary Wikidata ingestion does not require that workflow or the optional name-research ledger. Missing historical dates and competing identities retain their uncertainty regardless of reference quality. The single display-continent field selects the preferred P30 claim, or the first normal claim; it does not assert exclusive continent membership or reconstruct dated continent history. Multiple or scoped source claims remain quality advisories. Format upgrades require a compatible trusted checker before it can inspect the new body.

Unknown ISO starts use the existing uncertain bounds; the evidence companion preserves the explicit Wikidata qualifier. See [temporal ingestion and rollback](CONTRIBUTING.md#temporal-ingestion-and-rollback) for unsupported bounds, automatic start/end-date compatibility coverage, merge ordering and the limits on reverting accepted data.

## Ownership and scope

The repository is public; the package remains private and unpublished. The code is [MIT licensed](LICENSE); `private: true` prevents accidental npm publication. Wikidata structured data is [CC0](https://www.wikidata.org/wiki/Wikidata:Data_access#Using_Wikidata's_data); referenced documents retain their own terms. We preserve source links and snapshots, and do not redistribute full referenced documents.

There is no Slackwater migration, native reader, public API service, or production release in this spike. The first milestone is usable, source-backed coverage of the countries required by Slackwater, described below. Broader country and historical coverage can follow through reviewed contributions.

## First milestone: Slackwater coverage

The source inventory contains 157 inputs: 129 country spellings across 8,728 station-source records and 28 additional GeoNames geocoder identities. The candidate resolves 155 inputs covering 8,699 station-source records. Two bare names remain unresolved: Virgin Islands (26 records) and Saint Helena (3); consumers can supply the original ISO codes for their intended identities. Åland (AX) has source-backed ISO codes but no imported P30 continent claim; [#283](https://github.com/openwatersio/c5y-n8r/issues/283) tracks that missing metadata. The source audit reports name/code coverage and continent completeness separately. These counts describe source coverage, not independent verification. The comparison library's expected codes are migration baselines, not authoritative evidence.

Before Slackwater adopts this library, every required input must resolve to the intended source-backed country identity and current ISO code, with explicit aliases for existing source spellings. Pin the Slackwater source revision in the coverage inventory, test every required input, and publish a report that separates source matches, ambiguous mappings, unresolved inputs and evidence-quality flags. Historical fixtures remain useful tests; they do not establish complete historical coverage.

The exact spelling alias, matched with the standard trim/NFC/lowercase name normalization `Myanmar (Burma)` preserves stored Slackwater names; TICON imports use their original `MMR` ISO alpha-3 value. Both convert to current `MM` on Q836, retaining tentative date bounds and historical `BU`/`BUR` alternatives. The alias and its source are documented in [#149](https://github.com/openwatersio/c5y-n8r/issues/149). Reader 0.0.4 selects the current tentative code over retired codes only within one entity; cross-entity reused-code ambiguity remains protected.

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for data changes. Import existing Wikidata values with revision and statement provenance; we research facts whose evidence is missing or weak as asynchronous quality work, and shipping does not wait for that research to finish. When investigating an error, check reliable independent sources and contribute the supporting references to Wikidata. Record the resulting revision and refresh the affected entity. A reference URL alone does not prove a claim, and a current code table does not establish historical assignment dates. Local overrides remain available through their separate reviewed workflow when an upstream correction is pending.

Code and data have separate licensing. See [data licensing and provenance](DATA_LICENSE.md).

`sources/accepted-inputs.json` pins accepted entity/input pairs, candidate sets, preferred answers, and selected dated cases as an unreviewed compatibility baseline. The build rejects missing pins, unlisted additions, and changed answers, including a new competitor. Every input requires reference-date expectations both within its namespace and across all namespaces. The trusted-base checker protects existing expectations while allowing append-only observations for new inputs. The fixture guards behavior; it cannot establish the truth of its expectations. Restore the spelling upstream with evidence, or retain it as explicitly reviewed local matching policy; do not delete the fixture to silence a failure. Deprecated claims remain visible but cannot be preferred unless their deprecation reason is explicitly handled as historical withdrawal. The current exception is Wikidata's [former entity reason](https://www.wikidata.org/wiki/Q110770329), together with an end qualifier; its interpretation remains unreviewed.

Main requires the `Country policy gate` status, successful build checks and resolved conversations. Independent approvals, code-owner approval and last-push approval are optional, so maintainers can merge their own PRs. The policy controller runs from the default branch and independently verifies reader observations using base-branch expectations. Maintainers must inspect workflow edits before merging. Finite observations are regression evidence, not attestation against deliberately deceptive code.

Reviewed overlays preserve the protected lookup contract. ISO P580/P582 corrections can refresh dated answers with `npm run build -- --refresh-temporal-lookups --base /path/to/main`. The trusted base independently rebuilds the artifact, authenticates changed Wikidata pins and derives reader expectations. A higher dataset version is required; every query, code identity, rank, alias and local policy stays protected. Other answer-changing corrections remain blocked. Evidence-only reviews, such as the staged Turkey record, can use the two-stage flow without changing answers. Per-record provenance lives in the evidence companion; the reader continues to report the corpus as an unreviewed spike.

The policy controller independently rebuilds proposed artifacts with base-branch code, checks policy and version transitions, authenticates changed pins and verifies reader observations. The evidence job additionally reports claim-level quality and upstream drift. Maintainers must still inspect workflow edits; finite observations cannot attest a deliberately deceptive reader. Corpus JSON files and observation artifacts have bounded sizes, which must be revisited before expanding the prototype corpus.

## Prepared distribution without npm publication

`npm run distribution` compiles the reader and writes a prepared npm tarball, `SHA256SUMS`, and `distribution.json` to `reports/local/distribution/`. It packages the checked-in binary; run `npm run build` and verify the data diff before preparing a reviewed distribution. The manifest records the exact Git commit, archive SHA-256, npm integrity, binary SHA-256, and whether the checkout is dirty. Dirty builds are for local testing only. The package stays `private: true`; this command does not publish anything.

The manually dispatched **Prepare distribution** workflow builds and checks the selected commit and uploads an Actions artifact named with its full SHA. It requires a clean checkout after regeneration. Download and inspect that artifact before separately authorizing a GitHub release. A release should use a tag containing the full commit SHA, preserve its archive/checksum/manifest assets, and never replace those assets. No release is created by the workflow. GitHub assets are replaceable by maintainers, so consumers must verify a checksum obtained through their reviewed dependency update and retain the package-lock integrity.

For a downloaded artifact, verify and install without lifecycle scripts:

```sh
shasum -a 256 -c SHA256SUMS
npm install --ignore-scripts ./openwaters-c5y-n8r-*.tgz
```

Once an approved release exists, download the same archive from `https://github.com/openwatersio/c5y-n8r/releases/download/commit-<FULL_SHA>/openwaters-c5y-n8r-<VERSION>.tgz`, verify its reviewed SHA-256, and install the local file as above. The URL is a distribution convention, not an existing release. Direct Git source archives lack the prepared reader when scripts are disabled. Slackwater's root dependency policy permits npm registry dependencies only; use this artifact in the separately installed diagnostic until a distribution and adoption path is approved. Do not weaken that policy to install a release URL.

The package contains one runtime dataset at `@openwaters/c5y-n8r/data`, compiled JavaScript and declarations, code MIT licensing, data licensing, source provenance, and transitive source notices. Consumer compatibility inventories are excluded. Node can load the binary with `readFile(new URL(import.meta.resolve('@openwaters/c5y-n8r/data')))`. The reader accepts bytes and has no Node filesystem import.

In a browser or web worker, configure the bundler to emit the exported binary as a URL (this example uses Vite's `?url` convention):

```ts
import { CountryRegistry } from '@openwaters/c5y-n8r';
import dataUrl from '@openwaters/c5y-n8r/data?url';

const response = await fetch(dataUrl);
if (!response.ok) throw new Error(`Country data download failed: ${response.status}`);
const countries = CountryRegistry.open(new Uint8Array(await response.arrayBuffer()));
```

Other bundlers can copy the binary to a static asset and supply its URL to the same fetch call. Keep the bytes alive and immutable while using the registry. Packaging tests install the prepared tarball with an empty npm cache, offline mode, and `--ignore-scripts`, then exercise plain Node imports and fetched bytes in a worker. They also reject Node builtin imports in emitted reader modules. The Vite example itself is not a browser integration test.

## Convert a resolved country to a code

```ts
const { source, target } = registry.convert('Türkiye', { from: 'name', to: 'iso-alpha2' });
const code = target.preferred?.value;
const assignments = registry.assignments('Q43', { namespace: 'iso-alpha2' });
```

Both results retain alternatives, applicability, uncertainty, coverage and evidence. A missing or ambiguous source does not become a guessed target. Entity assignment lists are indexed once during opening; conversion does not enumerate possible codes. This adds O(assignments) startup work and a small integer-list index while preserving the binary format and existing lookup results. The dataset remains unreviewed.

The source builder's `--extend-accepted-inputs` mode first checks every existing protected observation, appends newly admitted inputs and missing start/end boundary observations and exits without replacing data artifacts. `--audit-slackwater` writes the required-input source audit without replacing the binary; explicit candidate Wikidata IDs can be supplied in the inventory, while unresolved and unfetched mappings stay visible as incomplete audit rows. These commands are development tools and cannot certify evidence. The separate `--refresh-temporal-lookups --base /path/to/main` operation updates protected results only for date-only source corrections; CI requires live pinned authentication.

`npm run source:fetch` preserves and authenticates existing pins while discovering newly mapped entities. After an upstream edit, use `npm run source:fetch -- --refresh Q43` to refresh that entity, or `npm run source:fetch -- --refresh` to refresh the entire manifest. Unchanged revisions retain their retrieval metadata and files. Refresh does not remove historical entities or approve changed facts; rebuild and inspect the evidence and compatibility reports afterward.

`assignments(id)` without a namespace returns all namespaces and may be ambiguous. Converting to `name` retains all accepted names rather than choosing a display label; use a selected candidate’s `name` for its entity label. The protected method fixture contains full conversion and assignment results alongside the original lookup fixture.

The existing statement-override workflow and the optional name-readiness diagnostic have distinct source rules: name readiness requires one authority plus three corroborating sources on the supporting Wikidata name statement. Existing staged statement approvals retain their documented requirements.

Dated conversion from a name retains uncertainty and does not select a preferred code when that name’s applicability is unreviewed. Inspect both `source` and `target`; do not interpret an absent preferred result as a guessed redirect. The optional `fullEnglishAliasEntities` policy retains all English aliases only for listed entities; other entities admit the canonical label and required source-backed spellings selected by `candidateEntity` in the consumer inventory.

The candidate has 740 assignments and 911 unreviewed evidence requests. [The evidence issue map](sources/evidence-review-issues.json) binds every request to a tracking issue and the exact evidence digest; an issue link is not an approval. [Continent taxonomy proof](sources/continent-taxonomy.json) pins the Oceania labels used for display grouping. Antarctica uses an explicit unreviewed self-continent policy supported by its real P31 continent statement, without inventing a P30 self-statement. These classifications apply at the reference date and do not assert historical geographic boundaries.

After a dataset rebuild, add or retire issue mappings explicitly and run `node scripts/refresh-evidence-issues.mjs` to bind the tracker to the new evidence bytes and dataset version. The helper performs no network operations and refuses missing or orphaned mappings. The original `baseCommit` in the tracker identifies the 136-item evidence baseline, not the later code-review base. Taxonomy proof and research files are separate source records checked by the test suite, rather than inputs read into the runtime country manifest. The Q51 self-continent rule deliberately fails closed if its P31 support disappears or a P30 claim appears, so maintainers must review that source change.

### Saint Helena scope

The territory Q192184 supplies the faithfully imported SH/SHN/654 claims and English label Saint Helena, Ascension and Tristan da Cunha. Saint Helena/Q34497 remains the island and has no imported ISO country assignment; its protected name lookup is unchanged. Three stored TICON records supply SHN in the original dataset, so a consumer can use that identity without inventing a worldwide island-name alias. The source audit deliberately keeps the bare Saint Helena input unresolved. Missing references on the territory's code claims are asynchronous quality work tracked in [#279](https://github.com/openwatersio/c5y-n8r/issues/279); no reviewed correction or temporal bounds are implied.

Continent answers are compatibility-pinned too. Resolving Åland’s missing continent (#283), or changing the first-source selection for a multi-continent entity such as TF, requires a separately reviewed non-temporal correction path; the temporal refresh command cannot ship those changes.

`node scripts/check-geocoder-inventory.mjs` authenticates the complete 157-code geocoder inventory against the SHA-256 of Slackwater’s immutable places snapshot. CI runs this separately from the offline lookup tests.
