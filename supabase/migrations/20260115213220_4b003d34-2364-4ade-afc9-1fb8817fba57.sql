-- =====================================================
-- DISABLE IDENTITY-RELIST FOR RETAIL (keep for auctions)
-- =====================================================
-- Retail = marketing churn, not meaningful relists
-- Auctions = real passed-in/returned signals
-- =====================================================

-- 1) Drop the trigger on retail_listings (it was incorrectly applied there)
DROP TRIGGER IF EXISTS trg_identity_sold_returned ON public.retail_listings;

-- 2) Keep the helper functions (they'll be used by auctions later)
-- find_recent_delisted_by_identity() - stays
-- check_identity_linked_sold_returned() - stays  
-- trigger_check_identity_sold_returned() - stays (will be attached to auctions)

-- 3) Create source_registry for future use
CREATE TABLE IF NOT EXISTS public.source_registry (
  source text PRIMARY KEY,
  source_type text NOT NULL CHECK (source_type IN ('RETAIL', 'AUCTION', 'DEALER_TRAP')),
  supports_identity_relist boolean NOT NULL DEFAULT false,
  supports_price_history boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4) Seed with known sources
INSERT INTO public.source_registry (source, source_type, supports_identity_relist, notes)
VALUES 
  -- Retail (no identity relist)
  ('autotrader', 'RETAIL', false, 'Nationwide retail classifieds'),
  ('gumtree', 'RETAIL', false, 'Private/dealer classifieds'),
  ('test', 'RETAIL', false, 'Test data'),
  
  -- Auctions (identity relist enabled)
  ('pickles', 'AUCTION', true, 'Pickles auctions'),
  ('pickles_crawl', 'AUCTION', true, 'Pickles catalogue crawl'),
  ('manheim', 'AUCTION', true, 'Manheim auctions'),
  ('f3', 'AUCTION', true, 'F3 motor auctions'),
  ('auto_auctions_aav', 'AUCTION', true, 'AAV motor auctions')
ON CONFLICT (source) DO NOTHING;

-- 5) Add source_type column to retail_listings for direct filtering (denormalized for speed)
ALTER TABLE public.retail_listings 
ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'RETAIL';

-- Set all existing retail to RETAIL
UPDATE public.retail_listings SET source_type = 'RETAIL' WHERE source_type IS NULL;

-- 6) For vehicle_listings (auctions), add columns if missing
ALTER TABLE public.vehicle_listings
ADD COLUMN IF NOT EXISTS anomaly_sold_returned boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS sold_returned_at timestamptz,
ADD COLUMN IF NOT EXISTS risk_flags text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS exclude_from_alerts boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS linked_from_listing_id text,
ADD COLUMN IF NOT EXISTS linked_reason text;