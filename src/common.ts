export const MAX_ENTITY_ID_LENGTH = 64;
export const MIN_DAY = -2147483648;
export const MAX_DAY = 2147483647;
export const READER_VERSION = '0.0.2';
export const FORMAT_VERSION = 2;
export type Namespace = 'iso-alpha2' | 'iso-alpha3' | 'iso-numeric' | 'name' | 'unofficial';
export const NAMESPACES: Namespace[] = ['iso-alpha2', 'iso-alpha3', 'iso-numeric', 'name', 'unofficial'];

export function day(value: string | Date): number {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Expected an ISO calendar date');
  const parsed = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new Error('Invalid calendar date');
  return Math.floor(parsed.getTime() / 86_400_000);
}

export function normalize(value: string, namespace: Namespace): string {
  const trimmed = value.trim().normalize('NFC');
  if (namespace === 'name') return trimmed.toLowerCase();
  if (namespace === 'iso-numeric') return /^[0-9]{3}$/.test(trimmed) ? trimmed : '';
  const size = namespace === 'iso-alpha3' ? 3 : 2;
  return new RegExp(`^[A-Za-z]{${size}}$`).test(trimmed) ? trimmed.toUpperCase() : '';
}

export function keyFor(value: string, namespace: Namespace): string {
  return `${namespace}\0${normalize(value, namespace)}`;
}

export function alpha2Slot(value: string): number {
  return (value.charCodeAt(0) - 65) * 26 + value.charCodeAt(1) - 65;
}

export function versionParts(version: string): number[] {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected stable major.minor.patch reader version');
  const result = version.split('.').map(Number);
  if (!result.every(Number.isSafeInteger)) throw new Error('Invalid reader version');
  return result;
}

export function readerSupports(required: string): boolean {
  const a = versionParts(READER_VERSION), b = versionParts(required);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
