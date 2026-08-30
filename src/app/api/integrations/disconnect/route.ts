import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { disconnectIntegration } from '@/lib/integrations';
import { appUrl } from '@/lib/appUrl';

const PROVIDERS = ['meta', 'google', 'whatsapp', 'instagram', 'website'] as const;

async function readProvider(req: NextRequest): Promise<string | null> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => null);
    return typeof body?.provider === 'string' ? body.provider : null;
  }
  const form = await req.formData().catch(() => null);
  const value = form?.get('provider');
  return typeof value === 'string' ? value : null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const provider = await readProvider(req);
  if (!provider || !PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) {
    return NextResponse.json({ error: 'Provider required' }, { status: 400 });
  }

  await disconnectIntegration(user.id, provider);

  const accept = req.headers.get('accept') || '';
  const isForm = (req.headers.get('content-type') || '').includes('application/x-www-form-urlencoded')
    || (req.headers.get('content-type') || '').includes('multipart/form-data');
  if (isForm || accept.includes('text/html')) {
    return NextResponse.redirect(appUrl('/integrations', req.url), 303);
  }

  return NextResponse.json({ success: true });
}
