-- Update fn_canonical_listing_id to handle Pickles /used/details/ URLs
CREATE OR REPLACE FUNCTION public.fn_canonical_listing_id(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      -- Pickles: /used/details/.../STOCK_NUMBER (new format)
      WHEN p_url ~* 'pickles\.com\.au/used/details/.*/(\d+)$'
        THEN 'pickles:' || regexp_replace(p_url, '.*/(\d+)$', '\1')
      -- Pickles: /lot/LOT_NUMBER (old format)
      WHEN p_url ~* 'pickles\.com\.au/.*/lot/([0-9]+)'
        THEN 'pickles:' || regexp_replace(p_url, '.*lot/([0-9]+).*', '\1')
      -- Manheim
      WHEN p_url ~* 'manheim\.com\.au/.*/vehicle/([0-9]+)'
        THEN 'manheim:' || regexp_replace(p_url, '.*vehicle/([0-9]+).*', '\1')
      -- Grays
      WHEN p_url ~* 'grays\.com/.*/lot/([0-9]+)'
        THEN 'grays:' || regexp_replace(p_url, '.*lot/([0-9]+).*', '\1')
      -- Lloyds
      WHEN p_url ~* 'lloydsauctions\.com\.au/.*/lot/([0-9]+)'
        THEN 'lloyds:' || regexp_replace(p_url, '.*lot/([0-9]+).*', '\1')
      -- Carsales
      WHEN p_url ~* 'carsales\.com\.au.*/(SSE-AD-\d+|OAG-AD-\d+|\d{7,})'
        THEN 'carsales:' || regexp_replace(p_url, '.*/(SSE-AD-\d+|OAG-AD-\d+|(\d{7,})).*', '\1')
      -- Autotrader
      WHEN p_url ~* 'autotrader\.com\.au.*/(\d{6,})'
        THEN 'autotrader:' || regexp_replace(p_url, '.*/(\d{6,}).*', '\1')
      -- Gumtree
      WHEN p_url ~* 'gumtree\.com\.au.*/(\d{10,})'
        THEN 'gumtree:' || regexp_replace(p_url, '.*/(\d{10,}).*', '\1')
      -- Fallback: MD5 hash
      ELSE md5(p_url)
    END;
$$;

-- Update fn_classify_listing_intent to explicitly detect Pickles detail pages
DROP FUNCTION IF EXISTS public.fn_classify_listing_intent(text, text, text);

CREATE OR REPLACE FUNCTION public.fn_classify_listing_intent(
  p_url text,
  p_title text DEFAULT NULL,
  p_snippet text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_url_lower text := lower(COALESCE(p_url, ''));
BEGIN
  -- =============================================
  -- HARD BLOCKLIST: Editorial / non-listing pages
  -- =============================================
  IF v_url_lower ~ '/(news|blog|review|guide|specs|comparison|pricing|insurance|finance|about|help|contact|faq)/' THEN
    RETURN jsonb_build_object('intent', 'non_listing', 'reason', 'URL_BLOCKLIST_EDITORIAL');
  END IF;

  -- =============================================
  -- HARD ALLOWLIST: Known listing detail patterns
  -- =============================================
  
  -- PICKLES: /used/details/.../STOCK_ID (MUST end in digits)
  IF v_url_lower ~ 'pickles\.com\.au/used/details/.*/\d+$' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_PICKLES_DETAILS');
  END IF;
  
  -- PICKLES: old /lot/ format
  IF v_url_lower ~ 'pickles\.com\.au.*/lot/\d+' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_PICKLES_LOT');
  END IF;
  
  -- MANHEIM
  IF v_url_lower ~ 'manheim\.com\.au.*/vehicle/\d+' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_MANHEIM_VEHICLE');
  END IF;
  
  -- GRAYS
  IF v_url_lower ~ 'grays\.com.*/lot/\d+' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_GRAYS_LOT');
  END IF;
  
  -- LLOYDS
  IF v_url_lower ~ 'lloydsauctions\.com\.au.*/lot/\d+' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_LLOYDS_LOT');
  END IF;
  
  -- CARSALES: /cars/details/...
  IF v_url_lower ~ 'carsales\.com\.au/cars/details/' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_CARSALES_DETAILS');
  END IF;
  
  -- AUTOTRADER: /car/.../detail/
  IF v_url_lower ~ 'autotrader\.com\.au.*/car/.*/detail/' OR v_url_lower ~ 'autotrader\.com\.au.*/\d{6,}' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_AUTOTRADER_DETAIL');
  END IF;
  
  -- GUMTREE: /s-ad/...
  IF v_url_lower ~ 'gumtree\.com\.au.*/s-ad/' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_GUMTREE_AD');
  END IF;
  
  -- DRIVE: /cars-for-sale/car/...
  IF v_url_lower ~ 'drive\.com\.au/cars-for-sale/car/' AND v_url_lower ~ '/\d{6,}' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_DRIVE_LISTING');
  END IF;

  -- =============================================
  -- Domain-level allowlist (less certain)
  -- =============================================
  IF v_url_lower ~ '(pickles\.com\.au|manheim\.com\.au|grays\.com|lloydsauctions\.com\.au)' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'DOMAIN_AUCTION_SITE');
  END IF;
  
  IF v_url_lower ~ '(carsales\.com\.au|autotrader\.com\.au|gumtree\.com\.au|drive\.com\.au)' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'DOMAIN_MARKETPLACE');
  END IF;

  -- =============================================
  -- Content signals (fallback)
  -- =============================================
  DECLARE
    v_signals int := 0;
    v_combined text := lower(COALESCE(p_title, '') || ' ' || COALESCE(p_snippet, ''));
  BEGIN
    IF v_combined ~ '\$\s*[\d,]+' THEN v_signals := v_signals + 1; END IF;
    IF v_combined ~ '[\d,]+\s*km' THEN v_signals := v_signals + 1; END IF;
    IF v_combined ~ '(for sale|buy now|auction|bid)' THEN v_signals := v_signals + 1; END IF;
    IF v_combined ~ '(nsw|vic|qld|sa|wa|tas|nt|act|australia)' THEN v_signals := v_signals + 1; END IF;
    
    IF v_signals >= 2 THEN
      RETURN jsonb_build_object('intent', 'listing', 'reason', 'CONTENT_SIGNALS_' || v_signals);
    END IF;
  END;

  RETURN jsonb_build_object('intent', 'unknown', 'reason', 'NO_MATCH');
END;
$$;

-- Also update fn_is_listing_intent to use the new logic
CREATE OR REPLACE FUNCTION public.fn_is_listing_intent(
  p_url text,
  p_title text,
  p_snippet text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := fn_classify_listing_intent(p_url, p_title, p_snippet);
  RETURN v_result->>'intent';
END;
$$;