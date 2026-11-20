/** Head-of-household names are Latin letters only (scope boundary p.16-17, DECISIONS C10). */
export const HEAD_NAME_RE = /^[A-Za-z][A-Za-z .'-]*$/;

const HONORIFIC_VARIANTS: Record<string, string> = {
  md: 'md',
  mohammad: 'md',
  mohammed: 'md',
  muhammad: 'md',
  muhammed: 'md',
  mohd: 'md',
  mohamad: 'md',
  mst: 'mst',
  mosammat: 'mst',
  mosammet: 'mst',
  mossammat: 'mst',
  most: 'mst',
  sk: 'sheikh',
  shaikh: 'sheikh',
  sheikh: 'sheikh',
  abdul: 'abdul',
  abdur: 'abdul',
  abdus: 'abdul',
};

/** Lower-case, strip punctuation, collapse spaces and unify common honorific spellings. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => HONORIFIC_VARIANTS[t] ?? t)
    .join(' ');
}

export function jaro(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 1 : 1;
  if (a.length === 0 || b.length === 0) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  return (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
}

/** Jaro-Winkler with the standard prefix scale 0.1 and max prefix 4. */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

/** Honorifics carry no identity and would share Jaro-Winkler's prefix boost between strangers. */
const HONORIFIC_TOKENS = new Set(['md', 'mst']);
function identity(name: string): string {
  const tokens = normaliseName(name).split(' ');
  const core = tokens.filter((t) => !HONORIFIC_TOKENS.has(t));
  return (core.length > 0 ? core : tokens).join(' ');
}

/** Name similarity: best of full-string and token-sorted Jaro-Winkler, honorifics removed. */
export function nameSimilarity(a: string, b: string): number {
  const na = identity(a);
  const nb = identity(b);
  if (!na || !nb) return 0;
  const sorted = (s: string) => s.split(' ').sort().join(' ');
  return Math.max(jaroWinkler(na, nb), jaroWinkler(sorted(na), sorted(nb)));
}

/** Great-circle distance in metres. */
export function haversineMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
