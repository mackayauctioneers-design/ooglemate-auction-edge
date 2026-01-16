-- Normalize make/model to uppercase on sale_hunts insert/update
CREATE OR REPLACE FUNCTION normalize_hunt_identity()
RETURNS TRIGGER AS $$
BEGIN
  NEW.make := UPPER(TRIM(NEW.make));
  NEW.model := UPPER(TRIM(NEW.model));
  IF NEW.variant_family IS NOT NULL THEN
    NEW.variant_family := UPPER(TRIM(NEW.variant_family));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger
DROP TRIGGER IF EXISTS trg_normalize_hunt_identity ON sale_hunts;
CREATE TRIGGER trg_normalize_hunt_identity
  BEFORE INSERT OR UPDATE ON sale_hunts
  FOR EACH ROW
  EXECUTE FUNCTION normalize_hunt_identity();

-- Also normalize existing data
UPDATE sale_hunts SET
  make = UPPER(TRIM(make)),
  model = UPPER(TRIM(model)),
  variant_family = CASE WHEN variant_family IS NOT NULL THEN UPPER(TRIM(variant_family)) ELSE NULL END
WHERE make != UPPER(make) OR model != UPPER(model);