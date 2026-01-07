-- =============================================================================
-- Add is_dealer_grade computed flag for filtering junk from rollups/alerts
-- Criteria: year >= 2016, price band ($10k-$300k), no exclusion keywords
-- =============================================================================

-- Add the flag column
ALTER TABLE vehicle_listings 
ADD COLUMN IF NOT EXISTS is_dealer_grade boolean DEFAULT false;

-- Create a function to compute dealer grade
CREATE OR REPLACE FUNCTION compute_dealer_grade(
  p_year integer,
  p_asking_price integer,
  p_reserve integer,
  p_excluded_keyword text,
  p_excluded_reason text
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT 
    -- Year gate: 2016+
    coalesce(p_year, 0) >= 2016
    -- Price band: $10k - $300k (use asking_price for classifieds, reserve for auctions)
    AND (
      (coalesce(p_asking_price, 0) BETWEEN 10000 AND 300000)
      OR (coalesce(p_reserve, 0) BETWEEN 10000 AND 300000)
      OR (p_asking_price IS NULL AND p_reserve IS NULL)  -- Allow if no price yet
    )
    -- No exclusion keywords
    AND p_excluded_keyword IS NULL
    AND p_excluded_reason IS NULL;
$$;

-- Create trigger to auto-compute on insert/update
CREATE OR REPLACE FUNCTION set_dealer_grade()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_dealer_grade := compute_dealer_grade(
    NEW.year,
    NEW.asking_price,
    NEW.reserve,
    NEW.excluded_keyword,
    NEW.excluded_reason
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path TO 'public';

DROP TRIGGER IF EXISTS trigger_set_dealer_grade ON vehicle_listings;
CREATE TRIGGER trigger_set_dealer_grade
BEFORE INSERT OR UPDATE ON vehicle_listings
FOR EACH ROW
EXECUTE FUNCTION set_dealer_grade();

-- Backfill existing records
UPDATE vehicle_listings
SET is_dealer_grade = compute_dealer_grade(
  year, asking_price, reserve, excluded_keyword, excluded_reason
);

-- Add index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_listings_dealer_grade 
ON vehicle_listings(is_dealer_grade) 
WHERE is_dealer_grade = true;