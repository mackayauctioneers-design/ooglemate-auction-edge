-- Drop existing v2 function to change parameter order
DROP FUNCTION IF EXISTS public.generate_vehicle_fingerprint_v2(integer,text,text,text,text,text,text,text,text,integer,text);

-- Recreate v2 function with corrected parameter order (family before raw)
CREATE OR REPLACE FUNCTION public.generate_vehicle_fingerprint_v2(
  p_year INT,
  p_make TEXT,
  p_model TEXT,
  p_variant_family TEXT,
  p_variant_raw TEXT,
  p_body TEXT,
  p_transmission TEXT,
  p_fuel TEXT,
  p_drivetrain TEXT,
  p_km INT,
  p_region TEXT
)
RETURNS TABLE(
  fingerprint TEXT,
  canonical TEXT,
  fingerprint_confidence INT,
  variant_used TEXT,
  variant_source TEXT
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_make TEXT := '';
  v_model TEXT := '';
  v_variant TEXT := '';
  v_body TEXT := '';
  v_trans TEXT := '';
  v_fuel TEXT := '';
  v_drive TEXT := '';
  v_region TEXT := '';
  v_conf INT := 0;
  v_odo_bucket INT := NULL;
  v_variant_source TEXT := NULL;
BEGIN
  v_make  := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_make,'')), '\s+', ' ', 'g'));
  v_model := UPPER(REGEXP_REPLACE(TRIM(COALESCE(p_model,'')), '\s+', ' ', 'g'));

  -- Prefer variant_family over variant_raw
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
    v_variant_source := NULL;
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

  IF v_conf > 100 THEN v_conf := 100; END IF;

  -- Bucket odometer to nearest 5000
  IF p_km IS NOT NULL THEN
    v_odo_bucket := floor(p_km / 5000.0) * 5000;
  END IF;

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