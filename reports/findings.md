# Spike findings

This spike exercises one candidate binary dataset and its TypeScript reader. It remains unpublished and has no production consumer. The corpus has 137 Wikidata entities, 627 indexed assignments, and 771 unreviewed evidence requests. The binary is 119,336 bytes; the evidence companion is 241,920 bytes. Country snapshots remain outside the runtime lookup artifact. Separate taxonomy and research snapshots document source interpretation without admitting extra country entities.

## Source fidelity and evidence quality

Wikidata is the upstream source, including statements without independent supporting references. The gate checks faithful extraction from pinned revisions and compatibility. Missing or weak references are asynchronous quality work, not a prerequisite to including data. Existing archived evidence reports describe the policy under which they were generated; they are not a current gate verdict.

Many ISO claims have no references. They can be imported with source provenance while quality issues remain open. The reused CS assignments carry year-precision qualifiers and deprecated ranks; those require faithful temporal interpretation. A country existence date cannot fill in a missing ISO assignment date. Labels and aliases can supply accepted spellings without establishing official-name history. Q43 is labeled Turkey in English and Türkiye in Turkish in the pin.

A source match does not certify factual truth. Improve suspected upstream errors in Wikidata, then sync and version the corrected data. Derived spellings, unofficial aliases and local corrections remain explicitly local policy. Trusted artifact rebuilding, pinned source authentication, versioning and protected reader observations remain required. Missing evidence quality and missing temporal information are separate concerns.

## Lookup behavior

The demo resolves CS to different entities for 1990 and 2005, keeps both candidates when no date is passed, and refuses a definite choice in a year-precision transition window. AN retains its historical entity and three in-corpus successor pointers. Other successors can exist outside this corpus. Congo deliberately returns two simultaneous candidates. UK is an explicitly unreviewed local alias in a separate namespace.

All results report partial or outside coverage and unreviewed-spike evidence status. A single entity with unknown code bounds may be the tentative undated answer, with applicability uncertain and temporal ambiguity exposed. Unknown bounds cannot outrank a competing established historical entity. Dated lookups with unknown applicability do not manufacture a preferred answer.

The coverage interval is embedded data. The entity set follows the compiled records. Per-entity and per-subject completeness declarations are deferred; this corpus never certifies a globally unique answer or a confirmed absence. Preferred-name history is also deferred: the reader returns the imported display label, not a reconstructed official name for the requested date. Continent selection uses a unique preferred source claim when supplied, otherwise the first imported claim. Multiple equal-rank continents remain an explicitly unreviewed display convention. Q55643 maps to Oceania with pinned taxonomy proof; Q538 retains the existing broad display grouping. Antarctica has a separately disclosed local self-continent rule supported by its actual P31 continent identity, without a fabricated P30 self-statement.

## Measurements

The recorded dataset-version-1 measurements below use Node v24.20.0 on Apple M1 Ultra, darwin/arm64. Values are median batch means in nanoseconds per operation, with the full workload and batch distributions in [benchmark.json](benchmark.json).

| Operation | Median ns/op |
| --- | ---: |
| spike: alpha2, full resolver result | 1473 |
| country-code-lookup: alpha2 | 846 |
| countries-list: alpha2 | 165 |
| country-codes-list: alpha2 | 346 |
| i18n-iso-countries: alpha2 validation | 35 |
| spike: name, full resolver result | 1332 |
| country-code-lookup: name | 2210 |
| countries-list: name | 5180 |
| country-codes-list: name | 216 |
| i18n-iso-countries: name | 14015 |
| spike: reused code with date | 1948 |
| spike: miss | 1491 |
| spike: ambiguity | 2261 |
| spike: open plus structural/index validation | 451025 |

These APIs do different work. The spike returns candidate views and ambiguity metadata; the comparison libraries mostly return a code or record. The i18n alpha-2 measurement validates a code. Some names miss in some comparison libraries. Eleven entities are not a full-scale dataset, and the batch percentiles are not individual-request tail latency. These measurements do not establish that FlatBuffers is universally faster. Simpler indexed library operations beat this resolver on code lookup.

The harness also examined 8,728 Slackwater source records and 129 distinct country values. The candidate resolves 127 country values covering 8,699 records, with continent metadata for every resolved value. Virgin Islands (26 records) and Saint Helena (3) remain unresolved; source spelling and geographic scope must be reviewed. See the per-value results before drawing any migration conclusion. Slackwater was not modified.

## Before retaining or expanding the implementation

- Establish the initial production entity/date boundary and explicit completeness declarations.
- Preserve date precision and explicit interval interpretation; investigate weak source references asynchronously.
- Keep evidence-quality follow-ups separate from required source-fidelity checks.
- Specify dated preferred names and a continent convention; preserve unsupported claims as unverified rather than promoting them silently.
- Measure full-scale data, individual lookup distributions, cold module/file loading, allocations, and retained memory before setting budgets.
- Fuzz the handwritten structural verifier against a larger malformed corpus or select a supported verifier strategy; shared structures are memoized, expanded structural work is bounded, and indexed entity IDs are limited to 64 UTF-16 code units. This spike validates the fields it reads; it is not a security certification for arbitrary future schemas.
- Complete release-manifest/evidence integrity checks, package installation fixtures, generated-binding regeneration checks, and the future binary-evolution contract.
- Keep the code MIT license and upstream data license inventory with distributions.

## Validation and review

The candidate local suite covers temporal resolution, uncertain bounds, ambiguity, aliases, retirement pointers, embedded version compatibility, malformed files, evidence mismatches, unsupported dates, source outages, and a coverage-only PR-gate bypass regression. The suite includes a plain Node package-export check and source-refresh regressions. Source compilation is deterministic from the pinned inputs; a sync of unchanged revisions preserves those inputs. Format 2 rejects format 1 instead of reinterpreting its deprecated-claim statuses. Metadata remains readable before an incompatible body is inspected.

The compatibility fixture pins 627 imported input assignments with 1,839 namespaced, default and dated lookup expectations. All 119 original inputs and 823 original full lookup observations are retained unchanged, alongside 28 protected conversion and assignment cases. The trusted checker flags fixture changes and its artifact comparison mode checks reader observations against base expectations in a fresh job that runs no proposed code. Source refreshes fail if a pinned mapping disappears, an alias points outside the corpus, or a supplied temporal value cannot be interpreted. Changed runtime artifacts require an increased dataset version in the PR evidence check. Full production review and a complete audit of historical data are outside this private spike.

The Saint Helena island lookup remains distinct from the newly admitted ISO-bearing territory Q192184. SHN converts to SH with uncertain temporal bounds retained. The provider's three SHN series can use code lookup; no bare island-name redirect is installed. See issue #150 for the source-context research and the separate GBR series that must not inherit the mapping.
