import { NextRequest, NextResponse } from 'next/server';
import { authenticateWebhook } from '@/lib/webhooks/verify';
import { LeadIngestionSchema } from '@/lib/schemas/tracking';
import { createServiceClient } from '@/lib/supabase/service';
import { withIdempotency } from '@/lib/idempotency';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const { ownerId, provider } = await authenticateWebhook(req, rawBody);
    
    const json = JSON.parse(rawBody);
    const result = LeadIngestionSchema.safeParse(json);
    
    if (!result.success) {
      return NextResponse.json({ error: 'Malformed payload', details: result.error }, { status: 400 });
    }
    
    const payload = result.data;
    const serviceClient = createServiceClient();
    const normalizedPhone = payload.phone ? payload.phone.replace(/\D/g, '') : null;
    const normalizedEmail = payload.email ? payload.email.toLowerCase().trim() : null;

    const idempotencyKey = `lead_ingest_${provider}_${payload.external_lead_id || payload.session_id || normalizedPhone}`;

    const leadId = await withIdempotency(idempotencyKey, ownerId, 'webhook_event', async () => {
      let existingLead = null;

      // 1. Deduplication Check
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
        // Idempotent return - do NOT overwrite status or revenue
        return existingLead.id;
      }

      // 2. First-Touch Attribution Lookback
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

      // 3. Insert New Lead (strictly defaults to NEW status, 0 revenue)
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
      if (error) throw error;
      return data.id;
    });

    return NextResponse.json({ success: true, lead_id: leadId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Verification Failed' }, { status: 401 });
  }
}
