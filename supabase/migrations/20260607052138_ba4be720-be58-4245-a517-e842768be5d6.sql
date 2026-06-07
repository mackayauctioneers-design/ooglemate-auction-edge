
-- 1. Evaluate a single listing against a dealer
CREATE OR REPLACE FUNCTION public.evaluate_listing_for_dealer(
  p_listing_id uuid,
  p_account_id uuid,
  p_dealer_id text
)
RETURNS TABLE (
  queued boolean,
  tier integer,
  confidence_score integer,
  max_bid integer,
  est_gp integer,
  reason text
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_listing record;
  v_fp record;
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
  -- Guard: sales_fingerprints_v1 not yet deployed
  IF to_regclass('public.sales_fingerprints_v1') IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, 0, 0, 'sales_fingerprints_v1 not deployed yet'::text;
    RETURN;
  END IF;

  SELECT * INTO v_listing FROM public.vehicle_listings WHERE id = p_listing_id;
  IF v_listing IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, 0, 0, 'Listing not found'::text;
    RETURN;
  END IF;

  -- Load fingerprint (dynamic to avoid parse-time failure before table exists)
  EXECUTE format($q$
    SELECT * FROM public.sales_fingerprints_v1
    WHERE account_id = %L
      AND make  = UPPER(%L)
      AND model = UPPER(%L)
    LIMIT 1
  $q$, p_account_id, COALESCE(v_listing.make, ''), COALESCE(v_listing.model, ''))
  INTO v_fp;

  IF v_fp IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, 0, 0, 'No fingerprint for this make/model'::text;
    RETURN;
  END IF;

  SELECT * INTO v_confidence FROM public.calculate_composite_confidence(
    p_account_id, v_listing.make, v_listing.model, v_listing.year, v_listing.km);
  SELECT * INTO v_vel    FROM public.calculate_velocity_score(p_account_id, v_listing.make, v_listing.model);
  SELECT * INTO v_margin FROM public.calculate_margin_trend(p_account_id, v_listing.make, v_listing.model);
  SELECT * INTO v_season FROM public.calculate_seasonal_multiplier(p_account_id, v_listing.make, v_listing.model);
  SELECT * INTO v_demand FROM public.calculate_buyer_demand_score(p_account_id, v_listing.make, v_listing.model);

  v_max_bid := COALESCE((v_fp).rebased_buy_anchor, (v_fp).historical_buy_median, 0)::integer;
  IF v_margin.trend_pct < -10 THEN
    v_max_bid := ROUND(v_max_bid * 0.9)::integer;
  ELSIF v_margin.trend_pct > 10 THEN
    v_max_bid := ROUND(v_max_bid * 1.05)::integer;
  END IF;

  v_est_gp := COALESCE((v_fp).rebased_sell_price, (v_fp).historical_sell_median, 0)::integer - v_max_bid;
  v_est_hold := COALESCE(v_vel.median_hold_days, 45)::integer;

  v_proof := jsonb_build_object(
    'units_sold', v_vel.units_sold,
    'avg_gp', ROUND(COALESCE((v_fp).raw_profit_avg, 0))::integer,
    'median_hold', v_est_hold,
    'velocity_score', v_vel.velocity_score,
    'velocity_label', v_vel.velocity_label,
    'buyer_demand', v_demand.demand_label,
    'retail_pct', v_demand.retail_pct,
    'margin_trend', v_margin.trend_label,
    'margin_trend_pct', v_margin.trend_pct,
    'seasonal_multiplier', v_season.seasonal_multiplier,
    'peak_month', v_season.peak_month,
    'fingerprint_status', (v_fp).fingerprint_status,
    'sales_count', (v_fp).sales_count,
    'last_sale_months_ago', (v_fp).newest_sale_months_ago
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
$$;

-- 2. Trigger function on vehicle_listings
CREATE OR REPLACE FUNCTION public.trg_new_listing_to_wholesale_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_dealer record;
  v_result record;
  v_queued_count integer := 0;
BEGIN
  IF NEW.status NOT IN ('listed', 'catalogue') THEN
    RETURN NEW;
  END IF;

  -- Short-circuit before fingerprints table exists to avoid heavy per-insert work
  IF to_regclass('public.sales_fingerprints_v1') IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_dealer IN
    SELECT dp.account_id, dp.dealer_name
    FROM public.dealer_profiles dp
    WHERE dp.account_id IS NOT NULL
  LOOP
    BEGIN
      SELECT * INTO v_result FROM public.evaluate_listing_for_dealer(
        NEW.id, v_dealer.account_id, v_dealer.dealer_name);
      IF v_result.queued THEN
        v_queued_count := v_queued_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Never break ingestion on a per-dealer error
      RAISE WARNING '[trg_new_listing] dealer % failed: %', v_dealer.dealer_name, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '[trg_new_listing] Listing % evaluated, % queued', NEW.id, v_queued_count;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_new_listing_wholesale ON public.vehicle_listings;
CREATE TRIGGER trg_new_listing_wholesale
  AFTER INSERT ON public.vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_new_listing_to_wholesale_queue();

-- 3. Backfill helper
CREATE OR REPLACE FUNCTION public.backfill_wholesale_queue(
  p_account_id uuid,
  p_dealer_id text,
  p_max_listings integer DEFAULT 500
)
RETURNS TABLE (
  listings_evaluated integer,
  queued integer,
  skipped integer
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_listing record;
  v_result record;
  v_queued integer := 0;
  v_skipped integer := 0;
BEGIN
  FOR v_listing IN
    SELECT id FROM public.vehicle_listings
    WHERE status IN ('listed', 'catalogue')
    ORDER BY last_seen_at DESC NULLS LAST
    LIMIT p_max_listings
  LOOP
    SELECT * INTO v_result FROM public.evaluate_listing_for_dealer(
      v_listing.id, p_account_id, p_dealer_id);
    IF v_result.queued THEN
      v_queued := v_queued + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT p_max_listings, v_queued, v_skipped;
END;
$$;
