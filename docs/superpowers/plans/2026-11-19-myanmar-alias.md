# Myanmar compatibility alias implementation plan

> Execute the approved recommendation inline using the existing source, approval and compatibility workflows.

**Goal:** Resolve the four stored Myanmar (Burma) records without losing TICON's original ISO identity.

**Design:** TICON already passes MMR into station normalization. Retain that path. Reader 0.0.4 fixes selection of a current tentative code over retired codes on the same entity; new dataset 4 requires that reader. Add only the exact researched name as a local Q836 alias; preserve historical code candidates and all existing lookup expectations. No general parenthesis stripping, new reader API or production migration.

**Evidence:** [Research and approval context](https://github.com/openwatersio/c5y-n8r/issues/149); the approval input is [myanmar-burma-alias-approval.json](../../myanmar-burma-alias-approval.json).

**Constraints:** The package stays private. Local request approval must merge before activation. New runtime artifacts increase the dataset version. Research quality is asynchronous; the alias is explicitly local rather than attributed to Wikidata.

- [ ] Fix and test same-entity current-code selection without changing reused-code ambiguity.
- [ ] Stage the exact request and minimum-reader transition digests with no runtime data change; run checks and Open Waters review.
- [ ] Add a failing conversion test, activate the alias, append compatibility observations, rebuild and refresh the audit and issue mapping.
- [ ] Verify the trusted checker accepts activation only against the staged approval base.
- [ ] Exercise MMR and the compatibility alias in Slackwater's isolated diagnostic, keeping production imports unchanged.
- [ ] Submit activation after the staged approval merges, following CONTRIBUTING.

**Review focus:** Exact spelling only; existing protected lookup observations unchanged; current MMR/MM selection retains temporal uncertainty; retired BU/BUR source flags retained and rejected by Slackwater; undated targets may describe the current code of that same entity; new evidence mapped to #149.
