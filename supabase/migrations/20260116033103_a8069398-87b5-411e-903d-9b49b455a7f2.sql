-- ============================================================================
-- KITING MODE (Active Sale Hunts) v1 - Complete Schema
-- ============================================================================

-- 1. sale_hunts - Core hunt profiles (auto-created from sales)
CREATE TABLE public.sale_hunts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id UUID NOT NULL,
  source_sale_id UUID NULL, -- link to dealer_sales if available
  
  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done', 'expired')),
  priority INT NOT NULL DEFAULT 5,
  
  -- Identity target
  year INT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant_family TEXT NULL,
  fuel TEXT NULL,
  transmission TEXT NULL,
  drivetrain TEXT NULL,
  
  -- KM targeting
  km INT NULL,
  km_band TEXT NULL,
  km_tolerance_pct NUMERIC NOT NULL DEFAULT 15,
  
  -- Pricing truth
  proven_exit_method TEXT NOT NULL DEFAULT 'sale_snapshot',
  proven_exit_value INT NULL,
  min_gap_abs_buy INT NOT NULL DEFAULT 800,
  min_gap_pct_buy NUMERIC NOT NULL DEFAULT 4.0,
  min_gap_abs_watch INT NOT NULL DEFAULT 400,
  min_gap_pct_watch NUMERIC NOT NULL DEFAULT 2.0,
  
  -- Source scope
  sources_enabled TEXT[] NOT NULL DEFAULT '{autotrader,drive,gumtree_dealer}',
  include_private BOOLEAN NOT NULL DEFAULT false,
  
  -- Geo scope
  states TEXT[] NULL,
  radius_km INT NULL,
  geo_mode TEXT NOT NULL DEFAULT 'state',
  
  -- Freshness constraints
  max_listing_age_days_buy INT NOT NULL DEFAULT 7,
  max_listing_age_days_watch INT NOT NULL DEFAULT 14,
  
  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '30 days'),
  last_scan_at TIMESTAMPTZ NULL,
  scan_interval_minutes INT NOT NULL DEFAULT 60,
  notes TEXT NULL
);

-- Indexes for sale_hunts
CREATE INDEX idx_sale_hunts_dealer_status ON public.sale_hunts(dealer_id, status);
CREATE INDEX idx_sale_hunts_status_scan ON public.sale_hunts(status, last_scan_at);
CREATE INDEX idx_sale_hunts_source_sale ON public.sale_hunts(source_sale_id) WHERE source_sale_id IS NOT NULL;

-- RLS for sale_hunts
ALTER TABLE public.sale_hunts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dealers can view own hunts" ON public.sale_hunts
  FOR SELECT USING (
    dealer_id IN (
      SELECT id FROM public.dealer_profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Dealers can update own hunts" ON public.sale_hunts
  FOR UPDATE USING (
    dealer_id IN (
      SELECT id FROM public.dealer_profiles WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role full access to sale_hunts" ON public.sale_hunts
  FOR ALL USING (true) WITH CHECK (true);

-- 2. hunt_matches - Every candidate evaluated
CREATE TABLE public.hunt_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_id UUID NOT NULL REFERENCES public.sale_hunts(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL,
  
  -- Scoring
  match_score NUMERIC(5,2) NOT NULL,
  confidence_label TEXT NOT NULL CHECK (confidence_label IN ('high', 'medium', 'low')),
  reasons TEXT[] DEFAULT '{}',
  
  -- Pricing analysis
  asking_price INT NULL,
  proven_exit_value INT NULL,
  gap_dollars INT NULL,
  gap_pct NUMERIC(6,2) NULL,
  
  -- Decision
  decision TEXT NOT NULL CHECK (decision IN ('buy', 'watch', 'ignore', 'no_evidence')),
  
  -- Timestamps
  matched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for hunt_matches
CREATE UNIQUE INDEX idx_hunt_matches_unique ON public.hunt_matches(hunt_id, listing_id);
CREATE INDEX idx_hunt_matches_decision ON public.hunt_matches(hunt_id, decision, matched_at DESC);

-- RLS for hunt_matches
ALTER TABLE public.hunt_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dealers view matches for own hunts" ON public.hunt_matches
  FOR SELECT USING (
    hunt_id IN (
      SELECT h.id FROM public.sale_hunts h
      JOIN public.dealer_profiles dp ON dp.id = h.dealer_id
      WHERE dp.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role full access to hunt_matches" ON public.hunt_matches
  FOR ALL USING (true) WITH CHECK (true);

-- 3. hunt_alerts - User-facing BUY/WATCH alerts
CREATE TABLE public.hunt_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_id UUID NOT NULL REFERENCES public.sale_hunts(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL,
  
  -- Alert info
  alert_type TEXT NOT NULL CHECK (alert_type IN ('BUY', 'WATCH')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ NULL,
  
  -- Render-ready payload
  payload JSONB NOT NULL
);

-- Indexes for hunt_alerts
CREATE INDEX idx_hunt_alerts_hunt ON public.hunt_alerts(hunt_id, created_at DESC);
CREATE INDEX idx_hunt_alerts_unacked ON public.hunt_alerts(hunt_id, acknowledged_at) WHERE acknowledged_at IS NULL;
CREATE UNIQUE INDEX idx_hunt_alerts_dedupe ON public.hunt_alerts(hunt_id, listing_id, alert_type);

-- RLS for hunt_alerts
ALTER TABLE public.hunt_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dealers view alerts for own hunts" ON public.hunt_alerts
  FOR SELECT USING (
    hunt_id IN (
      SELECT h.id FROM public.sale_hunts h
      JOIN public.dealer_profiles dp ON dp.id = h.dealer_id
      WHERE dp.user_id = auth.uid()
    )
  );

CREATE POLICY "Dealers update own alerts" ON public.hunt_alerts
  FOR UPDATE USING (
    hunt_id IN (
      SELECT h.id FROM public.sale_hunts h
      JOIN public.dealer_profiles dp ON dp.id = h.dealer_id
      WHERE dp.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role full access to hunt_alerts" ON public.hunt_alerts
  FOR ALL USING (true) WITH CHECK (true);

-- 4. hunt_scans - Audit log of scan runs
CREATE TABLE public.hunt_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_id UUID NOT NULL REFERENCES public.sale_hunts(id) ON DELETE CASCADE,
  
  -- Run info
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  source TEXT NULL, -- which lane/source was scanned
  
  -- Status
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  error TEXT NULL,
  
  -- Stats
  candidates_checked INT NULL,
  matches_found INT NULL,
  alerts_emitted INT NULL,
  metadata JSONB NULL
);

-- Indexes for hunt_scans
CREATE INDEX idx_hunt_scans_hunt ON public.hunt_scans(hunt_id, started_at DESC);

-- RLS for hunt_scans
ALTER TABLE public.hunt_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dealers view scans for own hunts" ON public.hunt_scans
  FOR SELECT USING (
    hunt_id IN (
      SELECT h.id FROM public.sale_hunts h
      JOIN public.dealer_profiles dp ON dp.id = h.dealer_id
      WHERE dp.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role full access to hunt_scans" ON public.hunt_scans
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- Trigger: Auto-create hunt when sale is uploaded
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_auto_create_hunt_on_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hunt_id UUID;
  v_state TEXT;
BEGIN
  -- Extract state from sale if available
  v_state := NEW.state;
  
  -- Create hunt profile from the sale
  INSERT INTO public.sale_hunts (
    dealer_id,
    source_sale_id,
    year,
    make,
    model,
    variant_family,
    km,
    proven_exit_method,
    proven_exit_value,
    states,
    geo_mode,
    notes
  ) VALUES (
    NEW.dealer_id,
    NEW.id,
    NEW.year,
    NEW.make,
    NEW.model,
    NULL, -- variant_family can be enriched later
    NEW.km,
    'sale_snapshot',
    NEW.sell_price,
    CASE WHEN v_state IS NOT NULL THEN ARRAY[v_state] ELSE NULL END,
    CASE WHEN v_state IS NOT NULL THEN 'state' ELSE 'national' END,
    'Auto-created from sale on ' || NEW.sold_date::text
  )
  RETURNING id INTO v_hunt_id;
  
  RETURN NEW;
END;
$$;

-- Attach trigger to dealer_sales
DROP TRIGGER IF EXISTS trg_auto_create_hunt_on_sale ON public.dealer_sales;
CREATE TRIGGER trg_auto_create_hunt_on_sale
  AFTER INSERT ON public.dealer_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_create_hunt_on_sale();

-- ============================================================================
-- Function: Get due hunts for scanning
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_due_hunt_scans(p_limit INT DEFAULT 20)
RETURNS TABLE (
  hunt_id UUID,
  dealer_id UUID,
  year INT,
  make TEXT,
  model TEXT,
  variant_family TEXT,
  km INT,
  proven_exit_value INT,
  sources_enabled TEXT[],
  include_private BOOLEAN,
  states TEXT[],
  geo_mode TEXT,
  max_listing_age_days_buy INT,
  max_listing_age_days_watch INT,
  min_gap_abs_buy INT,
  min_gap_pct_buy NUMERIC,
  min_gap_abs_watch INT,
  min_gap_pct_watch NUMERIC,
  km_tolerance_pct NUMERIC,
  scan_interval_minutes INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    h.id as hunt_id,
    h.dealer_id,
    h.year,
    h.make,
    h.model,
    h.variant_family,
    h.km,
    h.proven_exit_value,
    h.sources_enabled,
    h.include_private,
    h.states,
    h.geo_mode,
    h.max_listing_age_days_buy,
    h.max_listing_age_days_watch,
    h.min_gap_abs_buy,
    h.min_gap_pct_buy,
    h.min_gap_abs_watch,
    h.min_gap_pct_watch,
    h.km_tolerance_pct,
    h.scan_interval_minutes
  FROM public.sale_hunts h
  WHERE h.status = 'active'
    AND (h.expires_at IS NULL OR h.expires_at > now())
    AND (
      h.last_scan_at IS NULL 
      OR h.last_scan_at < now() - (h.scan_interval_minutes || ' minutes')::interval
    )
  ORDER BY h.priority DESC, h.last_scan_at ASC NULLS FIRST
  LIMIT p_limit;
$$;