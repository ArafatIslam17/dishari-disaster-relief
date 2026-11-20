import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Server-side cryptography.
 *  - Phone HMAC (C5): K_op = HMAC(PHONE_PEPPER, "op:"+operationId); hmac = HMAC(K_op, phone).
 *  - Value hashes for the audit log (C8): HMAC(PHONE_PEPPER, "audit:"+value), never raw values.
 *  - Envelope encryption (C8): per-operation data keys wrapped by DATA_MASTER_KEY with AES-256-GCM.
 */
export class ServerCrypto {
  private readonly pepper: Buffer;
  private readonly master: Buffer;

  constructor(pepperB64: string, masterB64: string) {
    this.pepper = Buffer.from(pepperB64, 'base64');
    this.master = Buffer.from(masterB64, 'base64').subarray(0, 32);
  }

  operationHmacKey(operationId: string): Buffer {
    return createHmac('sha256', this.pepper).update(`op:${operationId}`).digest();
  }

  phoneHmac(operationId: string, normalisedPhone: string): string {
    return createHmac('sha256', this.operationHmacKey(operationId)).update(normalisedPhone).digest('hex');
  }

  auditHash(value: unknown): string {
    return createHmac('sha256', this.pepper)
      .update(`audit:${JSON.stringify(value ?? null)}`)
      .digest('hex')
      .slice(0, 32);
  }

  wrap(plain: Buffer): string {
    return aesEncrypt(this.master, plain);
  }

  unwrap(wrapped: string): Buffer {
    return aesDecrypt(this.master, wrapped);
  }
}

/** AES-256-GCM; output = base64(iv[12] | tag[16] | ciphertext). */
export function aesEncrypt(key: Buffer, plain: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function aesDecrypt(key: Buffer, encoded: string): Buffer {
  const buf = Buffer.from(encoded, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Temporary password for NFR03: 12 characters, unambiguous alphabet, letters and digits guaranteed. */
export function temporaryPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = letters + letters.toUpperCase() + digits;
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => all[b % all.length] as string);
  chars[0] = letters[(bytes[0] ?? 0) % letters.length] as string;
  chars[5] = digits[(bytes[5] ?? 0) % digits.length] as string;
  return chars.join('');
}
