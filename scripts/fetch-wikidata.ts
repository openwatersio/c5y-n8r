import { READER_VERSION } from '../src/common.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const ids = ['Q43', 'Q213', 'Q33946', 'Q37024', 'Q25227', 'Q25279', 'Q26273', 'Q27561', 'Q145', 'Q971', 'Q974'];
const userAgent = `OpenWatersCountryRegistrySpike/${READER_VERSION} (https://github.com/openwatersio/c5y-n8r)`;
await mkdir('sources/wikidata', { recursive: true });
const previous = JSON.parse(await readFile('sources/manifest.json', 'utf8').catch(error => { if (error.code === 'ENOENT') return '[]'; throw error; }));
const manifest = [];
for (const id of ids) {
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
