
-- Platform cluster table: groups by make/model/generation/engine/drivetrain
CREATE TABLE public.dealer_platform_clusters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  generation TEXT NOT NULL,
  engine_type TEXT NOT NULL DEFAULT 'unknown',
  drivetrain TEXT NOT NULL DEFAULT 'unknown',
  year_min INT NOT NULL,
  year_max INT NOT NULL,
  total_flips INT NOT NULL DEFAULT 0,
  median_buy_price NUMERIC,
  median_sell_price NUMERIC,
  median_profit NUMERIC,
  median_km NUMERIC,
  avg_days_to_sell NUMERIC,
  last_sale_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, make, model, generation, engine_type, drivetrain)
);

ALTER TABLE public.dealer_platform_clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for all authenticated" ON public.dealer_platform_clusters
  FOR SELECT USING (true);

CREATE POLICY "Allow insert for service role" ON public.dealer_platform_clusters
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow update for service role" ON public.dealer_platform_clusters
  FOR UPDATE USING (true);

-- Generation mapping function
CREATE OR REPLACE FUNCTION public.derive_generation(p_make TEXT, p_model TEXT, p_year INT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  m TEXT := UPPER(TRIM(p_make));
  mo TEXT := UPPER(TRIM(p_model));
BEGIN
  -- Toyota Landcruiser
  IF m = 'TOYOTA' AND mo IN ('LANDCRUISER', 'LAND CRUISER') THEN
    IF p_year BETWEEN 2008 AND 2021 THEN RETURN 'LC200';
    ELSIF p_year >= 2022 THEN RETURN 'LC300';
    ELSIF p_year BETWEEN 1998 AND 2007 THEN RETURN 'LC100';
    END IF;
  END IF;
  -- Prado
  IF m = 'TOYOTA' AND mo IN ('LANDCRUISER PRADO', 'PRADO') THEN
    IF p_year BETWEEN 2009 AND 2023 THEN RETURN 'Prado150';
    ELSIF p_year >= 2024 THEN RETURN 'Prado250';
    ELSIF p_year BETWEEN 2002 AND 2009 THEN RETURN 'Prado120';
    END IF;
  END IF;
  -- Hilux
  IF m = 'TOYOTA' AND mo = 'HILUX' THEN
    IF p_year BETWEEN 2015 AND 2024 THEN RETURN 'Hilux8';
    ELSIF p_year BETWEEN 2005 AND 2014 THEN RETURN 'Hilux7';
    ELSIF p_year >= 2025 THEN RETURN 'Hilux9';
    END IF;
  END IF;
  -- Ford Ranger
  IF m = 'FORD' AND mo = 'RANGER' THEN
    IF p_year BETWEEN 2011 AND 2021 THEN RETURN 'RangerPX';
    ELSIF p_year >= 2022 THEN RETURN 'RangerNextGen';
    END IF;
  END IF;
  -- Nissan Navara
  IF m = 'NISSAN' AND mo = 'NAVARA' THEN
    IF p_year BETWEEN 2015 AND 2025 THEN RETURN 'NavaraD23';
    ELSIF p_year BETWEEN 2005 AND 2014 THEN RETURN 'NavaraD40';
    END IF;
  END IF;
  -- Mitsubishi Triton
  IF m = 'MITSUBISHI' AND mo = 'TRITON' THEN
    IF p_year BETWEEN 2015 AND 2024 THEN RETURN 'TritonMQ';
    ELSIF p_year >= 2024 THEN RETURN 'TritonMR';
    END IF;
  END IF;
  -- Isuzu D-Max
  IF m = 'ISUZU' AND mo IN ('D-MAX', 'DMAX') THEN
    IF p_year BETWEEN 2012 AND 2019 THEN RETURN 'DMax2';
    ELSIF p_year >= 2020 THEN RETURN 'DMax3';
    END IF;
  END IF;
  -- Mazda BT-50
  IF m = 'MAZDA' AND mo IN ('BT-50', 'BT50') THEN
    IF p_year BETWEEN 2011 AND 2020 THEN RETURN 'BT50-2';
    ELSIF p_year >= 2021 THEN RETURN 'BT50-3';
    END IF;
  END IF;
  -- Toyota RAV4
  IF m = 'TOYOTA' AND mo = 'RAV4' THEN
    IF p_year BETWEEN 2019 AND 2025 THEN RETURN 'RAV4-5';
    ELSIF p_year BETWEEN 2013 AND 2018 THEN RETURN 'RAV4-4';
    END IF;
  END IF;
  -- Hyundai i30
  IF m = 'HYUNDAI' AND mo IN ('I30', 'I 30') THEN
    IF p_year BETWEEN 2017 AND 2025 THEN RETURN 'i30-PD';
    ELSIF p_year BETWEEN 2012 AND 2016 THEN RETURN 'i30-GD';
    END IF;
  END IF;
  -- Toyota Corolla
  IF m = 'TOYOTA' AND mo = 'COROLLA' THEN
    IF p_year BETWEEN 2019 AND 2025 THEN RETURN 'Corolla12';
    ELSIF p_year BETWEEN 2013 AND 2018 THEN RETURN 'Corolla11';
    END IF;
  END IF;
  -- Toyota Camry
  IF m = 'TOYOTA' AND mo = 'CAMRY' THEN
    IF p_year BETWEEN 2018 AND 2025 THEN RETURN 'CamryXV70';
    ELSIF p_year BETWEEN 2012 AND 2017 THEN RETURN 'CamryXV50';
    END IF;
  END IF;
  -- Chevrolet Silverado
  IF m IN ('CHEVROLET', 'CHEV') AND mo = 'SILVERADO' THEN
    IF p_year BETWEEN 2020 AND 2025 THEN RETURN 'Silv1500-T1';
    END IF;
  END IF;
  -- Kia Sportage
  IF m = 'KIA' AND mo = 'SPORTAGE' THEN
    IF p_year BETWEEN 2022 AND 2025 THEN RETURN 'Sportage5';
    ELSIF p_year BETWEEN 2016 AND 2021 THEN RETURN 'Sportage4';
    END IF;
  END IF;
  -- VW Amarok
  IF m = 'VOLKSWAGEN' AND mo = 'AMAROK' THEN
    IF p_year BETWEEN 2010 AND 2022 THEN RETURN 'Amarok1';
    ELSIF p_year >= 2023 THEN RETURN 'Amarok2';
    END IF;
  END IF;
  -- Jeep Grand Cherokee
  IF m = 'JEEP' AND mo = 'GRAND CHEROKEE' THEN
    IF p_year BETWEEN 2011 AND 2021 THEN RETURN 'GC-WK2';
    ELSIF p_year >= 2022 THEN RETURN 'GC-WL';
    END IF;
  END IF;
  -- Toyota Kluger
  IF m = 'TOYOTA' AND mo = 'KLUGER' THEN
    IF p_year BETWEEN 2014 AND 2020 THEN RETURN 'Kluger3';
    ELSIF p_year >= 2021 THEN RETURN 'Kluger4';
    END IF;
  END IF;
  -- Subaru Forester
  IF m = 'SUBARU' AND mo = 'FORESTER' THEN
    IF p_year BETWEEN 2019 AND 2025 THEN RETURN 'Forester5';
    ELSIF p_year BETWEEN 2013 AND 2018 THEN RETURN 'Forester4';
    END IF;
  END IF;
  -- Fallback: decade band
  RETURN mo || '-' || (p_year / 5 * 5)::TEXT || 's';
END;
$$;

-- Function to rebuild clusters for an account
CREATE OR REPLACE FUNCTION public.rebuild_platform_clusters(p_account_id TEXT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  row_count INT;
BEGIN
  DELETE FROM public.dealer_platform_clusters WHERE account_id = p_account_id;

  INSERT INTO public.dealer_platform_clusters (
    account_id, make, model, generation, engine_type, drivetrain,
    year_min, year_max, total_flips,
    median_buy_price, median_sell_price, median_profit, median_km,
    last_sale_date
  )
  SELECT
    p_account_id,
    INITCAP(TRIM(s.make)),
    INITCAP(TRIM(s.model)),
    public.derive_generation(s.make, s.model, s.year),
    COALESCE(UPPER(NULLIF(TRIM(s.drive_type), '')), 'UNKNOWN'),
    COALESCE(
      CASE
        WHEN UPPER(COALESCE(s.drive_type,'')) IN ('4X4','4WD','AWD') THEN '4X4'
        WHEN UPPER(COALESCE(s.drive_type,'')) IN ('2WD','FWD','RWD') THEN '2WD'
        ELSE 'UNKNOWN'
      END, 'UNKNOWN'),
    MIN(s.year),
    MAX(s.year),
    COUNT(*)::INT,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.buy_price),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.sale_price),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (s.sale_price - COALESCE(s.buy_price, 0))),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.km),
    MAX(s.sold_at::DATE)
  FROM public.vehicle_sales_truth s
  WHERE s.account_id = p_account_id
    AND s.sale_price IS NOT NULL
    AND s.buy_price IS NOT NULL
    AND (s.sale_price - COALESCE(s.buy_price, 0)) > 0
  GROUP BY
    INITCAP(TRIM(s.make)),
    INITCAP(TRIM(s.model)),
    public.derive_generation(s.make, s.model, s.year),
    COALESCE(UPPER(NULLIF(TRIM(s.drive_type), '')), 'UNKNOWN'),
    COALESCE(
      CASE
        WHEN UPPER(COALESCE(s.drive_type,'')) IN ('4X4','4WD','AWD') THEN '4X4'
        WHEN UPPER(COALESCE(s.drive_type,'')) IN ('2WD','FWD','RWD') THEN '2WD'
        ELSE 'UNKNOWN'
      END, 'UNKNOWN');

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;
