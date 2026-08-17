import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { createServiceClient } from '../supabase/service';
import { decryptCredential } from '../crypto';

export async function verifyHmac(payload: string, signature: string, secret: string, timestamp: string): Promise<boolean> {
  const timeDiff = Math.abs(Date.now() - parseInt(timestamp, 10));
  // Replay protection: 5 minute window
  if (timeDiff > 5 * 60 * 1000) {
    return false;
  }

  const expectedMac = crypto.createHmac('sha256', secret)
    .update(timestamp + '.' + payload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedMac, 'hex'));
  } catch (e) {
    // Fails safely if length mismatch
    return false;
  }
}

export async function authenticateWebhook(req: NextRequest, rawBody: string): Promise<{ ownerId: string; provider: string }> {
  const signature = req.headers.get('x-signature');
  const timestamp = req.headers.get('x-timestamp');
  const ownerId = req.headers.get('x-owner-id');
  const provider = req.headers.get('x-provider') || 'website';

  if (!signature || !timestamp || !ownerId) {
    throw new Error('Missing required webhook authentication headers');
  }

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('integration_credentials')
    .select('encrypted_credentials')
    .eq('owner_id', ownerId)
    .eq('provider', provider)
    .single();

  if (error || !data) {
    throw new Error('Integration not found or not connected');
  }

  const credsStr = decryptCredential(data.encrypted_credentials);
  const creds = JSON.parse(credsStr);
  const secret = creds.hmac_secret;

  if (!secret) {
    throw new Error('Integration lacks HMAC secret configuration');
  }

  const isValid = await verifyHmac(rawBody, signature, secret, timestamp);
  
  if (!isValid) {
    throw new Error('Invalid cryptographic signature or replayed request');
  }

  return { ownerId, provider };
}
