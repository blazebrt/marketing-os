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
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
