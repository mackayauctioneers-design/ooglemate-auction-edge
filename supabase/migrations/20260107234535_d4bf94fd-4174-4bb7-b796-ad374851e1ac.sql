-- ===========================================================================
-- DEALER GROUPS & ROOFTOPS - Database-driven dealer configuration
-- ===========================================================================

-- Dealer Groups table
CREATE TABLE public.dealer_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_name TEXT NOT NULL UNIQUE,
  platform_type TEXT NOT NULL DEFAULT 'digitaldealer',  -- default parser mode
  discovery_url TEXT,                                    -- group directory/stock page
  region_id TEXT NOT NULL DEFAULT 'CENTRAL_COAST_NSW',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Dealer Rooftops table (individual dealerships within groups)
CREATE TABLE public.dealer_rooftops (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID REFERENCES public.dealer_groups(id) ON DELETE CASCADE,
  dealer_slug TEXT NOT NULL UNIQUE,
  dealer_name TEXT NOT NULL,
  inventory_url TEXT NOT NULL,
  suburb TEXT,
  state TEXT DEFAULT 'NSW',
  postcode TEXT,
  region_id TEXT NOT NULL DEFAULT 'CENTRAL_COAST_NSW',
  parser_mode TEXT NOT NULL,  -- digitaldealer, adtorque, etc
  enabled BOOLEAN NOT NULL DEFAULT false,
  priority TEXT NOT NULL DEFAULT 'normal',  -- high, normal, low
  anchor_dealer BOOLEAN NOT NULL DEFAULT false,
  -- Validation tracking
  validation_status TEXT NOT NULL DEFAULT 'pending',  -- pending, passed, failed
  validation_runs INTEGER NOT NULL DEFAULT 0,
  last_validated_at TIMESTAMP WITH TIME ZONE,
  validation_notes TEXT,
  -- Crawl stats (denormalized for quick access)
  last_crawl_at TIMESTAMP WITH TIME ZONE,
  last_vehicles_found INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.dealer_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_rooftops ENABLE ROW LEVEL SECURITY;

-- Admin-only policies (service role bypasses)
CREATE POLICY "Admin full access to dealer_groups" ON public.dealer_groups
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin full access to dealer_rooftops" ON public.dealer_rooftops
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Allow service role / edge functions to read
CREATE POLICY "Service role read dealer_groups" ON public.dealer_groups
  FOR SELECT USING (true);

CREATE POLICY "Service role read dealer_rooftops" ON public.dealer_rooftops
  FOR SELECT USING (true);

-- Indexes
CREATE INDEX idx_rooftops_group_id ON public.dealer_rooftops(group_id);
CREATE INDEX idx_rooftops_enabled ON public.dealer_rooftops(enabled) WHERE enabled = true;
CREATE INDEX idx_rooftops_validation ON public.dealer_rooftops(validation_status);
CREATE INDEX idx_rooftops_region ON public.dealer_rooftops(region_id);

-- Trigger for updated_at
CREATE TRIGGER update_dealer_groups_updated_at
  BEFORE UPDATE ON public.dealer_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_dealer_rooftops_updated_at
  BEFORE UPDATE ON public.dealer_rooftops
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===========================================================================
-- SEED: Brian Hilton Group (already validated)
-- ===========================================================================
INSERT INTO public.dealer_groups (group_name, platform_type, region_id, notes) VALUES
  ('Brian Hilton Group', 'digitaldealer', 'CENTRAL_COAST_NSW', 'Anchor dealer group - 8 rooftops'),
  ('Central Coast Motor Group', 'adtorque', 'CENTRAL_COAST_NSW', 'CCMG - 7 rooftops, AdTorque platform'),
  ('Central Auto Group', 'digitaldealer', 'CENTRAL_COAST_NSW', '5 rooftops'),
  ('Tuggerah Auto Group', 'digitaldealer', 'CENTRAL_COAST_NSW', '4 rooftops'),
  ('Cardiff Motor Group', 'digitaldealer', 'CENTRAL_COAST_NSW', 'Hunter-adjacent, services CC'),
  ('Independent Dealers', 'digitaldealer', 'CENTRAL_COAST_NSW', 'Standalone dealers');

-- ===========================================================================
-- SEED: Validated rooftops (from existing tested dealers)
-- ===========================================================================
WITH groups AS (
  SELECT id, group_name FROM public.dealer_groups
)
INSERT INTO public.dealer_rooftops (
  group_id, dealer_slug, dealer_name, inventory_url, suburb, postcode, 
  region_id, parser_mode, enabled, priority, anchor_dealer, 
  validation_status, validation_runs
)
SELECT 
  g.id,
  v.dealer_slug,
  v.dealer_name,
  v.inventory_url,
  v.suburb,
  v.postcode,
  v.region_id,
  v.parser_mode,
  v.enabled,
  v.priority,
  v.anchor_dealer,
  'passed',  -- Already validated
  2          -- 2 runs passed
FROM groups g
JOIN (VALUES
  -- Brian Hilton Group (validated - digitaldealer)
  ('Brian Hilton Group', 'brian-hilton-toyota', 'Brian Hilton Toyota', 'https://brianhiltontoyota.com.au/used-cars/', 'North Gosford', '2250', 'CENTRAL_COAST_NSW', 'digitaldealer', true, 'high', true),
  ('Brian Hilton Group', 'brian-hilton-kia', 'Brian Hilton Kia', 'https://brianhiltonkia.com.au/used-cars/', 'North Gosford', '2250', 'CENTRAL_COAST_NSW', 'digitaldealer', true, 'normal', false),
  ('Brian Hilton Group', 'brian-hilton-honda', 'Brian Hilton Honda', 'https://brianhiltonhonda.com.au/used-cars/', 'North Gosford', '2250', 'CENTRAL_COAST_NSW', 'digitaldealer', true, 'normal', false),
  ('Brian Hilton Group', 'brian-hilton-suzuki', 'Brian Hilton Suzuki', 'https://brianhiltonsuzuki.com.au/used-cars/', 'North Gosford', '2250', 'CENTRAL_COAST_NSW', 'digitaldealer', true, 'normal', false),
  ('Brian Hilton Group', 'brian-hilton-renault', 'Brian Hilton Renault', 'https://brianhiltonrenault.com.au/used-cars/', 'North Gosford', '2250', 'CENTRAL_COAST_NSW', 'digitaldealer', true, 'normal', false),
  ('Brian Hilton Group', 'brian-hilton-gwm', 'Brian Hilton GWM Haval', 'https://brianhiltongwmhaval.com.au/used-cars/', 'North Gosford', '2250', 'CENTRAL_COAST_NSW', 'digitaldealer', true, 'normal', false),
  ('Brian Hilton Group', 'brian-hilton-skoda', 'Brian Hilton Skoda', 'https://brianhiltonskoda.com.au/used-cars/', 'North Gosford', '2250', 'CENTRAL_COAST_NSW', 'digitaldealer', true, 'normal', false),
  ('Brian Hilton Group', 'brian-hilton-ldv', 'Brian Hilton LDV', 'https://brianhiltonldv.com.au/used-cars/', 'North Gosford', '2250', 'CENTRAL_COAST_NSW', 'digitaldealer', true, 'normal', false),
  
  -- CCMG (validated - adtorque)
  ('Central Coast Motor Group', 'ccmg', 'Central Coast Motor Group', 'https://www.ccmg.com.au/stock?condition=Used', 'Gosford', '2250', 'CENTRAL_COAST_NSW', 'adtorque', true, 'normal', false),
  ('Central Coast Motor Group', 'gosford-mazda', 'Gosford Mazda', 'https://gosfordmazda.com.au/stock?condition=Used', 'Gosford', '2250', 'CENTRAL_COAST_NSW', 'adtorque', true, 'normal', false),
  ('Central Coast Motor Group', 'central-coast-subaru', 'Central Coast Subaru', 'https://www.ccsubaru.com.au/stock?condition=Used', 'Gosford', '2250', 'CENTRAL_COAST_NSW', 'adtorque', true, 'normal', false),
  ('Central Coast Motor Group', 'central-coast-vw', 'Central Coast Volkswagen', 'https://www.ccvolkswagen.com.au/stock?condition=Used', 'West Gosford', '2250', 'CENTRAL_COAST_NSW', 'adtorque', true, 'normal', false),
  ('Central Coast Motor Group', 'central-coast-isuzu', 'Central Coast Isuzu UTE', 'https://www.ccisuzuute.com.au/stock?condition=Used', 'Gosford', '2250', 'CENTRAL_COAST_NSW', 'adtorque', true, 'normal', false),
  ('Central Coast Motor Group', 'chery-gosford', 'Chery Gosford', 'https://www.cherygosford.com.au/stock?condition=Used', 'Gosford', '2250', 'CENTRAL_COAST_NSW', 'adtorque', true, 'normal', false),
  ('Central Coast Motor Group', 'mercedes-gosford', 'Mercedes-Benz Gosford', 'https://www.mbgosford.com.au/vehicles/used/', 'Gosford', '2250', 'CENTRAL_COAST_NSW', 'adtorque', true, 'normal', false)
) AS v(group_name, dealer_slug, dealer_name, inventory_url, suburb, postcode, region_id, parser_mode, enabled, priority, anchor_dealer)
ON g.group_name = v.group_name;