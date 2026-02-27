
-- ============================================================
-- Migration: Add Manus API integration
-- ============================================================

-- 1. Add adapter_type column to dealer_outbound_sources
ALTER TABLE dealer_outbound_sources
  ADD COLUMN IF NOT EXISTS adapter_type TEXT NOT NULL DEFAULT 'firecrawl';

-- Add check constraint separately (IF NOT EXISTS not supported for constraints)
DO $$ BEGIN
  ALTER TABLE dealer_outbound_sources
    ADD CONSTRAINT chk_adapter_type CHECK (adapter_type IN ('firecrawl', 'manus', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add manus columns to retail_listings
ALTER TABLE retail_listings
  ADD COLUMN IF NOT EXISTS manus_task_id TEXT,
  ADD COLUMN IF NOT EXISTS search_source TEXT;

-- 3. Create table to track pending Manus search tasks
CREATE TABLE IF NOT EXISTS manus_search_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_id UUID NOT NULL REFERENCES sale_hunts(id) ON DELETE CASCADE,
  manus_task_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Add check constraint for status
DO $$ BEGIN
  ALTER TABLE manus_search_tasks
    ADD CONSTRAINT chk_manus_task_status CHECK (status IN ('pending', 'complete', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_manus_tasks_hunt ON manus_search_tasks(hunt_id);
CREATE INDEX IF NOT EXISTS idx_manus_tasks_status ON manus_search_tasks(status);

-- RLS: service role only (edge functions use service role key)
ALTER TABLE manus_search_tasks ENABLE ROW LEVEL SECURITY;

-- 4. Set adapter_type = 'manus' for known complex dealer sites
UPDATE dealer_outbound_sources
SET adapter_type = 'manus'
WHERE dealer_domain ILIKE ANY (ARRAY[
  '%canberratoyota%',
  '%meltontoyota%',
  '%johnmadilltoyota%',
  '%pattersoncheneytoyota%',
  '%scottstoyota%',
  '%sunshinetoyota%',
  '%tonywhitegroup%',
  '%weststarhyundai%',
  '%countrycars%'
]);

-- 5. Set adapter_type = 'none' for Carsales (blocked)
UPDATE dealer_outbound_sources
SET adapter_type = 'none'
WHERE dealer_domain ILIKE '%carsales%';
