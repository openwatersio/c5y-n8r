# Private spike findings

This spike exercises one binary dataset and its TypeScript reader. It remains unpublished and has no production consumer. The corpus has eleven Wikidata entities, 119 indexed assignments, and 136 evidence requests. The binary is 28,256 bytes; the evidence companion is 48,012 bytes. Source snapshots are about 5 MB and stay outside the runtime lookup artifact.

## Evidence

The live pinned-and-current check reports 82 verified spelling assertions and 54 findings requiring review. It exits with status 1. No claim is certified merely because a Wikidata URL exists. The full per-assertion output is in [evidence.json](evidence.json).

Many ISO claims have no references. The reused CS assignments carry year-precision qualifiers and deprecated ranks. A country existence date cannot fill in a missing ISO assignment date. Labels and accepted spellings have useful provenance without proving official-name history. The snapshot for Q43 labels the country Turkey in English and Türkiye in Turkish.

The check prototype conservatively leaves statement interpretation and local-policy aliases unresolved. It has no automated primary-document passage extraction or maintainer-resolution mechanism. Runtime entity/assignment or metadata changes trigger a non-passing review finding. Code-only changes with unchanged facts report no new factual assertions. The CI workflow isolates trusted checker code from proposed artifacts; it is not configured as a required branch-protection rule.

## Lookup behavior

The demo resolves CS to different entities for 1990 and 2005, keeps both candidates when no date is passed, and refuses a definite choice in a year-precision transition window. AN retains its historical entity and three in-corpus successor pointers. Other successors can exist outside this corpus. Congo deliberately returns two simultaneous candidates. UK is an explicitly unreviewed local alias in a separate namespace.

All results report partial or outside coverage and unreviewed-spike evidence status. A single entity with unknown code bounds may be the tentative undated answer, with applicability uncertain and temporal ambiguity exposed. Unknown bounds cannot outrank a competing established historical entity. Dated lookups with unknown applicability do not manufacture a preferred answer.

The coverage interval is embedded data. The entity set follows the compiled records. Per-entity and per-subject completeness declarations are deferred; this corpus never certifies a globally unique answer or a confirmed absence. Preferred-name history is also deferred: the reader returns the imported display label, not a reconstructed official name for the requested date. Continent selection uses the first imported claim and requires a reviewed convention before production.

## Measurements

Measurements below use Node v24.20.0 on Apple M1 Ultra, darwin/arm64. Values are median batch means in nanoseconds per operation, with the full workload and batch distributions in [benchmark.json](benchmark.json).

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

The harness also examined 8,728 Slackwater source records and 129 distinct country values. Only four country values are covered by this small corpus; 8,554 records remain uncovered. See the per-value results before drawing any migration conclusion. Slackwater was not modified.

## Before retaining or expanding the implementation

- Establish the initial production entity/date boundary and explicit completeness declarations.
- Resolve source references and date interpretations, including inclusive source dates versus half-open runtime intervals.
- Decide the maintainer-resolution mechanism for PR evidence findings and implement primary-source passage checks.
- Specify dated preferred names and a continent convention; preserve unsupported claims as unverified rather than promoting them silently.
- Measure full-scale data, individual lookup distributions, cold module/file loading, allocations, and retained memory before setting budgets.
- Harden the handwritten structural verifier against a larger malformed corpus or select a supported verifier strategy. This spike validates the fields it reads; it is not a security certification for arbitrary future schemas.
- Complete release-manifest/evidence integrity checks, package installation fixtures, generated-binding regeneration checks, and the future binary-evolution contract.
- Select the project name and license before any public release.

## Validation and review

The local suite has 16 passing tests, covering temporal resolution, uncertain bounds, ambiguity, aliases, retirement pointers, embedded version compatibility, malformed files, evidence mismatches, unsupported dates, source outages, and a coverage-only PR-gate bypass regression. The same tests run on Node 24. Source compilation is deterministic from the pinned inputs.

An independent reviewer found the metadata-only evidence-gate bypass and the unknown-bound preference error. Both were reproduced with failing tests and corrected. A narrow re-review confirmed those fixes. Full production review and a complete audit of historical data are outside this private spike.
