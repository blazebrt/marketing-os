-- Milestone 2: Idempotency and State Reconciliation

-- 1. Idempotency Keys table to prevent duplicate provider mutations
CREATE TABLE idempotency_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT NOT NULL UNIQUE,
    actor TEXT NOT NULL,
    request_path TEXT NOT NULL,
    request_params JSONB,
    response_body JSONB,
    response_status INT,
    locked_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure anon access is blocked
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service Role full access to idempotency_keys" ON idempotency_keys FOR ALL TO service_role USING (true);
CREATE POLICY "Authenticated full access to idempotency_keys" ON idempotency_keys FOR ALL TO authenticated USING (true);

-- 2. State persistence for Channel Deployments (for reconciliation)
ALTER TABLE channel_deployments 
ADD COLUMN target_state JSONB, -- The intended state of the deployment
ADD COLUMN actual_state JSONB, -- The last known verified state from the provider
ADD COLUMN reconciliation_status TEXT DEFAULT 'pending'; -- 'pending', 'in_progress', 'synced', 'failed'

-- 3. Webhook signature configurations (storing secrets securely)
-- Note: Secrets are better stored in Supabase Vault in a real production environment.
-- For this schema, we will add a flag to integrations to indicate if webhook is configured.
ALTER TABLE integrations
ADD COLUMN webhook_secret_configured BOOLEAN DEFAULT FALSE;

-- Ensure audit_logs mutation protection
-- Drop the wide open policy from milestone 1 and restrict to insert-only for authenticated users
DROP POLICY IF EXISTS "Authenticated full access to audit_logs" ON audit_logs;
CREATE POLICY "Authenticated insert only to audit_logs" ON audit_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated select only to audit_logs" ON audit_logs FOR SELECT TO authenticated USING (true);
-- Updates and Deletes are strictly denied (enforced by lack of policies)
