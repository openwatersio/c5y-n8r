# c5y-n8r — country-normalizer

We don't want to own a country-code library. We didn't want to build one. Country-name changes in our dependency kept breaking Slackwater's database builds, and the alternatives we reviewed did not give us the compatibility contract we needed.

We would prefer to contribute to an existing project that preserves accepted names, represents historical meanings, and makes data changes traceable. This private Open Waters spike tests what that would take. If an existing project can meet those requirements, moving this work upstream is preferable to maintaining another competing library.

## Libraries we compared

The table describes the pinned versions and release history we investigated, not every version of each project. `country-code-lookup` is the dependency that broke our builds; the other projects are evaluated alternatives. We appreciate the work behind them. The problem is whether their data and compatibility policies fit our consumers.

| Library | What it already does well | What we found | Why this spike exists alongside it |
| --- | --- | --- | --- |
| [country-code-lookup](https://github.com/richorama/country-code-lookup), 0.2.1 baseline / 0.2.2 update | Simple code/name lookup and continent data | The 0.2.2 patch removed accepted names, including source names used by Slackwater. [Build impact](https://github.com/openwatersio/slackwater-database/pull/396#issuecomment-6742529879), [documented alias removal](https://github.com/richorama/country-code-lookup#data-scope-and-review). | An updated preferred name must preserve the old input and its identity. |
| [i18n-iso-countries](https://github.com/michaelwittig/node-i18n-iso-countries), 7.14.0 | Localized names, aliases, and ISO conversions | The API was promising. At our review, the latest repository commit was the February 17, 2025 release, with long-standing open issues and PRs. [History](https://github.com/michaelwittig/node-i18n-iso-countries/commits/master/), [issues](https://github.com/michaelwittig/node-i18n-iso-countries/issues). | We need an actively maintained path for compatibility fixes and dated meanings. |
| [countries-list](https://github.com/annexare/Countries), 3.4.1 | Names, continents, ISO mappings, and historical-name aliases | Minor releases 3.3.0 and 3.4.0 broke old names. Version 3.4.1 repaired those lookups with aliases and tests. [3.4.0 notes](https://github.com/annexare/Countries/releases/tag/v3.4.0), [repair](https://github.com/annexare/Countries/pull/178). | Its repair is useful prior art. We also need historical code assignments and evidence for changed answers. |
| [country-codes-list](https://github.com/Synergy-Shock/country-codes-list), 3.2.0 | ISO conversions and rich country, currency, language, and phone metadata | The 3.2.0 minor changed `Turkey` to `Türkiye` without preserving the old name lookup. The contributing PR explicitly describes that failure and recommends a minor release. [PR #86](https://github.com/Synergy-Shock/country-codes-list/pull/86). | Recent activity alone does not establish backward compatibility for name-based inputs. |

The reviewed APIs did not provide the combination of dated resolution, explicit historical alternatives, bounded coverage, and claim-level evidence described in our [design spec](https://github.com/openwatersio/planning/blob/main/docs/superpowers/specs/2026-11-15-country-resolver-design.md). Performance comparisons live in the benchmark report; FlatBuffers is a format choice, not a claim that this implementation beats those libraries.

## What the spike demonstrates

- One FlatBuffer artifact read directly by TypeScript. There is no separate JavaScript country table.
- Direct alpha-2/numeric indexes and binary search over UTF-8 name/alpha-3 keys. The reader builds no runtime country index.
- Optional date lookup, retained historical candidates, retired entity pointers, and explicit ambiguity.
- Embedded dataset, format, and minimum-reader versions; freshness comparison against release metadata supplied by the caller.
- Pinned Wikidata snapshots, an evidence companion, and an evidence-check prototype that stays non-passing when a claim needs review.

The corpus contains eleven entities selected to exercise renames, the reused `CS` code, the retired Netherlands Antilles, successor pointers, the unofficial `UK` code, and an ambiguous `Congo` shorthand. It is partial coverage from 1974 through the database reference date. All results expose `evidenceStatus: "unreviewed-spike"`; no historical completeness is asserted. The local-policy aliases deliberately require review.

Wikidata's English label for Q43 in the pinned snapshot is `Turkey`; its Turkish label is `Türkiye`. Both spellings resolve. The reader does not pretend that the English label alone proves when an official name changed. Year-precision code qualifiers remain uncertain across the boundary year, and missing assignment dates remain unknown. See [spike findings](reports/findings.md) for the remaining design work.

## Run it

Use Node 24 or newer. The checked-in FlatBuffers bindings and binary let you run the demo without installing the compiler. `mise install` installs the pinned development tools when regeneration is needed.

```sh
npm ci
npm run check
npm run demo
npm run build
npm run benchmark
```

```ts
import { readFile } from 'node:fs/promises';
import { CountryRegistry } from './src/index.ts';

const countries = CountryRegistry.open(await readFile('data/countries.crdb'));
countries.resolve('Turkiye').preferred?.id; // Q43
countries.resolve('CS', { namespace: 'iso-alpha2', date: '1990-01-01' });
countries.resolve('CS', { namespace: 'iso-alpha2', date: '2005-01-01' });
countries.resolve('AN', { namespace: 'iso-alpha2' });
countries.metadata();
countries.compareRelease(); // freshness unknown until release metadata is supplied
```

Opening validates structure and semantic indexes once. Keep the supplied bytes immutable and alive while registry/result views are in use. Result fields decode on demand. Names use trimmed NFC Unicode lowercase matching; punctuation and accent variants need explicit aliases. Specify a namespace to avoid combining code and name meanings. Dates use UTC calendar days. A tentative undated code match with unknown bounds retains an uncertainty indication; it cannot outrank a different entity with an established historical assignment. The convenience result object and API are provisional.

## Sources and PR evidence

`sources/manifest.json` records source revisions, hashes, retrieval times, and permanent links. `sources/wikidata/` contains the corresponding Wikidata JSON. `sources/policy.json` records local alias policy. `npm run build` uses only these local inputs and produces `data/countries.crdb`, `data/evidence.json`, and `data/release.json`. The evidence companion and release manifest are supporting artifacts; the binary is the only runtime country dataset.

```sh
npm run source:fetch
npm run build
npm run evidence
npm run evidence -- --offline
```

`source:fetch` is an explicit network operation. `evidence` independently retrieves pinned and current Wikidata revisions and reports each supplied assertion, source link, reference links, and discrepancies. It verifies the binary/evidence binding. The offline mode checks pinned snapshots only and cannot certify live evidence. Both commands return a nonzero status when evidence remains unresolved; that is expected for this corpus.

The PR evidence workflow runs the checker from the trusted base commit against the proposed artifacts, without executing PR code in that job. A separate build/test job checks reproducibility. The prototype does not automate primary-document interpretation or a maintainer resolution process. Reference-dependent claims and runtime fact changes remain non-passing until that process is designed. Repository branch-protection requirements are not configured by this spike.

## Ownership and scope

The spike is private and unpublished. The code is [MIT licensed](LICENSE); `private: true` prevents accidental npm publication. Wikidata structured data is [CC0](https://www.wikidata.org/wiki/Wikidata:Data_access#Using_Wikidata's_data); referenced documents retain their own terms. We preserve source links and snapshots, and do not redistribute full referenced documents.

There is no Slackwater migration, native reader, public API service, or production release in this spike. The first milestone is verified coverage of the countries required by Slackwater, described below. Broader country and historical coverage can follow through reviewed contributions.

## First milestone: Slackwater coverage

The current benchmark inventory contains 129 distinct country inputs across 8,728 source records. Only four inputs currently resolve in this deliberately small corpus. These counts describe coverage, not verification. The comparison library's expected codes are migration baselines, not authoritative evidence.

Before Slackwater adopts this library, every required input must resolve to its reviewed country identity and current ISO code, with explicit aliases for existing source spellings. Pin the Slackwater source revision in the coverage inventory, test every required input, and publish a report that separates verified, ambiguous, and unresolved entries. Historical fixtures remain useful tests; they do not establish complete historical coverage.

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for data changes. Before updating Wikidata, verify each assertion against its original reliable source and at least three additional independent reliable sources, and list all of them as references on the Wikidata statement. Record the resulting revision link and rerun the source sync and evidence check. A reference URL alone does not prove a claim. Check the source passage and distinguish current code evidence from evidence for historical assignment dates. Missing evidence must remain unresolved until this process is complete; local overrides must not turn it into a passing check.

Code and data have separate licensing. See [data licensing and provenance](DATA_LICENSE.md).
