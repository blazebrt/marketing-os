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
    owner_id: actor,
    actor,
    action,
    entity_type: entityType,
    entity_id: entityId,
    before_state: beforeState,
    after_state: afterState,
    reason: String(reason || '').slice(0, 300),
  });

  if (error) {
    console.error(JSON.stringify({ scope: 'audit', code: 'AUDIT_WRITE_FAILED' }));
  }
}
