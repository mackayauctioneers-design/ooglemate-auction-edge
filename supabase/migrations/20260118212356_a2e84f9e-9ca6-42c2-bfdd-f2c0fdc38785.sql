-- Dealer Outbound Sources: seed list for Tier 3 discovery
CREATE TABLE IF NOT EXISTS public.dealer_outbound_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_slug text NOT NULL UNIQUE,
  dealer_name text NOT NULL,
  dealer_domain text NOT NULL,
  inventory_path text NOT NULL DEFAULT '/used-cars',
  enabled boolean NOT NULL DEFAULT true,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
  last_crawl_at timestamptz,
  last_crawl_count int,
  last_crawl_error text,
  consecutive_failures int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for enabled lookup
CREATE INDEX IF NOT EXISTS idx_dos_enabled ON public.dealer_outbound_sources(enabled) WHERE enabled = true;

-- Add dealer_outbound_enabled toggle to sale_hunts
ALTER TABLE public.sale_hunts
  ADD COLUMN IF NOT EXISTS dealer_outbound_enabled boolean NOT NULL DEFAULT false;

-- Extend fn_canonical_listing_id to handle dealer outbound URLs with dealer slug prefix
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
      -- Drive
      WHEN p_url ~* 'drive\.com\.au.*/(listing|dealer-listing)/(\d+)'
        THEN 'drive:' || regexp_replace(p_url, '.*/(listing|dealer-listing)/(\d+).*', '\2')
      -- Dealer stock page with ID: /stock/ABC123, /inventory/12345, /vehicles/XYZ789
      WHEN p_url ~* '/(?:stock|inventory|vehicles?|details?|listing)/([A-Za-z0-9_-]{3,20})/?$'
        THEN lower(regexp_replace(p_url, '^https?://([^/]+).*$', '\1')) 
             || ':' 
             || regexp_replace(p_url, '.*/(?:stock|inventory|vehicles?|details?|listing)/([A-Za-z0-9_-]{3,20})/?$', '\1')
      -- Fallback: domain:md5(normalized_url)
      ELSE lower(regexp_replace(p_url, '^https?://([^/]+).*$', '\1')) || ':' || md5(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(p_url), '\?.*$', ''), -- strip query
            '#.*$', ''  -- strip fragment
          ),
          '/$', ''  -- strip trailing slash
        )
      )
    END;
$$;

-- RLS: service role only for dealer_outbound_sources
ALTER TABLE public.dealer_outbound_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.dealer_outbound_sources
  FOR ALL USING (true) WITH CHECK (true);

-- Seed 5 test dealers
INSERT INTO public.dealer_outbound_sources (dealer_slug, dealer_name, dealer_domain, inventory_path, enabled, notes)
VALUES 
  ('patterson-cheney', 'Patterson Cheney Toyota', 'pattersoncheneytoyota.com.au', '/used-vehicles', true, 'Test dealer 1'),
  ('john-madill', 'John Madill Toyota', 'johnmadilltoyota.com.au', '/used-vehicles', true, 'Test dealer 2'),
  ('scotts-toyota', 'Scotts Toyota', 'scottstoyota.com.au', '/pre-owned', true, 'Test dealer 3'),
  ('canberra-toyota', 'Canberra Toyota', 'canberratoyota.com.au', '/used-cars', true, 'Test dealer 4'),
  ('sunshine-toyota', 'Sunshine Toyota', 'sunshinetoyota.com.au', '/used-vehicles', true, 'Test dealer 5')
ON CONFLICT (dealer_slug) DO NOTHING;