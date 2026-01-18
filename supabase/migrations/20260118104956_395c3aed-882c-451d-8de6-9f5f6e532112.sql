-- 1) Add canonical_id + intent fields if missing
ALTER TABLE public.hunt_external_candidates
  ADD COLUMN IF NOT EXISTS canonical_id text,
  ADD COLUMN IF NOT EXISTS source_tier int,
  ADD COLUMN IF NOT EXISTS extracted_price int;

-- 2) Backfill canonical_id for existing rows
UPDATE public.hunt_external_candidates
SET canonical_id = COALESCE(canonical_id, md5(source_url))
WHERE canonical_id IS NULL;

-- 3) Require canonical_id (after backfill)
ALTER TABLE public.hunt_external_candidates
  ALTER COLUMN canonical_id SET NOT NULL;

-- 4) Unique per hunt/version/listing identity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname='public'
      AND indexname='ux_hec_hunt_version_canonical'
  ) THEN
    CREATE UNIQUE INDEX ux_hec_hunt_version_canonical
      ON public.hunt_external_candidates(hunt_id, criteria_version, canonical_id);
  END IF;
END $$;

-- 5) Canonical ID function (replaces "base URL" dedupe)
CREATE OR REPLACE FUNCTION public.fn_canonical_listing_id(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  u text := COALESCE(p_url,'');
  host text := lower(regexp_replace(u, '^https?://([^/]+).*$', '\1'));
  path text := regexp_replace(u, '^https?://[^/]+', '');
  m text[];
  id text;
BEGIN
  -- AUTOTRADER AU: /car/{id}
  IF host LIKE '%autotrader.com.au%' THEN
    m := regexp_match(path, '/car/([0-9]+)');
    IF m IS NOT NULL THEN
      RETURN 'autotrader:' || m[1];
    END IF;
    RETURN 'autotrader:' || md5(u);
  END IF;

  -- GUMTREE: /s-ad/.../{adId}
  IF host LIKE '%gumtree.com.au%' THEN
    m := regexp_match(path, '/s-ad/.*/([0-9]{6,})');
    IF m IS NOT NULL THEN
      RETURN 'gumtree:' || m[1];
    END IF;
    RETURN 'gumtree:' || md5(u);
  END IF;

  -- DRIVE: dealer listing id patterns vary
  IF host LIKE '%drive.com.au%' THEN
    m := regexp_match(path, '(dealer-listing|listing)/([0-9]+)');
    IF m IS NOT NULL THEN
      RETURN 'drive:' || m[2];
    END IF;
    RETURN 'drive:' || md5(u);
  END IF;

  -- PICKLES
  IF host LIKE '%pickles.com.au%' THEN
    m := regexp_match(path, '([0-9]{6,})');
    IF m IS NOT NULL THEN
      RETURN 'pickles:' || m[1];
    END IF;
    RETURN 'pickles:' || md5(u);
  END IF;

  -- MANHEIM
  IF host LIKE '%manheim.com.au%' THEN
    m := regexp_match(path, '([0-9]{6,})');
    IF m IS NOT NULL THEN RETURN 'manheim:'||m[1]; END IF;
    RETURN 'manheim:'||md5(u);
  END IF;

  -- GRAYS
  IF host LIKE '%grays.com%' THEN
    m := regexp_match(path, '([0-9]{6,})');
    IF m IS NOT NULL THEN RETURN 'grays:'||m[1]; END IF;
    RETURN 'grays:'||md5(u);
  END IF;

  -- LLOYDS
  IF host LIKE '%lloydsauctions.com.au%' THEN
    m := regexp_match(path, '([0-9]{6,})');
    IF m IS NOT NULL THEN RETURN 'lloyds:'||m[1]; END IF;
    RETURN 'lloyds:'||md5(u);
  END IF;

  -- CARSALES: keep DETAILS ids if present; if search URL, keep full hash
  IF host LIKE '%carsales.com.au%' THEN
    m := regexp_match(path, '([0-9]{6,})');
    IF m IS NOT NULL THEN
      RETURN 'carsales:' || m[1];
    END IF;
    RETURN 'carsales_search:' || md5(u);
  END IF;

  -- default
  RETURN host || ':' || md5(u);
END $$;

-- 6) Listing intent classifier (unknown != IGNORE)
CREATE OR REPLACE FUNCTION public.fn_classify_listing_intent(p_url text, p_title text, p_snippet text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  u text := lower(COALESCE(p_url,''));
  t text := lower(COALESCE(p_title,'') || ' ' || COALESCE(p_snippet,''));
  signals int := 0;
BEGIN
  -- hard reject editorial
  IF u ~ '(\/news\/|\/blog\/|\/review|\/reviews\/|\/guides\/|\/guide\/|price-and-specs|\/spec|\/specs\/|\/comparison|\/compare|\/insurance|\/finance|\/about|\/help|\/contact|\/privacy|\/terms)' THEN
    RETURN jsonb_build_object('intent','non_listing','reason','NON_LISTING_URL');
  END IF;

  -- hard allow listing patterns
  IF u ~ 'autotrader\.com\.au\/car\/[0-9]+' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_AUTOTRADER_CAR');
  END IF;

  IF u ~ 'gumtree\.com\.au\/s-ad\/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_GUMTREE_AD');
  END IF;

  IF u ~ 'drive\.com\.au\/cars-for-sale\/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_DRIVE_CARS_FOR_SALE');
  END IF;

  IF u ~ '(pickles\.com\.au|manheim\.com\.au|lloydsauctions\.com\.au|grays\.com)' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_AUCTION_DOMAIN');
  END IF;

  IF u ~ 'carsales\.com\.au\/cars\/' THEN
    RETURN jsonb_build_object('intent','listing','reason','URL_CARSALES');
  END IF;

  -- content signals (2+ -> listing)
  IF t ~ '\$[0-9,]+' THEN signals := signals + 1; END IF;
  IF t ~ '[0-9,]+\s*(km|kms)' THEN signals := signals + 1; END IF;
  IF t ~ '(for sale|dealer|used|available|enquire)' THEN signals := signals + 1; END IF;
  IF t ~ '\b(nsw|vic|qld|wa|sa|tas|nt|act)\b' THEN signals := signals + 1; END IF;

  IF signals >= 2 THEN
    RETURN jsonb_build_object('intent','listing','reason','CONTENT_SIGNALS_'||signals);
  END IF;

  RETURN jsonb_build_object('intent','unknown','reason','INSUFFICIENT_SIGNALS');
END $$;

-- 7) Source tier function (auction-first)
CREATE OR REPLACE FUNCTION public.fn_source_tier(p_url text, p_source_name text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_source_name,'')) ~ '(pickles|manheim|grays|lloyds|slattery)'
      OR lower(COALESCE(p_url,'')) ~ '(pickles\.com\.au|manheim\.com\.au|grays\.com|lloydsauctions\.com\.au)'
      THEN 1
    WHEN lower(COALESCE(p_source_name,'')) ~ '(carsales|autotrader|drive|gumtree)'
      OR lower(COALESCE(p_url,'')) ~ '(carsales\.com\.au|autotrader\.com\.au|drive\.com\.au|gumtree\.com\.au)'
      THEN 2
    ELSE 3
  END;
$$;