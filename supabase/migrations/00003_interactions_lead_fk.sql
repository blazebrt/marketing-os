-- Milestone 3: Lead Tracking & Attribution Refinements

-- Link interactions to leads for holistic timeline (without aggressive merging)
ALTER TABLE marketing_interactions
ADD COLUMN lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

-- Ensure leads table has exact statuses enforced by check constraint
ALTER TABLE leads
ADD CONSTRAINT leads_status_check 
CHECK (status IN ('NEW', 'CONTACTED', 'BOOKED', 'VISITED', 'PAID', 'LOST', 'UNKNOWN'));

-- Ensure RLS on interactions remains secure
-- (Policies were already added in 00001, but we reaffirm service_role usage for ingestion)
