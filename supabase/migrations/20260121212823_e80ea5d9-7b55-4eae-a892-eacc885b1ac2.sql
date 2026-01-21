-- 1) Add missing columns to geo_suburb_postcode_xref
ALTER TABLE geo_suburb_postcode_xref 
ADD COLUMN IF NOT EXISTS suburb_norm text,
ADD COLUMN IF NOT EXISTS weight numeric DEFAULT 1.0;

-- 2) Populate suburb_norm from suburb for existing rows
UPDATE geo_suburb_postcode_xref 
SET suburb_norm = regexp_replace(upper(trim(coalesce(suburb,''))), '\s+', ' ', 'g')
WHERE suburb_norm IS NULL;

-- 3) Create index for normalized suburb lookups
CREATE INDEX IF NOT EXISTS idx_geo_suburb_postcode_norm
ON geo_suburb_postcode_xref(state, suburb_norm, weight DESC);

-- 4) Create suburb normalizer function
CREATE OR REPLACE FUNCTION fn_norm_suburb(p_suburb text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(upper(trim(coalesce(p_suburb,''))), '\s+', ' ', 'g');
$$;

-- 5) Update resolver to use normalized suburb with weight
CREATE OR REPLACE FUNCTION fn_resolve_postcode_from_suburb_state(p_state text, p_suburb text)
RETURNS TABLE(postcode text, confidence text)
LANGUAGE sql
STABLE
AS $$
  SELECT x.postcode,
         CASE WHEN COALESCE(x.weight, 1.0) >= 0.7 THEN 'HIGH'
              WHEN COALESCE(x.weight, 1.0) >= 0.4 THEN 'MED'
              ELSE 'LOW' END AS confidence
  FROM geo_suburb_postcode_xref x
  WHERE x.state = upper(p_state)
    AND x.suburb_norm = fn_norm_suburb(p_suburb)
  ORDER BY COALESCE(x.weight, 1.0) DESC
  LIMIT 1;
$$;

-- 6) Drop and recreate trigger to fire on all geo columns
DROP TRIGGER IF EXISTS trg_auto_parse_location ON vehicle_listings;

-- 7) Update trigger function with source-agnostic priority order
CREATE OR REPLACE FUNCTION fn_auto_parse_location_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parsed record;
  pc record;
  sa2 record;
BEGIN
  -- 1) Parse combined location string if needed
  IF NEW.location IS NOT NULL AND (NEW.state IS NULL OR NEW.postcode IS NULL OR NEW.suburb IS NULL) THEN
    SELECT * INTO parsed FROM fn_parse_location_au(NEW.location) LIMIT 1;

    IF parsed IS NOT NULL THEN
      NEW.suburb := COALESCE(NEW.suburb, parsed.suburb);
      NEW.state := COALESCE(NEW.state, parsed.state);
      NEW.postcode := COALESCE(NEW.postcode, parsed.postcode);
    END IF;
  END IF;

  -- 2) If postcode still missing, resolve from suburb+state xref
  IF NEW.postcode IS NULL AND NEW.state IS NOT NULL AND NEW.suburb IS NOT NULL THEN
    SELECT * INTO pc
    FROM fn_resolve_postcode_from_suburb_state(NEW.state, NEW.suburb)
    LIMIT 1;

    IF pc IS NOT NULL AND pc.postcode IS NOT NULL THEN
      NEW.postcode := pc.postcode;
      IF NEW.geo_confidence IS NULL OR NEW.geo_confidence = 'LOW' THEN
        NEW.geo_confidence := pc.confidence;
      END IF;
    END IF;
  END IF;

  -- 3) Resolve SA2 from state+postcode if missing
  IF NEW.sa2_code IS NULL AND NEW.state IS NOT NULL AND NEW.postcode IS NOT NULL THEN
    SELECT * INTO sa2
    FROM fn_resolve_sa2_from_postcode(NEW.state, NEW.postcode)
    LIMIT 1;

    IF sa2 IS NOT NULL AND sa2.sa2_code IS NOT NULL THEN
      NEW.sa2_code := sa2.sa2_code;
      NEW.geo_confidence := COALESCE(NEW.geo_confidence, sa2.confidence);
      NEW.geo_source := COALESCE(NEW.geo_source, 'auto_trigger');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 8) Recreate trigger on all geo columns
CREATE TRIGGER trg_auto_parse_location
  BEFORE INSERT OR UPDATE OF location, suburb, state, postcode
  ON vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_parse_location_trigger();