'use server'

import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';

export async function updateLeadStatus(leadId: string, currentStatus: string, newStatus: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from('leads')
    .update({ status: newStatus })
    .eq('id', leadId);

  if (error) throw new Error('Failed to update status');

  await logAudit('owner', 'UPDATE_LEAD_STATUS', 'lead', leadId, { status: currentStatus }, { status: newStatus }, 'Owner manually updated status');
  
  revalidatePath('/leads');
}

export async function updateLeadRevenue(leadId: string, currentRevenue: number | null, newRevenue: number) {
  const supabase = await createClient();

  const { error } = await supabase
    .from('leads')
    .update({ revenue_amount: newRevenue })
    .eq('id', leadId);

  if (error) throw new Error('Failed to update revenue');

  await logAudit('owner', 'UPDATE_LEAD_REVENUE', 'lead', leadId, { revenue_amount: currentRevenue }, { revenue_amount: newRevenue }, 'Owner manually updated revenue');
  
  revalidatePath('/leads');
}
