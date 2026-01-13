-- Replace backfill function with ctid-based version (more efficient)
CREATE OR REPLACE FUNCTION public.backfill_fingerprints_v2(batch_size int DEFAULT 5000)
RETURNS TABLE(updated_count int, remaining_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated int := 0;
  v_remaining bigint := 0;
BEGIN
  WITH target AS (
    SELECT ctid
    FROM public.vehicle_listings
    WHERE (fingerprint_version IS NULL OR fingerprint_version <> 2)
      AND year IS NOT NULL
      AND COALESCE(make,'') <> ''
      AND COALESCE(model,'') <> ''
    LIMIT batch_size
  ),
  upd AS (
    UPDATE public.vehicle_listings vl
    SET
      fingerprint = fp.fingerprint,
      fingerprint_version = 2,
      fingerprint_confidence = fp.fingerprint_confidence,
      variant_used = fp.variant_used,
      variant_source = fp.variant_source
    FROM target t
    CROSS JOIN LATERAL public.generate_vehicle_fingerprint_v2(
      vl.year,
      vl.make,
      vl.model,
      vl.variant_family,
      vl.variant_raw,
      NULL,
      vl.transmission,
      vl.fuel,
      vl.drivetrain,
      vl.km,
      NULL
    ) fp
    WHERE vl.ctid = t.ctid
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM upd;

  SELECT COUNT(*) INTO v_remaining
  FROM public.vehicle_listings
  WHERE (fingerprint_version IS NULL OR fingerprint_version <> 2)
    AND year IS NOT NULL
    AND COALESCE(make,'') <> ''
    AND COALESCE(model,'') <> '';

  RETURN QUERY SELECT v_updated, v_remaining;
END;
$$;