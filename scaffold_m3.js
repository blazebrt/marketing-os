const fs = require('fs');
const path = require('path');

const write = (p, content) => {
  const full = path.join(process.cwd(), p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf-8');
};

write('supabase/migrations/004_milestone3_leads.sql', `
-- Enums
do $$ begin
    create type lead_status as enum ('NEW', 'CONTACTED', 'BOOKED', 'VISITED', 'PAID', 'LOST', 'UNKNOWN');
exception
    when duplicate_object then null;
end $$;

create table if not exists public.marketing_interactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  session_id text not null,
  interaction_type text not null,
  source text,
  campaign_name text,
  ad_group_name text,
  ad_name text,
  creative_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  fbclid text,
  gclid text,
  landing_page text,
  created_at timestamptz not null default now(),
  unique(owner_id, session_id, interaction_type)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  external_lead_id text,
  name text,
  phone text,
  normalized_phone text,
  email text,
  normalized_email text,
  status lead_status not null default 'NEW',
  revenue_amount numeric(10, 2) not null default 0,
  source_channel text,
  campaign_name text,
  ad_group_name text,
  ad_name text,
  creative_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  fbclid text,
  gclid text,
  landing_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists leads_external_idx on public.leads(owner_id, external_lead_id) where external_lead_id is not null;
create index if not exists leads_phone_idx on public.leads(owner_id, normalized_phone) where normalized_phone is not null;
create index if not exists leads_email_idx on public.leads(owner_id, normalized_email) where normalized_email is not null;

alter table public.marketing_interactions enable row level security;
create policy "owner_interactions" on public.marketing_interactions for all using (auth.uid() = owner_id);

alter table public.leads enable row level security;
create policy "owner_leads" on public.leads for all using (auth.uid() = owner_id);
`);

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
`);

write('src/lib/schemas/tracking.ts', `
import { z } from 'zod';

export const InteractionSchema = z.object({
  session_id: z.string().min(1),
  interaction_type: z.enum(['website_visit', 'whatsapp_click', 'phone_click', 'lead_form_start']),
  source: z.string().optional(),
  campaign_name: z.string().optional(),
  ad_group_name: z.string().optional(),
  ad_name: z.string().optional(),
  creative_id: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  fbclid: z.string().optional(),
  gclid: z.string().optional(),
  landing_page: z.string().optional()
});

export const LeadIngestionSchema = z.object({
  session_id: z.string().optional(),
  external_lead_id: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  source: z.string().optional(),
  // Strict sanitization: Webhooks CANNOT provide status or revenue
}).refine(data => data.phone || data.email || data.external_lead_id, {
  message: 'Lead must contain phone, email, or external_lead_id'
});
`);

write('src/app/api/interactions/route.ts', `
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
`);

write('src/app/api/leads/route.ts', `
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
    const normalizedPhone = payload.phone ? payload.phone.replace(/\\D/g, '') : null;
    const normalizedEmail = payload.email ? payload.email.toLowerCase().trim() : null;

    const idempotencyKey = \`lead_ingest_\${provider}_\${payload.external_lead_id || payload.session_id || normalizedPhone}\`;

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
`);

write('src/app/leads/actions.ts', `
'use server';

import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';

export async function updateLead(leadId: string, status: string, revenue: number) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // RLS natively protects against updating someone else's lead
  const { error } = await supabase.from('leads').update({
    status,
    revenue_amount: revenue,
    updated_at: new Date().toISOString()
  }).eq('id', leadId).eq('owner_id', user.id);

  if (error) throw new Error('Failed to update lead');

  await logAudit(user.id, 'LEAD_UPDATED', 'lead', leadId, null, null, \`Updated status: \${status}, revenue: \${revenue}\`);
  revalidatePath('/leads');
  revalidatePath('/'); // Refresh dashboard
}
`);

write('src/app/leads/page.tsx', `
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { updateLead } from './actions';

export default async function LeadsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const { data: leads } = await supabase.from('leads').select('*').order('created_at', { ascending: false });

  const statuses = ['NEW', 'CONTACTED', 'BOOKED', 'VISITED', 'PAID', 'LOST', 'UNKNOWN'];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Lead Pipeline</h1>
      
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {leads?.map(lead => (
            <li key={lead.id} className="p-4 flex flex-col md:flex-row items-center justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-medium">{lead.name || 'Unknown Name'}</h3>
                <p className="text-sm text-gray-500">{lead.phone} • {lead.email}</p>
                <div className="mt-1 text-xs text-gray-400">
                  <span className="font-semibold text-gray-600">Source:</span> {lead.source_channel || 'Direct'} 
                  {lead.campaign_name && \` • Campaign: \${lead.campaign_name}\`}
                </div>
              </div>
              <div className="flex-1 flex justify-end">
                <form action={async (formData) => {
                  'use server';
                  const s = formData.get('status') as string;
                  const r = parseFloat(formData.get('revenue') as string);
                  await updateLead(lead.id, s, r);
                }} className="flex items-center gap-4">
                  
                  <div className="flex flex-col">
                    <label className="text-xs text-gray-500">Status</label>
                    <select name="status" defaultValue={lead.status} className="border p-1 rounded">
                      {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  
                  <div className="flex flex-col">
                    <label className="text-xs text-gray-500">Revenue</label>
                    <input type="number" name="revenue" defaultValue={lead.revenue_amount} className="border p-1 rounded w-24" />
                  </div>
                  
                  <button type="submit" className="mt-4 px-3 py-1 bg-black text-white text-sm rounded">Save</button>
                </form>
              </div>
            </li>
          ))}
          {!leads?.length && <div className="p-8 text-center text-gray-500">No leads found.</div>}
        </ul>
      </div>
    </div>
  );
}
`);

write('src/app/page.tsx', `
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const { data: leads } = await supabase.from('leads').select('status, revenue_amount');
  
  const total = leads?.length || 0;
  const newLeads = leads?.filter(l => l.status === 'NEW').length || 0;
  const contacted = leads?.filter(l => l.status === 'CONTACTED').length || 0;
  const bookings = leads?.filter(l => l.status === 'BOOKED').length || 0;
  const visits = leads?.filter(l => l.status === 'VISITED').length || 0;
  const revenue = leads?.reduce((sum, l) => sum + Number(l.revenue_amount), 0) || 0;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Marketing OS Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="p-6 bg-white shadow rounded-lg text-center">
          <p className="text-sm text-gray-500">Total Leads</p>
          <p className="text-3xl font-bold">{total}</p>
        </div>
        <div className="p-6 bg-white shadow rounded-lg text-center">
          <p className="text-sm text-gray-500">New</p>
          <p className="text-3xl font-bold">{newLeads}</p>
        </div>
        <div className="p-6 bg-white shadow rounded-lg text-center">
          <p className="text-sm text-gray-500">Contacted</p>
          <p className="text-3xl font-bold">{contacted}</p>
        </div>
        <div className="p-6 bg-white shadow rounded-lg text-center">
          <p className="text-sm text-gray-500">Bookings</p>
          <p className="text-3xl font-bold">{bookings}</p>
        </div>
        <div className="p-6 bg-white shadow rounded-lg text-center">
          <p className="text-sm text-gray-500">Visits</p>
          <p className="text-3xl font-bold">{visits}</p>
        </div>
        <div className="p-6 bg-white shadow rounded-lg text-center">
          <p className="text-sm text-gray-500">Pipeline Revenue</p>
          <p className="text-3xl font-bold text-green-600">₹{revenue.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}
`);
console.log('M3 scaffolded');
