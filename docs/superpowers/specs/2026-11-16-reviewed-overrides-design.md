# Reviewed local overrides

Country facts can be reviewed and used while a Wikidata contribution is blocked or awaiting acceptance. Each local decision remains distinguishable from the pinned Wikidata source. Turkey issue [#2](https://github.com/openwatersio/c5y-n8r/issues/2) supplies the first evidence-only case.

## Approach

Keep immutable Wikidata snapshots and add a small, separately reviewed JSON overlay. The build applies approved statement corrections to an in-memory copy before deriving the registry. The evidence companion carries both the original assertion and the local decision. A review can also attach evidence without changing a value.

Waiting for Wikidata blocks independently verified corrections when editing is restricted. Editing snapshot files would lose the distinction between upstream data and local decisions. A separate dataset fork duplicates source maintenance. The overlay follows the approach approved in this conversation.

## Review record

`sources/reviewed-overrides.json` contains versioned statement records with:

- A stable local ID, QID, property, statement ID, and reviewed Wikidata revision.
- The exact original statement value, qualifiers and rank, plus their fingerprint. Snapshot hashes remain in the source manifest.
- The proposed statement value, qualifiers and rank, or an explicit evidence-only decision.
- One primary source and two corroborating sources, each with URL, title, relevant passage or paraphrase, passage location, publication date when known, and retrieval date. Records explain source independence and any uncertainty; three URLs alone do not establish accuracy.
- Maintainer identity, approval date, review issue URL, and explanation of the applicable scope and time period.
- Upstream state: blocked, pending, accepted, or rejected; the contribution or discussion URL when available, and the reason for a blocked edit.

Only maintainer-approved, active records are applicable. Validation rejects duplicate local IDs, multiple active decisions for the same statement, missing sources or review fields, invalid ranks and values, and unsupported record versions. Rejected or unapproved proposals cannot alter data or certify evidence.

The first version supports existing statement values and qualifiers consumed by the current build. It does not create new entities, edit labels, or treat unofficial aliases as factual country statements. Those continue to use the existing explicit matching policy. Unknown statements and properties fail validation rather than being ignored.

## Build and provenance

`src/overrides.ts` owns validation, matching and application. `scripts/build.ts` loads the overlay after validating each original snapshot digest, applies eligible records to a copy, and generates evidence for the effective assertion with the original source and review attached. Raw snapshots and their hashes never change because of an override.

The binary remains the existing format. Its evidence digest binds the complete evidence companion, including local decisions and source details; any change to that companion changes the binary identity and requires a dataset version increase. The npm artifact includes the review records through the evidence companion. Documentation explains that generated data can contain reviewed local contributions and preserves the referenced documents' separate licensing terms.

The checker reports an explicitly approved assertion as verified with provenance identifying a local review. This verifies that the required review record exists and remains applicable; it does not claim to interpret source documents automatically. Unreviewed assertions retain their current statuses. The reader continues to describe the overall corpus as an unreviewed spike: one reviewed continent statement does not certify Turkey's codes, names, dates, or the rest of the dataset.

## Sync, drift and retirement

The checker compares each reviewed statement with pinned and current Wikidata data. A newer entity revision alone does not invalidate an unchanged statement, but a change to the reviewed statement's value, qualifiers, rank or references requires review. The build rejects a record whose pinned baseline no longer matches; live checking reports drift as non-passing. Offline checks remain unable to certify live state.

For a value correction, upstream adoption means the current statement matches the proposed value, qualifier scope and rank and includes the primary reference. For an evidence-only decision, it means the chosen primary reference is present upstream on the unchanged assertion. The checker reports acceptance as requiring retirement review; it never silently deletes an override or attributes a local contribution to Wikidata.

A maintainer retires the data override after checking the accepted upstream assertion, pinning its revision, and rerunning checks. The source-review record remains applicable to the upstream assertion, so retirement does not discard the evidence review or turn it back into an unreviewed claim. The historical local decision remains in Git and the issue. Rejection upstream returns the decision for review rather than silently keeping it active.

## Evidence policy

`CONTRIBUTING.md`, README and issue guidance require one high-quality primary source, checked against two other quality sources supporting the same entity, meaning, value, scope and applicable period. Additional sources and independence notes stay in the review record and issue. A Wikidata contribution normally adds the primary reference only, preserving valid existing references.

Wikidata remains the preferred upstream. A reviewed local decision is allowed when a contribution is blocked or pending; missing evidence cannot be replaced with an approval checkbox. Public-source licensing and notices remain part of the review.

## Compatibility and trusted checks

Existing accepted inputs and lookup expectations remain intact. Intentional answer changes still require review against the protected base. The trusted checker must understand the new review schema before it can accept reviewed local findings; proposed code cannot grant itself trusted verification.

Approval is bound to the digest of the complete review record through a trusted-base allowlist. Names, dates and an approval flag supplied by a PR cannot authorize themselves. The rollout has two stages: merge schema support and reviewed records through code-owner review without activating them, then activate only records whose complete digests are already authorized on the base branch. Any subsequent edit to a record invalidates that authorization and repeats review. This requires separate activation state; it cannot be inferred from the mere presence of a record in the proposed corpus.

The trusted checker recognizes a narrow evidence-only transition by comparing decoded runtime facts with the base and independently checking the authorized evidence differences. A changed evidence digest alone does not force every unrelated, unchanged assertion to become newly verified. Other changes remain non-passing unless they are exactly the authorized corrections. For factual overrides, the trusted checker independently derives and compares affected entity fields and assignment values and date bounds from the effective source; checking only the evidence ID is insufficient. Unrelated runtime changes cannot hide behind an approved record.

Tests cover evidence-only approval, an effective value correction, missing approval or source details, stale baselines, duplicate decisions, live drift, upstream adoption, retirement, reproducible builds, evidence tampering and unchanged accepted lookup behavior. The Turkey record references HRI/CORE/1/Add.116 §2 and records FAO and Şekercioğlu et al. as corroboration, together with their limits. No Wikidata edit is part of this implementation.
