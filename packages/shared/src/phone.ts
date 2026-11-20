/**
 * Bangladeshi mobile numbers (A2): 11 digits `01[3-9]XXXXXXXX`.
 * `+880`, `880` and `0088 0` prefixes, spaces and dashes are accepted on input.
 */
const BD_MOBILE_RE = /^01[3-9]\d{8}$/;

export function normalisePhone(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  // Convert Bangla digits (০-৯) to ASCII so volunteers can type with a Bangla keyboard.
  digits = digits.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00880')) digits = digits.slice(5);
  else if (digits.startsWith('880')) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith('1')) digits = `0${digits}`;
  return BD_MOBILE_RE.test(digits) ? digits : null;
}

export function isValidPhone(input: string): boolean {
  return normalisePhone(input) !== null;
}

/** Display mask for users outside the registering organisation (NFR06): 017******89. */
export function maskPhone(normalised: string): string {
  if (normalised.length < 6) return '*'.repeat(normalised.length);
  return `${normalised.slice(0, 3)}${'*'.repeat(normalised.length - 5)}${normalised.slice(-2)}`;
}

/** Levenshtein distance capped at `max + 1` (cheap early exit). */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}
