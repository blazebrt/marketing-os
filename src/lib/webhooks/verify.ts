import crypto from 'crypto';

/**
 * Verifies Meta (Facebook) Webhook signatures.
 * The signature is stored in the 'x-hub-signature-256' header.
 * It's calculated as 'sha256=' + HMAC_SHA256(APP_SECRET, RAW_BODY)
 */
export function verifyMetaSignature(
  signatureHeader: string | null,
  rawBody: string,
  appSecret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const signature = signatureHeader.replace('sha256=', '');
  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
    
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}
