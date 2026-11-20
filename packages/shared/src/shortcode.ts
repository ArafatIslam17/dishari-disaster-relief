/**
 * Household short codes (DECISIONS C6):
 *   3-char device prefix + 5 random Crockford base32 chars + 1 Luhn mod-32 check char.
 * Displayed in groups of three: `K7M 4QX 9TC`.
 */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SHORT_CODE_LENGTH = 9;
export const DEVICE_PREFIX_LENGTH = 3;
const RANDOM_LENGTH = 5;

function valueOf(ch: string): number {
  const v = CROCKFORD.indexOf(ch);
  if (v < 0) throw new Error(`Invalid Crockford character: ${ch}`);
  return v;
}

/** Luhn mod N (N = 32) check character over a normalised payload. */
export function checkChar(payload: string): string {
  const n = CROCKFORD.length;
  let factor = 2;
  let sum = 0;
  for (let i = payload.length - 1; i >= 0; i--) {
    let addend = factor * valueOf(payload[i] as string);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / n) + (addend % n);
    sum += addend;
  }
  const remainder = sum % n;
  return CROCKFORD[(n - remainder) % n] as string;
}

/** Upper-case, drop separators and map look-alikes (I, L → 1; O → 0). Returns null when not decodable. */
export function normaliseShortCode(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (s.length !== SHORT_CODE_LENGTH) return null;
  for (const ch of s) if (!CROCKFORD.includes(ch)) return null;
  return s;
}

export function isValidShortCode(input: string): boolean {
  const s = normaliseShortCode(input);
  if (!s) return false;
  return checkChar(s.slice(0, -1)) === s.slice(-1);
}

export function isValidDevicePrefix(prefix: string): boolean {
  return prefix.length === DEVICE_PREFIX_LENGTH && [...prefix].every((c) => CROCKFORD.includes(c));
}

export function generateShortCode(devicePrefix: string, random: () => number = secureRandom): string {
  if (!isValidDevicePrefix(devicePrefix)) throw new Error('Invalid device prefix');
  let body = devicePrefix;
  for (let i = 0; i < RANDOM_LENGTH; i++) body += CROCKFORD[Math.floor(random() * 32) % 32];
  return body + checkChar(body);
}

export function formatShortCode(code: string): string {
  return code.replace(/(.{3})(?=.)/g, '$1 ');
}

/** Generate a device prefix from 15 random bits. */
export function generateDevicePrefix(random: () => number = secureRandom): string {
  let out = '';
  for (let i = 0; i < DEVICE_PREFIX_LENGTH; i++) out += CROCKFORD[Math.floor(random() * 32) % 32];
  return out;
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return (buf[0] as number) / 0x1_0000_0000;
}
