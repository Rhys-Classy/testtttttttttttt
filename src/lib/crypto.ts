import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { env } from './env';

let key: Buffer | undefined;
function encryptionKey(): Buffer {
  if (!key) key = scryptSync(env().ENCRYPTION_KEY, 'business-os/integration-secrets/v1', 32);
  return key;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptJson<T = Record<string, unknown>>(payload: string | null | undefined): T | null {
  if (!payload) return null;
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported secret format');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Show the last 4 characters of a secret so people can tell keys apart. */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return '';
  return `••••${value.slice(-4)}`;
}
