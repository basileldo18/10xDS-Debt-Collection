-- SQL Migration to create the pending_leads table in Supabase
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.pending_leads (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL, -- Ties the lead to a specific user
    filename TEXT NOT NULL, -- Name of the original Excel/CSV file
    lead_data JSONB NOT NULL, -- The actual data from the Excel row
    status TEXT DEFAULT 'pending', -- Status of the lead (pending, processed, error)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_pending_leads_user_id ON public.pending_leads(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_leads_status ON public.pending_leads(status);

-- Enable Row Level Security
ALTER TABLE public.pending_leads ENABLE ROW LEVEL SECURITY;

-- Policies (Optional, but recommended)
-- Users can only see their own leads
CREATE POLICY "Users can manage their own pending leads" ON public.pending_leads
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Add a comment to the table
COMMENT ON TABLE public.pending_leads IS 'Stores leads imported from Excel/CSV files for future processing';
