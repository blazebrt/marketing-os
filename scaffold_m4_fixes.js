const fs = require('fs');
const path = require('path');

const write = (p, content) => {
  const full = path.join(process.cwd(), p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf-8');
};

write('supabase/migrations/006_milestone4_fixes.sql', `
-- Create real creatives table for verification
create table if not exists public.creatives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  type text not null,
  file_url text,
  created_at timestamptz not null default now()
);

alter table public.creatives enable row level security;
create policy "owner_creatives" on public.creatives for all using (auth.uid() = owner_id);

-- Explicit audit_logs if not already fully defined (to ensure idempotent testing)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details text,
  created_at timestamptz not null default now()
);

-- Note: No need to modify unified_campaigns, it already has creative_id text.
`);

write('src/app/campaigns/actions.ts', `
'use server';

import { createClient } from '@/lib/supabase/server';
import { CampaignIntentSchema } from '@/lib/schemas/campaigns';
import { calculateSafetyLimits } from '@/lib/campaigns/safeguards';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';

export async function saveDraftCampaign(payload: any) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const parsed = CampaignIntentSchema.parse(payload);
  const limits = calculateSafetyLimits(parsed.budget_type, parsed.budget_amount, parsed.duration_days);

  // NO mock creative ID injected here. We pass exactly what the client sends (undefined or null is fine).
  const { data, error } = await supabase.from('unified_campaigns').insert({
    owner_id: user.id,
    service: parsed.service,
    offer: parsed.offer,
    budget_type: parsed.budget_type,
    budget_amount: parsed.budget_amount,
    duration_days: parsed.duration_days,
    max_daily_spend: limits.maxDaily,
    max_campaign_spend: limits.maxTotal,
    destination: parsed.destination,
    channels: parsed.channels,
    creative_id: parsed.creative_id || null, 
    status: 'DRAFT'
  }).select('id').single();

  if (error) throw new Error('Database error saving draft');

  await logAudit(user.id, 'CAMPAIGN_CREATED', 'campaign', data.id, null, null, 'Draft campaign created via wizard');
  return data.id;
}

export async function verifyCampaign(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: campaign } = await supabase.from('unified_campaigns').select('*').eq('id', campaignId).eq('owner_id', user.id).single();
  if (!campaign) throw new Error('Campaign not found');

  const checks = [];
  
  // 1. Budget & Duration Safety checks
  try {
    calculateSafetyLimits(campaign.budget_type, Number(campaign.budget_amount), campaign.duration_days);
    checks.push({ name: 'Budget & Duration', pass: true, message: 'Budget and duration are within configured safety bounds' });
  } catch (e: any) {
    checks.push({ name: 'Budget & Duration', pass: false, message: e.message });
  }

  // 2. Creative Check (Requires real DB record)
  if (!campaign.creative_id) {
    checks.push({ name: 'Creative', pass: false, message: 'No creative attached' });
  } else {
    const { data: cr } = await supabase.from('creatives').select('id').eq('id', campaign.creative_id).eq('owner_id', user.id).single();
    if (cr) {
      checks.push({ name: 'Creative', pass: true, message: 'Creative record verified' });
    } else {
      checks.push({ name: 'Creative', pass: false, message: 'Creative record not found or inaccessible' });
    }
  }

  // 3. Destination Check
  if (campaign.destination) {
    checks.push({ name: 'Destination', pass: true, message: 'Destination configured' });
  } else {
    checks.push({ name: 'Destination', pass: false, message: 'Missing destination' });
  }

  // 4. Integrations & Channels Check (Using safe metadata table)
  const { data: creds } = await supabase.from('integrations').select('provider').eq('owner_id', user.id).eq('status', 'connected');
  const connectedProviders = creds?.map((c: any) => c.provider.toLowerCase()) || [];
  
  if (!campaign.channels || campaign.channels.length === 0) {
    checks.push({ name: 'Channels', pass: false, message: 'No channels selected' });
  } else {
    for (const channel of campaign.channels) {
      if (connectedProviders.includes(channel.toLowerCase())) {
        checks.push({ name: \`Integration: \${channel}\`, pass: true, message: \`\${channel} connection verified via safe metadata\` });
      } else {
        checks.push({ name: \`Integration: \${channel}\`, pass: false, message: \`\${channel} is disconnected or missing\` });
      }
    }
  }

  // 5. Tracking Readiness Check
  if (campaign.destination?.toLowerCase().includes('website')) {
    if (connectedProviders.includes('website')) {
      checks.push({ name: 'Tracking Readiness', pass: true, message: 'Website tracking integration is active' });
    } else {
      checks.push({ name: 'Tracking Readiness', pass: false, message: 'Website tracking required but disconnected' });
    }
  } else {
    checks.push({ name: 'Tracking Readiness', pass: true, message: 'No explicit tracking setup required for this destination' });
  }

  const allPass = checks.every(c => c.pass);
  await logAudit(user.id, 'PRELAUNCH_VERIFICATION', 'campaign', campaignId, null, null, \`Verification \${allPass ? 'Passed' : 'Failed'}\`);
  
  return { checks, allPass };
}

export async function requestApproval(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const verification = await verifyCampaign(campaignId);
  if (!verification.allPass) {
    throw new Error('Prelaunch verification failed. Cannot request approval.');
  }

  // Atomic state transition: DRAFT -> PENDING_APPROVAL
  const { error, data } = await supabase.from('unified_campaigns')
    .update({ status: 'PENDING_APPROVAL', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .eq('status', 'DRAFT')
    .select('id').single();

  if (error || !data) throw new Error('State transition to PENDING_APPROVAL failed (must be in DRAFT state)');

  await logAudit(user.id, 'CAMPAIGN_SUBMITTED_FOR_APPROVAL', 'campaign', campaignId, null, null, 'DRAFT -> PENDING_APPROVAL');
  revalidatePath('/campaigns');
  revalidatePath(\`/campaigns/\${campaignId}\`);
}

export async function approveCampaign(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // Verify again before final approval
  const verification = await verifyCampaign(campaignId);
  if (!verification.allPass) {
    throw new Error('Prelaunch verification failed. Cannot approve.');
  }

  // Atomic state transition: PENDING_APPROVAL -> APPROVED
  const { data: approvedData, error: approvedError } = await supabase.from('unified_campaigns')
    .update({ status: 'APPROVED', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .eq('status', 'PENDING_APPROVAL')
    .select('channels, status').single();

  if (approvedError || !approvedData) {
    throw new Error('State transition to APPROVED failed (must be in PENDING_APPROVAL state)');
  }

  await logAudit(user.id, 'CAMPAIGN_APPROVED', 'campaign', campaignId, null, null, 'Campaign approved explicitly by owner');

  // Safely create independent deployments idempotently
  if (approvedData.channels) {
    for (const provider of approvedData.channels) {
      await supabase.from('channel_deployments').insert({
        campaign_id: campaignId,
        owner_id: user.id,
        provider: provider.toLowerCase(),
        status: 'PENDING'
      }).catch(e => {
         // Silently catch duplicate insertion errors due to unique constraints for idempotency
      });
    }
  }

  // Final transition: APPROVED -> READY_TO_DEPLOY
  const { error: readyError } = await supabase.from('unified_campaigns')
    .update({ status: 'READY_TO_DEPLOY', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('owner_id', user.id)
    .eq('status', 'APPROVED');

  if (readyError) throw new Error('State transition to READY_TO_DEPLOY failed');

  await logAudit(user.id, 'CAMPAIGN_STATE_CHANGED', 'campaign', campaignId, null, null, 'APPROVED -> READY_TO_DEPLOY');
  revalidatePath('/campaigns');
  revalidatePath(\`/campaigns/\${campaignId}\`);
  return true;
}
`);

write('src/app/campaigns/new/page.tsx', `
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveDraftCampaign } from '../actions';

export default function NewCampaignWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [form, setForm] = useState({
    service: '',
    offer: '',
    budget_type: 'daily',
    budget_amount: '',
    duration_days: '30',
    channels: [] as string[],
    destination: '',
    creative_id: '' // Start empty, force explicit assignment if any
  });

  const update = (key: string, val: any) => setForm(prev => ({ ...prev, [key]: val }));

  const submit = async () => {
    try {
      setLoading(true);
      setError('');
      const payload = {
        ...form,
        budget_amount: Number(form.budget_amount),
        duration_days: Number(form.duration_days)
      };
      
      // Remove empty creative_id to allow DB null
      if (!payload.creative_id) delete payload.creative_id;

      const id = await saveDraftCampaign(payload);
      router.push(\`/campaigns/\${id}\`);
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-8 pt-16">
      <div className="mb-8">
        <div className="text-sm text-gray-500 mb-2">Step {step} of 6</div>
        <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
          <div className="bg-black h-full transition-all duration-300" style={{ width: \`\${(step / 6) * 100}%\` }}></div>
        </div>
      </div>

      {error && <div className="p-4 mb-4 bg-red-50 text-red-700 border border-red-200 rounded">{error}</div>}

      {step === 1 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">What are you promoting?</h1>
          <div className="space-y-4">
            {['Bridal Makeup', 'Haircut & Styling', 'Keratin Treatment', 'Facial & Cleanup'].map(s => (
              <button key={s} onClick={() => { update('service', s); setStep(2); }} 
                      className="w-full text-left p-4 border rounded hover:border-black transition">
                {s}
              </button>
            ))}
            <div className="mt-4 pt-4 border-t">
              <label className="text-sm font-medium">Or type your own:</label>
              <div className="flex gap-2 mt-2">
                <input type="text" value={form.service} onChange={e => update('service', e.target.value)} 
                       className="flex-1 border p-2 rounded" placeholder="e.g. Hair Spa" />
                <button onClick={() => form.service && setStep(2)} className="bg-black text-white px-4 rounded">Next</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">What are you offering?</h1>
          <div className="space-y-4">
            {['20% Off', 'Flat ₹500 Off', 'Free Hair Spa with Keratin', 'Bridal Package ₹9,999'].map(s => (
              <button key={s} onClick={() => { update('offer', s); setStep(3); }} 
                      className="w-full text-left p-4 border rounded hover:border-black transition">
                {s}
              </button>
            ))}
            <div className="mt-4 pt-4 border-t">
              <label className="text-sm font-medium">Custom offer:</label>
              <div className="flex gap-2 mt-2">
                <input type="text" value={form.offer} onChange={e => update('offer', e.target.value)} 
                       className="flex-1 border p-2 rounded" placeholder="e.g. 15% Off" />
                <button onClick={() => form.offer && setStep(3)} className="bg-black text-white px-4 rounded">Next</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">How much do you want to spend?</h1>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Budget Type</label>
              <select value={form.budget_type} onChange={e => update('budget_type', e.target.value)} className="w-full border p-2 rounded mt-1">
                <option value="daily">Daily Budget</option>
                <option value="total">Total Campaign Budget</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Amount (₹)</label>
              <input type="number" value={form.budget_amount} onChange={e => update('budget_amount', e.target.value)} 
                     className="w-full border p-2 rounded mt-1" placeholder="e.g. 1000" />
            </div>
            <div>
              <label className="text-sm font-medium">Duration (Days)</label>
              <input type="number" value={form.duration_days} onChange={e => update('duration_days', e.target.value)} 
                     className="w-full border p-2 rounded mt-1" />
            </div>
            <button onClick={() => form.budget_amount && setStep(4)} className="w-full bg-black text-white p-3 rounded mt-4">Next</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">Where do you want to advertise?</h1>
          <div className="space-y-4">
            {['Google', 'Meta'].map(c => (
              <label key={c} className="flex items-center p-4 border rounded cursor-pointer hover:bg-gray-50">
                <input type="checkbox" className="mr-3" 
                       checked={form.channels.includes(c)}
                       onChange={e => {
                         if (e.target.checked) update('channels', [...form.channels, c]);
                         else update('channels', form.channels.filter(x => x !== c));
                       }} />
                <span className="font-medium">{c} Ads</span>
              </label>
            ))}
            <button onClick={() => form.channels.length > 0 && setStep(5)} 
                    className="w-full bg-black text-white p-3 rounded mt-4 opacity-disabled">Next</button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">How should customers contact you?</h1>
          <div className="space-y-4">
            {['Website', 'WhatsApp', 'Phone', 'Website + WhatsApp'].map(s => (
              <button key={s} onClick={() => { update('destination', s); setStep(6); }} 
                      className="w-full text-left p-4 border rounded hover:border-black transition">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">Review & Create Draft</h1>
          <div className="space-y-4 p-6 bg-gray-50 rounded-lg text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-500">Service</span>
              <span className="font-medium">{form.service}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-500">Offer</span>
              <span className="font-medium">{form.offer}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-500">Budget</span>
              <span className="font-medium">₹{form.budget_amount} ({form.budget_type})</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-500">Channels</span>
              <span className="font-medium">{form.channels.join(', ')}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-500">Destination</span>
              <span className="font-medium">{form.destination}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Creative ID (Optional Test)</span>
              <input type="text" className="border px-2 text-xs" value={form.creative_id} onChange={e => update('creative_id', e.target.value)} placeholder="UUID" />
            </div>
          </div>
          <button onClick={submit} disabled={loading} className="w-full bg-black text-white p-3 rounded mt-6">
            {loading ? 'Creating...' : 'Create Draft & Proceed to Verification'}
          </button>
        </div>
      )}
    </div>
  );
}
`);

write('src/app/campaigns/[id]/page.tsx', `
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { verifyCampaign, requestApproval, approveCampaign } from '../actions';

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const id = resolvedParams.id;
  
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const { data: campaign } = await supabase.from('unified_campaigns').select('*').eq('id', id).single();
  if (!campaign) return redirect('/campaigns');

  const { data: deployments } = await supabase.from('channel_deployments').select('*').eq('campaign_id', id);

  let verification: any = null;
  if (campaign.status === 'DRAFT' || campaign.status === 'PENDING_APPROVAL') {
    // We run verification dynamically on render for these states to show the user the status
    verification = await verifyCampaign(id);
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Campaign: {campaign.service}</h1>
      <span className="inline-block bg-blue-100 text-blue-800 text-sm px-2 py-1 rounded mb-8">{campaign.status}</span>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="p-4 bg-gray-50 rounded">
          <p className="text-sm text-gray-500">Offer</p>
          <p className="font-medium">{campaign.offer}</p>
        </div>
        <div className="p-4 bg-gray-50 rounded">
          <p className="text-sm text-gray-500">Max Daily Spend</p>
          <p className="font-medium">₹{campaign.max_daily_spend}</p>
        </div>
        <div className="p-4 bg-gray-50 rounded">
          <p className="text-sm text-gray-500">Duration</p>
          <p className="font-medium">{campaign.duration_days} days</p>
        </div>
        <div className="p-4 bg-gray-50 rounded">
          <p className="text-sm text-gray-500">Channels</p>
          <p className="font-medium">{campaign.channels.join(', ')}</p>
        </div>
      </div>

      {(campaign.status === 'DRAFT' || campaign.status === 'PENDING_APPROVAL') && verification && (
        <div className="mb-8 border p-6 rounded-lg bg-white shadow-sm">
          <h2 className="text-xl font-bold mb-4">Pre-launch Verification</h2>
          <ul className="space-y-2 mb-6">
            {verification.checks.map((c: any, i: number) => (
              <li key={i} className="flex items-center">
                <span className={\`mr-2 font-bold \${c.pass ? 'text-green-600' : 'text-red-600'}\`}>
                  {c.pass ? '✓' : '✗'}
                </span>
                <span>{c.name}: <span className="text-gray-600 text-sm">{c.message}</span></span>
              </li>
            ))}
          </ul>
          
          {verification.allPass ? (
            campaign.status === 'DRAFT' ? (
              <form action={async () => {
                'use server';
                await requestApproval(id);
              }}>
                <button className="bg-black text-white px-6 py-3 rounded-lg font-medium">Submit for Approval</button>
              </form>
            ) : (
              <form action={async () => {
                'use server';
                await approveCampaign(id);
              }}>
                <button className="bg-green-600 text-white px-6 py-3 rounded-lg font-medium">Approve Campaign</button>
              </form>
            )
          ) : (
            <div className="p-4 bg-red-50 text-red-700 rounded border border-red-100">
              Please fix the issues above before this campaign can progress.
            </div>
          )}
        </div>
      )}

      {deployments && deployments.length > 0 && (
        <div>
          <h2 className="text-xl font-bold mb-4">Channel Deployments</h2>
          <div className="space-y-2">
            {deployments.map(d => (
              <div key={d.id} className="p-4 border rounded flex justify-between">
                <span className="font-medium capitalize">{d.provider}</span>
                <span className="bg-gray-100 px-2 py-1 text-sm rounded">{d.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
`);
console.log('M4 Fixes script written.');
