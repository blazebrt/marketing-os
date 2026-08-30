import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { createServiceClient } from '../supabase/service';
import { parseStoredCredentials, revealStoredSecret } from '../crypto';

export async function verifyHmac(payload: string, signature: string, secret: string, timestamp: string): Promise<boolean> {
  if (!/^\d{1,15}$/.test(timestamp)) {
    return false;
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }
  const timeDiff = Math.abs(Date.now() - ts);
  // Replay protection: 5 minute window
  if (timeDiff > 5 * 60 * 1000) {
    return false;
  }

  if (!/^[0-9a-f]+$/i.test(signature)) {
    return false;
  }

  const expectedMac = crypto.createHmac('sha256', secret)
    .update(timestamp + '.' + payload)
    .digest('hex');

  try {
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expectedMac, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function authenticateWebhook(req: NextRequest, rawBody: string): Promise<{ ownerId: string; provider: string }> {
  const signature = req.headers.get('x-signature');
  const timestamp = req.headers.get('x-timestamp');
  const integrationId = req.headers.get('x-integration-id'); // Replaced insecure x-owner-id

  if (!signature || !timestamp || !integrationId) {
    throw new Error('missing_headers');
  }

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('integration_credentials')
    .select('owner_id, provider, encrypted_credentials')
    .eq('id', integrationId)
    .single();

  if (error || !data) {
    throw new Error('integration_not_found');
  }

  let creds: Record<string, unknown>;
  try {
    creds = parseStoredCredentials(data.encrypted_credentials);
  } catch {
    throw new Error('missing_secret');
  }
  const secret = revealStoredSecret(creds.hmac_secret);

  if (!secret) {
    throw new Error('missing_secret');
  }

  const isValid = await verifyHmac(rawBody, signature, secret, timestamp);
  
  if (!isValid) {
    throw new Error('invalid_signature');
  }

  // Safely resolve the owner ID entirely server-side based on the verified integration
  return { ownerId: data.owner_id, provider: data.provider };
}
