import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { generateAndSaveGoogleCreatives } from '@/lib/providers/google/generative';

// In-memory rate limiting map: campaignId -> timestamp
const rateLimits = new Map<string, number>();
const RATE_LIMIT_MS = 10000; // 10 seconds

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolvedParams = await params;
    const campaignId = resolvedParams.id;
    
    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaign id' }, { status: 400 });
    }

    const now = Date.now();
    const lastGen = rateLimits.get(campaignId);
    if (lastGen && now - lastGen < RATE_LIMIT_MS) {
      return NextResponse.json({ error: 'Rate limit exceeded. Please wait.' }, { status: 429 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Attempt generation
    const result = await generateAndSaveGoogleCreatives(campaignId, user.id);
    
    rateLimits.set(campaignId, now);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Generation Error:', error);
    return NextResponse.json({ error: error.message || 'Generation failed' }, { status: 500 });
  }
}
