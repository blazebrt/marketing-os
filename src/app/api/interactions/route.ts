import { NextRequest, NextResponse } from 'next/server';
import { authenticateWebhook } from '@/lib/webhooks/verify';
import { InteractionSchema } from '@/lib/schemas/tracking';
import { createServiceClient } from '@/lib/supabase/service';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const { ownerId } = await authenticateWebhook(req, rawBody);
    
    const json = JSON.parse(rawBody);
    const result = InteractionSchema.safeParse(json);
    
    if (!result.success) {
      return NextResponse.json({ error: 'Malformed payload', details: result.error }, { status: 400 });
    }

    const serviceClient = createServiceClient();

    // Idempotent upsert based on owner, session, and type
    const { error } = await serviceClient.from('marketing_interactions').upsert({
      owner_id: ownerId,
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
      throw error;
    }

    return NextResponse.json({ success: true, session_id: result.data.session_id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Verification Failed' }, { status: 401 });
  }
}
