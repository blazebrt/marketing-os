import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { createServiceClient } from '../supabase/service';
import { parseStoredCredentials, revealStoredSecret } from '../crypto';
import { isUuid } from '../ids';

export async function verifyHmac(payload: string, signature: string, secret: string, timestamp: string): Promise<boolean> {
  if (!/^\d{1,15}$/.test(timestamp)) {
    return false;
  }
  const raw = Number(timestamp);
  if (!Number.isFinite(raw)) {
    return false;
  }
  // Tracking scripts may send unix seconds or milliseconds.
  const ts = raw < 1e12 ? raw * 1000 : raw;
  const timeDiff = Math.abs(Date.now() - ts);
  // Replay protection: 5 minute window
  if (timeDiff > 5 * 60 * 1000) {
    return false;
  }

  if (!/^[0-9a-f]+$/i.test(signature) || signature.length > 256) {
    return false;
  }

  const expectedMac = crypto.createHmac('sha256', secret)
    .update(timestamp + '.' + payload)
    .digest('hex');

  try {
    const a = crypto.createHash('sha256').update(Buffer.from(signature, 'hex')).digest();
    const b = crypto.createHash('sha256').update(Buffer.from(expectedMac, 'hex')).digest();
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function loadWebhookCredentials(integrationId: string): Promise<{
  owner_id: string;
  provider: string;
  encrypted_credentials: string;
} | null> {
  const serviceClient = createServiceClient();

  const { data: byCredentialId, error: credErr } = await serviceClient
    .from('integration_credentials')
    .select('owner_id, provider, encrypted_credentials')
    .eq('id', integrationId)
    .single();

  if (!credErr && byCredentialId?.encrypted_credentials) {
    return byCredentialId;
  }

  // Tracking scripts are given integrations.id (the metadata row), which is
  // a different UUID from integration_credentials.id.
  const { data: integration, error: integErr } = await serviceClient
    .from('integrations')
    .select('owner_id, provider')
    .eq('id', integrationId)
    .single();

  if (integErr || !integration?.owner_id || !integration.provider) return null;

  const { data: byOwner, error: ownerErr } = await serviceClient
    .from('integration_credentials')
    .select('owner_id, provider, encrypted_credentials')
    .eq('owner_id', integration.owner_id)
    .eq('provider', integration.provider)
    .single();

  if (ownerErr || !byOwner?.encrypted_credentials) return null;
  return byOwner;
}

export async function authenticateWebhook(req: NextRequest, rawBody: string): Promise<{ ownerId: string; provider: string }> {
  const signature = req.headers.get('x-signature');
  const timestamp = req.headers.get('x-timestamp');
  const integrationId = req.headers.get('x-integration-id');

  if (!signature || !timestamp || !integrationId) {
    throw new Error('missing_headers');
  }
  if (!isUuid(integrationId)) {
    throw new Error('integration_not_found');
  }

  const data = await loadWebhookCredentials(integrationId);

  if (!data) {
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

  return { ownerId: data.owner_id, provider: data.provider };
}
