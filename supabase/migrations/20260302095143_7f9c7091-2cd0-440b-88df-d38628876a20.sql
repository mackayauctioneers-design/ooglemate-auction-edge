
-- =============================================================
-- EVOLVE source_registry + CREATE dealer_entitlements & outward_search_runs
-- =============================================================

-- Add outward-search-v2 columns to existing source_registry
ALTER TABLE public.source_registry
  ADD COLUMN IF NOT EXISTS adapter_type TEXT NOT NULL DEFAULT 'internal_db',
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS rate_limit_per_hour INT DEFAULT 60,
  ADD COLUMN IF NOT EXISTS cooldown_minutes INT DEFAULT 30,
  ADD COLUMN IF NOT EXISTS avg_latency_ms INT,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill display_name from source where null
UPDATE public.source_registry SET display_name = initcap(replace(source, '_', ' ')) WHERE display_name IS NULL;

-- Set tier for premium sources
UPDATE public.source_registry SET tier = 'premium', adapter_type = 'manus'
WHERE source IN ('carsales', 'autotrader', 'drive', 'carsguide', 'gumtree_dealer', 'gumtree_private', 'facebook_marketplace');

-- Set adapter_type for auction sources using internal DB
UPDATE public.source_registry SET adapter_type = 'internal_db'
WHERE source_type = 'AUCTION';

-- dealer_entitlements
CREATE TABLE public.dealer_entitlements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) UNIQUE,
  plan_tier TEXT NOT NULL DEFAULT 'free',
  max_searches_per_day INT NOT NULL DEFAULT 5,
  max_sources_per_search INT NOT NULL DEFAULT 3,
  allowed_source_tiers TEXT[] NOT NULL DEFAULT ARRAY['free'],
  searches_used_today INT NOT NULL DEFAULT 0,
  searches_reset_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 day'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- outward_search_runs
CREATE TABLE public.outward_search_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID REFERENCES public.accounts(id),
  initiated_by TEXT DEFAULT 'user',
  instruction TEXT NOT NULL,
  parsed_intent JSONB,
  sources_queried TEXT[] NOT NULL DEFAULT '{}',
  total_results INT NOT NULL DEFAULT 0,
  results_by_source JSONB DEFAULT '{}',
  cache_hit BOOLEAN NOT NULL DEFAULT false,
  gated BOOLEAN NOT NULL DEFAULT false,
  gate_reason TEXT,
  quota_snapshot JSONB,
  duration_ms INT,
  error TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_outward_search_runs_account ON public.outward_search_runs(account_id, created_at DESC);
CREATE INDEX idx_outward_search_runs_status ON public.outward_search_runs(status);
CREATE INDEX idx_dealer_entitlements_account ON public.dealer_entitlements(account_id);

-- RLS
ALTER TABLE public.dealer_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outward_search_runs ENABLE ROW LEVEL SECURITY;

-- Ensure source_registry has RLS
ALTER TABLE public.source_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access on source_registry"
  ON public.source_registry FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "authenticated read source_registry"
  ON public.source_registry FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_role full access on dealer_entitlements"
  ON public.dealer_entitlements FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "account members read own entitlements"
  ON public.dealer_entitlements FOR SELECT TO authenticated
  USING (account_id IN (
    SELECT dp.account_id FROM public.dealer_profiles dp
    JOIN public.dealer_profile_user_links dpul ON dpul.dealer_profile_id = dp.id
    WHERE dpul.user_id = auth.uid()
  ));

CREATE POLICY "service_role full access on outward_search_runs"
  ON public.outward_search_runs FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "account members read own search runs"
  ON public.outward_search_runs FOR SELECT TO authenticated
  USING (account_id IN (
    SELECT dp.account_id FROM public.dealer_profiles dp
    JOIN public.dealer_profile_user_links dpul ON dpul.dealer_profile_id = dp.id
    WHERE dpul.user_id = auth.uid()
  ));

-- Timestamps triggers
CREATE TRIGGER update_dealer_entitlements_updated_at
  BEFORE UPDATE ON public.dealer_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_source_registry_updated_at
  BEFORE UPDATE ON public.source_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
