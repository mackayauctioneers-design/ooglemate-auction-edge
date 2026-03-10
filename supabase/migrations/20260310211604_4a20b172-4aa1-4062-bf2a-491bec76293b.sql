
-- Model market snapshot: daily active listing counts by make/model/variant
CREATE TABLE public.model_market_snapshot (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant_resolved TEXT,
  region TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active_listing_count INT NOT NULL,
  avg_price NUMERIC,
  avg_km NUMERIC,
  avg_days_on_market NUMERIC,
  UNIQUE (make, model, variant_resolved, region, observed_at)
);

CREATE INDEX idx_mms_make_model ON public.model_market_snapshot (make, model);
CREATE INDEX idx_mms_observed_at ON public.model_market_snapshot (observed_at DESC);

-- Demand velocity: computed from consecutive snapshots
CREATE TABLE public.demand_velocity_daily (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant_resolved TEXT,
  region TEXT,
  snapshot_date DATE NOT NULL,
  prev_count INT,
  current_count INT,
  velocity INT GENERATED ALWAYS AS (COALESCE(prev_count, 0) - COALESCE(current_count, 0)) STORED,
  sell_through_pct NUMERIC,
  velocity_score SMALLINT,  -- 0-10 normalized score
  UNIQUE (make, model, variant_resolved, region, snapshot_date)
);

CREATE INDEX idx_dvd_date ON public.demand_velocity_daily (snapshot_date DESC);
CREATE INDEX idx_dvd_score ON public.demand_velocity_daily (velocity_score DESC);

-- Function to compute velocity scores from snapshots
CREATE OR REPLACE FUNCTION public.compute_demand_velocity(p_date DATE DEFAULT CURRENT_DATE)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  rows_inserted INT;
BEGIN
  INSERT INTO public.demand_velocity_daily (make, model, variant_resolved, region, snapshot_date, prev_count, current_count, sell_through_pct, velocity_score)
  SELECT
    t.make,
    t.model,
    t.variant_resolved,
    t.region,
    p_date,
    y.active_listing_count AS prev_count,
    t.active_listing_count AS current_count,
    CASE WHEN y.active_listing_count > 0
      THEN ROUND(100.0 * (y.active_listing_count - t.active_listing_count) / y.active_listing_count, 2)
      ELSE 0
    END AS sell_through_pct,
    -- Score 0-10: based on sell-through percentage
    LEAST(10, GREATEST(0,
      CASE
        WHEN y.active_listing_count IS NULL OR y.active_listing_count < 5 THEN 5  -- insufficient data, neutral
        WHEN y.active_listing_count - t.active_listing_count <= 0 THEN 0  -- no churn or growing
        ELSE ROUND(10.0 * (y.active_listing_count - t.active_listing_count) / GREATEST(y.active_listing_count, 1))
      END
    ))::SMALLINT AS velocity_score
  FROM public.model_market_snapshot t
  LEFT JOIN public.model_market_snapshot y
    ON t.make = y.make
    AND t.model = y.model
    AND COALESCE(t.variant_resolved, '') = COALESCE(y.variant_resolved, '')
    AND COALESCE(t.region, '') = COALESCE(y.region, '')
    AND y.observed_at::date = p_date - 1
  WHERE t.observed_at::date = p_date
  ON CONFLICT (make, model, variant_resolved, region, snapshot_date) DO UPDATE SET
    prev_count = EXCLUDED.prev_count,
    current_count = EXCLUDED.current_count,
    sell_through_pct = EXCLUDED.sell_through_pct,
    velocity_score = EXCLUDED.velocity_score;

  GET DIAGNOSTICS rows_inserted = ROW_COUNT;
  RETURN rows_inserted;
END;
$$;
