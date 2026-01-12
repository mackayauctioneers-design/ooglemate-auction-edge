-- Add fingerprint v2 columns
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS fingerprint_confidence smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variant_source text;

-- Create v2 fingerprint function (keeps v1 untouched)
CREATE OR REPLACE FUNCTION public.generate_vehicle_fingerprint_v2(
  p_year int,
  p_make text,
  p_model text,
  p_variant_raw text DEFAULT NULL,
  p_variant_family text DEFAULT NULL,
  p_body text DEFAULT NULL,
  p_transmission text DEFAULT NULL,
  p_fuel text DEFAULT NULL,
  p_drivetrain text DEFAULT NULL,
  p_km int DEFAULT NULL,
  p_region text DEFAULT NULL
)
RETURNS TABLE(
  fingerprint text,
  canonical text,
  fingerprint_confidence int,
  variant_used text,
  variant_source text
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_odo_bucket int;
  v_variant text;
  v_variant_source text := 'none';
  v_conf int := 0;
  v_make text;
  v_model text;
  v_body text;
  v_trans text;
  v_fuel text;
  v_drive text;
  v_region text;
BEGIN
  -- Normalize core strings
  v_make  := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_make,'')),  '\s+', ' ', 'g'));
  v_model := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_model,'')), '\s+', ' ', 'g'));

  -- Prefer family over raw for fingerprint variant component
  IF COALESCE(TRIM(p_variant_family), '') <> '' THEN
    v_variant := UPPER(REGEXP_REPLACE(TRIM(p_variant_family), '\s+', ' ', 'g'));
    v_variant_source := 'family';
    v_conf := v_conf + 25;
  ELSIF COALESCE(TRIM(p_variant_raw), '') <> '' THEN
    v_variant := UPPER(REGEXP_REPLACE(TRIM(p_variant_raw), '\s+', ' ', 'g'));
    v_variant_source := 'raw';
    v_conf := v_conf + 15;
  ELSE
    v_variant := '';
  END IF;

  v_body   := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_body,'')), '\s+', ' ', 'g'));
  v_trans  := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_transmission,'')), '\s+', ' ', 'g'));
  v_fuel   := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_fuel,'')), '\s+', ' ', 'g'));
  v_drive  := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_drivetrain,'')), '\s+', ' ', 'g'));
  v_region := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_region,'')), '\s+', ' ', 'g'));

  -- Base confidence if we have year/make/model
  IF p_year IS NOT NULL AND v_make <> '' AND v_model <> '' THEN
    v_conf := v_conf + 30;
  END IF;

  -- Other confidence contributors
  IF COALESCE(TRIM(p_transmission), '') <> '' THEN v_conf := v_conf + 10; END IF;
  IF COALESCE(TRIM(p_fuel), '') <> '' THEN v_conf := v_conf + 10; END IF;
  IF COALESCE(TRIM(p_drivetrain), '') <> '' THEN v_conf := v_conf + 5; END IF;
  IF COALESCE(TRIM(p_region), '') <> '' THEN v_conf := v_conf + 5; END IF;
  IF p_km IS NOT NULL THEN v_conf := v_conf + 10; END IF;

  -- Cap confidence
  IF v_conf > 100 THEN v_conf := 100; END IF;

  -- Bucket odometer to nearest 5000 (same as v1)
  IF p_km IS NOT NULL THEN
    v_odo_bucket := floor(p_km / 5000.0) * 5000;
  END IF;

  -- Build canonical string (same shape as v1 but with preferred variant)
  canonical := concat_ws('|',
    COALESCE(p_year::text, ''),
    v_make,
    v_model,
    v_variant,
    v_body,
    v_trans,
    v_fuel,
    v_drive,
    COALESCE(v_odo_bucket::text, ''),
    v_region
  );

  fingerprint := md5(canonical);
  fingerprint_confidence := v_conf;
  variant_used := v_variant;
  variant_source := v_variant_source;

  RETURN NEXT;
END;
$function$;