import crypto from 'crypto';

export function getEncryptionKey(): Buffer {
  const b64Key = process.env.ENCRYPTION_KEY;
  if (!b64Key) throw new Error('Configuration Error: ENCRYPTION_KEY is missing. System failing closed.');
  
  const keyBuffer = Buffer.from(b64Key, 'base64');
  if (keyBuffer.length !== 32) {
    throw new Error(`Configuration Error: ENCRYPTION_KEY must be exactly 32 bytes when decoded. Got ${keyBuffer.length} bytes.`);
  }
  return keyBuffer;
}

const ALGORITHM = 'aes-256-gcm';

export function encryptCredential(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decryptCredential(text: string): string {
  const key = getEncryptionKey();
  const parts = text.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  if (!/^[0-9a-f]+$/i.test(parts[0]) || !/^[0-9a-f]+$/i.test(parts[1]) || !/^[0-9a-f]+$/i.test(parts[2])) {
    throw new Error('Invalid encrypted format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];
  if (iv.length !== 16 || authTag.length !== 16) {
    throw new Error('Invalid encrypted format');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** True when a string looks like encryptCredential() output. */
export function looksEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p) && p.length > 0);
}

/**
 * Credentials are stored as JSON with individually encrypted token fields
 * (upsertIntegration). Older rows may be a single encryptCredential() blob.
 */
export function parseStoredCredentials(stored: string): Record<string, unknown> {
  const trimmed = stored.trim();
  const parsed = trimmed.startsWith('{')
    ? JSON.parse(trimmed)
    : JSON.parse(decryptCredential(trimmed));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid encrypted format');
  }
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    out[key] = value;
  }
  return out;
}

export function revealStoredSecret(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (looksEncrypted(value)) {
    try {
      return decryptCredential(value);
    } catch {
      return null;
    }
  }
  return value;
}

export function decryptNamedSecret(stored: string, field: string): string {
  const record = parseStoredCredentials(stored);
  const value = revealStoredSecret(record[field]);
  if (!value) throw new Error('missing credential field');
  return value;
}

