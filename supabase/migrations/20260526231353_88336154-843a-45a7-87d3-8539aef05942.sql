CREATE OR REPLACE FUNCTION public.rebuild_dealer_fingerprints(p_dealer_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_dealer_name text;
  v_count integer := 0;
BEGIN
  SELECT account_id, dealer_name INTO v_account_id, v_dealer_name
  FROM public.dealer_profiles WHERE id = p_dealer_id;
  IF v_account_id IS NULL THEN RETURN 0; END IF;

  WITH agg AS (
    SELECT
      make, model, COALESCE(variant,'') AS variant,
      MIN(year) AS year_min, MAX(year) AS year_max,
      MAX(km) AS max_km,
      AVG(listed_price)::int AS avg_price,
      AVG(EXTRACT(EPOCH FROM (sold_date::timestamptz - first_seen))/86400)::numeric AS avg_days,
      COUNT(*) AS n
    FROM public.dealer_sales_truth
    WHERE dealer_id = p_dealer_id
      AND sold_date IS NOT NULL
      AND make IS NOT NULL AND model IS NOT NULL
      AND year >= 2020
      AND (km IS NULL OR km <= 120000)
    GROUP BY 1,2,3
    HAVING COUNT(*) >= 1
  )
  INSERT INTO public.dealer_replacement_fingerprints (
    account_id, dealer_name, make, model, variant,
    year_min, year_max, max_km, expected_sale_price,
    avg_sell_price, avg_days_to_sell, sales_velocity,
    confidence_score, sales_count, auto_built, last_rebuilt_at,
    active, status
  )
  SELECT
    v_account_id, v_dealer_name, make, model, NULLIF(variant,''),
    year_min, year_max, LEAST(max_km, 120000), avg_price,
    avg_price, avg_days,
    CASE WHEN avg_days > 0 THEN 30.0/avg_days ELSE NULL END,
    LEAST(1.0, n::numeric / 5.0), n, true, now(),
    true, 'confirmed'
  FROM agg
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

UPDATE public.dealer_replacement_fingerprints
SET active = false, status = 'out_of_spec'
WHERE active = true
  AND (year_max < 2020 OR (max_km IS NOT NULL AND max_km > 120000));

UPDATE public.dealer_fingerprints
SET is_active = 'N'
WHERE is_active = 'Y'
  AND (year_max < 2020 OR (max_km IS NOT NULL AND max_km > 120000));