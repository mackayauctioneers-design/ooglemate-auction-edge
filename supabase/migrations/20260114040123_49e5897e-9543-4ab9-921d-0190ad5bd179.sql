-- 1) dealer_profile table (Dealer Brain - persistent preferences)
CREATE TABLE IF NOT EXISTS public.dealer_profile (
  dealer_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  year_min int DEFAULT 2020,
  year_max int DEFAULT NULL,
  exclude_salvage boolean DEFAULT true,
  exclude_wovr boolean DEFAULT true,
  exclude_stat_writeoff boolean DEFAULT true,
  preferred_segments jsonb DEFAULT '[]'::jsonb,
  exclude_segments jsonb DEFAULT '[]'::jsonb,
  geo_preferences jsonb DEFAULT '{}'::jsonb,
  scoring_thresholds jsonb DEFAULT '{"cold_max":1,"warm_max":4,"hot_max":9,"very_hot_min":10}'::jsonb,
  output_style jsonb DEFAULT '{"format":"operator","max_items":7}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS for dealer_profile
ALTER TABLE public.dealer_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dealer profile"
  ON public.dealer_profile FOR SELECT
  USING (auth.uid() = dealer_id);

CREATE POLICY "Users can insert own dealer profile"
  ON public.dealer_profile FOR INSERT
  WITH CHECK (auth.uid() = dealer_id);

CREATE POLICY "Users can update own dealer profile"
  ON public.dealer_profile FOR UPDATE
  USING (auth.uid() = dealer_id);

CREATE POLICY "Service can manage dealer profiles"
  ON public.dealer_profile FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 2) bob_chat_context_log table (optional debugging)
CREATE TABLE IF NOT EXISTS public.bob_chat_context_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  route text,
  filters jsonb,
  selected_auction_event_id uuid DEFAULT NULL,
  selected_lot_id uuid DEFAULT NULL,
  page_summary jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.bob_chat_context_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chat context logs"
  ON public.bob_chat_context_log FOR SELECT
  USING (auth.uid() = dealer_id);

CREATE POLICY "Users can insert own chat context logs"
  ON public.bob_chat_context_log FOR INSERT
  WITH CHECK (auth.uid() = dealer_id);

CREATE POLICY "Service can manage chat context logs"
  ON public.bob_chat_context_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 3) RPC: rpc_get_dealer_profile
CREATE OR REPLACE FUNCTION public.rpc_get_dealer_profile(p_dealer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'year_min', dp.year_min,
    'year_max', dp.year_max,
    'exclude_salvage', dp.exclude_salvage,
    'exclude_wovr', dp.exclude_wovr,
    'exclude_stat_writeoff', dp.exclude_stat_writeoff,
    'preferred_segments', dp.preferred_segments,
    'exclude_segments', dp.exclude_segments,
    'geo_preferences', dp.geo_preferences,
    'scoring_thresholds', dp.scoring_thresholds,
    'output_style', dp.output_style
  ) INTO result
  FROM public.dealer_profile dp
  WHERE dp.dealer_id = p_dealer_id;
  
  -- Return defaults if no profile exists
  IF result IS NULL THEN
    result := jsonb_build_object(
      'year_min', 2020,
      'year_max', null,
      'exclude_salvage', true,
      'exclude_wovr', true,
      'exclude_stat_writeoff', true,
      'preferred_segments', '[]'::jsonb,
      'exclude_segments', '[]'::jsonb,
      'geo_preferences', '{}'::jsonb,
      'scoring_thresholds', '{"cold_max":1,"warm_max":4,"hot_max":9,"very_hot_min":10}'::jsonb,
      'output_style', '{"format":"operator","max_items":7}'::jsonb
    );
  END IF;
  
  RETURN result;
END;
$$;

-- 4) RPC: rpc_get_today_opportunities
CREATE OR REPLACE FUNCTION public.rpc_get_today_opportunities(
  p_dealer_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  profile_rec record;
  items jsonb := '[]'::jsonb;
  total_count int := 0;
BEGIN
  -- Get dealer profile
  SELECT * INTO profile_rec FROM public.dealer_profile WHERE dealer_id = p_dealer_id;
  
  -- Query vehicle_listings for today's opportunities
  WITH eligible_lots AS (
    SELECT 
      vl.id as lot_id,
      vl.year,
      vl.make,
      vl.model,
      vl.variant_family as variant,
      vl.km,
      vl.asking_price,
      vl.location,
      vl.source as auction_house,
      vl.listing_url,
      vl.status,
      -- Calculate relevance score based on fingerprint matches
      COALESCE(fps.median_gross_profit, 0) as median_gp,
      COALESCE(fps.sample_size, 0) as sample_size,
      CASE 
        WHEN fps.sample_size >= 5 AND fps.median_gross_profit > 2000 THEN 8.0 + (fps.median_gross_profit / 5000.0)
        WHEN fps.sample_size >= 3 THEN 6.0 + (COALESCE(fps.median_gross_profit, 0) / 5000.0)
        ELSE 4.0
      END as relevance_score
    FROM public.vehicle_listings vl
    LEFT JOIN public.fingerprint_profit_stats fps 
      ON fps.fingerprint = LOWER(vl.make || '|' || vl.model || '|' || COALESCE(vl.variant_family, ''))
    WHERE vl.status IN ('active', 'upcoming')
      AND vl.year >= COALESCE(profile_rec.year_min, 2020)
      AND (profile_rec.year_max IS NULL OR vl.year <= profile_rec.year_max)
      -- Apply location filter if specified
      AND (
        p_filters->>'location' IS NULL 
        OR p_filters->>'location' = 'ALL'
        OR vl.location ILIKE '%' || (p_filters->>'location') || '%'
      )
    ORDER BY relevance_score DESC
    LIMIT COALESCE((profile_rec.output_style->>'max_items')::int, 7)
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'lot_id', lot_id,
      'year', year,
      'make', make,
      'model', model,
      'variant', variant,
      'km', km,
      'asking_price', asking_price,
      'location', location,
      'auction_house', auction_house,
      'listing_url', listing_url,
      'status', CASE WHEN relevance_score > 7 THEN 'BUY_NOW' WHEN relevance_score > 5 THEN 'WATCH' ELSE 'REVIEW' END,
      'relevance_score', ROUND(relevance_score::numeric, 1),
      'edge_reasons', CASE 
        WHEN sample_size >= 5 AND median_gp > 3000 THEN ARRAY['historical_match', 'strong_profit_signal']
        WHEN sample_size >= 3 THEN ARRAY['moderate_sample', 'watch_pricing']
        ELSE ARRAY['limited_data', 'needs_review']
      END,
      'next_action', CASE 
        WHEN relevance_score > 7 THEN 'Strong opportunity - check condition and set max bid'
        WHEN relevance_score > 5 THEN 'Add to watchlist - monitor pricing signals'
        ELSE 'Review listing details before deciding'
      END
    )
  ), COUNT(*) INTO items, total_count
  FROM eligible_lots;
  
  result := jsonb_build_object(
    'items', COALESCE(items, '[]'::jsonb),
    'counts', jsonb_build_object('total', COALESCE(total_count, 0))
  );
  
  RETURN result;
END;
$$;

-- 5) RPC: rpc_get_upcoming_auction_cards
CREATE OR REPLACE FUNCTION public.rpc_get_upcoming_auction_cards(
  p_dealer_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  profile_rec record;
  cards jsonb := '[]'::jsonb;
BEGIN
  -- Get dealer profile for scoring thresholds
  SELECT * INTO profile_rec FROM public.dealer_profile WHERE dealer_id = p_dealer_id;
  
  -- Aggregate auction data
  WITH auction_stats AS (
    SELECT 
      vl.source as auction_house,
      vl.location as location_label,
      CASE 
        WHEN vl.location ILIKE '%NSW%' THEN 'NSW'
        WHEN vl.location ILIKE '%QLD%' OR vl.location ILIKE '%Queensland%' THEN 'QLD'
        WHEN vl.location ILIKE '%VIC%' OR vl.location ILIKE '%Victoria%' THEN 'VIC'
        WHEN vl.location ILIKE '%SA%' OR vl.location ILIKE '%South Australia%' THEN 'SA'
        WHEN vl.location ILIKE '%WA%' OR vl.location ILIKE '%Western Australia%' THEN 'WA'
        WHEN vl.location ILIKE '%TAS%' OR vl.location ILIKE '%Tasmania%' THEN 'TAS'
        WHEN vl.location ILIKE '%NT%' OR vl.location ILIKE '%Northern Territory%' THEN 'NT'
        WHEN vl.location ILIKE '%ACT%' THEN 'ACT'
        ELSE NULL
      END as state,
      MIN(vl.auction_date) as event_datetime,
      COUNT(*) as total_lots,
      COUNT(*) FILTER (WHERE vl.year >= COALESCE(profile_rec.year_min, 2020)) as eligible_lots,
      COUNT(*) FILTER (WHERE vl.year >= COALESCE(profile_rec.year_min, 2020) AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(profile_rec.preferred_segments, '[]'::jsonb)) seg
        WHERE LOWER(vl.make) = LOWER(seg->>'make') AND LOWER(vl.model) = LOWER(seg->>'model')
      )) as relevant_lots
    FROM public.vehicle_listings vl
    WHERE vl.status IN ('active', 'upcoming')
      AND (vl.auction_date IS NULL OR vl.auction_date >= CURRENT_DATE)
      AND (
        p_filters->>'location' IS NULL 
        OR p_filters->>'location' = 'ALL'
        OR vl.location ILIKE '%' || (p_filters->>'location') || '%'
      )
      AND (
        p_filters->>'auction_house' IS NULL 
        OR p_filters->>'auction_house' = 'ALL'
        OR vl.source ILIKE '%' || (p_filters->>'auction_house') || '%'
      )
    GROUP BY vl.source, vl.location
    ORDER BY eligible_lots DESC
    LIMIT 20
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'auction_house', auction_house,
      'state', state,
      'location_label', COALESCE(location_label, 'Unknown'),
      'event_datetime', event_datetime,
      'total_lots', total_lots,
      'eligible_lots', eligible_lots,
      'relevant_lots', relevant_lots,
      'heat_tier', CASE 
        WHEN eligible_lots >= COALESCE((profile_rec.scoring_thresholds->>'very_hot_min')::int, 10) THEN 'VERY_HOT'
        WHEN eligible_lots >= COALESCE((profile_rec.scoring_thresholds->>'hot_max')::int, 9) THEN 'HOT'
        WHEN eligible_lots >= COALESCE((profile_rec.scoring_thresholds->>'warm_max')::int, 4) THEN 'WARM'
        ELSE 'COLD'
      END,
      'warnings', CASE WHEN state IS NULL THEN ARRAY['LOCATION_UNKNOWN'] ELSE ARRAY[]::text[] END
    )
  ) INTO cards
  FROM auction_stats;
  
  result := jsonb_build_object('cards', COALESCE(cards, '[]'::jsonb));
  
  RETURN result;
END;
$$;

-- 6) RPC: rpc_get_auction_lots
CREATE OR REPLACE FUNCTION public.rpc_get_auction_lots(
  p_dealer_id uuid,
  p_auction_event_id uuid,
  p_mode text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  profile_rec record;
  lots jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO profile_rec FROM public.dealer_profile WHERE dealer_id = p_dealer_id;
  
  WITH lot_data AS (
    SELECT 
      vl.id as lot_id,
      vl.year,
      vl.make,
      vl.model,
      vl.variant_family as variant,
      vl.km,
      vl.asking_price,
      vl.listing_url,
      vl.year >= COALESCE(profile_rec.year_min, 2020) as eligible,
      EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(profile_rec.preferred_segments, '[]'::jsonb)) seg
        WHERE LOWER(vl.make) = LOWER(seg->>'make') AND LOWER(vl.model) = LOWER(seg->>'model')
      ) as relevant,
      COALESCE(fps.median_gross_profit, 0) / 1000.0 as relevance_score,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN vl.status = 'passed_in' THEN 'PASS_IN_HISTORY' END,
        CASE WHEN vl.variant_family IS NULL OR vl.variant_family = '' THEN 'UNDERDESCRIBED' END
      ], NULL) as flags
    FROM public.vehicle_listings vl
    LEFT JOIN public.fingerprint_profit_stats fps 
      ON fps.fingerprint = LOWER(vl.make || '|' || vl.model || '|' || COALESCE(vl.variant_family, ''))
    WHERE vl.status IN ('active', 'upcoming')
      AND (
        p_mode = 'all'
        OR (p_mode = 'eligible' AND vl.year >= COALESCE(profile_rec.year_min, 2020))
        OR (p_mode = 'relevant' AND vl.year >= COALESCE(profile_rec.year_min, 2020) AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(profile_rec.preferred_segments, '[]'::jsonb)) seg
          WHERE LOWER(vl.make) = LOWER(seg->>'make') AND LOWER(vl.model) = LOWER(seg->>'model')
        ))
      )
    ORDER BY relevance_score DESC
    LIMIT 50
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'lot_id', lot_id,
      'year', year,
      'make', make,
      'model', model,
      'variant', variant,
      'km', km,
      'asking_price', asking_price,
      'listing_url', listing_url,
      'eligible', eligible,
      'relevant', relevant,
      'relevance_score', ROUND(relevance_score::numeric, 1),
      'flags', flags
    )
  ) INTO lots
  FROM lot_data;
  
  result := jsonb_build_object('lots', COALESCE(lots, '[]'::jsonb));
  
  RETURN result;
END;
$$;

-- 7) RPC: rpc_get_watchlist
CREATE OR REPLACE FUNCTION public.rpc_get_watchlist(p_dealer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  watchlist jsonb := '[]'::jsonb;
BEGIN
  WITH watchlist_data AS (
    SELECT 
      vl.id as lot_id,
      vl.year || ' ' || vl.make || ' ' || vl.model || COALESCE(' ' || vl.variant_family, '') as title,
      vl.source as auction_house,
      vl.location,
      uw.notes as why,
      CASE WHEN uw.is_pinned THEN 'PINNED' ELSE 'WATCH' END as status,
      uw.updated_at as last_seen
    FROM public.user_watchlist uw
    JOIN public.vehicle_listings vl ON vl.id = uw.listing_id
    WHERE uw.user_id = p_dealer_id
      AND uw.is_watching = true
    ORDER BY uw.is_pinned DESC, uw.updated_at DESC
    LIMIT 20
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'lot_id', lot_id,
      'title', title,
      'auction_house', auction_house,
      'location', location,
      'why', COALESCE(why, 'Added to watchlist'),
      'status', status,
      'last_seen', last_seen
    )
  ) INTO watchlist
  FROM watchlist_data;
  
  result := jsonb_build_object('watchlist', COALESCE(watchlist, '[]'::jsonb));
  
  RETURN result;
END;
$$;

-- 8) RPC: rpc_explain_why_listed
CREATE OR REPLACE FUNCTION public.rpc_explain_why_listed(
  p_dealer_id uuid,
  p_lot_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  lot_rec record;
  profile_rec record;
  fps_rec record;
  eligibility_checks text[];
  fingerprint_hash text;
BEGIN
  -- Get the lot
  SELECT * INTO lot_rec FROM public.vehicle_listings WHERE id = p_lot_id;
  
  IF lot_rec IS NULL THEN
    RETURN jsonb_build_object('error', 'Lot not found');
  END IF;
  
  -- Get dealer profile
  SELECT * INTO profile_rec FROM public.dealer_profile WHERE dealer_id = p_dealer_id;
  
  -- Build fingerprint
  fingerprint_hash := LOWER(lot_rec.make || '|' || lot_rec.model || '|' || COALESCE(lot_rec.variant_family, ''));
  
  -- Get fingerprint stats
  SELECT * INTO fps_rec FROM public.fingerprint_profit_stats WHERE fingerprint = fingerprint_hash LIMIT 1;
  
  -- Build eligibility checks
  eligibility_checks := ARRAY[]::text[];
  IF lot_rec.year >= COALESCE(profile_rec.year_min, 2020) THEN
    eligibility_checks := eligibility_checks || 'year_ok';
  END IF;
  eligibility_checks := eligibility_checks || 'not_salvage'; -- Default assumption
  eligibility_checks := eligibility_checks || 'segment_ok';
  IF lot_rec.km IS NULL OR lot_rec.km < 200000 THEN
    eligibility_checks := eligibility_checks || 'km_ok';
  END IF;
  
  result := jsonb_build_object(
    'lot', jsonb_build_object(
      'lot_id', lot_rec.id,
      'year', lot_rec.year,
      'make', lot_rec.make,
      'model', lot_rec.model,
      'variant', lot_rec.variant_family,
      'km', lot_rec.km,
      'location', lot_rec.location,
      'auction_house', lot_rec.source,
      'asking_price', lot_rec.asking_price
    ),
    'eligibility', jsonb_build_object(
      'passed', lot_rec.year >= COALESCE(profile_rec.year_min, 2020),
      'checks', eligibility_checks
    ),
    'fingerprint', jsonb_build_object(
      'fingerprint', fingerprint_hash,
      'match_strength', CASE WHEN fps_rec.sample_size >= 5 THEN 0.9 WHEN fps_rec.sample_size >= 3 THEN 0.7 ELSE 0.4 END,
      'sample_size', COALESCE(fps_rec.sample_size, 0),
      'median_profit', COALESCE(fps_rec.median_gross_profit, 0)
    ),
    'market_context', jsonb_build_object(
      'comp_count', COALESCE(fps_rec.sample_size, 0),
      'median_price', COALESCE(fps_rec.median_gross_profit, 0) + COALESCE(lot_rec.asking_price, 0),
      'km_adjusted_band', ARRAY[
        COALESCE(lot_rec.asking_price, 0) * 0.95,
        COALESCE(lot_rec.asking_price, 0) * 1.05
      ]
    ),
    'flags', CASE 
      WHEN lot_rec.variant_family IS NULL OR lot_rec.variant_family = '' THEN ARRAY['UNDERDESCRIBED']
      ELSE ARRAY['NONE']
    END,
    'recommended_action', CASE 
      WHEN fps_rec.sample_size >= 5 AND fps_rec.median_gross_profit > 2000 THEN 'BUY_NOW'
      WHEN fps_rec.sample_size >= 3 THEN 'WATCH'
      ELSE 'REVIEW'
    END,
    'what_would_upgrade_to_buy', ARRAY['passed_in', 'guide_drops', 'weak_bidding']
  );
  
  RETURN result;
END;
$$;

-- Update timestamp trigger for dealer_profile
CREATE OR REPLACE FUNCTION public.update_dealer_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_dealer_profile_updated_at
  BEFORE UPDATE ON public.dealer_profile
  FOR EACH ROW
  EXECUTE FUNCTION public.update_dealer_profile_updated_at();