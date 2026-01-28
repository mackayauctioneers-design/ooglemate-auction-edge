-- 1) Split deep fetch timestamps
ALTER TABLE public.stub_anchors 
  DROP COLUMN IF EXISTS deep_fetch_at,
  ADD COLUMN IF NOT EXISTS deep_fetch_queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deep_fetch_completed_at TIMESTAMPTZ;

-- 5) Split confidence into identity_confidence vs fingerprint_confidence
ALTER TABLE public.stub_anchors 
  DROP COLUMN IF EXISTS confidence,
  ADD COLUMN IF NOT EXISTS identity_confidence TEXT NOT NULL DEFAULT 'low' 
    CHECK (identity_confidence IN ('high', 'med', 'low')),
  ADD COLUMN IF NOT EXISTS fingerprint_confidence TEXT NOT NULL DEFAULT 'low'
    CHECK (fingerprint_confidence IN ('high', 'med', 'low'));

-- Add index for deep-fetch job select pattern
CREATE INDEX IF NOT EXISTS idx_stub_anchors_deep_fetch_pending 
  ON public.stub_anchors(deep_fetch_triggered, deep_fetch_completed_at) 
  WHERE deep_fetch_triggered = true AND deep_fetch_completed_at IS NULL;

-- 3) Add indexes for JOIN-based matching on normalized make/model
CREATE INDEX IF NOT EXISTS idx_stub_anchors_make_lower ON public.stub_anchors(LOWER(make));
CREATE INDEX IF NOT EXISTS idx_stub_anchors_model_lower ON public.stub_anchors(LOWER(model));
CREATE INDEX IF NOT EXISTS idx_dealer_specs_make_lower ON public.dealer_specs(LOWER(make)) WHERE enabled = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dealer_specs_model_lower ON public.dealer_specs(LOWER(model)) WHERE enabled = true AND deleted_at IS NULL;

-- 4) Verify UNIQUE constraint exists on pickles_detail_queue (already exists per earlier check)
-- Just add a check constraint to prevent UUID fallback in source_listing_id
-- Note: UUID pattern is 8-4-4-4-12 hex chars with hyphens, numeric stock IDs are all digits
-- We'll enforce this in application code since Pickles uses both UUIDs and numeric IDs

-- Update the upsert_stub_anchor_batch function to use new confidence columns
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
  v_identity_conf TEXT;
  v_fingerprint_conf TEXT;
BEGIN
  FOR v_stub IN SELECT * FROM jsonb_array_elements(p_stubs)
  LOOP
    v_stock_id := v_stub->>'source_stock_id';
    v_url := v_stub->>'detail_url';
    
    -- Compute identity_confidence: high if stock_id present and not empty
    IF v_stock_id IS NOT NULL AND v_stock_id != '' THEN
      v_identity_conf := 'high';
    ELSE
      v_identity_conf := 'low';
      -- Queue as exception
      INSERT INTO va_exceptions (url, source, missing_fields, reason)
      VALUES (v_url, p_source, ARRAY['source_stock_id'], 'Missing stock ID in list page')
      ON CONFLICT DO NOTHING;
      v_exception := v_exception + 1;
      CONTINUE;
    END IF;
    
    -- Compute fingerprint_confidence based on year/make/model/km
    IF (v_stub->>'year') IS NOT NULL 
       AND (v_stub->>'make') IS NOT NULL 
       AND (v_stub->>'model') IS NOT NULL 
       AND (v_stub->>'km') IS NOT NULL THEN
      v_fingerprint_conf := 'high';
    ELSIF (v_stub->>'year') IS NOT NULL 
          AND (v_stub->>'make') IS NOT NULL 
          AND (v_stub->>'model') IS NOT NULL THEN
      v_fingerprint_conf := 'med';
    ELSE
      v_fingerprint_conf := 'low';
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
        fingerprint_confidence = CASE 
          WHEN v_fingerprint_conf = 'high' THEN 'high'
          WHEN fingerprint_confidence = 'high' THEN 'high'
          ELSE v_fingerprint_conf
        END,
        updated_at = now()
      WHERE source = p_source AND source_stock_id = v_stock_id;
      v_updated := v_updated + 1;
    ELSE
      -- Insert new
      INSERT INTO stub_anchors (
        source, source_stock_id, detail_url,
        year, make, model, km, location, raw_text,
        identity_confidence, fingerprint_confidence
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
        v_identity_conf,
        v_fingerprint_conf
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_created, v_updated, v_exception;
END;
$$;

-- 3) Replace CROSS JOIN with proper JOIN-based matching function
CREATE OR REPLACE FUNCTION public.match_stubs_to_specs(
  p_batch_size INTEGER DEFAULT 100,
  p_min_score NUMERIC DEFAULT 50
)
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
    -- Match score calculation
    (100.0
      - (CASE WHEN sa.year IS NULL THEN 20 ELSE 0 END)
      - (CASE WHEN sa.km IS NULL THEN 15 ELSE 0 END)
      - (CASE WHEN sa.year < COALESCE(ds.year_min, 1900) OR sa.year > COALESCE(ds.year_max, 2100) THEN 30 ELSE 0 END)
      - (CASE WHEN ds.km_max IS NOT NULL AND sa.km > ds.km_max * 1.25 THEN 25 ELSE 0 END)
    )::numeric AS match_score
  FROM stub_anchors sa
  -- JOIN instead of CROSS JOIN - use normalized make/model
  INNER JOIN dealer_specs ds 
    ON LOWER(sa.make) = LOWER(ds.make)
    AND LOWER(sa.model) = LOWER(ds.model)
  WHERE 
    -- Stub is pending and not yet deep-fetched
    sa.status = 'pending'
    AND sa.deep_fetch_triggered = false
    -- Spec is enabled
    AND ds.enabled = true
    AND ds.deleted_at IS NULL
    -- Year within range (with tolerance)
    AND (sa.year IS NULL OR sa.year >= COALESCE(ds.year_min, 1900) - 1)
    AND (sa.year IS NULL OR sa.year <= COALESCE(ds.year_max, 2100) + 1)
    -- KM within range (with 25% tolerance)
    AND (sa.km IS NULL OR ds.km_max IS NULL OR sa.km <= ds.km_max * 1.25)
    -- Match score threshold
    AND (100.0
      - (CASE WHEN sa.year IS NULL THEN 20 ELSE 0 END)
      - (CASE WHEN sa.km IS NULL THEN 15 ELSE 0 END)
      - (CASE WHEN sa.year < COALESCE(ds.year_min, 1900) OR sa.year > COALESCE(ds.year_max, 2100) THEN 30 ELSE 0 END)
      - (CASE WHEN ds.km_max IS NOT NULL AND sa.km > ds.km_max * 1.25 THEN 25 ELSE 0 END)
    ) >= p_min_score
  ORDER BY match_score DESC
  LIMIT p_batch_size;
END;
$$;