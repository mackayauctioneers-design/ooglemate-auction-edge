-- 1.1 Add enrichment columns to retail_listings
ALTER TABLE public.retail_listings 
ADD COLUMN IF NOT EXISTS badge text,
ADD COLUMN IF NOT EXISTS body_type text,
ADD COLUMN IF NOT EXISTS engine_family text,
ADD COLUMN IF NOT EXISTS engine_size_l numeric,
ADD COLUMN IF NOT EXISTS fuel_type text,
ADD COLUMN IF NOT EXISTS transmission text,
ADD COLUMN IF NOT EXISTS drivetrain text,
ADD COLUMN IF NOT EXISTS series_code text,
ADD COLUMN IF NOT EXISTS enriched_at timestamptz,
ADD COLUMN IF NOT EXISTS enrichment_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS enrichment_source text,
ADD COLUMN IF NOT EXISTS enrichment_errors text;

-- Indexes for enrichment
CREATE INDEX IF NOT EXISTS idx_retail_listings_enrichment_status ON public.retail_listings (source, enrichment_status);
CREATE INDEX IF NOT EXISTS idx_retail_listings_badge ON public.retail_listings (make, model, badge);
CREATE INDEX IF NOT EXISTS idx_retail_listings_engine_body ON public.retail_listings (make, model, engine_family, body_type);

-- 1.2 Add required fields to sale_hunts
ALTER TABLE public.sale_hunts
ADD COLUMN IF NOT EXISTS required_badge text,
ADD COLUMN IF NOT EXISTS required_body_type text,
ADD COLUMN IF NOT EXISTS required_engine_family text,
ADD COLUMN IF NOT EXISTS required_engine_size_l numeric;

-- 3.1 Create listing_enrichment_queue table
CREATE TABLE IF NOT EXISTS public.listing_enrichment_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  source text NOT NULL,
  priority int DEFAULT 5,
  status text DEFAULT 'queued',
  attempts int DEFAULT 0,
  last_error text,
  locked_until timestamptz,
  lock_token uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(listing_id)
);

-- Index for queue processing
CREATE INDEX IF NOT EXISTS idx_enrichment_queue_status ON public.listing_enrichment_queue (status, locked_until, priority);

-- Enable RLS
ALTER TABLE public.listing_enrichment_queue ENABLE ROW LEVEL SECURITY;

-- RLS policies for enrichment queue (service role only)
DROP POLICY IF EXISTS "Service role can manage enrichment queue" ON public.listing_enrichment_queue;
CREATE POLICY "Service role can manage enrichment queue"
ON public.listing_enrichment_queue
FOR ALL
USING (true)
WITH CHECK (true);

-- 3.2 Trigger: enqueue on new or changed listing
CREATE OR REPLACE FUNCTION public.enqueue_listing_for_enrichment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.enrichment_status IS NULL OR NEW.enrichment_status = 'pending' THEN
    INSERT INTO public.listing_enrichment_queue (listing_id, source, priority)
    VALUES (NEW.id, COALESCE(NEW.source, 'unknown'), 5)
    ON CONFLICT (listing_id) DO UPDATE SET
      updated_at = now(),
      status = CASE 
        WHEN listing_enrichment_queue.status = 'failed' THEN 'queued'
        ELSE listing_enrichment_queue.status
      END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enqueue_listing_enrichment ON public.retail_listings;
CREATE TRIGGER trg_enqueue_listing_enrichment
AFTER INSERT ON public.retail_listings
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_listing_for_enrichment();

-- Variant rules table (make is nullable for generic rules)
CREATE TABLE IF NOT EXISTS public.variant_extraction_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text,
  model text,
  pattern text NOT NULL,
  field_name text NOT NULL,
  field_value text NOT NULL,
  priority int DEFAULT 10,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.variant_extraction_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read variant rules" ON public.variant_extraction_rules;
CREATE POLICY "Anyone can read variant rules"
ON public.variant_extraction_rules
FOR SELECT
USING (true);

-- Seed variant rules
INSERT INTO public.variant_extraction_rules (make, model, pattern, field_name, field_value, priority) VALUES
('HYUNDAI', 'I30', '\bELITE\b', 'badge', 'ELITE', 10),
('HYUNDAI', 'I30', '\bPREMIUM\b', 'badge', 'PREMIUM', 10),
('HYUNDAI', 'I30', '\bN\s*LINE\b', 'badge', 'N_LINE', 10),
('HYUNDAI', 'I30', '\bACTIVE\b', 'badge', 'ACTIVE', 10),
('TOYOTA', 'LANDCRUISER', '\bVDJ\d*\b', 'engine_family', 'V8', 20),
('TOYOTA', 'LANDCRUISER', '\bVDJ\d*\b', 'engine_size_l', '4.5', 20),
('TOYOTA', 'LANDCRUISER', '\bGDJ\d*\b', 'engine_family', 'I4', 20),
('TOYOTA', 'LANDCRUISER', '\bGDJ\d*\b', 'engine_size_l', '2.8', 20),
('TOYOTA', 'LANDCRUISER', '\bGRJ\d*\b', 'engine_family', 'V6', 20),
('TOYOTA', 'LANDCRUISER', '\bGRJ\d*\b', 'engine_size_l', '4.0', 20),
('TOYOTA', 'HILUX', '\bGUN\d*\b', 'engine_family', 'I4', 20),
('TOYOTA', 'HILUX', '\bGUN\d*\b', 'engine_size_l', '2.8', 20),
('FORD', 'RANGER', '\bPX\b', 'series_code', 'PX', 15),
('*', NULL, '\b(DUAL\s*CAB|DOUBLE\s*CAB|D/CAB)\b', 'body_type', 'DUAL_CAB', 5),
('*', NULL, '\b(SINGLE\s*CAB|S/CAB)\b', 'body_type', 'SINGLE_CAB', 5),
('*', NULL, '\bCAB\s*CHASSIS\b', 'body_type', 'CAB_CHASSIS', 5),
('*', NULL, '\bHATCH(BACK)?\b', 'body_type', 'HATCH', 3),
('*', NULL, '\bSEDAN\b', 'body_type', 'SEDAN', 3),
('*', NULL, '\bWAGON\b', 'body_type', 'WAGON', 3),
('*', NULL, '\bUTE\b', 'body_type', 'UTE', 3),
('*', NULL, '\bSUV\b', 'body_type', 'SUV', 3),
('*', NULL, '\bV8\b', 'engine_family', 'V8', 2),
('*', NULL, '\bV6\b', 'engine_family', 'V6', 2),
('*', NULL, '\b4\s*CYL(INDER)?\b', 'engine_family', 'I4', 2),
('*', NULL, '\b6\s*CYL(INDER)?\b', 'engine_family', 'I6', 2),
('*', NULL, '\b2\.0\s*L?\b', 'engine_size_l', '2.0', 1),
('*', NULL, '\b2\.8\s*L?\b', 'engine_size_l', '2.8', 1),
('*', NULL, '\b4\.5\s*L?\b', 'engine_size_l', '4.5', 1),
('*', NULL, '\b3\.0\s*L?\b', 'engine_size_l', '3.0', 1),
('*', NULL, '\b5\.0\s*L?\b', 'engine_size_l', '5.0', 1),
('*', NULL, '\bDIESEL\b', 'fuel_type', 'DIESEL', 2),
('*', NULL, '\bPETROL\b', 'fuel_type', 'PETROL', 2),
('*', NULL, '\bHYBRID\b', 'fuel_type', 'HYBRID', 2),
('*', NULL, '\bELECTRIC\b', 'fuel_type', 'ELECTRIC', 2),
('*', NULL, '\b(AUTO(MATIC)?|A/T)\b', 'transmission', 'AUTOMATIC', 2),
('*', NULL, '\b(MANUAL|M/T)\b', 'transmission', 'MANUAL', 2),
('*', NULL, '\b(4X4|4WD|AWD)\b', 'drivetrain', '4WD', 2),
('*', NULL, '\b(2WD|RWD|FWD)\b', 'drivetrain', '2WD', 2)
ON CONFLICT DO NOTHING;