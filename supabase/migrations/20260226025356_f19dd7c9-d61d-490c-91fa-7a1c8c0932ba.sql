
-- Add new columns for lifecycle improvements
ALTER TABLE vehicle_listings 
  ADD COLUMN IF NOT EXISTS risk_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sold_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS reappeared_at timestamptz;

-- Update lifecycle_state constraint to include RETURNED and INVALID
ALTER TABLE vehicle_listings DROP CONSTRAINT IF EXISTS lifecycle_state_valid;
ALTER TABLE vehicle_listings ADD CONSTRAINT lifecycle_state_valid 
  CHECK (lifecycle_state = ANY (ARRAY['NEW','WATCH','BUY','BOUGHT','SOLD','AVOID','STALE','DEAD','RETURNED','INVALID']));

-- Create trigger function: when a DEAD/STALE listing is upserted (revived), flag it
CREATE OR REPLACE FUNCTION public.trg_detect_reappearance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire on UPDATE (upsert conflict = update)
  IF TG_OP = 'UPDATE' THEN
    -- If was DEAD or STALE and is being revived
    IF OLD.lifecycle_state IN ('DEAD', 'STALE') 
       AND NEW.lifecycle_state IN ('NEW', 'WATCH') THEN
      NEW.lifecycle_state := 'RETURNED';
      NEW.risk_flag := true;
      NEW.reappeared_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Attach trigger (before the existing platform_class trigger)
DROP TRIGGER IF EXISTS trg_vehicle_listings_reappearance ON vehicle_listings;
CREATE TRIGGER trg_vehicle_listings_reappearance
  BEFORE UPDATE ON vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_detect_reappearance();

-- Create validation trigger: block junk from becoming ACTIVE
CREATE OR REPLACE FUNCTION public.trg_validate_listing_quality()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- On INSERT: if critical fields are missing/junk, mark INVALID
  IF NEW.lifecycle_state IN ('NEW', 'WATCH') THEN
    IF NEW.make IS NULL OR NEW.make = '' OR UPPER(NEW.make) = 'UNKNOWN'
       OR NEW.model IS NULL OR NEW.model = '' OR UPPER(NEW.model) = 'UNKNOWN'
       OR NEW.year IS NULL OR NEW.year < 2000 THEN
      NEW.lifecycle_state := 'INVALID';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicle_listings_validate ON vehicle_listings;
CREATE TRIGGER trg_vehicle_listings_validate
  BEFORE INSERT OR UPDATE ON vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_validate_listing_quality();
