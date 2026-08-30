import { NextRequest, NextResponse } from 'next/server';
import { authenticateWebhook } from '@/lib/webhooks/verify';
import { InteractionSchema } from '@/lib/schemas/tracking';
import { createServiceClient } from '@/lib/supabase/service';

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
