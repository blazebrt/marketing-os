const fs = require('fs');
const path = require('path');

const write = (p, content) => {
  const full = path.join(process.cwd(), p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf-8');
};

write('src/lib/webhooks/verify.ts', `
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

  const credsStr = decryptCredential(data.encrypted_credentials);
  const creds = JSON.parse(credsStr);
  const secret = creds.hmac_secret;

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
`);

write('src/app/api/interactions/route.ts', `
import { NextRequest, NextResponse } from 'next/server';
import { authenticateWebhook } from '@/lib/webhooks/verify';
import { InteractionSchema } from '@/lib/schemas/tracking';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(req: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  let authResult;
  try {
    authResult = await authenticateWebhook(req, rawBody);
  } catch (authError) {
    return NextResponse.json({ error: 'webhook_verification_failed' }, { status: 401 });
  }

  let json;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const result = InteractionSchema.safeParse(json);
  if (!result.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  try {
    const serviceClient = createServiceClient();
    const { error } = await serviceClient.from('marketing_interactions').upsert({
      owner_id: authResult.ownerId,
      session_id: result.data.session_id,
      interaction_type: result.data.interaction_type,
      source: result.data.source,
      campaign_name: result.data.campaign_name,
      ad_group_name: result.data.ad_group_name,
      ad_name: result.data.ad_name,
      creative_id: result.data.creative_id,
      utm_source: result.data.utm_source,
      utm_medium: result.data.utm_medium,
      utm_campaign: result.data.utm_campaign,
      fbclid: result.data.fbclid,
      gclid: result.data.gclid,
      landing_page: result.data.landing_page
    }, { onConflict: 'owner_id, session_id, interaction_type' });

    if (error) {
      throw new Error('database_error');
    }

    return NextResponse.json({ success: true, session_id: result.data.session_id });
  } catch (e: any) {
    return NextResponse.json({ error: 'request_rejected' }, { status: 400 });
  }
}
`);

write('src/app/api/leads/route.ts', `
import { NextRequest, NextResponse } from 'next/server';
import { authenticateWebhook } from '@/lib/webhooks/verify';
import { LeadIngestionSchema } from '@/lib/schemas/tracking';
import { createServiceClient } from '@/lib/supabase/service';
import { withIdempotency } from '@/lib/idempotency';

export async function POST(req: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  let authResult;
  try {
    authResult = await authenticateWebhook(req, rawBody);
  } catch (authError) {
    return NextResponse.json({ error: 'webhook_verification_failed' }, { status: 401 });
  }

  let json;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const result = LeadIngestionSchema.safeParse(json);
  if (!result.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  
  try {
    const payload = result.data;
    const { ownerId, provider } = authResult;
    const serviceClient = createServiceClient();
    
    const normalizedPhone = payload.phone ? payload.phone.replace(/\\D/g, '') : null;
    const normalizedEmail = payload.email ? payload.email.toLowerCase().trim() : null;
    const idempotencyKey = \`lead_ingest_\${provider}_\${payload.external_lead_id || payload.session_id || normalizedPhone}\`;

    const leadId = await withIdempotency(idempotencyKey, ownerId, 'webhook_event', async () => {
      let existingLead = null;

      if (payload.external_lead_id) {
        const { data } = await serviceClient.from('leads')
          .select('id, status, revenue_amount').eq('owner_id', ownerId).eq('external_lead_id', payload.external_lead_id).single();
        if (data) existingLead = data;
      }
      if (!existingLead && normalizedPhone) {
        const { data } = await serviceClient.from('leads')
          .select('id, status, revenue_amount').eq('owner_id', ownerId).eq('normalized_phone', normalizedPhone).single();
        if (data) existingLead = data;
      }
      if (!existingLead && normalizedEmail) {
        const { data } = await serviceClient.from('leads')
          .select('id, status, revenue_amount').eq('owner_id', ownerId).eq('normalized_email', normalizedEmail).single();
        if (data) existingLead = data;
      }

      if (existingLead) {
        return existingLead.id;
      }

      let attribution = {};
      if (payload.session_id) {
        const { data: interactions } = await serviceClient.from('marketing_interactions')
          .select('*')
          .eq('owner_id', ownerId)
          .eq('session_id', payload.session_id)
          .order('created_at', { ascending: true })
          .limit(1);
          
        if (interactions && interactions.length > 0) {
          const first = interactions[0];
          attribution = {
            source_channel: first.source || provider,
            campaign_name: first.campaign_name,
            ad_group_name: first.ad_group_name,
            ad_name: first.ad_name,
            creative_id: first.creative_id,
            utm_source: first.utm_source,
            utm_medium: first.utm_medium,
            utm_campaign: first.utm_campaign,
            fbclid: first.fbclid,
            gclid: first.gclid,
            landing_session_id: first.session_id
          };
        }
      }

      const insertPayload = {
        owner_id: ownerId,
        external_lead_id: payload.external_lead_id,
        name: payload.name,
        phone: payload.phone,
        normalized_phone: normalizedPhone,
        email: payload.email,
        normalized_email: normalizedEmail,
        status: 'NEW',
        revenue_amount: 0,
        source_channel: provider,
        ...attribution
      };

      const { data, error } = await serviceClient.from('leads').insert(insertPayload).select('id').single();
      if (error) throw new Error('database_error');
      return data.id;
    });

    return NextResponse.json({ success: true, lead_id: leadId });
  } catch (e: any) {
    return NextResponse.json({ error: 'request_rejected' }, { status: 400 });
  }
}
`);
console.log('M3 fixes scaffolded.');
