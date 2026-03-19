-- Backfill seller_type for existing retail_listings records
-- Classification rules:
--   autotrader, drive, easyauto123, carsguide → 'dealer' (dealer-only platforms)
--   carsales → URL-based: /dealer/ = dealer, /private/ = private, default = dealer
--   gumtree → 'private' (conservative default for mixed platform)
--   fb-marketplace → 'private'
--   all others → 'dealer'

-- 1. Dealer-only platforms (autotrader, drive, easyauto123, carsguide)
UPDATE retail_listings
SET seller_type = 'dealer'
WHERE seller_type IS NULL
  AND source IN ('autotrader', 'drive', 'easyauto123', 'carsguide');

-- 2. Carsales: URL-based classification
-- Private listings (URL contains /private/)
UPDATE retail_listings
SET seller_type = 'private'
WHERE seller_type IS NULL
  AND source = 'carsales'
  AND (listing_url ILIKE '%/private/%' OR listing_url ILIKE '%/private-%');

-- Dealer listings (URL contains /dealer/) 
UPDATE retail_listings
SET seller_type = 'dealer'
WHERE seller_type IS NULL
  AND source = 'carsales'
  AND (listing_url ILIKE '%/dealer/%' OR listing_url ILIKE '%/dealer-%');

-- Remaining carsales default to 'dealer' (majority are dealer stock)
UPDATE retail_listings
SET seller_type = 'dealer'
WHERE seller_type IS NULL
  AND source = 'carsales';

-- 3. Gumtree defaults to 'private'
UPDATE retail_listings
SET seller_type = 'private'
WHERE seller_type IS NULL
  AND source = 'gumtree';

-- 4. Facebook Marketplace is always private
UPDATE retail_listings
SET seller_type = 'private'
WHERE seller_type IS NULL
  AND source = 'fb-marketplace';

-- 5. Catch-all for any remaining sources → dealer
UPDATE retail_listings
SET seller_type = 'dealer'
WHERE seller_type IS NULL;

-- Add index on seller_type for fast filtering in deal scoring queries
CREATE INDEX IF NOT EXISTS idx_retail_listings_seller_type ON retail_listings (seller_type);
