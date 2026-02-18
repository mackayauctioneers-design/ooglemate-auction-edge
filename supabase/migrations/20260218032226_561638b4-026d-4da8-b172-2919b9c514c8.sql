CREATE OR REPLACE FUNCTION public.derive_platform(
  p_make TEXT,
  p_model TEXT,
  p_year INT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  m TEXT := UPPER(TRIM(p_make));
  mo TEXT := UPPER(TRIM(p_model));
BEGIN
  IF m = 'TOYOTA' THEN
    IF mo LIKE '%PRADO%' THEN
      RETURN 'PRADO';
    ELSIF mo LIKE '%LANDCRUISER%' THEN
      IF p_year >= 2022 THEN RETURN 'LC300';
      ELSIF p_year BETWEEN 2008 AND 2021 THEN RETURN 'LC200';
      ELSE RETURN 'LC_OTHER';
      END IF;
    END IF;
  END IF;

  IF m = 'MITSUBISHI' AND mo = 'OUTLANDER' THEN
    RETURN 'OUTLANDER';
  END IF;

  RETURN m || ':' || mo;
END;
$$;