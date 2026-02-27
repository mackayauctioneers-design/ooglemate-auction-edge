-- Add price_type column to vehicle_listings for drive-away vs excl. govt. charges normalisation
ALTER TABLE vehicle_listings ADD COLUMN IF NOT EXISTS price_type TEXT DEFAULT 'unknown';

-- Index for filtering/reporting
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_price_type ON vehicle_listings(price_type);

-- Comment for documentation
COMMENT ON COLUMN vehicle_listings.price_type IS 'Price classification: drive_away, excl_govt, or unknown. Used to normalise asking_price to off-road equivalent for margin comparison.';