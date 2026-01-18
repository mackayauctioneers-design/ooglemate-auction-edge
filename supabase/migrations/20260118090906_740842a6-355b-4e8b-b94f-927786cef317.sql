
-- Fix RPC to use actual column names from hunt_unified_candidates table

DROP FUNCTION IF EXISTS public.rpc_get_unified_candidates(uuid, integer, integer, text, text, boolean);

CREATE OR REPLACE FUNCTION public.rpc_get_unified_candidates(
  p_hunt_id UUID,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0,
  p_decision_filter TEXT DEFAULT NULL,
  p_source_filter TEXT DEFAULT NULL,
  p_exclude_ignore BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  id UUID,
  hunt_id UUID,
  criteria_version INTEGER,
  source_type TEXT,
  source_listing_id TEXT,
  source TEXT,
  url TEXT,
  title TEXT,
  year INTEGER,
  make TEXT,
  model TEXT,
  variant TEXT,
  km INTEGER,
  price INTEGER,
  asking_price INTEGER,
  location TEXT,
  domain TEXT,
  match_score NUMERIC,
  dna_score NUMERIC,
  rank_score NUMERIC,
  price_score NUMERIC,
  final_score NUMERIC,
  effective_price INTEGER,
  decision TEXT,
  gap_dollars INTEGER,
  gap_pct NUMERIC,
  source_name TEXT,
  source_class TEXT,
  source_tier INTEGER,
  verified BOOLEAN,
  is_cheapest BOOLEAN,
  rank_position INTEGER,
  reasons TEXT[],
  sort_reason TEXT[],
  blocked_reason TEXT,
  id_kit JSONB,
  requires_manual_check BOOLEAN,
  series_family TEXT,
  engine_family TEXT,
  body_type TEXT,
  cab_type TEXT,
  badge TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hunt RECORD;
BEGIN
  -- Get hunt details
  SELECT * INTO v_hunt FROM sale_hunts WHERE sale_hunts.id = p_hunt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hunt not found: %', p_hunt_id;
  END IF;

  RETURN QUERY
  SELECT 
    c.id,
    c.hunt_id,
    c.criteria_version,
    c.source_type,
    c.source_listing_id,
    c.source,
    c.url,
    c.title,
    c.year,
    c.make,
    c.model,
    c.variant_raw AS variant,
    c.km,
    c.price,
    c.asking_price,
    c.location,
    c.domain,
    c.match_score,
    c.dna_score,
    c.rank_score,
    c.price_score,
    c.final_score,
    c.effective_price,
    c.decision,
    c.gap_dollars,
    c.gap_pct,
    c.source AS source_name,
    c.source_class,
    c.source_tier,
    c.verified,
    c.is_cheapest,
    c.rank_position,
    c.reasons,
    c.sort_reason,
    c.blocked_reason,
    c.id_kit,
    c.requires_manual_check,
    c.series_family,
    c.engine_family,
    c.body_type,
    c.cab_type,
    c.badge,
    c.created_at
  FROM hunt_unified_candidates c
  WHERE c.hunt_id = p_hunt_id
    AND c.criteria_version = v_hunt.criteria_version
    AND c.is_stale = false
    -- Apply decision filter if provided
    AND (p_decision_filter IS NULL OR c.decision = p_decision_filter)
    -- Exclude IGNORE by default unless explicitly requested
    AND (
      p_decision_filter = 'IGNORE' 
      OR NOT p_exclude_ignore 
      OR c.decision != 'IGNORE'
    )
    -- Apply source filter if provided  
    AND (p_source_filter IS NULL OR c.source_type = p_source_filter)
  ORDER BY 
    -- Tier 1 = Auctions first
    c.source_tier ASC NULLS LAST,
    -- Then by DNA score (identity match quality)
    c.dna_score DESC NULLS LAST,
    -- Then by price ascending (cheapest first within same tier/score)
    c.price ASC NULLS LAST,
    -- Then by recency
    c.created_at DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.rpc_get_unified_candidates IS 
'Returns unified candidates for a hunt with identity-first ranking (auction-first, then DNA score, then price). 
Excludes IGNORE by default for Live Matches. Use p_decision_filter=IGNORE to see rejected items.';
