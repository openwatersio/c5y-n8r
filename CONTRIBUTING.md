# Contributing

c5y-n8r provides fast library access to verified information maintained in Wikidata. Accuracy and traceability are requirements for accepting data. Our first goal is verified coverage of the country inputs required by Slackwater; `sources/slackwater-required.json` records that inventory and its pending verification status.

## Verify each assertion before editing Wikidata

For every data addition or correction, identify a reliable source for the exact assertion and independently double-check it against at least three additional reliable sources. This means at least four sources in total. Record all of them as references on the relevant Wikidata statement when updating Wikidata.

The sources must support the same entity, value, meaning, and applicable time period. Prefer the responsible standards body or issuing authority as the original source. Three sites repeating one dataset, mirrors of the same publication, and sources derived from Wikidata do not provide independent corroboration. Search snippets and an AI-generated answer are not evidence.

Read the supporting passage or table in every source. Record its URL or publication identifier, section or page, publication or revision date where available, and retrieval date. Explain how it supports the assertion. For historical claims, verify the effective dates separately: a current ISO table does not establish when a code was introduced, retired, or reassigned. Preserve any uncertainty in date precision.

If the sources disagree or fewer than three additional independent sources can be found, leave the assertion unresolved and document the gap. Do not update Wikidata on our behalf or accept the data into a verified release until the discrepancy is resolved and the evidence requirement is met. Never manufacture consensus by counting duplicate sources.

## Update upstream, then sync

1. Check the current Wikidata entity and statement, including its qualifiers, rank, and existing references. Confirm the entity represents the intended country or historical identity.
2. Complete the source checks above before submitting the Wikidata edit. Add the original source and all three or more corroborating sources as statement references using the appropriate reference properties. Preserve valid existing references and follow Wikidata's contribution rules. Keep a passage-level explanation in the pull request if the reference fields cannot capture it.
3. Record the resulting Wikidata revision permalink and statement ID. If the statement is already correct and fully referenced, record its existing revision and verify those references against the same standard.
4. Run `npm run source:fetch` to retrieve the updated Wikidata information, then `npm run build`. Commit the pinned snapshots, source manifest, binary, and evidence artifacts together. The library's imported assertions must come from the synced Wikidata revision; a local data patch cannot substitute for fixing upstream.
5. Run `npm run check` and `npm run evidence`. Review every evidence result and include the report with the pull request. A missing source, inaccessible supporting passage, conflicting value, or unresolved review remains non-passing.

Local matching rules, such as normalization and unofficial aliases, must be clearly identified as policy. They cannot establish a country fact or bypass source verification. Preserve accepted inputs and historical identities when preferred names or current codes change.

## What a data pull request must include

- The affected Slackwater inputs and intended answers, including any dates, ambiguity, or coverage limits.
- The exact Wikidata entity, statement IDs, and revision permalinks used by the sync.
- The original source and at least three additional independent sources for each assertion, with supporting passages or table locations and confirmation that all sources are referenced on Wikidata.
- An explanation of disagreements, date precision, and any unresolved assertions. Unresolved entries stay outside verified release coverage.
- The dataset version change, generated artifact changes, compatibility fixtures, and evidence report. Explain any change to an existing answer; retain old accepted spellings and dated meanings.
- Applicable upstream data licenses and notices, following [DATA_LICENSE.md](DATA_LICENSE.md). The [MIT license](LICENSE) covers code and documentation.

The evidence checker currently verifies supplied Wikidata pointers, values, and references, but does not interpret source passages or enforce independent corroboration automatically. Maintainers must check those requirements during review. A green build or a reference count alone cannot certify a dataset. The spike's existing corpus remains unreviewed until it satisfies this policy.
