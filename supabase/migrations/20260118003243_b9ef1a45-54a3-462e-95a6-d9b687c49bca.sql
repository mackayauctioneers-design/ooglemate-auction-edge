-- Hunt Criteria Versioning + Auto Reset on Edit
-- When hunt criteria changes, old results are staled and version is bumped

-- 1. Add versioning columns to sale_hunts
ALTER TABLE public.sale_hunts
ADD COLUMN IF NOT EXISTS criteria_version INT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS criteria_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Add versioning columns to hunt_matches
ALTER TABLE public.hunt_matches
ADD COLUMN IF NOT EXISTS criteria_version INT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT false;

-- 3. Add versioning columns to hunt_alerts
ALTER TABLE public.hunt_alerts
ADD COLUMN IF NOT EXISTS criteria_version INT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT false;

-- 4. Add versioning columns to hunt_unified_candidates
ALTER TABLE public.hunt_unified_candidates
ADD COLUMN IF NOT EXISTS criteria_version INT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT false;

-- 5. Add versioning columns to outward_candidates (web search results)
ALTER TABLE public.outward_candidates
ADD COLUMN IF NOT EXISTS criteria_version INT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT false;

-- 6. Add versioning columns to hunt_external_candidates
ALTER TABLE public.hunt_external_candidates
ADD COLUMN IF NOT EXISTS criteria_version INT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT false;

-- 7. Indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_hunt_matches_version 
  ON public.hunt_matches(hunt_id, criteria_version, is_stale);
CREATE INDEX IF NOT EXISTS idx_hunt_alerts_version 
  ON public.hunt_alerts(hunt_id, criteria_version, is_stale);
CREATE INDEX IF NOT EXISTS idx_hunt_unified_version 
  ON public.hunt_unified_candidates(hunt_id, criteria_version, is_stale);
CREATE INDEX IF NOT EXISTS idx_outward_candidates_version 
  ON public.outward_candidates(hunt_id, criteria_version, is_stale);

-- 8. Create trigger function to auto-bump version on criteria change
CREATE OR REPLACE FUNCTION public.fn_hunt_criteria_version_bump()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  criteria_changed BOOLEAN := false;
BEGIN
  -- Check if any criteria fields changed
  IF (OLD.year IS DISTINCT FROM NEW.year) OR
     (OLD.make IS DISTINCT FROM NEW.make) OR
     (OLD.model IS DISTINCT FROM NEW.model) OR
     (OLD.variant_family IS DISTINCT FROM NEW.variant_family) OR
     (OLD.series_family IS DISTINCT FROM NEW.series_family) OR
     (OLD.badge IS DISTINCT FROM NEW.badge) OR
     (OLD.body_type IS DISTINCT FROM NEW.body_type) OR
     (OLD.engine_family IS DISTINCT FROM NEW.engine_family) OR
     (OLD.cab_type IS DISTINCT FROM NEW.cab_type) OR
     (OLD.engine_code IS DISTINCT FROM NEW.engine_code) OR
     (OLD.fuel IS DISTINCT FROM NEW.fuel) OR
     (OLD.transmission IS DISTINCT FROM NEW.transmission) OR
     (OLD.drivetrain IS DISTINCT FROM NEW.drivetrain) OR
     (OLD.km IS DISTINCT FROM NEW.km) OR
     (OLD.km_tolerance_pct IS DISTINCT FROM NEW.km_tolerance_pct) OR
     (OLD.proven_exit_value IS DISTINCT FROM NEW.proven_exit_value) OR
     (OLD.min_gap_pct_buy IS DISTINCT FROM NEW.min_gap_pct_buy) OR
     (OLD.min_gap_abs_buy IS DISTINCT FROM NEW.min_gap_abs_buy) OR
     (OLD.must_have_raw IS DISTINCT FROM NEW.must_have_raw) OR
     (OLD.must_have_tokens IS DISTINCT FROM NEW.must_have_tokens) OR
     (OLD.states IS DISTINCT FROM NEW.states) OR
     (OLD.geo_mode IS DISTINCT FROM NEW.geo_mode)
  THEN
    criteria_changed := true;
  END IF;

  IF criteria_changed THEN
    -- Bump version and timestamp
    NEW.criteria_version := OLD.criteria_version + 1;
    NEW.criteria_updated_at := now();
    
    -- Mark old matches as stale
    UPDATE public.hunt_matches 
    SET is_stale = true 
    WHERE hunt_id = NEW.id AND criteria_version < NEW.criteria_version;
    
    -- Mark old alerts as stale  
    UPDATE public.hunt_alerts 
    SET is_stale = true 
    WHERE hunt_id = NEW.id AND criteria_version < NEW.criteria_version;
    
    -- Mark old unified candidates as stale
    UPDATE public.hunt_unified_candidates 
    SET is_stale = true 
    WHERE hunt_id = NEW.id AND criteria_version < NEW.criteria_version;
    
    -- Mark old outward candidates as stale
    UPDATE public.outward_candidates 
    SET is_stale = true 
    WHERE hunt_id = NEW.id AND criteria_version < NEW.criteria_version;
    
    -- Mark old external candidates as stale
    UPDATE public.hunt_external_candidates 
    SET is_stale = true 
    WHERE hunt_id = NEW.id AND criteria_version < NEW.criteria_version;
    
    -- Reset scan timestamps to force fresh scan
    NEW.last_scan_at := NULL;
    NEW.last_outward_scan_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- 9. Create the trigger
DROP TRIGGER IF EXISTS trg_hunt_criteria_version_bump ON public.sale_hunts;
CREATE TRIGGER trg_hunt_criteria_version_bump
  BEFORE UPDATE ON public.sale_hunts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_hunt_criteria_version_bump();

-- 10. Create RPC to manually reset hunt results
CREATE OR REPLACE FUNCTION public.rpc_reset_hunt_results(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_version INT;
BEGIN
  -- Get current version and bump it
  UPDATE public.sale_hunts 
  SET 
    criteria_version = criteria_version + 1,
    criteria_updated_at = now(),
    last_scan_at = NULL,
    last_outward_scan_at = NULL
  WHERE id = p_hunt_id
  RETURNING criteria_version INTO v_new_version;
  
  -- Mark all results as stale
  UPDATE public.hunt_matches SET is_stale = true WHERE hunt_id = p_hunt_id;
  UPDATE public.hunt_alerts SET is_stale = true WHERE hunt_id = p_hunt_id;
  UPDATE public.hunt_unified_candidates SET is_stale = true WHERE hunt_id = p_hunt_id;
  UPDATE public.outward_candidates SET is_stale = true WHERE hunt_id = p_hunt_id;
  UPDATE public.hunt_external_candidates SET is_stale = true WHERE hunt_id = p_hunt_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'new_version', v_new_version,
    'message', 'All results staled, ready for fresh scan'
  );
END;
$$;

-- 11. Update rpc_get_unified_candidates to filter by current version
DROP FUNCTION IF EXISTS rpc_get_unified_candidates(uuid, integer, integer, text, text);

CREATE OR REPLACE FUNCTION rpc_get_unified_candidates(
  p_hunt_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_decision_filter text DEFAULT NULL,
  p_source_filter text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  hunt_id uuid,
  source_type text,
  source_listing_id text,
  effective_price integer,
  price_score numeric,
  final_score numeric,
  decision text,
  confidence text,
  year integer,
  make text,
  model text,
  variant text,
  km integer,
  asking_price integer,
  gap_dollars integer,
  gap_pct numeric,
  listing_url text,
  source_name text,
  title text,
  first_seen_at timestamptz,
  location text,
  url text,
  is_verified boolean,
  criteria_version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hunt_version INT;
BEGIN
  -- Get current hunt criteria version
  SELECT sh.criteria_version INTO v_hunt_version
  FROM sale_hunts sh
  WHERE sh.id = p_hunt_id;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      huc.id,
      huc.hunt_id,
      huc.source_type,
      huc.source_listing_id,
      huc.effective_price,
      huc.price_score,
      huc.final_score,
      huc.decision,
      huc.confidence,
      huc.year,
      huc.make,
      huc.model,
      huc.variant,
      huc.km,
      huc.asking_price,
      huc.gap_dollars,
      huc.gap_pct,
      huc.listing_url,
      huc.source_name,
      huc.title,
      huc.first_seen_at,
      huc.location,
      huc.url,
      huc.criteria_version,
      CASE
        WHEN huc.source_type = 'outward' THEN
          COALESCE(
            (SELECT (oc.extracted->>'asking_price') IS NOT NULL
                 OR (oc.extracted->>'price') IS NOT NULL
             FROM outward_candidates oc
             WHERE oc.id::text = huc.source_listing_id
               AND oc.is_stale = false),
            (SELECT hec.price_verified
             FROM hunt_external_candidates hec
             WHERE hec.source_url = huc.url
               AND hec.is_stale = false
             LIMIT 1),
            false
          )
        ELSE true
      END as is_verified_calc
    FROM hunt_unified_candidates huc
    WHERE huc.hunt_id = p_hunt_id
      AND huc.criteria_version = v_hunt_version
      AND huc.is_stale = false
      AND (p_decision_filter IS NULL OR huc.decision = p_decision_filter)
      AND (p_source_filter IS NULL OR huc.source_type = p_source_filter)
  )
  SELECT
    r.id,
    r.hunt_id,
    r.source_type,
    r.source_listing_id,
    r.effective_price,
    r.price_score,
    r.final_score,
    r.decision,
    r.confidence,
    r.year,
    r.make,
    r.model,
    r.variant,
    r.km,
    r.asking_price,
    r.gap_dollars,
    r.gap_pct,
    r.listing_url,
    r.source_name,
    r.title,
    r.first_seen_at,
    r.location,
    r.url,
    r.is_verified_calc as is_verified,
    r.criteria_version
  FROM ranked r
  ORDER BY r.effective_price ASC NULLS LAST, r.final_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- 12. Update count function to filter by current version
CREATE OR REPLACE FUNCTION rpc_get_unified_candidates_count(
  p_hunt_id uuid,
  p_decision_filter text DEFAULT NULL,
  p_source_filter text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
  v_hunt_version INT;
BEGIN
  SELECT sh.criteria_version INTO v_hunt_version
  FROM sale_hunts sh
  WHERE sh.id = p_hunt_id;

  SELECT COUNT(*)::integer INTO v_count
  FROM hunt_unified_candidates huc
  WHERE huc.hunt_id = p_hunt_id
    AND huc.criteria_version = v_hunt_version
    AND huc.is_stale = false
    AND (p_decision_filter IS NULL OR huc.decision = p_decision_filter)
    AND (p_source_filter IS NULL OR huc.source_type = p_source_filter);
  
  RETURN v_count;
END;
$$;

-- 13. Update cheapest price function to filter by current version
CREATE OR REPLACE FUNCTION rpc_get_unified_cheapest_price(
  p_hunt_id uuid,
  p_source_filter text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cheapest INTEGER;
  v_hunt_version INT;
BEGIN
  SELECT sh.criteria_version INTO v_hunt_version
  FROM sale_hunts sh
  WHERE sh.id = p_hunt_id;

  SELECT MIN(huc.effective_price) INTO v_cheapest
  FROM hunt_unified_candidates huc
  WHERE huc.hunt_id = p_hunt_id
    AND huc.criteria_version = v_hunt_version
    AND huc.is_stale = false
    AND huc.effective_price IS NOT NULL
    AND (p_source_filter IS NULL OR huc.source_type = p_source_filter);
  
  RETURN v_cheapest;
END;
$$;