import { isAbsolute, relative, resolve, sep } from 'node:path';
import { readFile, lstat, realpath } from 'node:fs/promises';

export async function readCorpusBytes(corpus: string, path: string, limit = 4 * 1024 * 1024) {
  const root = await realpath(corpus), file = resolve(root, path), info = await lstat(file);
  if (!info.isFile() || info.size > limit) throw new Error(`Invalid or oversized corpus file: ${path}`);
  const location = relative(root, await realpath(file));
  if (location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)) throw new Error(`Invalid corpus file outside source directory: ${path}`);
  return readFile(file);
}
export async function readCorpusFile(corpus: string, path: string): Promise<string> {
  return (await readCorpusBytes(corpus, path)).toString('utf8');
}
