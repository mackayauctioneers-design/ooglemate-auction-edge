-- Sales Triggers Engine Schema (v0) - Complete with correct order

-- 1. Vehicle Identities (base table - no dependencies)
CREATE TABLE IF NOT EXISTS public.vehicle_identities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  year_min INTEGER NOT NULL,
  year_max INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant_family TEXT,
  fuel TEXT,
  drivetrain TEXT,
  transmission TEXT,
  km_band TEXT NOT NULL,
  region_id TEXT NOT NULL DEFAULT 'AU-NATIONAL',
  identity_hash TEXT NOT NULL UNIQUE,
  listing_count INTEGER DEFAULT 0,
  evidence_count INTEGER DEFAULT 0,
  last_evidence_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Retail Listings
CREATE TABLE IF NOT EXISTS public.retail_listings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,
  source_listing_id TEXT NOT NULL,
  listing_url TEXT,
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant_raw TEXT,
  variant_family TEXT,
  km INTEGER,
  asking_price INTEGER NOT NULL,
  state TEXT,
  postcode TEXT,
  suburb TEXT,
  region_id TEXT DEFAULT 'AU-NATIONAL',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delisted_at TIMESTAMPTZ,
  price_history JSONB DEFAULT '[]'::jsonb,
  identity_id UUID REFERENCES vehicle_identities(id),
  identity_mapped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT retail_listings_source_unique UNIQUE (source, source_listing_id)
);

-- 3. Sales Evidence
CREATE TABLE IF NOT EXISTS public.sales_evidence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  identity_id UUID NOT NULL REFERENCES vehicle_identities(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_row_id TEXT NOT NULL,
  dealer_id TEXT,
  dealer_name TEXT,
  exit_price INTEGER NOT NULL,
  exit_date DATE NOT NULL,
  km_at_exit INTEGER,
  days_to_exit INTEGER,
  gross_profit INTEGER,
  confidence_score INTEGER DEFAULT 50,
  region_scope TEXT DEFAULT 'state',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sales_evidence_source_unique UNIQUE (source_type, source_row_id)
);

-- 4. Proven Exits
CREATE TABLE IF NOT EXISTS public.proven_exits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  identity_id UUID NOT NULL REFERENCES vehicle_identities(id) ON DELETE CASCADE UNIQUE,
  exit_value INTEGER NOT NULL,
  exit_method TEXT NOT NULL DEFAULT 'median',
  sample_size INTEGER NOT NULL DEFAULT 0,
  recency_weighted BOOLEAN DEFAULT false,
  region_scope TEXT NOT NULL DEFAULT 'national',
  km_band_used TEXT NOT NULL,
  newest_sale_date DATE,
  oldest_sale_date DATE,
  sale_recency_days INTEGER,
  data_sources TEXT[] DEFAULT '{}',
  contributing_dealer_ids TEXT[] DEFAULT '{}',
  confidence_label TEXT DEFAULT 'low',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Trigger Config (layered guardrails - provisional)
CREATE TABLE IF NOT EXISTS public.trigger_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  guardrail_type TEXT NOT NULL DEFAULT 'layered',
  guardrail_value_pct NUMERIC(5,2) DEFAULT 5.00,
  guardrail_value_abs INTEGER DEFAULT 500,
  guardrail_max_gap INTEGER,
  min_sample_size_buy INTEGER DEFAULT 2,
  max_sale_age_days_buy INTEGER DEFAULT 270,
  min_confidence_buy TEXT DEFAULT 'medium',
  min_sample_size_watch INTEGER DEFAULT 1,
  max_sale_age_days_watch INTEGER DEFAULT 365,
  exit_method TEXT DEFAULT 'median',
  is_provisional BOOLEAN DEFAULT true,
  provisional_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active_from TIMESTAMPTZ,
  active_to TIMESTAMPTZ
);

INSERT INTO trigger_config (version, guardrail_type, guardrail_value_pct, guardrail_value_abs, min_sample_size_buy, max_sale_age_days_buy, is_provisional, provisional_notes, active_from)
VALUES ('v0', 'layered', 5.00, 500, 2, 270, true, 'Initial BUY guardrail (provisional) - 5% AND $500 minimum gap, sample>=2, sale within 270 days.', now())
ON CONFLICT (version) DO NOTHING;

-- 6. Trigger Evaluations (immutable log)
CREATE TABLE IF NOT EXISTS public.trigger_evaluations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID NOT NULL,
  listing_source TEXT NOT NULL,
  identity_id UUID NOT NULL REFERENCES vehicle_identities(id),
  config_version TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  listing_price INTEGER NOT NULL,
  listing_km INTEGER,
  proven_exit_value INTEGER,
  proven_exit_method TEXT,
  sample_size INTEGER,
  sale_recency_days INTEGER,
  region_scope TEXT,
  km_band_used TEXT,
  guardrail_pct_used NUMERIC(5,2),
  guardrail_abs_used INTEGER,
  result TEXT NOT NULL,
  reasons TEXT[] DEFAULT '{}',
  gate_failures TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Sales Triggers
CREATE TABLE IF NOT EXISTS public.sales_triggers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  evaluation_id UUID REFERENCES trigger_evaluations(id),
  listing_id UUID NOT NULL,
  identity_id UUID NOT NULL REFERENCES vehicle_identities(id),
  trigger_type TEXT NOT NULL,
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant_family TEXT,
  km INTEGER,
  asking_price INTEGER NOT NULL,
  listing_url TEXT,
  location TEXT,
  proven_exit_value INTEGER NOT NULL,
  proven_exit_summary TEXT,
  gap_dollars INTEGER NOT NULL,
  gap_pct NUMERIC(5,2) NOT NULL,
  confidence_label TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  target_dealer_ids TEXT[] DEFAULT '{}',
  target_region_id TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_identities_hash ON vehicle_identities(identity_hash);
CREATE INDEX IF NOT EXISTS idx_vehicle_identities_make_model ON vehicle_identities(make, model);
CREATE INDEX IF NOT EXISTS idx_retail_listings_identity ON retail_listings(identity_id);
CREATE INDEX IF NOT EXISTS idx_retail_listings_source ON retail_listings(source, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sales_evidence_identity ON sales_evidence(identity_id);
CREATE INDEX IF NOT EXISTS idx_trigger_evaluations_result ON trigger_evaluations(result, evaluated_at);
CREATE INDEX IF NOT EXISTS idx_sales_triggers_type ON sales_triggers(trigger_type, created_at);

-- Enable RLS
ALTER TABLE vehicle_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE proven_exits ENABLE ROW LEVEL SECURITY;
ALTER TABLE trigger_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE trigger_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_triggers ENABLE ROW LEVEL SECURITY;

-- RLS Policies (full access for now)
CREATE POLICY "Full access" ON vehicle_identities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON retail_listings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON sales_evidence FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON proven_exits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON trigger_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON trigger_evaluations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON sales_triggers FOR ALL USING (true) WITH CHECK (true);