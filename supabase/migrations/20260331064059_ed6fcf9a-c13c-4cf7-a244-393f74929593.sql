
-- opportunity_enrichments: 1:1 enrichment data for matched opportunities
CREATE TABLE public.opportunity_enrichments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matched_opportunity_id uuid NOT NULL UNIQUE REFERENCES public.matched_opportunities_v1(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Market metrics
  market_median_price numeric,
  market_price_low numeric,
  market_price_high numeric,

  -- Dealer history metrics
  ajh_median_sell_price numeric,
  ajh_median_gross numeric,
  ajh_median_days_in_stock integer,
  ajh_sales_count integer,

  -- Auction + projection
  auction_guide_price numeric,
  estimated_landed_cost numeric,
  estimated_recon_cost numeric,
  projected_gross numeric,

  -- Relative positions
  price_vs_market_pct numeric,
  gross_vs_ajh_median_pct numeric,

  -- Flags + presentation
  liquidity_band text,
  profit_band text,
  summary_text text,

  -- Optional comps
  comps_sample jsonb
);

-- RLS: dealer only sees their own enrichments
ALTER TABLE public.opportunity_enrichments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read enrichments"
  ON public.opportunity_enrichments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert/update enrichments"
  ON public.opportunity_enrichments FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_opportunity_enrichments_opp_id ON public.opportunity_enrichments(matched_opportunity_id);
CREATE INDEX idx_opportunity_enrichments_account ON public.opportunity_enrichments(account_id);
