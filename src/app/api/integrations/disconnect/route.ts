import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { disconnectIntegration } from '@/lib/integrations';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { provider } = await req.json();
  if (!provider) return NextResponse.json({ error: 'Provider required' }, { status: 400 });

  await disconnectIntegration(user.id, provider);
  return NextResponse.json({ success: true });
}
