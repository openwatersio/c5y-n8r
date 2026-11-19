import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const raw = await readFile('data/evidence.json');
const evidence = JSON.parse(raw.toString());
const path = 'sources/evidence-review-issues.json';
const tracker = JSON.parse(await readFile(path, 'utf8'));
const ids = evidence.requests.map(request => request.id);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate evidence request');
const missing = ids.filter(id => !tracker.evidenceIssues[id]);
const orphaned = Object.keys(tracker.evidenceIssues).filter(id => !ids.includes(id));
if (missing.length || orphaned.length) throw new Error(`Update issue mappings explicitly before refreshing: missing=${JSON.stringify(missing)} orphaned=${JSON.stringify(orphaned)}`);
if (Object.values(tracker.evidenceIssues).some(url => !/^https:\/\/github\.com\/openwatersio\/c5y-n8r\/issues\/[1-9][0-9]*$/.test(url))) throw new Error('Invalid evidence issue URL');
tracker.datasetVersion = evidence.datasetVersion;
tracker.candidateEvidenceSha256 = createHash('sha256').update(raw).digest('hex');
tracker.totalEvidenceItems = ids.length;
tracker.newEvidenceItems = ids.length - tracker.existingEvidenceItems;
await writeFile(path, JSON.stringify(tracker, null, 2) + '\n');
console.log(JSON.stringify({ datasetVersion: tracker.datasetVersion, evidence: ids.length, sha256: tracker.candidateEvidenceSha256 }));
