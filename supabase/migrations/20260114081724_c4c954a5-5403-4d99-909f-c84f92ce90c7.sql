-- Fix compute_proven_exit - calculate recency separately
DROP FUNCTION IF EXISTS compute_proven_exit(UUID);

CREATE FUNCTION compute_proven_exit(p_identity_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_exit_value NUMERIC;
  v_sample_size INTEGER;
  v_newest_date DATE;
  v_oldest_date DATE;
  v_recency_days INTEGER;
  v_sources TEXT[];
  v_dealers TEXT[];
  v_confidence TEXT;
  v_region TEXT;
  v_km_band TEXT;
BEGIN
  -- Get identity metadata
  SELECT vi.region_id, vi.km_band
  INTO v_region, v_km_band
  FROM vehicle_identities vi
  WHERE vi.id = p_identity_id;

  -- Aggregate sales evidence
  SELECT
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY se.exit_price),
    COUNT(*)::INTEGER,
    MAX(se.exit_date),
    MIN(se.exit_date),
    ARRAY_AGG(DISTINCT se.source_type),
    ARRAY_AGG(DISTINCT se.dealer_id) FILTER (WHERE se.dealer_id IS NOT NULL)
  INTO v_exit_value, v_sample_size, v_newest_date, v_oldest_date, v_sources, v_dealers
  FROM sales_evidence se
  WHERE se.identity_id = p_identity_id
    AND se.exit_date >= CURRENT_DATE - INTERVAL '270 days';

  -- No evidence found
  IF v_sample_size IS NULL OR v_sample_size = 0 THEN
    DELETE FROM proven_exits pe WHERE pe.identity_id = p_identity_id;
    RETURN;
  END IF;

  -- Calculate recency separately
  v_recency_days := (CURRENT_DATE - v_newest_date)::INTEGER;

  -- Compute confidence label
  IF v_sample_size >= 3 AND v_recency_days <= 90 THEN
    v_confidence := 'high';
  ELSIF v_sample_size >= 2 AND v_recency_days <= 180 THEN
    v_confidence := 'medium';
  ELSE
    v_confidence := 'low';
  END IF;

  -- Upsert proven exit
  INSERT INTO proven_exits (
    identity_id, exit_value, exit_method, sample_size,
    recency_weighted, region_scope, km_band_used,
    newest_sale_date, oldest_sale_date, sale_recency_days,
    data_sources, contributing_dealer_ids, confidence_label
  ) VALUES (
    p_identity_id, v_exit_value, 'median', v_sample_size,
    false, v_region, v_km_band,
    v_newest_date, v_oldest_date, v_recency_days,
    v_sources, v_dealers, v_confidence
  )
  ON CONFLICT (identity_id) DO UPDATE SET
    exit_value = EXCLUDED.exit_value,
    exit_method = EXCLUDED.exit_method,
    sample_size = EXCLUDED.sample_size,
    newest_sale_date = EXCLUDED.newest_sale_date,
    oldest_sale_date = EXCLUDED.oldest_sale_date,
    sale_recency_days = EXCLUDED.sale_recency_days,
    data_sources = EXCLUDED.data_sources,
    contributing_dealer_ids = EXCLUDED.contributing_dealer_ids,
    confidence_label = EXCLUDED.confidence_label,
    computed_at = now(),
    updated_at = now();
END;
$$;