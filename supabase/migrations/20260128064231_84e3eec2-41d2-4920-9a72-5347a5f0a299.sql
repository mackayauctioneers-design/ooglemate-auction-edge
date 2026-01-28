-- ===========================================
-- Production Hardening Migration
-- ===========================================

-- 1) Add normalized columns to stub_anchors
ALTER TABLE public.stub_anchors 
  ADD COLUMN IF NOT EXISTS make_norm TEXT GENERATED ALWAYS AS (LOWER(TRIM(make))) STORED,
  ADD COLUMN IF NOT EXISTS model_norm TEXT GENERATED ALWAYS AS (LOWER(TRIM(model))) STORED;

-- 2) Add normalized columns to dealer_specs
ALTER TABLE public.dealer_specs 
  ADD COLUMN IF NOT EXISTS make_norm TEXT GENERATED ALWAYS AS (LOWER(TRIM(make))) STORED,
  ADD COLUMN IF NOT EXISTS model_norm TEXT GENERATED ALWAYS AS (LOWER(TRIM(model))) STORED;

-- 3) Create composite indexes for efficient joins
DROP INDEX IF EXISTS idx_stub_anchors_match_lookup;
CREATE INDEX idx_stub_anchors_match_lookup 
  ON public.stub_anchors (status, deep_fetch_triggered, make_norm, model_norm)
  WHERE status = 'pending' AND deep_fetch_triggered = false;

DROP INDEX IF EXISTS idx_dealer_specs_match_lookup;
CREATE INDEX idx_dealer_specs_match_lookup 
  ON public.dealer_specs (enabled, deleted_at, make_norm, model_norm)
  WHERE enabled = true AND deleted_at IS NULL;

-- 4) Add concurrency control columns to pickles_detail_queue
ALTER TABLE public.pickles_detail_queue 
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;

-- 5) Update match_stubs_to_specs RPC to use normalized columns
CREATE OR REPLACE FUNCTION public.match_stubs_to_specs(
  p_batch_size INT DEFAULT 100,
  p_min_score INT DEFAULT 50
)
RETURNS TABLE(
  stub_id UUID,
  spec_id UUID,
  match_score INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sa.id AS stub_id,
    ds.id AS spec_id,
    (
      -- Year match: 30 points
      CASE 
        WHEN sa.year BETWEEN COALESCE(ds.year_min, 1900) AND COALESCE(ds.year_max, 2100) THEN 30
        WHEN sa.year BETWEEN COALESCE(ds.year_min, 1900) - 1 AND COALESCE(ds.year_max, 2100) + 1 THEN 15
        ELSE 0
      END
      +
      -- Make/Model match: 50 points (already filtered by JOIN)
      50
      +
      -- KM within range: 20 points
      CASE 
        WHEN ds.km_max IS NULL THEN 10
        WHEN sa.km IS NULL THEN 5
        WHEN sa.km <= ds.km_max THEN 20
        WHEN sa.km <= ds.km_max * 1.25 THEN 10
        ELSE 0
      END
    )::INT AS match_score
  FROM stub_anchors sa
  INNER JOIN dealer_specs ds 
    ON sa.make_norm = ds.make_norm
    AND sa.model_norm = ds.model_norm
  WHERE 
    sa.status = 'pending'
    AND sa.deep_fetch_triggered = false
    AND ds.enabled = true
    AND ds.deleted_at IS NULL
    AND (
      -- Year match: 30 points
      CASE 
        WHEN sa.year BETWEEN COALESCE(ds.year_min, 1900) AND COALESCE(ds.year_max, 2100) THEN 30
        WHEN sa.year BETWEEN COALESCE(ds.year_min, 1900) - 1 AND COALESCE(ds.year_max, 2100) + 1 THEN 15
        ELSE 0
      END
      +
      -- Make/Model match: 50 points
      50
      +
      -- KM within range: 20 points
      CASE 
        WHEN ds.km_max IS NULL THEN 10
        WHEN sa.km IS NULL THEN 5
        WHEN sa.km <= ds.km_max THEN 20
        WHEN sa.km <= ds.km_max * 1.25 THEN 10
        ELSE 0
      END
    ) >= p_min_score
  ORDER BY sa.first_seen_at ASC
  LIMIT p_batch_size;
END;
$$;

-- 6) Create RPC for atomic queue claim (FOR UPDATE SKIP LOCKED)
CREATE OR REPLACE FUNCTION public.claim_detail_queue_batch(
  p_batch_size INT DEFAULT 20,
  p_claim_by TEXT DEFAULT 'worker',
  p_max_retries INT DEFAULT 3
)
RETURNS TABLE(
  id UUID,
  source TEXT,
  source_listing_id TEXT,
  detail_url TEXT,
  crawl_status TEXT,
  retry_count INT,
  stub_anchor_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim_time TIMESTAMPTZ := NOW();
BEGIN
  -- Claim rows atomically
  RETURN QUERY
  WITH claimed AS (
    SELECT q.id
    FROM pickles_detail_queue q
    WHERE q.crawl_status IN ('pending', 'error')
      AND (q.claimed_at IS NULL OR q.claimed_at < NOW() - INTERVAL '10 minutes')
      AND q.retry_count < p_max_retries
    ORDER BY 
      CASE WHEN q.crawl_status = 'pending' THEN 0 ELSE 1 END,
      q.first_seen_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE pickles_detail_queue q
  SET 
    claimed_at = v_claim_time,
    claimed_by = p_claim_by,
    crawl_status = 'processing'
  FROM claimed
  WHERE q.id = claimed.id
  RETURNING 
    q.id,
    q.source,
    q.source_listing_id,
    q.detail_url,
    q.crawl_status,
    q.retry_count,
    q.stub_anchor_id;
END;
$$;

-- 7) Add stub_anchor_id to pickles_detail_queue for back-reference
ALTER TABLE public.pickles_detail_queue 
  ADD COLUMN IF NOT EXISTS stub_anchor_id UUID REFERENCES stub_anchors(id);

-- 8) Create index for queue processing
DROP INDEX IF EXISTS idx_pickles_detail_queue_claim;
CREATE INDEX idx_pickles_detail_queue_claim 
  ON public.pickles_detail_queue (crawl_status, claimed_at, retry_count, first_seen_at)
  WHERE crawl_status IN ('pending', 'error');

-- 9) Ensure UNIQUE constraint on pickles_detail_queue
-- First drop if exists and recreate
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'pickles_detail_queue_source_listing_unique'
  ) THEN
    ALTER TABLE public.pickles_detail_queue 
      ADD CONSTRAINT pickles_detail_queue_source_listing_unique 
      UNIQUE (source, source_listing_id);
  END IF;
EXCEPTION WHEN duplicate_object THEN
  -- Constraint already exists
  NULL;
END $$;