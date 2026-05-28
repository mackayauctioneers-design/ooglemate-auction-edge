
-- 1. Extend dealer_profiles with strategic identity fields
ALTER TABLE public.dealer_profiles
  ADD COLUMN IF NOT EXISTS franchise_brand text,
  ADD COLUMN IF NOT EXISTS preferred_brands text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS dealership_category text,
  ADD COLUMN IF NOT EXISTS specialist_categories text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS location_state text,
  ADD COLUMN IF NOT EXISTS location_suburb text,
  ADD COLUMN IF NOT EXISTS location_postcode text,
  ADD COLUMN IF NOT EXISTS natural_buyer_notes text,
  ADD COLUMN IF NOT EXISTS strategic_profile_updated_at timestamptz;

-- 2. dealer_stock_mix
CREATE TABLE IF NOT EXISTS public.dealer_stock_mix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES public.dealer_profiles(id) ON DELETE CASCADE,
  make text NOT NULL,
  model_count integer NOT NULL DEFAULT 0,
  share_pct numeric NOT NULL DEFAULT 0,
  last_computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dealer_id, make)
);

GRANT SELECT ON public.dealer_stock_mix TO authenticated;
GRANT ALL ON public.dealer_stock_mix TO service_role;

ALTER TABLE public.dealer_stock_mix ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage stock mix"
  ON public.dealer_stock_mix
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Dealers read own stock mix"
  ON public.dealer_stock_mix
  FOR SELECT TO authenticated
  USING (dealer_id IN (SELECT id FROM public.dealer_profiles WHERE user_id = auth.uid()));

-- 3. Extend operator_opportunities
ALTER TABLE public.operator_opportunities
  ADD COLUMN IF NOT EXISTS strategic_fit_score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS strategic_fit_reason text,
  ADD COLUMN IF NOT EXISTS strategic_fit_signals jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS match_lane text DEFAULT 'sales_truth',
  ADD COLUMN IF NOT EXISTS recommended_dealer_id uuid,
  ADD COLUMN IF NOT EXISTS recommended_dealer_reason text,
  ADD COLUMN IF NOT EXISTS composite_score numeric;

CREATE INDEX IF NOT EXISTS idx_operator_opps_match_lane ON public.operator_opportunities(match_lane);
CREATE INDEX IF NOT EXISTS idx_operator_opps_composite ON public.operator_opportunities(composite_score DESC);

-- 4. compute_strategic_fit function
CREATE OR REPLACE FUNCTION public.compute_strategic_fit(
  p_dealer_id uuid,
  p_make text,
  p_model text DEFAULT NULL,
  p_body text DEFAULT NULL,
  p_state text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d record;
  score integer := 0;
  reasons text[] := '{}';
  signals jsonb := '{}'::jsonb;
  v_make text := upper(coalesce(p_make,''));
  v_share numeric;
  v_mandate_hit boolean := false;
BEGIN
  SELECT * INTO d FROM public.dealer_profiles WHERE id = p_dealer_id;
  IF NOT FOUND OR v_make = '' THEN
    RETURN jsonb_build_object('score', 0, 'reason', null, 'signals', signals);
  END IF;

  -- Franchise brand match
  IF d.franchise_brand IS NOT NULL AND upper(d.franchise_brand) = v_make THEN
    score := score + 40;
    reasons := reasons || format('Franchise %s dealer', initcap(d.franchise_brand));
    signals := signals || jsonb_build_object('franchise_match', true);
  END IF;

  -- Preferred brands
  IF d.preferred_brands IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(d.preferred_brands) b WHERE upper(b) = v_make) THEN
    score := score + 25;
    reasons := reasons || format('Regularly retails %s', initcap(v_make));
    signals := signals || jsonb_build_object('preferred_brand', true);
  END IF;

  -- Specialist category (very simple body→category map)
  IF d.specialist_categories IS NOT NULL AND array_length(d.specialist_categories,1) > 0 THEN
    IF (p_body ILIKE '%suv%' AND 'family_suv' = ANY(d.specialist_categories))
       OR (p_body ILIKE '%ute%' AND '4x4' = ANY(d.specialist_categories))
       OR (p_body ILIKE '%wagon%' AND 'family_suv' = ANY(d.specialist_categories)) THEN
      score := score + 15;
      reasons := reasons || 'Specialist category match';
      signals := signals || jsonb_build_object('specialist_match', true);
    END IF;
  END IF;

  -- Location (state)
  IF d.location_state IS NOT NULL AND p_state IS NOT NULL
     AND upper(d.location_state) = upper(p_state) THEN
    score := score + 10;
    reasons := reasons || 'Same state';
    signals := signals || jsonb_build_object('same_state', true);
  END IF;

  -- Stock mix concentration
  SELECT share_pct INTO v_share
    FROM public.dealer_stock_mix
   WHERE dealer_id = p_dealer_id AND upper(make) = v_make;
  IF v_share IS NOT NULL AND v_share >= 15 THEN
    score := score + 15;
    reasons := reasons || format('%.0f%% of current stock is %s', v_share, initcap(v_make));
    signals := signals || jsonb_build_object('stock_share_pct', v_share);
  END IF;

  -- Active mandate covering make
  SELECT EXISTS (
    SELECT 1 FROM public.active_mandates m
     WHERE m.dealer_id = p_dealer_id
       AND upper(coalesce(m.make,'')) = v_make
  ) INTO v_mandate_hit;
  IF v_mandate_hit THEN
    score := score + 20;
    reasons := reasons || 'Active mandate covers this make';
    signals := signals || jsonb_build_object('mandate_match', true);
  END IF;

  -- Wholesale penalty
  IF d.dealership_category = 'wholesale' THEN
    score := score - 20;
  END IF;

  -- Cap
  IF score < 0 THEN score := 0; END IF;
  IF score > 100 THEN score := 100; END IF;

  RETURN jsonb_build_object(
    'score', score,
    'reason', CASE WHEN array_length(reasons,1) > 0
                   THEN array_to_string(reasons, ' · ')
                   ELSE null END,
    'signals', signals
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_strategic_fit(uuid, text, text, text, text) TO authenticated, service_role;
