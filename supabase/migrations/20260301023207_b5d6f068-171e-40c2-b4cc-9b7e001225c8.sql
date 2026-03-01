
-- 1. Add brands column to dealer_outbound_sources for brand routing
ALTER TABLE public.dealer_outbound_sources
ADD COLUMN IF NOT EXISTS brands text[] DEFAULT '{}';

-- 2. Create search_cache table for 3-hour TTL caching
CREATE TABLE public.search_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key text NOT NULL UNIQUE,
  make text NOT NULL,
  model text,
  badge text,
  year_min integer,
  year_max integer,
  max_km integer,
  price_max integer,
  results jsonb NOT NULL DEFAULT '[]',
  source text NOT NULL DEFAULT 'outward',
  hits integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '3 hours')
);

CREATE INDEX idx_search_cache_key ON public.search_cache (cache_key);
CREATE INDEX idx_search_cache_expires ON public.search_cache (expires_at);

-- RLS: service role only (edge functions)
ALTER TABLE public.search_cache ENABLE ROW LEVEL SECURITY;

-- 3. Populate brands from dealer names (best-effort heuristic)
UPDATE public.dealer_outbound_sources SET brands = ARRAY['TOYOTA']
WHERE lower(dealer_name) LIKE '%toyota%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['HYUNDAI']
WHERE lower(dealer_name) LIKE '%hyundai%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['MAZDA']
WHERE lower(dealer_name) LIKE '%mazda%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['NISSAN']
WHERE lower(dealer_name) LIKE '%nissan%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['FORD']
WHERE lower(dealer_name) LIKE '%ford%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['KIA']
WHERE lower(dealer_name) LIKE '%kia%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['SUBARU']
WHERE lower(dealer_name) LIKE '%subaru%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['MITSUBISHI']
WHERE lower(dealer_name) LIKE '%mitsubishi%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['VOLKSWAGEN']
WHERE (lower(dealer_name) LIKE '%volkswagen%' OR lower(dealer_name) LIKE '%vw %') AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['AUDI']
WHERE lower(dealer_name) LIKE '%audi%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['BMW']
WHERE lower(dealer_name) LIKE '%bmw%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['MERCEDES-BENZ']
WHERE (lower(dealer_name) LIKE '%mercedes%' OR lower(dealer_name) LIKE '%benz%') AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['ISUZU']
WHERE lower(dealer_name) LIKE '%isuzu%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['HONDA']
WHERE lower(dealer_name) LIKE '%honda%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['SUZUKI']
WHERE lower(dealer_name) LIKE '%suzuki%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['VOLVO']
WHERE lower(dealer_name) LIKE '%volvo%' AND brands = '{}';

UPDATE public.dealer_outbound_sources SET brands = ARRAY['LEXUS']
WHERE lower(dealer_name) LIKE '%lexus%' AND brands = '{}';

-- Multi-brand dealers (groups, auction houses, generic) — empty brands means "all brands"
-- No update needed — they stay as '{}' which we'll treat as "matches all"
