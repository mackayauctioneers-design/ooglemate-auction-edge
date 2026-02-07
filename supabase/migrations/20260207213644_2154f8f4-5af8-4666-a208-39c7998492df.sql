
-- ============================================================================
-- TARGET CONDUIT: sales_target_candidates + josh_daily_targets
-- ============================================================================

-- A) sales_target_candidates
CREATE TABLE public.sales_target_candidates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  make text NOT NULL,
  model text NOT NULL,
  variant text,
  body_type text,
  fuel_type text,
  transmission text,
  drive_type text,
  sales_count int NOT NULL DEFAULT 0,
  median_days_to_clear int,
  avg_days_to_clear int,
  pct_under_30 int,
  pct_under_60 int,
  median_sale_price int,
  median_profit int,
  median_km int,
  target_score int NOT NULL DEFAULT 0,
  score_reasons jsonb NOT NULL DEFAULT '{}',
  last_sold_at date,
  status text NOT NULL DEFAULT 'candidate',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_sales_target_shape ON public.sales_target_candidates (
  account_id, make, model,
  COALESCE(variant, ''),
  COALESCE(transmission, ''),
  COALESCE(fuel_type, ''),
  COALESCE(body_type, ''),
  COALESCE(drive_type, '')
);

CREATE INDEX idx_stc_account_status ON public.sales_target_candidates(account_id, status);
CREATE INDEX idx_stc_score ON public.sales_target_candidates(target_score DESC);

-- B) josh_daily_targets with explicit target_date column
CREATE TABLE public.josh_daily_targets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  target_candidate_id uuid NOT NULL REFERENCES public.sales_target_candidates(id) ON DELETE CASCADE,
  assigned_to text NOT NULL DEFAULT 'josh',
  status text NOT NULL DEFAULT 'open',
  notes text,
  target_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX uq_josh_daily_target_per_day ON public.josh_daily_targets (
  account_id, target_candidate_id, target_date
);

CREATE INDEX idx_jdt_account_date ON public.josh_daily_targets(account_id, target_date DESC);
CREATE INDEX idx_jdt_status ON public.josh_daily_targets(status);

-- Enable RLS
ALTER TABLE public.sales_target_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.josh_daily_targets ENABLE ROW LEVEL SECURITY;

-- RLS: authenticated users (internal tool)
CREATE POLICY "Auth users can select target candidates" ON public.sales_target_candidates FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert target candidates" ON public.sales_target_candidates FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update target candidates" ON public.sales_target_candidates FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete target candidates" ON public.sales_target_candidates FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can select daily targets" ON public.josh_daily_targets FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert daily targets" ON public.josh_daily_targets FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update daily targets" ON public.josh_daily_targets FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete daily targets" ON public.josh_daily_targets FOR DELETE USING (auth.uid() IS NOT NULL);

-- Trigger for updated_at
CREATE TRIGGER update_sales_target_candidates_updated_at
  BEFORE UPDATE ON public.sales_target_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
