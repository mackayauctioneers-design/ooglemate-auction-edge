-- RPC to get home dashboard data: opportunities, kiting activity, and watchlist movement
CREATE OR REPLACE FUNCTION public.get_home_dashboard(p_dealer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  opportunities jsonb;
  kiting_live jsonb;
  watchlist_movement jsonb;
  active_hunt_count int;
  scans_last_60m int;
  candidates_today int;
  last_scan_record record;
BEGIN
  -- 1. Today's opportunities from hunt_alerts (last 48h)
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY 
    CASE WHEN t.severity = 'BUY' THEN 0 ELSE 1 END,
    t.gap_pct DESC NULLS LAST,
    t.created_at DESC
  ), '[]'::jsonb)
  INTO opportunities
  FROM (
    SELECT 
      'HUNT' as type,
      ha.severity,
      sh.year,
      sh.make,
      sh.model,
      (ha.payload->>'km')::int as km,
      (ha.payload->>'asking_price')::numeric as asking_price,
      sh.proven_exit_value,
      (ha.payload->>'gap_dollars')::numeric as gap_dollars,
      (ha.payload->>'gap_pct')::numeric as gap_pct,
      COALESCE(ha.payload->>'confidence', 'medium') as confidence,
      ha.payload->>'source' as source,
      ha.payload->>'listing_url' as url,
      ha.payload->'why' as why,
      ha.created_at,
      ha.id as alert_id,
      sh.id as hunt_id
    FROM hunt_alerts ha
    JOIN sale_hunts sh ON sh.id = ha.hunt_id
    WHERE sh.dealer_id = p_dealer_id
      AND ha.created_at >= NOW() - INTERVAL '48 hours'
      AND ha.severity IN ('BUY', 'WATCH')
    LIMIT 50
  ) t;

  -- 2. Kiting Live stats
  -- Active hunts count
  SELECT COUNT(*) INTO active_hunt_count
  FROM sale_hunts
  WHERE dealer_id = p_dealer_id
    AND status = 'active';

  -- Scans last 60 minutes
  SELECT COUNT(*) INTO scans_last_60m
  FROM hunt_scans hs
  JOIN sale_hunts sh ON sh.id = hs.hunt_id
  WHERE sh.dealer_id = p_dealer_id
    AND hs.started_at >= NOW() - INTERVAL '60 minutes';

  -- Candidates evaluated today
  SELECT COALESCE(SUM(hs.candidates_found), 0)::int INTO candidates_today
  FROM hunt_scans hs
  JOIN sale_hunts sh ON sh.id = hs.hunt_id
  WHERE sh.dealer_id = p_dealer_id
    AND hs.started_at >= CURRENT_DATE;

  -- Last scan info
  SELECT hs.started_at, hs.status = 'completed' as ok, hs.scan_type
  INTO last_scan_record
  FROM hunt_scans hs
  JOIN sale_hunts sh ON sh.id = hs.hunt_id
  WHERE sh.dealer_id = p_dealer_id
  ORDER BY hs.started_at DESC
  LIMIT 1;

  kiting_live := jsonb_build_object(
    'active_hunts', active_hunt_count,
    'scans_last_60m', scans_last_60m,
    'candidates_today', candidates_today,
    'last_scan_at', last_scan_record.started_at,
    'last_scan_ok', COALESCE(last_scan_record.ok, false),
    'sources', ARRAY['autotrader', 'drive', 'gumtree_dealer', 'pickles']
  );

  -- 3. Watchlist movement - recent WATCH items with staleness detection
  SELECT COALESCE(jsonb_agg(row_to_json(w) ORDER BY w.last_seen_at DESC NULLS LAST), '[]'::jsonb)
  INTO watchlist_movement
  FROM (
    SELECT 
      ha.id as listing_id,
      sh.year || ' ' || sh.make || ' ' || sh.model as title,
      ha.payload->>'source' as source,
      ha.created_at as last_seen_at,
      EXTRACT(DAY FROM NOW() - ha.created_at)::int as age_days,
      0 as price_change_count_14d,
      ha.created_at as last_price_change_at,
      CASE 
        WHEN ha.created_at < NOW() - INTERVAL '7 days' THEN 'STALE'
        ELSE 'WATCH'
      END as status,
      (ha.payload->>'gap_pct')::numeric as gap_pct,
      (ha.payload->>'asking_price')::numeric as asking_price
    FROM hunt_alerts ha
    JOIN sale_hunts sh ON sh.id = ha.hunt_id
    WHERE sh.dealer_id = p_dealer_id
      AND ha.severity = 'WATCH'
      AND ha.acknowledged_at IS NULL
    ORDER BY ha.created_at DESC
    LIMIT 20
  ) w;

  -- Combine all results
  result := jsonb_build_object(
    'today_opportunities', opportunities,
    'kiting_live', kiting_live,
    'watchlist_movement', watchlist_movement
  );

  RETURN result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_home_dashboard(uuid) TO authenticated;