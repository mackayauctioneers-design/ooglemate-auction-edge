
CREATE OR REPLACE FUNCTION public.upsert_operator_opportunity_guarded(p_row jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing_id text;
  v_existing_status text;
  v_dismissed uuid[];
  v_new_anchor uuid;
BEGIN
  v_listing_id := p_row->>'listing_id';
  
  -- Check if listing already exists in a terminal state
  SELECT status, COALESCE(dismissed_anchor_ids, '{}') 
  INTO v_existing_status, v_dismissed
  FROM operator_opportunities
  WHERE listing_id = v_listing_id;
  
  IF v_existing_status IS NOT NULL AND v_existing_status IN ('ignored', 'expired', 'lost', 'won', 'archived') THEN
    RETURN 'skipped_terminal';
  END IF;

  -- Check if the incoming anchor has been dismissed
  v_new_anchor := CASE WHEN p_row->>'anchor_sale_id' IS NOT NULL THEN (p_row->>'anchor_sale_id')::uuid ELSE NULL END;
  
  -- If the incoming anchor is in the dismissed list, null it out
  IF v_new_anchor IS NOT NULL AND v_dismissed IS NOT NULL AND v_new_anchor = ANY(v_dismissed) THEN
    -- Set anchor fields to null since this anchor was dismissed
    INSERT INTO operator_opportunities (
      listing_id, listing_source, source_url,
      make, model, variant, platform_class, trim_class, drivetrain_bucket,
      year, km, asking_price,
      best_account_id, best_account_name, best_expected_margin, best_under_buy,
      anchor_sale_id, anchor_sale_buy_price, anchor_sale_sell_price, anchor_sale_profit,
      anchor_sale_sold_at, anchor_sale_km, anchor_sale_trim_class,
      alt_matches, tier, days_listed, freshness, pass_count, motivation_signal,
      auction_house, auction_datetime, auction_status, auction_target_price,
      retail_median, retail_median_confidence, retail_median_sample,
      retail_median_p25, retail_median_p75, retail_vs_ask_pct,
      status, updated_at
    )
    VALUES (
      v_listing_id,
      p_row->>'listing_source', p_row->>'source_url',
      p_row->>'make', p_row->>'model', p_row->>'variant',
      p_row->>'platform_class', p_row->>'trim_class', p_row->>'drivetrain_bucket',
      (p_row->>'year')::int, (p_row->>'km')::int, (p_row->>'asking_price')::numeric,
      (p_row->>'best_account_id')::uuid, p_row->>'best_account_name',
      (p_row->>'best_expected_margin')::numeric, (p_row->>'best_under_buy')::numeric,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      COALESCE(p_row->'alt_matches', '[]'::jsonb), p_row->>'tier',
      (p_row->>'days_listed')::int, p_row->>'freshness',
      (p_row->>'pass_count')::int, p_row->>'motivation_signal',
      p_row->>'auction_house',
      CASE WHEN p_row->>'auction_datetime' IS NOT NULL THEN (p_row->>'auction_datetime')::timestamptz ELSE NULL END,
      p_row->>'auction_status',
      (p_row->>'auction_target_price')::numeric,
      (p_row->>'retail_median')::int, p_row->>'retail_median_confidence',
      (p_row->>'retail_median_sample')::int,
      (p_row->>'retail_median_p25')::int, (p_row->>'retail_median_p75')::int,
      (p_row->>'retail_vs_ask_pct')::numeric,
      COALESCE(p_row->>'status', 'new'), now()
    )
    ON CONFLICT (listing_id) DO UPDATE SET
      listing_source = EXCLUDED.listing_source,
      source_url = EXCLUDED.source_url,
      make = EXCLUDED.make, model = EXCLUDED.model, variant = EXCLUDED.variant,
      platform_class = EXCLUDED.platform_class, trim_class = EXCLUDED.trim_class,
      drivetrain_bucket = EXCLUDED.drivetrain_bucket,
      year = EXCLUDED.year, km = EXCLUDED.km, asking_price = EXCLUDED.asking_price,
      best_account_id = EXCLUDED.best_account_id, best_account_name = EXCLUDED.best_account_name,
      best_expected_margin = EXCLUDED.best_expected_margin, best_under_buy = EXCLUDED.best_under_buy,
      -- Do NOT overwrite anchor fields — they stay null because anchor was dismissed
      alt_matches = EXCLUDED.alt_matches, tier = EXCLUDED.tier,
      days_listed = EXCLUDED.days_listed, freshness = EXCLUDED.freshness,
      pass_count = EXCLUDED.pass_count, motivation_signal = EXCLUDED.motivation_signal,
      auction_house = EXCLUDED.auction_house, auction_datetime = EXCLUDED.auction_datetime,
      auction_status = EXCLUDED.auction_status, auction_target_price = EXCLUDED.auction_target_price,
      retail_median = EXCLUDED.retail_median, retail_median_confidence = EXCLUDED.retail_median_confidence,
      retail_median_sample = EXCLUDED.retail_median_sample,
      retail_median_p25 = EXCLUDED.retail_median_p25, retail_median_p75 = EXCLUDED.retail_median_p75,
      retail_vs_ask_pct = EXCLUDED.retail_vs_ask_pct,
      updated_at = now()
    WHERE operator_opportunities.status IN ('new', 'assigned', 'reviewed');
    
    IF NOT FOUND THEN
      RETURN 'skipped_terminal';
    END IF;
    RETURN 'upserted';
  END IF;
  
  -- Normal upsert (anchor not dismissed)
  INSERT INTO operator_opportunities (
    listing_id, listing_source, source_url,
    make, model, variant, platform_class, trim_class, drivetrain_bucket,
    year, km, asking_price,
    best_account_id, best_account_name, best_expected_margin, best_under_buy,
    anchor_sale_id, anchor_sale_buy_price, anchor_sale_sell_price, anchor_sale_profit,
    anchor_sale_sold_at, anchor_sale_km, anchor_sale_trim_class,
    alt_matches, tier, days_listed, freshness, pass_count, motivation_signal,
    auction_house, auction_datetime, auction_status, auction_target_price,
    retail_median, retail_median_confidence, retail_median_sample,
    retail_median_p25, retail_median_p75, retail_vs_ask_pct,
    status, updated_at
  )
  VALUES (
    v_listing_id,
    p_row->>'listing_source', p_row->>'source_url',
    p_row->>'make', p_row->>'model', p_row->>'variant',
    p_row->>'platform_class', p_row->>'trim_class', p_row->>'drivetrain_bucket',
    (p_row->>'year')::int, (p_row->>'km')::int, (p_row->>'asking_price')::numeric,
    (p_row->>'best_account_id')::uuid, p_row->>'best_account_name',
    (p_row->>'best_expected_margin')::numeric, (p_row->>'best_under_buy')::numeric,
    v_new_anchor,
    (p_row->>'anchor_sale_buy_price')::numeric, (p_row->>'anchor_sale_sell_price')::numeric,
    (p_row->>'anchor_sale_profit')::numeric,
    CASE WHEN p_row->>'anchor_sale_sold_at' IS NOT NULL THEN (p_row->>'anchor_sale_sold_at')::timestamptz ELSE NULL END,
    (p_row->>'anchor_sale_km')::int, p_row->>'anchor_sale_trim_class',
    COALESCE(p_row->'alt_matches', '[]'::jsonb), p_row->>'tier',
    (p_row->>'days_listed')::int, p_row->>'freshness',
    (p_row->>'pass_count')::int, p_row->>'motivation_signal',
    p_row->>'auction_house',
    CASE WHEN p_row->>'auction_datetime' IS NOT NULL THEN (p_row->>'auction_datetime')::timestamptz ELSE NULL END,
    p_row->>'auction_status',
    (p_row->>'auction_target_price')::numeric,
    (p_row->>'retail_median')::int, p_row->>'retail_median_confidence',
    (p_row->>'retail_median_sample')::int,
    (p_row->>'retail_median_p25')::int, (p_row->>'retail_median_p75')::int,
    (p_row->>'retail_vs_ask_pct')::numeric,
    COALESCE(p_row->>'status', 'new'), now()
  )
  ON CONFLICT (listing_id) DO UPDATE SET
    listing_source = EXCLUDED.listing_source,
    source_url = EXCLUDED.source_url,
    make = EXCLUDED.make, model = EXCLUDED.model, variant = EXCLUDED.variant,
    platform_class = EXCLUDED.platform_class, trim_class = EXCLUDED.trim_class,
    drivetrain_bucket = EXCLUDED.drivetrain_bucket,
    year = EXCLUDED.year, km = EXCLUDED.km, asking_price = EXCLUDED.asking_price,
    best_account_id = EXCLUDED.best_account_id, best_account_name = EXCLUDED.best_account_name,
    best_expected_margin = EXCLUDED.best_expected_margin, best_under_buy = EXCLUDED.best_under_buy,
    anchor_sale_id = EXCLUDED.anchor_sale_id,
    anchor_sale_buy_price = EXCLUDED.anchor_sale_buy_price,
    anchor_sale_sell_price = EXCLUDED.anchor_sale_sell_price,
    anchor_sale_profit = EXCLUDED.anchor_sale_profit,
    anchor_sale_sold_at = EXCLUDED.anchor_sale_sold_at,
    anchor_sale_km = EXCLUDED.anchor_sale_km,
    anchor_sale_trim_class = EXCLUDED.anchor_sale_trim_class,
    alt_matches = EXCLUDED.alt_matches, tier = EXCLUDED.tier,
    days_listed = EXCLUDED.days_listed, freshness = EXCLUDED.freshness,
    pass_count = EXCLUDED.pass_count, motivation_signal = EXCLUDED.motivation_signal,
    auction_house = EXCLUDED.auction_house, auction_datetime = EXCLUDED.auction_datetime,
    auction_status = EXCLUDED.auction_status, auction_target_price = EXCLUDED.auction_target_price,
    retail_median = EXCLUDED.retail_median, retail_median_confidence = EXCLUDED.retail_median_confidence,
    retail_median_sample = EXCLUDED.retail_median_sample,
    retail_median_p25 = EXCLUDED.retail_median_p25, retail_median_p75 = EXCLUDED.retail_median_p75,
    retail_vs_ask_pct = EXCLUDED.retail_vs_ask_pct,
    updated_at = now()
  WHERE operator_opportunities.status IN ('new', 'assigned', 'reviewed');
  
  IF NOT FOUND THEN
    RETURN 'skipped_terminal';
  END IF;
  
  RETURN 'upserted';
END;
$$;
