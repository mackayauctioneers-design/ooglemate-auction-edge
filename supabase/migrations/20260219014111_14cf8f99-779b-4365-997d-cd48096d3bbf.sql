
-- ============================================================================
-- OPERATOR TRADING DESK: Global multi-account opportunity table
-- ============================================================================

CREATE TABLE public.operator_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Listing identity
  listing_id TEXT NOT NULL,
  listing_source TEXT,                -- pickles, caroogle, autotrader, etc.
  source_url TEXT,
  
  -- Vehicle
  make TEXT,
  model TEXT,
  variant TEXT,
  platform_class TEXT,
  trim_class TEXT,
  drivetrain_bucket TEXT,
  year INT,
  km INT,
  asking_price NUMERIC,
  
  -- Multi-account scoring (the power)
  best_account_id UUID REFERENCES public.accounts(id),
  best_account_name TEXT,
  best_expected_margin NUMERIC,
  best_under_buy NUMERIC,
  alt_matches JSONB DEFAULT '[]'::jsonb,  -- [{account_id, account_name, expected_margin, under_buy, anchor_sale_id}]
  
  -- Tiering
  tier TEXT NOT NULL DEFAULT 'WATCH',   -- CODE_RED, HIGH, WATCH
  
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'new',   -- new, reviewed, assigned, bought, ignored, expired
  assigned_to_account UUID REFERENCES public.accounts(id),
  assigned_to_name TEXT,
  assigned_at TIMESTAMPTZ,
  assigned_by TEXT,
  
  -- Metadata
  days_listed INT,
  freshness TEXT,                       -- 'today', 'this_week', 'older'
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(listing_id)
);

-- Indexes for the trading desk queries
CREATE INDEX idx_operator_opps_status ON public.operator_opportunities(status);
CREATE INDEX idx_operator_opps_tier ON public.operator_opportunities(tier);
CREATE INDEX idx_operator_opps_best_account ON public.operator_opportunities(best_account_id);
CREATE INDEX idx_operator_opps_margin ON public.operator_opportunities(best_expected_margin DESC);
CREATE INDEX idx_operator_opps_created ON public.operator_opportunities(created_at DESC);

-- RLS: Operator-only access (admin role)
ALTER TABLE public.operator_opportunities ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins full access to operator_opportunities"
  ON public.operator_opportunities
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Updated_at trigger
CREATE TRIGGER update_operator_opportunities_updated_at
  BEFORE UPDATE ON public.operator_opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
