# Saint Helena scope implementation

**Goal:** Resolve Slackwater’s three TICON SHN records without assigning the territory’s ISO code to the island entity.

**Design:** Admit Q192184’s existing Wikidata label, P30 and SH/SHN/654 claims as ordinary faithful imports. Keep Saint Helena/Q34497 distinct and preserve its protected lookup answers. No global alias, parent-entity inference or date invention. Missing references remain asynchronous quality findings. The consumer diagnostic uses the original SHN value only for the three verified TICON IDs and retains raw spelling and evidence; the separate GBR series is outside this mapping.

**Implementation:** Extend the pinned corpus and append compatibility cases, increment datasetVersion to 5 and refresh artifacts, audit and issue mapping. Publish a reviewed data PR. Pin its exact public commit in the separately installed Slackwater diagnostic and add the bounded source context, namespace-aware grouping and tests. Keep production and npm publication inactive.

- [x] Add failing territory conversion tests and verify the island remains without a country ISO assignment.
- [x] Import the existing territory snapshot, append fixtures, regenerate dataset 5 and bind new requests to #150.
- [ ] Verify source fidelity, old observations and full checks; run Open Waters review and submit the data PR.
- [ ] Update and check the isolated diagnostic, preserving SHN versus GBR context, evidence and source licenses.
