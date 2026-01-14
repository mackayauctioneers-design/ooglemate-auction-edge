-- Fix emit_sales_trigger to use correct column names
DROP FUNCTION IF EXISTS emit_sales_trigger(UUID);

CREATE FUNCTION emit_sales_trigger(p_evaluation_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eval RECORD;
  v_listing RECORD;
  v_proven RECORD;
  v_trigger_id UUID;
BEGIN
  SELECT * INTO v_eval FROM trigger_evaluations te WHERE te.id = p_evaluation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evaluation not found: %', p_evaluation_id; END IF;

  -- Only emit for BUY or WATCH
  IF v_eval.result NOT IN ('BUY', 'WATCH') THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_listing FROM retail_listings rl WHERE rl.id = v_eval.listing_id;
  SELECT * INTO v_proven FROM proven_exits pe WHERE pe.identity_id = v_eval.identity_id;

  -- Insert full sales_triggers row
  INSERT INTO sales_triggers (
    evaluation_id,
    listing_id,
    identity_id,
    trigger_type,
    year,
    make,
    model,
    variant_family,
    km,
    location,
    listing_url,
    asking_price,
    proven_exit_value,
    proven_exit_summary,
    gap_dollars,
    gap_pct,
    confidence_label,
    sample_size,
    config_version
  ) VALUES (
    p_evaluation_id,
    v_eval.listing_id,
    v_eval.identity_id,
    v_eval.result,
    v_listing.year,
    v_listing.make,
    v_listing.model,
    v_listing.variant_family,
    v_listing.km,
    v_listing.state,
    v_listing.listing_url,
    v_eval.listing_price,
    v_eval.proven_exit_value,
    COALESCE(v_proven.contributing_dealer_ids[1], 'dealer') || ' sold at $' || v_eval.proven_exit_value,
    v_eval.gap_dollars,
    v_eval.gap_pct,
    v_proven.confidence_label,
    v_proven.sample_size,
    v_eval.config_version
  )
  ON CONFLICT (listing_id, config_version) 
  DO UPDATE SET
    trigger_type = EXCLUDED.trigger_type,
    asking_price = EXCLUDED.asking_price,
    proven_exit_value = EXCLUDED.proven_exit_value,
    gap_dollars = EXCLUDED.gap_dollars,
    gap_pct = EXCLUDED.gap_pct,
    confidence_label = EXCLUDED.confidence_label,
    sample_size = EXCLUDED.sample_size
  RETURNING id INTO v_trigger_id;

  RETURN v_trigger_id;
END;
$$;