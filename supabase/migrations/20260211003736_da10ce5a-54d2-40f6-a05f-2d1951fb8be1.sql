
-- ============================================================================
-- fingerprint_targets: the dealer's live sourcing engine
-- ============================================================================
CREATE TABLE public.fingerprint_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant TEXT,
  year_from INT,
  year_to INT,
  transmission TEXT,
  fuel_type TEXT,
  drive_type TEXT,
  body_type TEXT,
  -- Commercial performance
  median_profit NUMERIC,
  median_profit_pct NUMERIC,
  median_days_to_clear INT,
  median_sale_price NUMERIC,
  median_km NUMERIC,
  total_sales INT NOT NULL DEFAULT 0,
  confidence_level TEXT NOT NULL DEFAULT 'LOW' CHECK (confidence_level IN ('HIGH', 'MEDIUM', 'LOW')),
  spec_completeness INT NOT NULL DEFAULT 0,
  target_score NUMERIC NOT NULL DEFAULT 0,
  -- Workflow
  origin TEXT NOT NULL DEFAULT 'sales_truth' CHECK (origin IN ('sales_truth', 'bob', 'manual')),
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'paused', 'retired')),
  source_candidate_id UUID REFERENCES public.sales_target_candidates(id),
  last_promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_fingerprint_targets_account ON public.fingerprint_targets(account_id);
CREATE INDEX idx_fingerprint_targets_lookup ON public.fingerprint_targets(account_id, make, model, variant);
CREATE INDEX idx_fingerprint_targets_status ON public.fingerprint_targets(account_id, status);

-- Enable RLS
ALTER TABLE public.fingerprint_targets ENABLE ROW LEVEL SECURITY;

-- RLS policies - open read/write for authenticated users (internal tool)
CREATE POLICY "Authenticated users can read fingerprint_targets"
  ON public.fingerprint_targets FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert fingerprint_targets"
  ON public.fingerprint_targets FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update fingerprint_targets"
  ON public.fingerprint_targets FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete fingerprint_targets"
  ON public.fingerprint_targets FOR DELETE
  USING (auth.role() = 'authenticated');

-- Updated_at trigger
CREATE TRIGGER update_fingerprint_targets_updated_at
  BEFORE UPDATE ON public.fingerprint_targets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
