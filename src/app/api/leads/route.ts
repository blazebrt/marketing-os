import { NextRequest, NextResponse } from 'next/server';
import { authenticateWebhook } from '@/lib/webhooks/verify';
import { LeadIngestionSchema } from '@/lib/schemas/tracking';
import { createServiceClient } from '@/lib/supabase/service';
import { withIdempotency } from '@/lib/idempotency';

const MAX_WEBHOOK_BYTES = 32 * 1024;

export async function POST(req: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  if (rawBody.length > MAX_WEBHOOK_BYTES) {
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
    
    const normalizedPhone = payload.phone ? payload.phone.replace(/\D/g, '') : null;
    const normalizedEmail = payload.email ? payload.email.toLowerCase().trim() : null;
    const identity = payload.external_lead_id || normalizedPhone || normalizedEmail || payload.session_id;
    if (!identity) {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
    }
    const idempotencyKey = `lead_ingest_${provider}_${identity}`;

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
