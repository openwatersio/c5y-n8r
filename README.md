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
- Direct alpha-2/numeric indexes and binary search over UTF-8 name/alpha-3 keys. The reader builds no runtime country index.
- Optional date lookup, retained historical candidates, retired entity pointers, and explicit ambiguity.
- Embedded dataset, format, and minimum-reader versions (dataset 2 uses format 2 and requires reader 0.0.2); freshness comparison against release metadata supplied by the caller.
- Pinned Wikidata snapshots, an evidence companion, and an evidence-check prototype that stays non-passing when a claim needs review.

The corpus contains eleven entities selected to exercise renames, the reused `CS` code, the retired Netherlands Antilles, successor pointers, the unofficial `UK` code, and an ambiguous `Congo` shorthand. It is partial coverage from 1974 through the database reference date. All results expose `evidenceStatus: "unreviewed-spike"`; no historical completeness is asserted. The local-policy aliases deliberately require review.

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

Entity IDs are limited to 64 UTF-16 code units in both compilation and loading, bounding later indexed identity reads. Verification memoizes shared structures and rejects expanded traversal work above eight times the file size, including cached references that later readers would traverse. Opening validates the stable metadata envelope first, reports unsupported format/reader requirements through `CompatibilityError`, then validates the supported body and semantic indexes. The root metadata field and existing metadata field layouts must remain stable across formats. Format 1 is rejected because its deprecated-claim status has a different meaning. Keep the supplied bytes immutable and alive while registry/result views are in use. Result fields decode on demand. Names use trimmed NFC Unicode lowercase matching; punctuation, accent, and locale-specific case variants (including Turkish dotted I) need explicit aliases. Single-entity date uncertainty uses `selection: "uncertain"`; ambiguity is reserved for competing entities. Specify a namespace to avoid combining code and name meanings. Dates use UTC calendar days. A tentative undated code match with unknown bounds retains an uncertainty indication; it cannot outrank a different entity with an established historical assignment. The convenience result object and API are provisional.

`compareRelease` is asynchronous. Equal dataset versions with different embedded metadata return `freshness: "different"`. When the supplied release includes `sha256`, it also compares the loaded binary hash using Web Crypto and caches that calculation. Lookups and opening remain synchronous; hashing occurs only when checking a release. Keep loaded bytes immutable for the registry's lifetime.

## Sources and PR evidence

`sources/manifest.json` records source revisions, hashes, retrieval times, and permanent links. `sources/wikidata/` contains the corresponding Wikidata JSON. `sources/policy.json` records local alias policy and the minimum compatible reader version; that threshold changes when interpretation requires it, rather than on every package patch. A sync preserves pinned files and retrieval times for unchanged revisions. Historical snapshot files remain available for provenance. `sources/reviewed-overrides.json` records reviewed statements, `sources/review-approvals.json` binds approvals to complete record digests, and `sources/override-activation.json` selects active or retired reviews. The Turkey review is staged and inactive. `npm run build` uses only these local inputs and produces `data/countries.crdb`, `data/evidence.json`, and `data/release.json`. The evidence companion and release manifest are supporting artifacts; the binary is the only runtime country dataset.

```sh
npm run source:fetch
npm run build
npm run evidence -- --base /path/to/trusted-main
npm run evidence -- --base /path/to/trusted-main --offline
```

`source:fetch` is an explicit network operation. `evidence` independently retrieves pinned and current Wikidata revisions and reports each supplied assertion, source link, reference links, and discrepancies. It verifies assignment-to-evidence identity/value bindings and reports the binary hash and evidence digest. Entity fields and temporal interpretation still require manual review. A spelling match is reported as `source-match`, not verified factual evidence. The offline mode checks pinned snapshots only and cannot certify live evidence. The exit code follows `gatePassed`; `passed` separately describes evidence verification. Unresolved live findings on byte-identical reviewed artifacts can be advisory for maintenance, while offline checks with applicable assertions remain non-passing. Comparisons without changed assertions or selected reviews have no applicable assertions and exit zero.

The PR evidence workflow runs the checker from the trusted base commit against the proposed merge artifacts, without executing PR code in that job. A separate build/test job checks reproducibility. Reader compatibility uses two PR-only jobs, each with a five-minute timeout: an untrusted observation job builds and runs the proposed reader, then a fresh verdict job compares its JSON observations against base expectations. The verdict job never checks out or executes proposed code, and requires every expected case exactly once. A failed observation job fails the verdict job too. The checker accepts `--reader-results`, not an executable reader path.

The trusted checker also flags compatibility fixture changes when binary data is unchanged. Compatibility observations are regression evidence, not proof that a deliberately deceptive reader honestly executed a lookup; code and workflow changes still need maintainer review. The checker does not automate primary-document interpretation. A reviewed assertion requires a complete source review and an exact approval digest already present in the trusted base. Reviewed artifacts are independently rebuilt by trusted code; unrelated changes remain subject to review. Equivalent-fact refreshes can use the scoped gate after independent rebuilding; other source changes still receive the broader review. Live drift on byte-identical maintenance PRs is advisory, with separate evidence and gate verdicts. Reviewed corpora require an explicit trusted `--base`. Format upgrades require a compatible trusted checker before the PR evidence job can inspect the new body; an unsupported checker must report the incompatibility rather than approve the data.

## Ownership and scope

The repository is public; the package remains private and unpublished. The code is [MIT licensed](LICENSE); `private: true` prevents accidental npm publication. Wikidata structured data is [CC0](https://www.wikidata.org/wiki/Wikidata:Data_access#Using_Wikidata's_data); referenced documents retain their own terms. We preserve source links and snapshots, and do not redistribute full referenced documents.

There is no Slackwater migration, native reader, public API service, or production release in this spike. The first milestone is verified coverage of the countries required by Slackwater, described below. Broader country and historical coverage can follow through reviewed contributions.

## First milestone: Slackwater coverage

The current benchmark inventory contains 129 distinct country inputs across 8,728 source records. Only four inputs currently resolve in this deliberately small corpus. These counts describe coverage, not verification. The comparison library's expected codes are migration baselines, not authoritative evidence.

Before Slackwater adopts this library, every required input must resolve to its reviewed country identity and current ISO code, with explicit aliases for existing source spellings. Pin the Slackwater source revision in the coverage inventory, test every required input, and publish a report that separates verified, ambiguous, and unresolved entries. Historical fixtures remain useful tests; they do not establish complete historical coverage.

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for data changes. Before updating Wikidata, verify each assertion against one high-quality primary source and at least two other quality sources. Add the primary reference to Wikidata and retain corroboration, passages and independence notes in the issue and review record. Record the resulting revision link and rerun the source sync and evidence check. A reference URL alone does not prove a claim. Check the source passage and distinguish current code evidence from evidence for historical assignment dates. Missing evidence remains unresolved. When upstream editing is blocked or pending, a maintainer-reviewed local override can supply the effective assertion or its evidence. Raw snapshots remain immutable. Approval and activation use separate PRs so proposed fields cannot approve themselves; see the reviewed override workflow in CONTRIBUTING.md.

Code and data have separate licensing. See [data licensing and provenance](DATA_LICENSE.md).

`sources/accepted-inputs.json` pins accepted entity/input pairs, candidate sets, preferred answers, and selected dated cases as an unreviewed compatibility baseline. The build rejects missing pins, unlisted additions, and changed answers, including a new competitor. Every input requires reference-date expectations both within its namespace and across all namespaces. The trusted-base checker flags changes to the fixture itself for review. The fixture guards behavior; it cannot establish the truth of its expectations. Restore the spelling upstream with evidence, or retain it as explicitly reviewed local matching policy; do not delete the fixture to silence a failure. Deprecated claims remain visible but cannot be preferred unless their deprecation reason is explicitly handled as historical withdrawal. The current exception is Wikidata's [former entity reason](https://www.wikidata.org/wiki/Q110770329), together with an end qualifier; its interpretation remains unreviewed.

Main requires the `Country policy gate` status, successful build checks and resolved conversations. Independent approvals, code-owner approval and last-push approval are optional, so maintainers can merge their own PRs. The policy controller runs from the default branch and independently verifies reader observations using base-branch expectations. Maintainers must inspect workflow edits before merging. Finite observations are regression evidence, not attestation against deliberately deceptive code.

Reviewed overlays preserve the protected lookup contract. A correction that changes accepted answers remains non-passing until a separate trusted compatibility-approval route exists; this PR does not provide that route. Evidence-only reviews, such as the staged Turkey record, can use the two-stage flow without changing answers. Per-record provenance lives in the evidence companion; the reader continues to report the corpus as an unreviewed spike.

The policy controller independently verifies reader observations. It relies on the evidence job’s workflow definition for evidence execution, so maintainers must inspect edits to that workflow before merging; its success status is not independent attestation of an altered workflow. Corpus JSON files and observation artifacts have bounded sizes, which must be revisited before expanding the prototype corpus.
