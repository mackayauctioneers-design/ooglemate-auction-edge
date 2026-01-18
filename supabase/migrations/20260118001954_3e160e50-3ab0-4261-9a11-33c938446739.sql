-- Fix the rpc_get_unified_candidates to check outward_candidates for verification status
-- The source_listing_id for outward candidates IS the outward_candidates.id

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
  requires_manual_check boolean,
  is_verified boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT 
      huc.*,
      -- Check if this is verified: 
      -- For outward candidates, check the outward_candidates table directly
      -- For internal candidates, they are always considered verified
      CASE 
        WHEN huc.source_type = 'outward' THEN 
          COALESCE(
            -- First try to find in outward_candidates and check if price was extracted
            (SELECT oc.extracted->>'price' IS NOT NULL 
             FROM outward_candidates oc 
             WHERE oc.id::text = huc.source_listing_id),
            -- Fallback: check hunt_external_candidates by URL match
            (SELECT hec.price_verified 
             FROM hunt_external_candidates hec 
             WHERE hec.source_url = huc.url 
             LIMIT 1),
            false
          )
        ELSE true -- Internal listings are considered verified by default
      END as is_verified_calc,
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
      AND (p_source_filter IS NULL OR huc.source_type = p_source_filter)
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
    r.requires_manual_check,
    r.is_verified_calc as is_verified
  FROM ranked r
  ORDER BY r.effective_price ASC NULLS LAST, r.final_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;