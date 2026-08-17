-- 1. Setup Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Integrations
CREATE TABLE integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider TEXT NOT NULL, -- 'meta', 'google', 'website', 'whatsapp', 'instagram'
    status TEXT NOT NULL DEFAULT 'disconnected', -- 'connected', 'error', 'disconnected'
    access_token TEXT,
    refresh_token TEXT,
    external_account_id TEXT,
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Unified Campaigns
CREATE TABLE unified_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service TEXT NOT NULL,
    offer TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'pending_approval', 'active', 'paused', 'completed'
    
    -- Abstracted budgets for owner
    budget_type TEXT NOT NULL, -- 'daily', 'total'
    budget_amount NUMERIC(10,2) NOT NULL,
    
    -- Internal safe limits (hidden from owner UI)
    max_daily_spend NUMERIC(10,2),
    max_campaign_spend NUMERIC(10,2),
    max_auto_budget_increase NUMERIC(10,2),
    
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Channel Deployments
CREATE TABLE channel_deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unified_campaign_id UUID NOT NULL REFERENCES unified_campaigns(id) ON DELETE CASCADE,
    channel TEXT NOT NULL, -- 'meta', 'google'
    channel_specific_allocation NUMERIC(10,2),
    external_campaign_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Creatives
CREATE TABLE creatives_meta (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_deployment_id UUID NOT NULL REFERENCES channel_deployments(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    text_copy TEXT,
    format TEXT, -- 'image', 'video', 'carousel'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE creatives_google (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_deployment_id UUID NOT NULL REFERENCES channel_deployments(id) ON DELETE CASCADE,
    headlines JSONB NOT NULL DEFAULT '[]',
    descriptions JSONB NOT NULL DEFAULT '[]',
    keywords JSONB NOT NULL DEFAULT '[]', -- Includes { keyword, match_type, ai_generated, owner_approved }
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Marketing Interactions (Top of funnel clicks, visits)
CREATE TABLE marketing_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL, -- 'phone_click', 'whatsapp_click', 'website_visit'
    session_id TEXT NOT NULL, -- Used to persist first-touch attribution
    
    -- Full Attribution Fields
    campaign_id TEXT,
    ad_group_id TEXT,
    ad_id TEXT,
    creative_id TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    fbclid TEXT,
    gclid TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Leads (Attribution & Outcome Tracking)
CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Identity
    name TEXT,
    phone TEXT,
    email TEXT,
    normalized_phone TEXT, -- Used for deduplication
    normalized_email TEXT, -- Used for deduplication
    
    -- Outcomes
    status TEXT NOT NULL DEFAULT 'NEW', -- 'NEW', 'CONTACTED', 'BOOKED', 'VISITED', 'PAID', 'LOST', 'UNKNOWN'
    revenue_amount NUMERIC(10,2), -- Independent monetary outcome
    
    -- Granular Attribution (survives from first-touch session)
    landing_session_id TEXT,
    source_channel TEXT,
    campaign_name TEXT,
    ad_group_name TEXT,
    ad_name TEXT,
    creative_id TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    fbclid TEXT,
    gclid TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Audit Logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor TEXT NOT NULL, -- 'system', 'owner', 'webhook', or user_id
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL, -- 'unified_campaign', 'lead', 'integration'
    entity_id UUID,
    before_state JSONB,
    after_state JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Campaign Events
CREATE TABLE campaign_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unified_campaign_id UUID NOT NULL REFERENCES unified_campaigns(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, -- 'launched', 'paused', 'budget_increased', 'external_approval_rejected'
    event_details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. RLS / Security Model (Single Tenant)
-- Since this is an internal tool for a single owner, all tables require authentication.
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE unified_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE creatives_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE creatives_google ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_events ENABLE ROW LEVEL SECURITY;

-- Create policies allowing authenticated users full access
CREATE POLICY "Authenticated full access to integrations" ON integrations FOR ALL TO authenticated USING (true);
CREATE POLICY "Authenticated full access to unified_campaigns" ON unified_campaigns FOR ALL TO authenticated USING (true);
CREATE POLICY "Authenticated full access to channel_deployments" ON channel_deployments FOR ALL TO authenticated USING (true);
CREATE POLICY "Authenticated full access to creatives_meta" ON creatives_meta FOR ALL TO authenticated USING (true);
CREATE POLICY "Authenticated full access to creatives_google" ON creatives_google FOR ALL TO authenticated USING (true);
CREATE POLICY "Authenticated full access to marketing_interactions" ON marketing_interactions FOR ALL TO authenticated USING (true);
CREATE POLICY "Authenticated full access to leads" ON leads FOR ALL TO authenticated USING (true);
CREATE POLICY "Authenticated full access to audit_logs" ON audit_logs FOR ALL TO authenticated USING (true);
CREATE POLICY "Authenticated full access to campaign_events" ON campaign_events FOR ALL TO authenticated USING (true);

-- Allow service role bypass for webhooks
-- Handled automatically by Supabase Service Role Key bypassing RLS.
