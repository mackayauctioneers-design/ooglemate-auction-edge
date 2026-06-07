CREATE OR REPLACE FUNCTION public.evaluate_listing_for_dealer(p_listing_id uuid, p_account_id uuid, p_dealer_id text)
 RETURNS TABLE(queued boolean, tier integer, confidence_score integer, max_bid integer, est_gp integer, reason text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_listing record;
  v_fp public.sales_fingerprints_v1%ROWTYPE;
  v_fp_found boolean := false;
  v_confidence record;
  v_vel record;
  v_margin record;
  v_season record;
  v_demand record;
  v_max_bid integer;
  v_est_gp integer;
  v_est_hold integer;
  v_dedup_key text;
  v_proof jsonb;
  v_flags text[];
BEGIN
  IF to_regclass('public.sales_fingerprints_v1') IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, 0, 0, 'sales_fingerprints_v1 not deployed yet'::text;
    RETURN;
  END IF;

  SELECT * INTO v_listing FROM public.vehicle_listings WHERE id = p_listing_id;
  IF v_listing IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, 0, 0, 'Listing not found'::text;
    RETURN;
  END IF;

  SELECT * INTO v_fp
  FROM public.sales_fingerprints_v1
  WHERE account_id = p_account_id
    AND make  = UPPER(COALESCE(v_listing.make, ''))
    AND model = UPPER(COALESCE(v_listing.model, ''))
  LIMIT 1;
  v_fp_found := FOUND;

  IF NOT v_fp_found THEN
    RETURN QUERY SELECT false, 0, 0, 0, 0, 'No fingerprint for this make/model'::text;
    RETURN;
  END IF;

  SELECT * INTO v_confidence FROM public.calculate_composite_confidence(
    p_account_id, v_listing.make, v_listing.model, v_listing.year, v_listing.km);
  SELECT * INTO v_vel    FROM public.calculate_velocity_score(p_account_id, v_listing.make, v_listing.model);
  SELECT * INTO v_margin FROM public.calculate_margin_trend(p_account_id, v_listing.make, v_listing.model);
  SELECT * INTO v_season FROM public.calculate_seasonal_multiplier(p_account_id, v_listing.make, v_listing.model);
  SELECT * INTO v_demand FROM public.calculate_buyer_demand_score(p_account_id, v_listing.make, v_listing.model);

  v_max_bid := COALESCE(v_fp.rebased_buy_anchor, v_fp.historical_buy_median, 0)::integer;
  IF v_margin.trend_pct < -10 THEN
    v_max_bid := ROUND(v_max_bid * 0.9)::integer;
  ELSIF v_margin.trend_pct > 10 THEN
    v_max_bid := ROUND(v_max_bid * 1.05)::integer;
  END IF;

  v_est_gp := COALESCE(v_fp.rebased_sell_price, v_fp.historical_sell_median, 0)::integer - v_max_bid;
  v_est_hold := COALESCE(v_vel.median_hold_days, 45)::integer;

  v_proof := jsonb_build_object(
    'units_sold', v_vel.units_sold,
    'avg_gp', ROUND(COALESCE(v_fp.raw_profit_avg, 0))::integer,
    'median_hold', v_est_hold,
    'velocity_score', v_vel.velocity_score,
    'velocity_label', v_vel.velocity_label,
    'buyer_demand', v_demand.demand_label,
    'retail_pct', v_demand.retail_pct,
    'margin_trend', v_margin.trend_label,
    'margin_trend_pct', v_margin.trend_pct,
    'seasonal_multiplier', v_season.seasonal_multiplier,
    'peak_month', v_season.peak_month,
    'fingerprint_status', v_fp.fingerprint_status,
    'sales_count', v_fp.sales_count,
    'last_sale_months_ago', v_fp.newest_sale_months_ago
  );

  v_flags := v_confidence.pattern_flags;
  v_dedup_key := format('%s-%s-%s-%s', p_dealer_id, p_listing_id, v_listing.make, v_listing.model);

  IF v_confidence.confidence_score < 40 AND v_confidence.tier > 3 THEN
    RETURN QUERY SELECT false, v_confidence.tier, v_confidence.confidence_score, v_max_bid, v_est_gp,
      format('Below threshold: confidence=%s, tier=%s', v_confidence.confidence_score, v_confidence.tier);
    RETURN;
  END IF;

  IF v_est_gp < 500 THEN
    RETURN QUERY SELECT false, v_confidence.tier, v_confidence.confidence_score, v_max_bid, v_est_gp,
      format('GP too low: $%s < $500 min', v_est_gp);
    RETURN;
  END IF;

  INSERT INTO public.wholesale_manager_queue (
    listing_id, dealer_id, account_id,
    tier, status,
    max_bid, est_gp, est_hold_days, confidence_score,
    historical_proof, pattern_flags,
    make, model, variant, year, km, asking_price,
    listing_url, source_searched,
    assigned_manager, dedup_key
  ) VALUES (
    p_listing_id, p_dealer_id, p_account_id,
    v_confidence.tier,
    CASE WHEN v_confidence.tier = 1 THEN 'approved' ELSE 'pending' END,
    v_max_bid, v_est_gp, v_est_hold, v_confidence.confidence_score,
    v_proof, v_flags,
    v_listing.make, v_listing.model, v_listing.variant_raw, v_listing.year, v_listing.km,
    v_listing.asking_price,
    v_listing.listing_url, v_listing.source,
    'hermes', v_dedup_key
  )
  ON CONFLICT (dedup_key) DO NOTHING;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_confidence.tier, v_confidence.confidence_score, v_max_bid, v_est_gp,
      format('Queued: tier=%s, confidence=%s, gp=$%s', v_confidence.tier, v_confidence.confidence_score, v_est_gp);
  ELSE
    RETURN QUERY SELECT false, v_confidence.tier, v_confidence.confidence_score, v_max_bid, v_est_gp,
      'Duplicate (already in queue)'::text;
  END IF;
END;
$function$;

REFRESH MATERIALIZED VIEW public.sales_fingerprints_v1;