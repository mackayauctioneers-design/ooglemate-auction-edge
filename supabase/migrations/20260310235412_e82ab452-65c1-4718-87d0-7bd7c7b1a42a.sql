
-- Add deal_score and source_type columns to cheap_car_queue
ALTER TABLE public.cheap_car_queue
  ADD COLUMN IF NOT EXISTS deal_score numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS source_weight integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS freshness_score integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS submitted_by text DEFAULT NULL;

-- Create function to compute deal_score
CREATE OR REPLACE FUNCTION public.compute_deal_score(
  p_discount_pct numeric,
  p_source text,
  p_detected_at timestamptz,
  p_source_type text DEFAULT 'system'
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_price_score numeric := 0;
  v_source_score numeric := 0;
  v_freshness_score numeric := 0;
  v_hours_old numeric;
BEGIN
  -- Price discount scoring
  IF p_discount_pct IS NOT NULL THEN
    IF p_discount_pct <= -20 THEN v_price_score := 10;
    ELSIF p_discount_pct <= -16 THEN v_price_score := 8;
    ELSIF p_discount_pct <= -12 THEN v_price_score := 6;
    ELSIF p_discount_pct <= -8 THEN v_price_score := 4;
    ELSIF p_discount_pct <= -5 THEN v_price_score := 2;
    ELSE v_price_score := 0;
    END IF;
  END IF;

  -- Source weighting (non-Carsales sources get bonus for hidden bargains)
  CASE lower(p_source)
    WHEN 'carsales' THEN v_source_score := 1;
    WHEN 'autotrader' THEN v_source_score := 2;
    WHEN 'gumtree' THEN v_source_score := 2;
    WHEN 'drive' THEN v_source_score := 2;
    WHEN 'dealer' THEN v_source_score := 2;
    WHEN 'auction' THEN v_source_score := 3;
    ELSE v_source_score := 1;
  END CASE;

  -- Manual submissions get a small bonus for human curation
  IF p_source_type = 'manual' THEN
    v_source_score := v_source_score + 1;
  END IF;

  -- Freshness scoring (newer = better)
  v_hours_old := EXTRACT(EPOCH FROM (now() - p_detected_at)) / 3600;
  IF v_hours_old <= 2 THEN v_freshness_score := 3;
  ELSIF v_hours_old <= 12 THEN v_freshness_score := 2;
  ELSIF v_hours_old <= 48 THEN v_freshness_score := 1;
  ELSE v_freshness_score := 0;
  END IF;

  RETURN v_price_score + v_source_score + v_freshness_score;
END;
$$;

-- Backfill existing rows
UPDATE public.cheap_car_queue
SET deal_score = public.compute_deal_score(discount_pct, source, detected_at, source_type)
WHERE deal_score IS NULL;
