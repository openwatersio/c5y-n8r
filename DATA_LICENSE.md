# Data licensing and provenance

The MIT license covers this repository's code and documentation. Imported data and generated datasets retain the applicable upstream terms; the code license does not relicense them.

The current imported structured data in `sources/wikidata/` is provided by Wikidata under [CC0 1.0](https://www.wikidata.org/wiki/Wikidata:Licensing). `sources/manifest.json` preserves revision links, retrieval dates, and hashes. The generated binary derives from these snapshots and the repository's alias policy. Preserve the provenance companion when distributing a dataset.

Referenced documents retain their own licenses. Linking to a source as evidence does not grant permission to redistribute the document, and its license does not automatically propagate to independently stated facts in Wikidata. We store reference links rather than copies of those documents.

Any additional imported dataset must record its source, version or revision, license, required notices, and the artifacts derived from it. Review compatibility before incorporation, and carry applicable attribution and redistribution requirements through generated outputs. A future dataset with different inputs must have its own complete license inventory.

## Consumer compatibility inventories

`sources/slackwater-required.json` and the compatibility section of `reports/benchmark.json` record country input strings and counts from the pinned Slackwater revision, with unverified migration-baseline codes produced by `country-code-lookup` 0.2.1. It contains no station coordinates or prediction data. Slackwater's root MIT notice excludes `data/` and delegates data licensing to the individual source files; do not apply the root MIT license to imported source data. The complete pinned source and license inventory is recorded in [sources/slackwater-licenses.json](sources/slackwater-licenses.json), including exact per-license record counts, upstream credits, license URLs, source notes, and revision links. It covers all 8,728 records and 129 country inputs at revision `f9c3d42c066efe87e606f8c09673fb70cff2b2cf`; no station data is redistributed here. Preserve that companion and the upstream terms when sharing these inventories.

The inputs include DMI (207), JHOD (20), JMA (70), Kartverket (33), LINZ (56), NOAA (3,504), and TICON-4 (4,838) records. TICON contains 4,164 CC BY 4.0 records and 674 CC BY-NC 4.0 records; the latter retain upstream noncommercial restrictions. The inventory does not grant commercial-use permission or relicense those inputs. JHOD uses Government Standard Terms of Use 2.0; JMA selects the CC BY 4.0 option under Public Data License 1.0. Source credits and editing notices, including the TICON citation by Hart-Davis, Dettmering and Seitz (2025), are preserved in the companion.

These consumer inventories and their source-license inventory are excluded from the npm artifact by its `files` allowlist. The runtime country dataset remains derived from the CC0 Wikidata snapshots; the consumer inventory is used only to check compatibility.

The `country-code-lookup` package is MIT licensed, copyright 2019 Richard Astbury; its notice is preserved in [sources/licenses/country-code-lookup-MIT.txt](sources/licenses/country-code-lookup-MIT.txt). `sources/accepted-inputs.json` is an unreviewed compatibility fixture derived from the CC0 Wikidata snapshots and local alias policy, rather than a certification of those assertions.
