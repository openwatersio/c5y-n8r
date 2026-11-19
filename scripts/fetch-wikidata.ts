import { READER_VERSION } from '../src/common.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const required = JSON.parse(await readFile('sources/slackwater-required.json', 'utf8'));
const initialIds = ['Q43', 'Q213', 'Q33946', 'Q37024', 'Q25227', 'Q25279', 'Q26273', 'Q27561', 'Q145', 'Q971', 'Q974'];
const userAgent = `OpenWatersCountryRegistrySpike/${READER_VERSION} (https://github.com/openwatersio/c5y-n8r)`;
await mkdir('sources/wikidata', { recursive: true });
const previous = JSON.parse(await readFile('sources/manifest.json', 'utf8').catch(error => { if (error.code === 'ENOENT') return '[]'; throw error; }));
const ids: string[] = [...new Set<string>([...previous.map((m: any) => m.id), ...initialIds, ...required.required.flatMap((r: any) => r.candidateEntity === undefined ? [] : [r.candidateEntity])])];
if (ids.some(id => !/^Q[1-9][0-9]*$/.test(id))) throw new Error('Invalid candidate entity ID');
const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const refreshIds = args.filter(arg => arg !== '--refresh');
if (refreshIds.some(id => !/^Q[1-9][0-9]*$/.test(id) || !ids.includes(id)) || (!refresh && refreshIds.length)) throw new Error('Invalid or unknown refresh entity');
const manifest = [];
for (const id of ids) {
  const pinned = previous.find((m: any) => m.id === id);
  if (pinned && !(refresh && (!refreshIds.length || refreshIds.includes(id)))) {
    const stored = await readFile(pinned.file);
    if (createHash('sha256').update(stored).digest('hex') !== pinned.sha256) throw new Error(`${id}: pinned snapshot digest mismatch`);
    manifest.push(pinned); continue;
  }
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`;
  const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  const text = await response.text();
  const entity = JSON.parse(text).entities[id];
  if (!entity || !Number.isSafeInteger(entity.lastrevid)) throw new Error(`${id}: missing revision`);
  const file = `sources/wikidata/${id}-${entity.lastrevid}.json`;
  const prior = previous.find((m: any) => m.id === id && m.revision === entity.lastrevid && m.file === file);
  if (prior) {
    const stored = await readFile(file);
    if (createHash('sha256').update(stored).digest('hex') !== prior.sha256) throw new Error(`${id}: pinned snapshot digest mismatch`);
    manifest.push(prior); console.log(id, entity.lastrevid, 'unchanged'); continue;
  }
  await writeFile(file, text);
  manifest.push({ id, revision: entity.lastrevid, file, sha256: createHash('sha256').update(text).digest('hex'), retrievedAt: new Date().toISOString(), permanentLink: `https://www.wikidata.org/w/index.php?title=${id}&oldid=${entity.lastrevid}` });
  console.log(id, entity.lastrevid);
}
await writeFile('sources/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
