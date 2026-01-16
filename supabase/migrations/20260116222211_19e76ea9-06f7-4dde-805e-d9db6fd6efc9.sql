-- Badge/Series/Engine Authority Layer v1
-- Prevents trust-killing mismatches (LC79 vs LC300, V8 vs 4cyl, cab chassis vs wagon)

-- ============================================
-- 1. Add classification columns to retail_listings
-- ============================================
ALTER TABLE public.retail_listings
  ADD COLUMN IF NOT EXISTS model_root text,
  ADD COLUMN IF NOT EXISTS series_family text,
  ADD COLUMN IF NOT EXISTS badge text,
  ADD COLUMN IF NOT EXISTS badge_tier int,
  ADD COLUMN IF NOT EXISTS body_type text,
  ADD COLUMN IF NOT EXISTS engine_family text,
  ADD COLUMN IF NOT EXISTS variant_confidence text DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS variant_source text,
  ADD COLUMN IF NOT EXISTS variant_reasons text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS classified_at timestamptz;

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_retail_listings_series_family ON public.retail_listings(make, model, series_family);
CREATE INDEX IF NOT EXISTS idx_retail_listings_engine_family ON public.retail_listings(engine_family);
CREATE INDEX IF NOT EXISTS idx_retail_listings_body_type ON public.retail_listings(body_type);

-- ============================================
-- 2. Add classification columns to sale_hunts
-- ============================================
ALTER TABLE public.sale_hunts
  ADD COLUMN IF NOT EXISTS model_root text,
  ADD COLUMN IF NOT EXISTS series_family text,
  ADD COLUMN IF NOT EXISTS badge text,
  ADD COLUMN IF NOT EXISTS badge_tier int,
  ADD COLUMN IF NOT EXISTS body_type text,
  ADD COLUMN IF NOT EXISTS engine_family text,
  ADD COLUMN IF NOT EXISTS variant_confidence text DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS variant_source text,
  ADD COLUMN IF NOT EXISTS variant_reasons text[] DEFAULT '{}';

-- ============================================
-- 3. Create model_taxonomy table
-- ============================================
CREATE TABLE IF NOT EXISTS public.model_taxonomy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL,
  model_root text NOT NULL,
  series_family text NOT NULL,
  badge_tiers jsonb NOT NULL DEFAULT '{}',
  body_types_allowed text[] DEFAULT '{}',
  engine_families_allowed text[] DEFAULT '{}',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(make, model_root, series_family)
);

-- Enable RLS
ALTER TABLE public.model_taxonomy ENABLE ROW LEVEL SECURITY;

-- Public read access (reference data)
CREATE POLICY "model_taxonomy_public_read" ON public.model_taxonomy
  FOR SELECT USING (true);

-- ============================================
-- 4. Create variant_rules table
-- ============================================
CREATE TABLE IF NOT EXISTS public.variant_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL,
  model_root text NOT NULL,
  priority int DEFAULT 100,
  rule_type text NOT NULL CHECK (rule_type IN ('SET', 'HARD_BLOCK', 'BADGE_TIER', 'INFER')),
  pattern text NOT NULL,
  apply_to text NOT NULL DEFAULT 'any' CHECK (apply_to IN ('url', 'title', 'variant_raw', 'any')),
  set_json jsonb NOT NULL DEFAULT '{}',
  confidence text DEFAULT 'high' CHECK (confidence IN ('high', 'medium', 'low')),
  enabled boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.variant_rules ENABLE ROW LEVEL SECURITY;

-- Public read access (reference data)
CREATE POLICY "variant_rules_public_read" ON public.variant_rules
  FOR SELECT USING (true);

-- Index for efficient rule lookup
CREATE INDEX IF NOT EXISTS idx_variant_rules_lookup ON public.variant_rules(make, model_root, priority) WHERE enabled = true;

-- ============================================
-- 5. Create variant_audit table
-- ============================================
CREATE TABLE IF NOT EXISTS public.variant_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid REFERENCES public.retail_listings(id) ON DELETE CASCADE,
  hunt_id uuid REFERENCES public.sale_hunts(id) ON DELETE CASCADE,
  raw_title text,
  raw_variant text,
  raw_url text,
  output_model_root text,
  output_series_family text,
  output_badge text,
  output_badge_tier int,
  output_body_type text,
  output_engine_family text,
  confidence text,
  reasons text[],
  rules_applied uuid[],
  classified_at timestamptz DEFAULT now(),
  CHECK (listing_id IS NOT NULL OR hunt_id IS NOT NULL)
);

-- Enable RLS
ALTER TABLE public.variant_audit ENABLE ROW LEVEL SECURITY;

-- Public read for debugging
CREATE POLICY "variant_audit_public_read" ON public.variant_audit
  FOR SELECT USING (true);

-- Index for lookup
CREATE INDEX IF NOT EXISTS idx_variant_audit_listing ON public.variant_audit(listing_id);
CREATE INDEX IF NOT EXISTS idx_variant_audit_hunt ON public.variant_audit(hunt_id);

-- ============================================
-- 6. Create listing_classify_queue table
-- ============================================
CREATE TABLE IF NOT EXISTS public.listing_classify_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.retail_listings(id) ON DELETE CASCADE,
  queued_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  error text,
  UNIQUE(listing_id)
);

-- Enable RLS
ALTER TABLE public.listing_classify_queue ENABLE ROW LEVEL SECURITY;

-- Public access for edge function
CREATE POLICY "listing_classify_queue_public" ON public.listing_classify_queue
  FOR ALL USING (true);

-- ============================================
-- 7. Seed Toyota LandCruiser taxonomy
-- ============================================
INSERT INTO public.model_taxonomy (make, model_root, series_family, badge_tiers, body_types_allowed, engine_families_allowed, notes)
VALUES
  ('TOYOTA', 'LANDCRUISER', 'LC70', 
   '{"WORKMATE": 1, "GX": 2, "GXL": 3}',
   ARRAY['CAB_CHASSIS', 'UTE', 'WAGON'],
   ARRAY['V8_DIESEL', 'I4_DIESEL', 'V6_PETROL'],
   '70 Series - VDJ76/78/79, GDJ76/78/79, GRJ76/79'),
  ('TOYOTA', 'LANDCRUISER', 'LC200',
   '{"GX": 1, "GXL": 2, "VX": 3, "SAHARA": 4}',
   ARRAY['WAGON'],
   ARRAY['V8_DIESEL', 'V8_PETROL'],
   '200 Series wagon - UZJ200, VDJ200'),
  ('TOYOTA', 'LANDCRUISER', 'LC300',
   '{"GX": 1, "GXL": 2, "VX": 3, "SAHARA": 4, "GR SPORT": 5}',
   ARRAY['WAGON'],
   ARRAY['V6_DIESEL', 'V6_PETROL'],
   '300 Series wagon - FJA300'),
  ('TOYOTA', 'PRADO', 'PRADO150',
   '{"GX": 1, "GXL": 2, "VX": 3, "KAKADU": 4}',
   ARRAY['WAGON'],
   ARRAY['I4_DIESEL', 'V6_PETROL'],
   'Prado 150 Series')
ON CONFLICT (make, model_root, series_family) DO NOTHING;

-- ============================================
-- 8. Seed Toyota LandCruiser variant_rules
-- ============================================

-- Series detection from model codes
INSERT INTO public.variant_rules (make, model_root, priority, rule_type, pattern, apply_to, set_json, confidence, notes)
VALUES
  -- LC70 Series + Engine from Toyota codes
  ('TOYOTA', 'LANDCRUISER', 10, 'SET', '(VDJ76|VDJ78|VDJ79)', 'any', 
   '{"series_family": "LC70", "engine_family": "V8_DIESEL"}', 'high', 'VDJ = 1VD-FTV V8 diesel'),
  ('TOYOTA', 'LANDCRUISER', 10, 'SET', '(1VD|1VD-FTV)', 'any',
   '{"series_family": "LC70", "engine_family": "V8_DIESEL"}', 'high', '1VD engine code'),
  ('TOYOTA', 'LANDCRUISER', 10, 'SET', '(GDJ76|GDJ78|GDJ79)', 'any',
   '{"series_family": "LC70", "engine_family": "I4_DIESEL"}', 'high', 'GDJ = 1GD-FTV 4cyl diesel'),
  ('TOYOTA', 'LANDCRUISER', 10, 'SET', '(1GD|1GD-FTV|2\.8L?\s*DIESEL|2\.8\s*TURBO)', 'any',
   '{"series_family": "LC70", "engine_family": "I4_DIESEL"}', 'high', '1GD/2.8L diesel'),
  ('TOYOTA', 'LANDCRUISER', 10, 'SET', '(GRJ76|GRJ79)', 'any',
   '{"series_family": "LC70", "engine_family": "V6_PETROL"}', 'high', 'GRJ = V6 petrol'),
  
  -- LC70 from series mentions
  ('TOYOTA', 'LANDCRUISER', 20, 'SET', '(LC70|LC76|LC78|LC79|70\s*SERIES|79\s*SERIES|78\s*SERIES|76\s*SERIES)', 'any',
   '{"series_family": "LC70"}', 'high', 'LC70 series patterns'),
  
  -- LC200 patterns
  ('TOYOTA', 'LANDCRUISER', 20, 'SET', '(LC200|200\s*SERIES|VDJ200|UZJ200)', 'any',
   '{"series_family": "LC200"}', 'high', 'LC200 series patterns'),
  
  -- LC300 patterns
  ('TOYOTA', 'LANDCRUISER', 20, 'SET', '(LC300|300\s*SERIES|FJA300)', 'any',
   '{"series_family": "LC300"}', 'high', 'LC300 series patterns'),
  
  -- Badge detection
  ('TOYOTA', 'LANDCRUISER', 50, 'SET', '(\bWORKMATE\b)', 'any',
   '{"badge": "WORKMATE"}', 'high', 'Workmate badge'),
  ('TOYOTA', 'LANDCRUISER', 50, 'SET', '(\bGXL\b)', 'any',
   '{"badge": "GXL"}', 'high', 'GXL badge'),
  ('TOYOTA', 'LANDCRUISER', 50, 'SET', '(\bVX\b)', 'any',
   '{"badge": "VX"}', 'high', 'VX badge'),
  ('TOYOTA', 'LANDCRUISER', 50, 'SET', '(\bSAHARA\b)', 'any',
   '{"badge": "SAHARA"}', 'high', 'Sahara badge'),
  ('TOYOTA', 'LANDCRUISER', 50, 'SET', '(GR[\s-]?SPORT)', 'any',
   '{"badge": "GR SPORT"}', 'high', 'GR Sport badge'),
  ('TOYOTA', 'LANDCRUISER', 50, 'SET', '(\bGX\b)(?!L)', 'any',
   '{"badge": "GX"}', 'medium', 'GX badge (not GXL)'),
  
  -- Body type detection
  ('TOYOTA', 'LANDCRUISER', 60, 'SET', '(CAB[\s-]?CHASSIS|CABCHASSIS|TRAY[\s-]?BACK|TRAYBACK)', 'any',
   '{"body_type": "CAB_CHASSIS"}', 'high', 'Cab chassis body'),
  ('TOYOTA', 'LANDCRUISER', 60, 'SET', '(\bWAGON\b)', 'any',
   '{"body_type": "WAGON"}', 'high', 'Wagon body'),
  ('TOYOTA', 'LANDCRUISER', 60, 'SET', '(\bUTE\b|DUAL[\s-]?CAB|SINGLE[\s-]?CAB|DUAL\s*C\/B|SINGLE\s*C\/B)', 'any',
   '{"body_type": "UTE"}', 'high', 'Ute body'),
  ('TOYOTA', 'LANDCRUISER', 65, 'SET', '(\bTROOP[\s-]?CARRIER\b|\bTROOPIE\b|\bTROOPY\b)', 'any',
   '{"body_type": "WAGON", "badge": "WORKMATE"}', 'high', 'Troopcarrier = wagon workmate'),
  
  -- Engine family from text (lower priority)
  ('TOYOTA', 'LANDCRUISER', 70, 'SET', '(V8[\s-]?DIESEL|4\.5[\s-]?V8|4\.5L[\s-]?DIESEL)', 'any',
   '{"engine_family": "V8_DIESEL"}', 'medium', 'V8 diesel text match'),
  ('TOYOTA', 'LANDCRUISER', 70, 'SET', '(V6[\s-]?DIESEL|3\.3[\s-]?DIESEL|3\.3L[\s-]?DIESEL|TWIN[\s-]?TURBO[\s-]?DIESEL)', 'any',
   '{"engine_family": "V6_DIESEL"}', 'medium', 'V6 diesel (LC300)'),
  ('TOYOTA', 'LANDCRUISER', 70, 'SET', '(V6[\s-]?PETROL|4\.0[\s-]?PETROL|4\.0L[\s-]?PETROL)', 'any',
   '{"engine_family": "V6_PETROL"}', 'medium', 'V6 petrol text match'),
  ('TOYOTA', 'LANDCRUISER', 70, 'SET', '(4[\s-]?CYL|I4|INLINE[\s-]?4|FOUR[\s-]?CYLINDER)', 'any',
   '{"engine_family": "I4_DIESEL"}', 'low', 'Generic 4cyl - assume diesel for LC'),
   
  -- Prado rules
  ('TOYOTA', 'PRADO', 20, 'SET', '(PRADO|GDJ150|TRJ150|GRJ150)', 'any',
   '{"series_family": "PRADO150"}', 'high', 'Prado 150 series'),
  ('TOYOTA', 'PRADO', 50, 'SET', '(\bKAKADU\b)', 'any',
   '{"badge": "KAKADU"}', 'high', 'Kakadu badge'),
  ('TOYOTA', 'PRADO', 50, 'SET', '(\bGXL\b)', 'any',
   '{"badge": "GXL"}', 'high', 'GXL badge'),
  ('TOYOTA', 'PRADO', 50, 'SET', '(\bVX\b)', 'any',
   '{"badge": "VX"}', 'high', 'VX badge'),
  ('TOYOTA', 'PRADO', 50, 'SET', '(\bGX\b)(?!L)', 'any',
   '{"badge": "GX"}', 'medium', 'GX badge')
ON CONFLICT DO NOTHING;