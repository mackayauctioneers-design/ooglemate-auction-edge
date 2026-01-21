-- Update the auto-parse trigger to resolve postcode from suburb if missing
CREATE OR REPLACE FUNCTION fn_auto_parse_location_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parsed RECORD;
  resolved_postcode text;
  postcode_conf text;
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
  
  -- If we have suburb+state but no postcode, try suburb→postcode lookup
  IF NEW.postcode IS NULL AND NEW.state IS NOT NULL AND NEW.suburb IS NOT NULL THEN
    SELECT r.postcode, r.confidence 
    INTO resolved_postcode, postcode_conf
    FROM fn_resolve_postcode_from_suburb_state(NEW.state, NEW.suburb) r
    LIMIT 1;
    
    IF resolved_postcode IS NOT NULL THEN
      NEW.postcode := resolved_postcode;
      -- Downgrade geo_confidence if postcode came from suburb lookup
      IF postcode_conf = 'LOW' THEN
        NEW.geo_confidence := 'LOW';
      END IF;
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