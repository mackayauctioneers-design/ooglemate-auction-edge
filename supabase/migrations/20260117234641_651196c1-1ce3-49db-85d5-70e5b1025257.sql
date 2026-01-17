-- Drop existing function first, then recreate with price-first sorting
DROP FUNCTION IF EXISTS rpc_get_unified_candidates(uuid, integer, integer, text);

CREATE OR REPLACE FUNCTION rpc_get_unified_candidates(
  p_hunt_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_decision_filter text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  source_type text,
  source text,
  source_listing_id text,
  url text,
  title text,
  year integer,
  make text,
  model text,
  variant_raw text,
  km integer,
  price integer,
  location text,
  domain text,
  match_score numeric,
  price_score numeric,
  final_score numeric,
  decision text,
  reasons text[],
  is_cheapest boolean,
  rank_position integer,
  blocked_reason text,
  id_kit jsonb,
  requires_manual_check boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT 
      huc.*,
      -- Primary sort: price ascending (cheapest first), then score for ties
      ROW_NUMBER() OVER (
        ORDER BY 
          huc.effective_price ASC NULLS LAST,
          huc.final_score DESC
      ) as rank_pos,
      huc.effective_price = MIN(huc.effective_price) OVER () as is_cheapest_calc
    FROM hunt_unified_candidates huc
    WHERE huc.hunt_id = p_hunt_id
      AND (p_decision_filter IS NULL OR huc.decision = p_decision_filter)
  )
  SELECT 
    r.id,
    r.source_type,
    r.source,
    r.source_listing_id,
    r.url,
    r.title,
    r.year,
    r.make,
    r.model,
    r.variant_raw,
    r.km,
    r.price,
    r.location,
    r.domain,
    r.match_score,
    r.price_score,
    r.final_score,
    r.decision,
    r.reasons,
    r.is_cheapest_calc as is_cheapest,
    r.rank_pos::integer as rank_position,
    r.blocked_reason,
    r.id_kit,
    r.requires_manual_check
  FROM ranked r
  ORDER BY r.effective_price ASC NULLS LAST, r.final_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;