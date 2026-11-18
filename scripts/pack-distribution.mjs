import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

execFileSync('npm', ['run', 'build:reader'], { stdio: 'inherit' });
const output = resolve(process.argv[2] ?? 'reports/local/distribution');
await mkdir(output, { recursive: true });
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim() !== '';
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], { encoding: 'utf8' }));
const sha256 = createHash('sha256').update(await readFile(resolve(output, packed.filename))).digest('hex');
await writeFile(resolve(output, 'distribution.json'), JSON.stringify({
  package: packed.name, version: packed.version, commit, dirty,
  archive: packed.filename, sha256, integrity: packed.integrity,
  binarySha256: createHash('sha256').update(await readFile('data/countries.crdb')).digest('hex'),
}, null, 2) + '\n');
await writeFile(resolve(output, 'SHA256SUMS'), `${sha256}  ${packed.filename}\n`);
console.log(`Prepared ${resolve(output, packed.filename)} (${commit}${dirty ? ', dirty checkout; local testing only' : ''})`);
