import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const { geocoderInventory: pin } = JSON.parse(await readFile(new URL('../sources/slackwater-required.json', import.meta.url), 'utf8'));
assert.match(pin.revision, /^[0-9a-f]{40}$/);
assert.equal(pin.repository, 'https://github.com/openwatersio/slackwater-database');
assert.equal(pin.path, 'metadata/places.json');
const response = await fetch(`https://raw.githubusercontent.com/openwatersio/slackwater-database/${pin.revision}/${pin.path}`, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'openwatersio/c5y-n8r geocoder provenance check' } });
if (!response.ok) throw new Error(`Pinned inventory fetch failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
assert.deepEqual([...new Set(JSON.parse(bytes).map(row => row.countryCode))].sort(), pin.countryCodes);
console.log(`Authenticated ${pin.countryCodes.length} geocoder codes at ${pin.revision}`);
