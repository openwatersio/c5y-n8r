import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const ids = ['Q43', 'Q213', 'Q33946', 'Q37024', 'Q25227', 'Q25279', 'Q26273', 'Q27561', 'Q145', 'Q971', 'Q974'];
const userAgent = 'OpenWatersCountryRegistrySpike/0.0.1 (https://github.com/openwatersio/country-registry-spike)';
await mkdir('sources/wikidata', { recursive: true });
const manifest = [];
for (const id of ids) {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`;
  const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  const text = await response.text();
  const entity = JSON.parse(text).entities[id];
  if (!entity || !Number.isSafeInteger(entity.lastrevid)) throw new Error(`${id}: missing revision`);
  const file = `sources/wikidata/${id}-${entity.lastrevid}.json`;
  await writeFile(file, text);
  manifest.push({ id, revision: entity.lastrevid, file, sha256: createHash('sha256').update(text).digest('hex'), retrievedAt: new Date().toISOString(), permanentLink: `https://www.wikidata.org/w/index.php?title=${id}&oldid=${entity.lastrevid}` });
  console.log(id, entity.lastrevid);
}
await writeFile('sources/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
