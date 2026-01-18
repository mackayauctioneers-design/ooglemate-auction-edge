-- ============================================
-- fn_is_listing_intent: Classifies URLs as listing/non_listing/unknown
-- This function REJECTS articles, blogs, reviews, guides, etc.
-- ============================================

DROP FUNCTION IF EXISTS public.fn_is_listing_intent(text, text, text);

CREATE OR REPLACE FUNCTION public.fn_is_listing_intent(
  p_url TEXT,
  p_title TEXT,
  p_snippet TEXT
) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_url TEXT := LOWER(COALESCE(p_url, ''));
  v_title TEXT := LOWER(COALESCE(p_title, ''));
  v_snippet TEXT := LOWER(COALESCE(p_snippet, ''));
  v_combined TEXT;
  v_domain TEXT;
  v_signals INT := 0;
  v_intent TEXT := 'unknown';
  v_reason TEXT := 'DEFAULT';
BEGIN
  v_combined := v_title || ' ' || v_snippet;
  
  -- Extract domain
  v_domain := REGEXP_REPLACE(v_url, '^https?://(www\.)?', '');
  v_domain := SPLIT_PART(v_domain, '/', 1);
  
  -- ==========================================
  -- HARD REJECT PATTERNS (non_listing)
  -- ==========================================
  
  -- URL path patterns that are NEVER listings
  IF v_url ~ '/(news|blog|article|review|reviews|guide|guides|price-and-specs|compare|comparison|insurance|finance|about|help|contact|privacy|terms|category|login|signin|signup|register|faq|sitemap|media|press|stories|features|insights|resources|tips|how-to|what-is|best-|top-|vs-|advice|editorial|canopies|ute-canopies|ute-trays|accessories)/' THEN
    RETURN jsonb_build_object('intent', 'non_listing', 'reason', 'URL_PATH_REJECT', 'signals', ARRAY['path_blocked']);
  END IF;
  
  -- Title/snippet patterns that indicate non-listing content
  IF v_combined ~ '(price and specs|review:|car review|best used cars|top 10|buying guide|comparison test|vs\s+\d|should you buy|how to|what is the|everything you need to know)' THEN
    RETURN jsonb_build_object('intent', 'non_listing', 'reason', 'TITLE_CONTENT_REJECT', 'signals', ARRAY['editorial_content']);
  END IF;
  
  -- Junk domains - never return
  IF v_domain ~ '(youtube\.com|youtu\.be|reddit\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com|wikipedia\.org|whirlpool\.net\.au|caradvice\.com\.au|motoring\.com\.au|norweld\.com\.au|arb\.com\.au|ironman4x4\.com)' THEN
    RETURN jsonb_build_object('intent', 'non_listing', 'reason', 'BLOCKED_DOMAIN', 'signals', ARRAY['junk_domain']);
  END IF;
  
  -- ==========================================
  -- HARD ALLOW PATTERNS (verified listings)
  -- ==========================================
  
  -- Auction sites (Tier 1)
  IF v_url ~ 'pickles\.com\.au.*/lot' OR v_url ~ 'pickles\.com\.au.*/auction' OR v_url ~ 'pickles\.com\.au.*/item' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_AUCTION_PICKLES', 'signals', ARRAY['auction_tier1', 'pickles']);
  END IF;
  
  IF v_url ~ 'manheim\.com\.au.*/lot' OR v_url ~ 'manheim\.com\.au.*/auction' OR v_url ~ 'manheim\.com\.au.*/vehicle' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_AUCTION_MANHEIM', 'signals', ARRAY['auction_tier1', 'manheim']);
  END IF;
  
  IF v_url ~ 'lloydsauctions\.com\.au.*/lot' OR v_url ~ 'lloydsauctions\.com\.au.*/item' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_AUCTION_LLOYDS', 'signals', ARRAY['auction_tier1', 'lloyds']);
  END IF;
  
  IF v_url ~ 'grays\.com.*/lot' OR v_url ~ 'grays\.com.*/auction' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_AUCTION_GRAYS', 'signals', ARRAY['auction_tier1', 'grays']);
  END IF;
  
  IF v_url ~ 'slattery\.com\.au.*/lot' OR v_url ~ 'slattery\.com\.au.*/auction' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_AUCTION_SLATTERY', 'signals', ARRAY['auction_tier1', 'slattery']);
  END IF;
  
  -- Marketplace sites (Tier 2)
  IF v_url ~ 'autotrader\.com\.au/.*/car/' OR v_url ~ 'autotrader\.com\.au/car/' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_AUTOTRADER_CAR', 'signals', ARRAY['marketplace_tier2', 'autotrader']);
  END IF;
  
  IF v_url ~ 'gumtree\.com\.au/s-ad/' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_GUMTREE_SAD', 'signals', ARRAY['marketplace_tier2', 'gumtree']);
  END IF;
  
  IF v_url ~ 'carsales\.com\.au.*/details/' OR v_url ~ 'carsales\.com\.au.*/car-details/' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_CARSALES_DETAILS', 'signals', ARRAY['marketplace_tier2', 'carsales']);
  END IF;
  
  -- Drive - only dealer listings, NOT editorial
  IF v_url ~ 'drive\.com\.au/cars-for-sale/.*/dealer-listing' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_DRIVE_DEALER_LISTING', 'signals', ARRAY['marketplace_tier2', 'drive']);
  END IF;
  
  -- Drive cars-for-sale with numeric ID
  IF v_url ~ 'drive\.com\.au/cars-for-sale/car/\d+' THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'URL_DRIVE_CAR_ID', 'signals', ARRAY['marketplace_tier2', 'drive']);
  END IF;
  
  -- ==========================================
  -- SIGNAL-BASED DETECTION (for unknown URLs)
  -- ==========================================
  
  -- Count listing signals in content
  IF v_combined ~ '\$\s*[\d,]+' THEN v_signals := v_signals + 1; END IF;  -- Has price
  IF v_combined ~ '[\d,]+\s*km' THEN v_signals := v_signals + 1; END IF;  -- Has km
  IF v_combined ~ '(for sale|available now|buy now|dealer|used car)' THEN v_signals := v_signals + 1; END IF;
  IF v_combined ~ '(nsw|vic|qld|wa|sa|tas|nt|act|australia)' THEN v_signals := v_signals + 1; END IF;  -- AU location
  IF v_combined ~ '(stock|listing|lot|auction|private seller)' THEN v_signals := v_signals + 1; END IF;
  
  -- If 2+ signals, treat as listing
  IF v_signals >= 2 THEN
    RETURN jsonb_build_object('intent', 'listing', 'reason', 'SIGNAL_MATCH', 'signals', ARRAY['price', 'km', 'location', 'for_sale']::text[]);
  END IF;
  
  -- Default to unknown - will become UNVERIFIED in UI
  RETURN jsonb_build_object('intent', 'unknown', 'reason', 'INSUFFICIENT_SIGNALS', 'signals', ARRAY[]::text[]);
END $$;

-- ============================================
-- Update fn_classify_listing_intent to use the new function
-- ============================================
DROP FUNCTION IF EXISTS public.fn_classify_listing_intent(text, text, text);

CREATE OR REPLACE FUNCTION public.fn_classify_listing_intent(
  p_url TEXT,
  p_title TEXT,
  p_snippet TEXT
) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  -- Just delegate to the new comprehensive function
  RETURN fn_is_listing_intent(p_url, p_title, p_snippet);
END $$;