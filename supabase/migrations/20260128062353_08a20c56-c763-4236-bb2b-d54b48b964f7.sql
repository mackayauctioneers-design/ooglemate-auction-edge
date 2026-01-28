-- =============================================
-- PICKLES AUTO-ANCHOR INGEST SCHEMA
-- =============================================

-- 1. Stub Anchors table: stores minimal parsed data from list pages
CREATE TABLE public.stub_anchors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'pickles',
  source_stock_id TEXT,
  detail_url TEXT NOT NULL,
  
  -- Parsed stub fields
  year INTEGER,
  make TEXT,
  model TEXT,
  km INTEGER,
  location TEXT,
  raw_text TEXT, -- first 500 chars for debugging
  
  -- Fingerprint fields
  fingerprint TEXT GENERATED ALWAYS AS (
    LOWER(COALESCE(make, '') || ':' || COALESCE(model, '') || ':' || 
          COALESCE(year::text, '') || ':' || 
          CASE 
            WHEN km IS NULL THEN 'unknown'
            WHEN km < 50000 THEN '0-50k'
            WHEN km < 100000 THEN '50-100k'
            WHEN km < 150000 THEN '100-150k'
            ELSE '150k+'
          END)
  ) STORED,
  
  confidence TEXT NOT NULL DEFAULT 'low' CHECK (confidence IN ('high', 'med', 'low')),
  
  -- Tracking
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  times_seen INTEGER NOT NULL DEFAULT 1,
  
  -- Deep-fetch tracking
  deep_fetch_triggered BOOLEAN NOT NULL DEFAULT false,
  deep_fetch_at TIMESTAMPTZ,
  deep_fetch_reason TEXT,
  
  -- Hunt match tracking
  matched_hunt_ids UUID[] DEFAULT '{}',
  best_match_score NUMERIC,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'enriched', 'rejected', 'exception')),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Canonical dedupe key
  CONSTRAINT ux_stub_anchors_source_stock UNIQUE (source, source_stock_id),
  CONSTRAINT ux_stub_anchors_url UNIQUE (source, detail_url)
);

-- Indexes for fast matching
CREATE INDEX idx_stub_anchors_make_model ON public.stub_anchors(LOWER(make), LOWER(model));
CREATE INDEX idx_stub_anchors_year ON public.stub_anchors(year);
CREATE INDEX idx_stub_anchors_status ON public.stub_anchors(status);
CREATE INDEX idx_stub_anchors_confidence ON public.stub_anchors(confidence);
CREATE INDEX idx_stub_anchors_pending_match ON public.stub_anchors(status, confidence) WHERE status = 'pending';

-- 2. VA Exceptions queue: for stubs that need manual intervention
CREATE TABLE public.va_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stub_anchor_id UUID REFERENCES public.stub_anchors(id) ON DELETE CASCADE,
  
  url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'pickles',
  
  -- What's missing or failed
  missing_fields TEXT[] NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  error_details TEXT,
  
  -- VA workflow
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'completed', 'rejected')),
  assigned_to TEXT,
  assigned_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  
  -- Resolution data (VA fills this in)
  resolved_data JSONB,
  resolution_notes TEXT,
  
  -- Tracking
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_va_exceptions_status ON public.va_exceptions(status);
CREATE INDEX idx_va_exceptions_priority ON public.va_exceptions(priority, status);
CREATE INDEX idx_va_exceptions_pending ON public.va_exceptions(created_at) WHERE status = 'pending';

-- 3. Stub ingest runs table: track each hourly run
CREATE TABLE public.stub_ingest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'pickles',
  region TEXT NOT NULL DEFAULT 'nsw',
  
  -- Run metrics
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  
  -- Counts
  pages_fetched INTEGER DEFAULT 0,
  stubs_found INTEGER DEFAULT 0,
  stubs_created INTEGER DEFAULT 0,
  stubs_updated INTEGER DEFAULT 0,
  exceptions_queued INTEGER DEFAULT 0,
  deep_fetches_triggered INTEGER DEFAULT 0,
  
  -- Errors
  errors JSONB DEFAULT '[]',
  last_error TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_stub_ingest_runs_status ON public.stub_ingest_runs(status);
CREATE INDEX idx_stub_ingest_runs_started ON public.stub_ingest_runs(started_at DESC);

-- 4. Enable RLS
ALTER TABLE public.stub_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stub_ingest_runs ENABLE ROW LEVEL SECURITY;

-- Service role access (edge functions)
CREATE POLICY "Service role full access on stub_anchors"
  ON public.stub_anchors FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on va_exceptions"
  ON public.va_exceptions FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on stub_ingest_runs"
  ON public.stub_ingest_runs FOR ALL
  USING (true) WITH CHECK (true);

-- 5. Updated_at trigger
CREATE TRIGGER update_stub_anchors_updated_at
  BEFORE UPDATE ON public.stub_anchors
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_va_exceptions_updated_at
  BEFORE UPDATE ON public.va_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Function to upsert stub anchors in batch
CREATE OR REPLACE FUNCTION public.upsert_stub_anchor_batch(
  p_source TEXT,
  p_stubs JSONB
)
RETURNS TABLE (
  created_count INTEGER,
  updated_count INTEGER,
  exception_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created INTEGER := 0;
  v_updated INTEGER := 0;
  v_exception INTEGER := 0;
  v_stub JSONB;
  v_stock_id TEXT;
  v_url TEXT;
  v_exists BOOLEAN;
BEGIN
  FOR v_stub IN SELECT * FROM jsonb_array_elements(p_stubs)
  LOOP
    v_stock_id := v_stub->>'source_stock_id';
    v_url := v_stub->>'detail_url';
    
    -- Check if stock_id is missing -> exception
    IF v_stock_id IS NULL OR v_stock_id = '' THEN
      INSERT INTO va_exceptions (url, source, missing_fields, reason)
      VALUES (v_url, p_source, ARRAY['source_stock_id'], 'Missing stock ID in list page')
      ON CONFLICT DO NOTHING;
      v_exception := v_exception + 1;
      CONTINUE;
    END IF;
    
    -- Check if exists
    SELECT EXISTS(
      SELECT 1 FROM stub_anchors 
      WHERE source = p_source AND source_stock_id = v_stock_id
    ) INTO v_exists;
    
    IF v_exists THEN
      -- Update existing
      UPDATE stub_anchors SET
        last_seen_at = now(),
        times_seen = times_seen + 1,
        year = COALESCE((v_stub->>'year')::integer, year),
        km = COALESCE((v_stub->>'km')::integer, km),
        location = COALESCE(v_stub->>'location', location),
        raw_text = COALESCE(v_stub->>'raw_text', raw_text),
        updated_at = now()
      WHERE source = p_source AND source_stock_id = v_stock_id;
      v_updated := v_updated + 1;
    ELSE
      -- Insert new
      INSERT INTO stub_anchors (
        source, source_stock_id, detail_url,
        year, make, model, km, location, raw_text, confidence
      ) VALUES (
        p_source,
        v_stock_id,
        v_url,
        (v_stub->>'year')::integer,
        v_stub->>'make',
        v_stub->>'model',
        (v_stub->>'km')::integer,
        v_stub->>'location',
        v_stub->>'raw_text',
        CASE
          WHEN v_stock_id IS NOT NULL 
               AND (v_stub->>'year') IS NOT NULL 
               AND (v_stub->>'make') IS NOT NULL 
               AND (v_stub->>'model') IS NOT NULL 
               AND (v_stub->>'km') IS NOT NULL THEN 'high'
          WHEN v_stock_id IS NOT NULL 
               AND (v_stub->>'year') IS NOT NULL 
               AND (v_stub->>'make') IS NOT NULL 
               AND (v_stub->>'model') IS NOT NULL THEN 'med'
          ELSE 'low'
        END
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_created, v_updated, v_exception;
END;
$$;

-- 7. Function to match stubs against active dealer_specs (hunts)
CREATE OR REPLACE FUNCTION public.match_stubs_to_specs()
RETURNS TABLE (
  stub_id UUID,
  spec_id UUID,
  spec_name TEXT,
  match_score NUMERIC
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
    ds.name AS spec_name,
    -- Simple match score: 100 base, deduct for missing/mismatched fields
    (100.0
      - (CASE WHEN sa.year IS NULL THEN 20 ELSE 0 END)
      - (CASE WHEN sa.km IS NULL THEN 15 ELSE 0 END)
      - (CASE WHEN sa.year < COALESCE(ds.year_min, 1900) OR sa.year > COALESCE(ds.year_max, 2100) THEN 30 ELSE 0 END)
      - (CASE WHEN ds.km_max IS NOT NULL AND sa.km > ds.km_max * 1.25 THEN 25 ELSE 0 END)
    )::numeric AS match_score
  FROM stub_anchors sa
  CROSS JOIN dealer_specs ds
  WHERE 
    -- Stub is pending
    sa.status = 'pending'
    -- Spec is enabled
    AND ds.enabled = true
    AND ds.deleted_at IS NULL
    -- Make/model match (case-insensitive)
    AND LOWER(sa.make) = LOWER(ds.make)
    AND LOWER(sa.model) = LOWER(ds.model)
    -- Year within range (with tolerance)
    AND (sa.year IS NULL OR sa.year >= COALESCE(ds.year_min, 1900) - 1)
    AND (sa.year IS NULL OR sa.year <= COALESCE(ds.year_max, 2100) + 1)
    -- KM within range (with 25% tolerance)
    AND (sa.km IS NULL OR ds.km_max IS NULL OR sa.km <= ds.km_max * 1.25)
  ORDER BY match_score DESC;
END;
$$;