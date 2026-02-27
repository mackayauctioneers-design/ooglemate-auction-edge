-- Add price_type column to retail_listings for drive-away vs excl. govt. charges normalisation
ALTER TABLE retail_listings ADD COLUMN IF NOT EXISTS price_type TEXT DEFAULT 'unknown';
CREATE INDEX IF NOT EXISTS idx_retail_listings_price_type ON retail_listings(price_type);
COMMENT ON COLUMN retail_listings.price_type IS 'Price classification: drive_away, excl_govt, or unknown. Used to normalise asking_price to off-road equivalent.';