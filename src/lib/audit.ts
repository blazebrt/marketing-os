import { createClient } from './supabase/server';

export let __mockLogAudit: any = null;
export function __setMockLogAudit(mock: any) { __mockLogAudit = mock; }

export async function logAudit(
  actor: string,
  action: string,
  entityType: string,
  entityId: string | null,
  beforeState: any,
  afterState: any,
  reason: string
) {
  if (__mockLogAudit) return __mockLogAudit(actor, action, entityType, entityId, beforeState, afterState, reason);

  const supabase = await createClient();
  
  const { error } = await supabase.from('audit_logs').insert({
    actor,
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_state: beforeState,
    after_state: afterState,
    reason,
  });

  if (error) {
    console.error('Failed to write audit log:', error);
  }
}
