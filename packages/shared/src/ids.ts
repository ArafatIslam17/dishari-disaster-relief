/**
 * UUIDv7 (RFC 9562): 48-bit Unix milliseconds, version, 74 random bits.
 * Monotonic within one process: when two ids share a millisecond, the random
 * tail is incremented so ids sort in creation order (sync resume relies on it).
 */
let lastMs = -1;
let lastTail: Uint8Array = new Uint8Array(10);

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function incrementTail(tail: Uint8Array): Uint8Array {
  const next = new Uint8Array(tail);
  for (let i = next.length - 1; i >= 0; i--) {
    const v = (next[i] ?? 0) + 1;
    next[i] = v & 0xff;
    if (v <= 0xff) break;
  }
  return next;
}

export function uuidv7(now: number = Date.now()): string {
  let tail: Uint8Array;
  if (now === lastMs) {
    tail = incrementTail(lastTail);
  } else if (now < lastMs) {
    // Clock went backwards: keep monotonic order by staying on the last timestamp.
    now = lastMs;
    tail = incrementTail(lastTail);
  } else {
    tail = randomBytes(10);
  }
  lastMs = now;
  lastTail = tail;

  const bytes = new Uint8Array(16);
  let ms = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes.set(tail, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Milliseconds encoded in a UUIDv7. */
export function uuidv7Time(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}
