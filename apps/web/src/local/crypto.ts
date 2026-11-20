/**
 * Field-level encryption for the phone's local store (NFR04, UC10 QR1).
 * A random AES-GCM-256 data key (DEK) encrypts personal fields. The DEK is stored only
 * wrapped: by a key derived from the PIN (PBKDF2-SHA-256) and by a per-device recovery key
 * the server returns at online log-in. The PIN itself is never stored (DECISIONS C18).
 */
import { PIN_PBKDF2_ITERATIONS } from '@relief/shared';

export interface Sealed {
  iv: Uint8Array;
  ct: ArrayBuffer;
}
export interface WrappedKey {
  iv: Uint8Array;
  data: ArrayBuffer;
}

const subtle = () => globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function newSalt(): Uint8Array<ArrayBuffer> {
  return randomBytes(16);
}

export async function deriveKek(pin: string, salt: Uint8Array, iterations = PIN_PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

export function generateDek(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']) as Promise<CryptoKey>;
}

export async function wrapDek(dek: CryptoKey, kek: CryptoKey): Promise<WrappedKey> {
  const iv = randomBytes(12);
  const data = await subtle().wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return { iv, data };
}

/** Throws when the wrapping key is wrong (AES-GCM authentication fails). */
export function unwrapDek(wrapped: WrappedKey, kek: CryptoKey): Promise<CryptoKey> {
  return subtle().unwrapKey(
    'raw',
    wrapped.data,
    kek,
    { name: 'AES-GCM', iv: new Uint8Array(wrapped.iv) },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The server-held per-device recovery key, as a wrapping key. */
export function importRecoveryKey(b64: string): Promise<CryptoKey> {
  return subtle().importKey('raw', base64ToBytes(b64), { name: 'AES-GCM' }, false, ['wrapKey', 'unwrapKey']);
}

export async function seal(dek: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, dek, encoder.encode(JSON.stringify(value)));
  return { iv, ct };
}

export async function unseal<T>(dek: CryptoKey, sealed: Sealed): Promise<T> {
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: new Uint8Array(sealed.iv) }, dek, sealed.ct);
  return JSON.parse(decoder.decode(plain)) as T;
}

/** HMAC-SHA256(K_op, phone) as hex: matches the server's mobile_hmac (DECISIONS C5). */
export async function phoneHmac(keyB64: string, normalisedPhone: string): Promise<string> {
  const key = await subtle().importKey('raw', base64ToBytes(keyB64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await subtle().sign('HMAC', key, encoder.encode(normalisedPhone));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}
