-- Step 1: Add columns to vehicle_listings
ALTER TABLE vehicle_listings
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS suburb text,
  ADD COLUMN IF NOT EXISTS postcode text;

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_state ON vehicle_listings(state);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_postcode ON vehicle_listings(postcode);

-- Step 2: Create location parser function
CREATE OR REPLACE FUNCTION fn_parse_location_au(p_location text)
RETURNS TABLE (
  suburb text,
  state text,
  postcode text
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parts text[];
  p1 text;
  p2 text;
  p3 text;
BEGIN
  IF p_location IS NULL OR length(trim(p_location)) = 0 THEN
    RETURN;
  END IF;

  parts := regexp_split_to_array(p_location, '\s*,\s*');

  -- Common case: "Suburb, NSW, 2250"
  IF array_length(parts, 1) >= 3 THEN
    p1 := trim(parts[1]);
    p2 := upper(trim(parts[2]));
    p3 := trim(parts[3]);

    IF p2 ~ '^(NSW|QLD|VIC|SA|WA|TAS|NT|ACT)$' AND p3 ~ '^\d{4}$' THEN
      suburb := p1;
      state := p2;
      postcode := p3;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Fallback: try to extract state + postcode anywhere in string
  state := (SELECT upper((regexp_match(p_location, '(NSW|QLD|VIC|SA|WA|TAS|NT|ACT)'))[1]));
  postcode := (SELECT (regexp_match(p_location, '(\d{4})'))[1]);
  suburb := NULL;

  IF state IS NOT NULL OR postcode IS NOT NULL THEN
    RETURN NEXT;
  END IF;

  RETURN;
END;
$$;

-- Step 3: Create trigger function for automatic parsing on insert/update
CREATE OR REPLACE FUNCTION fn_auto_parse_location_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parsed RECORD;
BEGIN
  -- Only parse if location exists and state/postcode are null
  IF NEW.location IS NOT NULL AND (NEW.state IS NULL OR NEW.postcode IS NULL) THEN
    SELECT * INTO parsed FROM fn_parse_location_au(NEW.location) LIMIT 1;
    
    IF parsed IS NOT NULL THEN
      NEW.suburb := COALESCE(NEW.suburb, parsed.suburb);
      NEW.state := COALESCE(NEW.state, parsed.state);
      NEW.postcode := COALESCE(NEW.postcode, parsed.postcode);
    END IF;
  END IF;
  
  -- Auto-resolve SA2 if we have state+postcode but no sa2_code
  IF NEW.sa2_code IS NULL AND NEW.state IS NOT NULL AND NEW.postcode IS NOT NULL THEN
    SELECT r.sa2_code, r.confidence 
    INTO NEW.sa2_code, NEW.geo_confidence
    FROM fn_resolve_sa2_from_postcode(NEW.state, NEW.postcode) r
    LIMIT 1;
    
    IF NEW.sa2_code IS NOT NULL THEN
      NEW.geo_source := 'auto_trigger';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_auto_parse_location ON vehicle_listings;
CREATE TRIGGER trg_auto_parse_location
  BEFORE INSERT OR UPDATE OF location ON vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_parse_location_trigger();

-- Step 4: Backfill existing data (parse location into state/suburb/postcode)
UPDATE vehicle_listings vl
SET
  suburb = COALESCE(vl.suburb, p.suburb),
  state = COALESCE(vl.state, p.state),
  postcode = COALESCE(vl.postcode, p.postcode)
FROM (
  SELECT id, (fn_parse_location_au(location)).*
  FROM vehicle_listings
  WHERE location IS NOT NULL
    AND (state IS NULL OR postcode IS NULL)
) p
WHERE vl.id = p.id
  AND (p.state IS NOT NULL OR p.postcode IS NOT NULL);