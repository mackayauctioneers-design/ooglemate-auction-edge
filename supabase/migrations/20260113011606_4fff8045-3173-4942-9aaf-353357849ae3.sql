-- Backfill function for v2 fingerprints
CREATE OR REPLACE FUNCTION public.backfill_fingerprints_v2(batch_size INT DEFAULT 1000)
RETURNS TABLE(updated_count INT, remaining_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  updated_rows INT := 0;
  remaining BIGINT;
  rec RECORD;
BEGIN
  -- Process rows in a loop
  FOR rec IN
    SELECT id, year, make, model, variant_family, variant_raw, 
           transmission, fuel, drivetrain, km
    FROM public.vehicle_listings
    WHERE (fingerprint_version IS NULL OR fingerprint_version <> 2)
      AND year IS NOT NULL
      AND COALESCE(make,'') <> ''
      AND COALESCE(model,'') <> ''
    LIMIT batch_size
  LOOP
    UPDATE public.vehicle_listings vl
    SET
      fingerprint = fp.fingerprint,
      fingerprint_version = 2,
      fingerprint_confidence = fp.fingerprint_confidence,
      variant_used = fp.variant_used,
      variant_source = fp.variant_source
    FROM public.generate_vehicle_fingerprint_v2(
      rec.year, rec.make, rec.model,
      rec.variant_family, rec.variant_raw,
      NULL, rec.transmission, rec.fuel, rec.drivetrain,
      rec.km, NULL
    ) AS fp
    WHERE vl.id = rec.id;
    
    updated_rows := updated_rows + 1;
  END LOOP;
  
  -- Count remaining
  SELECT COUNT(*) INTO remaining
  FROM public.vehicle_listings
  WHERE (fingerprint_version IS NULL OR fingerprint_version <> 2)
    AND year IS NOT NULL
    AND COALESCE(make,'') <> ''
    AND COALESCE(model,'') <> '';
  
  updated_count := updated_rows;
  remaining_count := remaining;
  RETURN NEXT;
END;
$$;