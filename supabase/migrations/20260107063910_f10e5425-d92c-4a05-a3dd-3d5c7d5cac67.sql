-- =============================================================================
-- 1. Add asking_price for classifieds (reserve is for auctions)
-- =============================================================================
ALTER TABLE vehicle_listings 
ADD COLUMN IF NOT EXISTS asking_price integer;

-- =============================================================================
-- 2. Make auction-specific fields nullable for classifieds compatibility
-- =============================================================================
ALTER TABLE vehicle_listings 
ALTER COLUMN lot_id DROP NOT NULL,
ALTER COLUMN auction_house DROP NOT NULL;

-- =============================================================================
-- 3. Add seller classification metadata
-- =============================================================================
ALTER TABLE vehicle_listings 
ADD COLUMN IF NOT EXISTS seller_confidence text,
ADD COLUMN IF NOT EXISTS seller_reasons text[];

-- =============================================================================
-- 4. Add raw listed date field (separate from first_seen_at)
-- =============================================================================
ALTER TABLE vehicle_listings 
ADD COLUMN IF NOT EXISTS listed_date_raw text;

-- =============================================================================
-- 5. Create listing_snapshots table for trend analytics
-- =============================================================================
CREATE TABLE IF NOT EXISTS listing_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES vehicle_listings(id) ON DELETE CASCADE,
  seen_at timestamp with time zone NOT NULL DEFAULT now(),
  status text,
  asking_price integer,
  reserve integer,
  location text,
  km integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for efficient querying by listing and time
CREATE INDEX IF NOT EXISTS idx_snapshots_listing_seen 
ON listing_snapshots(listing_id, seen_at DESC);

-- Index for time-based trend queries
CREATE INDEX IF NOT EXISTS idx_snapshots_seen_at 
ON listing_snapshots(seen_at DESC);

-- Enable RLS
ALTER TABLE listing_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Anyone can view listing snapshots" 
ON listing_snapshots 
FOR SELECT 
USING (true);

CREATE POLICY "Service can manage listing snapshots" 
ON listing_snapshots 
FOR ALL 
USING (true)
WITH CHECK (true);