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

  await logAudit(user.id, 'LEAD_UPDATED', 'lead', leadId, null, null, `Updated status: ${status}, revenue: ${revenue}`);
  revalidatePath('/leads');
  revalidatePath('/'); // Refresh dashboard
}
