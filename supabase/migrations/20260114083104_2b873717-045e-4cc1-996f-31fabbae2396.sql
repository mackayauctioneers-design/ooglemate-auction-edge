-- 1. Create function to upsert retail listing and trigger evaluation
CREATE OR REPLACE FUNCTION upsert_retail_listing(
  p_source TEXT,
  p_source_listing_id TEXT,
  p_listing_url TEXT,
  p_year INTEGER,
  p_make TEXT,
  p_model TEXT,
  p_variant_raw TEXT DEFAULT NULL,
  p_variant_family TEXT DEFAULT NULL,
  p_km INTEGER DEFAULT NULL,
  p_asking_price INTEGER DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_suburb TEXT DEFAULT NULL
)
RETURNS TABLE (
  listing_id UUID,
  identity_id UUID,
  is_new BOOLEAN,
  price_changed BOOLEAN,
  evaluation_result TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing_id UUID;
  v_identity_id UUID;
  v_is_new BOOLEAN := FALSE;
  v_price_changed BOOLEAN := FALSE;
  v_old_price INTEGER;
  v_eval_result TEXT := NULL;
  v_existing RECORD;
BEGIN
  -- Check if listing exists
  SELECT rl.id, rl.asking_price, rl.identity_id, rl.delisted_at
  INTO v_existing
  FROM retail_listings rl
  WHERE rl.source = p_source AND rl.source_listing_id = p_source_listing_id;

  IF v_existing.id IS NULL THEN
    -- New listing
    v_is_new := TRUE;
    INSERT INTO retail_listings (
      source, source_listing_id, listing_url, year, make, model,
      variant_raw, variant_family, km, asking_price, state, suburb,
      first_seen_at, last_seen_at
    ) VALUES (
      p_source, p_source_listing_id, p_listing_url, p_year,
      UPPER(TRIM(p_make)), UPPER(TRIM(p_model)),
      NULLIF(TRIM(p_variant_raw), ''), NULLIF(TRIM(p_variant_family), ''),
      p_km, p_asking_price, UPPER(TRIM(p_state)), p_suburb,
      now(), now()
    )
    RETURNING id INTO v_listing_id;
  ELSE
    -- Existing listing
    v_listing_id := v_existing.id;
    v_old_price := v_existing.asking_price;
    v_price_changed := (p_asking_price IS DISTINCT FROM v_old_price);

    UPDATE retail_listings SET
      last_seen_at = now(),
      asking_price = COALESCE(p_asking_price, asking_price),
      price_changed_at = CASE WHEN v_price_changed THEN now() ELSE price_changed_at END,
      delisted_at = NULL,  -- Re-activate if previously delisted
      km = COALESCE(p_km, km),
      variant_raw = COALESCE(NULLIF(TRIM(p_variant_raw), ''), variant_raw),
      variant_family = COALESCE(NULLIF(TRIM(p_variant_family), ''), variant_family),
      updated_at = now()
    WHERE id = v_listing_id;

    v_identity_id := v_existing.identity_id;
  END IF;

  -- Map to identity if not already mapped and we have required fields
  IF v_identity_id IS NULL AND p_year IS NOT NULL AND p_make IS NOT NULL AND p_model IS NOT NULL THEN
    v_identity_id := map_listing_to_identity(
      p_year, UPPER(TRIM(p_make)), UPPER(TRIM(p_model)),
      NULLIF(TRIM(p_variant_family), ''),
      NULL, NULL, NULL,
      p_km,
      COALESCE(UPPER(TRIM(p_state)), 'AU-NATIONAL')
    );

    UPDATE retail_listings SET
      identity_id = v_identity_id,
      identity_mapped_at = now()
    WHERE id = v_listing_id;
  END IF;

  -- Auto-evaluate on new listing or price change (only if identity exists)
  IF v_identity_id IS NOT NULL AND (v_is_new OR v_price_changed) THEN
    SELECT et.result INTO v_eval_result
    FROM evaluate_and_emit_trigger(v_listing_id, 'v0_provisional') et;

    UPDATE retail_listings SET
      last_evaluated_at = now(),
      last_evaluation_result = v_eval_result
    WHERE id = v_listing_id;
  END IF;

  RETURN QUERY SELECT v_listing_id, v_identity_id, v_is_new, v_price_changed, v_eval_result;
END;
$$;

-- 2. Create function to mark stale listings as delisted
CREATE OR REPLACE FUNCTION mark_stale_listings_delisted(p_stale_days INTEGER DEFAULT 3)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE retail_listings
  SET delisted_at = now(), updated_at = now()
  WHERE delisted_at IS NULL
    AND last_seen_at < now() - (p_stale_days || ' days')::INTERVAL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 3. Create function to get listings needing evaluation (for backfill)
CREATE OR REPLACE FUNCTION get_listings_needing_evaluation(p_limit INTEGER DEFAULT 500)
RETURNS TABLE (listing_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT rl.id
  FROM retail_listings rl
  WHERE rl.identity_id IS NOT NULL
    AND rl.delisted_at IS NULL
    AND (
      rl.last_evaluated_at IS NULL
      OR rl.last_evaluated_at < rl.price_changed_at
      OR rl.last_evaluated_at < (
        SELECT pe.computed_at FROM proven_exits pe WHERE pe.identity_id = rl.identity_id
      )
    )
  ORDER BY rl.last_seen_at DESC
  LIMIT p_limit;
END;
$$;

-- 4. Create observability view for ingest stats
CREATE OR REPLACE VIEW retail_ingest_stats AS
SELECT
  (SELECT COUNT(*) FROM retail_listings WHERE first_seen_at >= CURRENT_DATE) AS listings_scraped_today,
  (SELECT COUNT(*) FROM retail_listings WHERE delisted_at IS NULL) AS active_listings_total,
  (SELECT COUNT(*) FROM retail_listings WHERE identity_id IS NOT NULL AND delisted_at IS NULL) AS listings_with_identity,
  (SELECT COUNT(*) FROM trigger_evaluations WHERE evaluated_at >= CURRENT_DATE) AS evaluations_today,
  (SELECT COUNT(*) FROM sales_triggers WHERE created_at >= CURRENT_DATE) AS triggers_today,
  (SELECT COUNT(*) FROM sales_triggers WHERE created_at >= CURRENT_DATE AND trigger_type = 'BUY') AS buy_triggers_today,
  (SELECT COUNT(*) FROM sales_triggers WHERE created_at >= CURRENT_DATE AND trigger_type = 'WATCH') AS watch_triggers_today,
  (SELECT ROUND(COUNT(*) FILTER (WHERE identity_id IS NOT NULL)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 1) FROM retail_listings WHERE delisted_at IS NULL) AS identity_mapping_pct;

-- 5. Create unique index for upsert key if not exists
CREATE UNIQUE INDEX IF NOT EXISTS retail_listings_source_key ON retail_listings (source, source_listing_id);