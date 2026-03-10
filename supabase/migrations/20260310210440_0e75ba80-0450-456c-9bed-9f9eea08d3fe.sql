-- Use plpgsql to avoid SQL-language validation issues with correlated subqueries
CREATE OR REPLACE FUNCTION public.refresh_price_summaries()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.listing_price_summary (
    listing_id, source, first_price, latest_price, lowest_price,
    price_drop_count, total_price_drop, largest_single_drop,
    first_badge, latest_badge, badge_changed, badge_improved, updated_at
  )
  SELECT
    h.listing_id,
    h.source,
    (ARRAY_AGG(h.price ORDER BY h.observed_at ASC))[1],
    (ARRAY_AGG(h.price ORDER BY h.observed_at DESC))[1],
    MIN(h.price),
    0,
    GREATEST(0, (ARRAY_AGG(h.price ORDER BY h.observed_at ASC))[1] - MIN(h.price))::integer,
    0,
    (ARRAY_AGG(h.price_badge ORDER BY h.observed_at ASC) FILTER (WHERE h.price_badge IS NOT NULL))[1],
    (ARRAY_AGG(h.price_badge ORDER BY h.observed_at DESC) FILTER (WHERE h.price_badge IS NOT NULL))[1],
    (ARRAY_AGG(h.price_badge ORDER BY h.observed_at ASC) FILTER (WHERE h.price_badge IS NOT NULL))[1] IS DISTINCT FROM
    (ARRAY_AGG(h.price_badge ORDER BY h.observed_at DESC) FILTER (WHERE h.price_badge IS NOT NULL))[1],
    false,
    now()
  FROM public.listing_price_history h
  GROUP BY h.listing_id, h.source
  ON CONFLICT (listing_id, source) DO UPDATE SET
    latest_price = EXCLUDED.latest_price,
    lowest_price = EXCLUDED.lowest_price,
    price_drop_count = EXCLUDED.price_drop_count,
    total_price_drop = EXCLUDED.total_price_drop,
    largest_single_drop = EXCLUDED.largest_single_drop,
    latest_badge = EXCLUDED.latest_badge,
    badge_changed = EXCLUDED.badge_changed,
    updated_at = now();
END;
$$;

-- Refresh dealer pressure function
CREATE OR REPLACE FUNCTION public.refresh_dealer_pressure()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.dealer_pressure_scores;
END;
$$;