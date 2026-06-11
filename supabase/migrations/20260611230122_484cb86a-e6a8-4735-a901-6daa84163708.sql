
-- 1. hermes_raw_listings
CREATE TABLE public.hermes_raw_listings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  make TEXT,
  model TEXT,
  variant TEXT,
  year INT,
  odometer_km INT,
  asking_price NUMERIC,
  price_type TEXT,
  state TEXT,
  days_on_market INT,
  url TEXT,
  market_floor NUMERIC,
  market_floor_retail NUMERIC,
  market_floor_confidence NUMERIC,
  market_floor_fetched_at TIMESTAMPTZ,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hermes_raw_listings_source_extid_uniq UNIQUE (source, external_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hermes_raw_listings TO authenticated;
GRANT ALL ON public.hermes_raw_listings TO service_role;
ALTER TABLE public.hermes_raw_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage hermes_raw_listings" ON public.hermes_raw_listings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_hermes_raw_listings_source_fetched ON public.hermes_raw_listings (source, fetched_at DESC);
CREATE INDEX idx_hermes_raw_listings_market_floor ON public.hermes_raw_listings (market_floor) WHERE market_floor IS NOT NULL;
CREATE INDEX idx_hermes_raw_listings_make_model ON public.hermes_raw_listings (make, model);

-- 2. hermes_agent_heartbeats
CREATE TABLE public.hermes_agent_heartbeats (
  agent_id TEXT NOT NULL PRIMARY KEY,
  last_seen TIMESTAMPTZ,
  last_sweep_at TIMESTAMPTZ,
  sweep_count INT NOT NULL DEFAULT 0,
  status TEXT,
  last_error TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hermes_agent_heartbeats TO authenticated;
GRANT ALL ON public.hermes_agent_heartbeats TO service_role;
ALTER TABLE public.hermes_agent_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage hermes_agent_heartbeats" ON public.hermes_agent_heartbeats
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. dealer_context
CREATE TABLE public.dealer_context (
  dealer_id TEXT NOT NULL PRIMARY KEY,
  dealer_name TEXT NOT NULL,
  budget_min NUMERIC,
  budget_max NUMERIC,
  year_min INT,
  odometer_max INT,
  preferred_makes TEXT[],
  search_states TEXT[],
  home_state TEXT,
  buy_threshold_pct NUMERIC,
  watch_threshold_pct NUMERIC,
  telegram_bot_token TEXT,
  telegram_chat_id TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_context TO authenticated;
GRANT ALL ON public.dealer_context TO service_role;
ALTER TABLE public.dealer_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage dealer_context" ON public.dealer_context
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. hermes_evaluations
CREATE TABLE public.hermes_evaluations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dealer_id TEXT NOT NULL REFERENCES public.dealer_context(dealer_id) ON DELETE CASCADE,
  sweep_id TEXT,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT,
  external_id TEXT,
  url TEXT,
  make TEXT,
  model TEXT,
  variant TEXT,
  year INT,
  odometer_km INT,
  asking_price NUMERIC,
  state TEXT,
  market_floor NUMERIC,
  landed_cost NUMERIC,
  freight_applied NUMERIC,
  discount_pct NUMERIC,
  decision TEXT,
  confidence NUMERIC,
  ignore_reason TEXT,
  outcome_purchased BOOLEAN,
  outcome_purchase_price NUMERIC,
  outcome_sold BOOLEAN,
  outcome_days_to_sell INT,
  outcome_gross_profit NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hermes_evaluations TO authenticated;
GRANT ALL ON public.hermes_evaluations TO service_role;
ALTER TABLE public.hermes_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage hermes_evaluations" ON public.hermes_evaluations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_hermes_evaluations_dealer_decision ON public.hermes_evaluations (dealer_id, decision, evaluated_at DESC);
CREATE INDEX idx_hermes_evaluations_sweep ON public.hermes_evaluations (sweep_id);

-- updated_at triggers
CREATE TRIGGER trg_hermes_raw_listings_updated BEFORE UPDATE ON public.hermes_raw_listings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_hermes_agent_heartbeats_updated BEFORE UPDATE ON public.hermes_agent_heartbeats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dealer_context_updated BEFORE UPDATE ON public.dealer_context
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_hermes_evaluations_updated BEFORE UPDATE ON public.hermes_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed Patrick Auto
INSERT INTO public.dealer_context (
  dealer_id, dealer_name, budget_min, budget_max, year_min,
  preferred_makes, home_state, buy_threshold_pct, watch_threshold_pct, active
) VALUES (
  'patrick_auto', 'Patrick Auto', 5000, 60000, 2016,
  ARRAY['Toyota','Ford','Mitsubishi','Nissan','Isuzu','Mazda'],
  'NSW', 15, 5, true
);
