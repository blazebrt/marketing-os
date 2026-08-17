import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const supabase = await createClient();

    // The public website backend MUST own and generate the session_id
    const sessionId = body.session_id;
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

    // Never trust client-provided campaign IDs unconditionally
    const interaction = {
      type: body.type, // 'website_visit', 'whatsapp_click', 'phone_click'
      session_id: sessionId,
      utm_source: body.utm_source?.substring(0, 255),
      utm_medium: body.utm_medium?.substring(0, 255),
      utm_campaign: body.utm_campaign?.substring(0, 255),
      fbclid: body.fbclid?.substring(0, 255),
      gclid: body.gclid?.substring(0, 255),
    };

    // Use service role to insert (this is a public endpoint)
    const { error } = await supabase
      .from('marketing_interactions')
      .insert(interaction);

    if (error) {
      return NextResponse.json({ error: 'Failed to record interaction' }, { status: 500 });
    }

    return NextResponse.json({ success: true, session_id: sessionId });
  } catch (err) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
