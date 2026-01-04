-- Create update_updated_at_column function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create vehicle_listings table for Pickles/Manheim ingestion
CREATE TABLE IF NOT EXISTS public.vehicle_listings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id TEXT NOT NULL UNIQUE, -- e.g., "Pickles:12345"
  lot_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'pickles', -- pickles, manheim, etc.
  auction_house TEXT NOT NULL DEFAULT 'Pickles',
  event_id TEXT,
  
  -- Vehicle details
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant_raw TEXT,
  variant_family TEXT,
  year INTEGER NOT NULL,
  km INTEGER,
  transmission TEXT,
  drivetrain TEXT,
  fuel TEXT,
  
  -- Auction details
  location TEXT,
  auction_datetime TIMESTAMPTZ,
  listing_url TEXT,
  reserve INTEGER,
  highest_bid INTEGER,
  
  -- Status & lifecycle
  status TEXT NOT NULL DEFAULT 'catalogue', -- catalogue, listed, passed_in, sold, withdrawn
  pass_count INTEGER NOT NULL DEFAULT 0,
  relist_count INTEGER NOT NULL DEFAULT 0,
  
  -- Visibility
  visible_to_dealers BOOLEAN NOT NULL DEFAULT true,
  excluded_reason TEXT,
  excluded_keyword TEXT,
  
  -- Timestamps
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_auction_date TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Auction history (JSONB array of past auction results)
  auction_history JSONB DEFAULT '[]'::jsonb
);

-- Create ingestion_runs table for tracking ingestion jobs
CREATE TABLE IF NOT EXISTS public.ingestion_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL, -- pickles_catalogue, pickles_results, manheim_catalogue
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running', -- running, success, failed
  lots_found INTEGER DEFAULT 0,
  lots_created INTEGER DEFAULT 0,
  lots_updated INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create dealer_fingerprints table for matching
CREATE TABLE IF NOT EXISTS public.dealer_fingerprints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fingerprint_id TEXT NOT NULL UNIQUE,
  dealer_name TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant_family TEXT,
  year_min INTEGER NOT NULL,
  year_max INTEGER NOT NULL,
  min_km INTEGER,
  max_km INTEGER,
  is_spec_only BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create alert_logs table for Pickles alerts
CREATE TABLE IF NOT EXISTS public.alert_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id TEXT NOT NULL UNIQUE,
  dealer_name TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  fingerprint_id TEXT NOT NULL,
  alert_type TEXT NOT NULL, -- UPCOMING, ACTION
  action_reason TEXT, -- passed_in, relisted, reserve_softened
  match_type TEXT NOT NULL DEFAULT 'exact', -- exact (Tier 1), probable (Tier 2)
  message_text TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- new, read, acknowledged
  read_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Lot details for display
  lot_make TEXT,
  lot_model TEXT,
  lot_variant TEXT,
  lot_year INTEGER,
  auction_house TEXT,
  auction_datetime TIMESTAMPTZ,
  location TEXT,
  listing_url TEXT
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_source ON public.vehicle_listings(source);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_status ON public.vehicle_listings(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_make_model ON public.vehicle_listings(make, model);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_auction_datetime ON public.vehicle_listings(auction_datetime);

CREATE INDEX IF NOT EXISTS idx_dealer_fingerprints_dealer ON public.dealer_fingerprints(dealer_name);
CREATE INDEX IF NOT EXISTS idx_dealer_fingerprints_make_model ON public.dealer_fingerprints(make, model);
CREATE INDEX IF NOT EXISTS idx_dealer_fingerprints_active ON public.dealer_fingerprints(is_active);

CREATE INDEX IF NOT EXISTS idx_alert_logs_dealer ON public.alert_logs(dealer_name);
CREATE INDEX IF NOT EXISTS idx_alert_logs_dedup_key ON public.alert_logs(dedup_key);
CREATE INDEX IF NOT EXISTS idx_alert_logs_status ON public.alert_logs(status);

-- Enable RLS
ALTER TABLE public.vehicle_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for vehicle_listings (public read, service write)
CREATE POLICY "Anyone can view vehicle listings" ON public.vehicle_listings FOR SELECT USING (true);
CREATE POLICY "Service can manage vehicle listings" ON public.vehicle_listings FOR ALL USING (true) WITH CHECK (true);

-- RLS policies for ingestion_runs (admin only)
CREATE POLICY "Service can manage ingestion runs" ON public.ingestion_runs FOR ALL USING (true) WITH CHECK (true);

-- RLS policies for dealer_fingerprints (public read, service write)
CREATE POLICY "Anyone can view fingerprints" ON public.dealer_fingerprints FOR SELECT USING (true);
CREATE POLICY "Service can manage fingerprints" ON public.dealer_fingerprints FOR ALL USING (true) WITH CHECK (true);

-- RLS policies for alert_logs (public read, service write)
CREATE POLICY "Anyone can view alerts" ON public.alert_logs FOR SELECT USING (true);
CREATE POLICY "Service can manage alerts" ON public.alert_logs FOR ALL USING (true) WITH CHECK (true);

-- Triggers for updated_at
CREATE TRIGGER update_vehicle_listings_updated_at
  BEFORE UPDATE ON public.vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_dealer_fingerprints_updated_at
  BEFORE UPDATE ON public.dealer_fingerprints
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();