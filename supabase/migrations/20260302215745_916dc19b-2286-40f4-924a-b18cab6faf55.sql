
-- VALO Runs — persists each valuation for audit, MODO linkage, and analytics
CREATE TABLE public.valo_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.accounts(id),
  intent JSONB NOT NULL,
  anchor JSONB,
  backups JSONB,
  market JSONB,
  trade_in_offer JSONB,
  confidence TEXT,
  modo_result JSONB,
  adjusted_offer JSONB,
  adjusted_confidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.valo_runs ENABLE ROW LEVEL SECURITY;

-- Operators/service role can do everything (edge functions use service role)
CREATE POLICY "Service role full access on valo_runs"
  ON public.valo_runs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for account lookups
CREATE INDEX idx_valo_runs_account ON public.valo_runs (account_id, created_at DESC);
