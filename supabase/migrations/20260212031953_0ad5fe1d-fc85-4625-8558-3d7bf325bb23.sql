
-- Table: fingerprint_search_urls
CREATE TABLE public.fingerprint_search_urls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fingerprint_id UUID NOT NULL REFERENCES public.sales_target_candidates(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  source TEXT NOT NULL, -- 'carsales', 'autotrader', 'pickles'
  search_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fsu_fingerprint ON public.fingerprint_search_urls(fingerprint_id);
CREATE INDEX idx_fsu_account ON public.fingerprint_search_urls(account_id);

ALTER TABLE public.fingerprint_search_urls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on fingerprint_search_urls"
  ON public.fingerprint_search_urls FOR ALL
  USING (true) WITH CHECK (true);

-- Table: firecrawl_candidates
CREATE TABLE public.firecrawl_candidates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fingerprint_id UUID NOT NULL REFERENCES public.sales_target_candidates(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  source TEXT NOT NULL,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  year INTEGER,
  make TEXT,
  model TEXT,
  variant TEXT,
  kms INTEGER,
  price INTEGER,
  location TEXT,
  seller TEXT,
  url TEXT,
  match_score INTEGER DEFAULT 0,
  upgrade_flag BOOLEAN DEFAULT false,
  downgrade_flag BOOLEAN DEFAULT false,
  score_reasons JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new', -- 'new', 'reviewed', 'actioned', 'dismissed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_fc_dedup ON public.firecrawl_candidates(fingerprint_id, url) WHERE url IS NOT NULL;
CREATE INDEX idx_fc_fingerprint ON public.firecrawl_candidates(fingerprint_id);
CREATE INDEX idx_fc_account ON public.firecrawl_candidates(account_id);
CREATE INDEX idx_fc_score ON public.firecrawl_candidates(match_score DESC);

ALTER TABLE public.firecrawl_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on firecrawl_candidates"
  ON public.firecrawl_candidates FOR ALL
  USING (true) WITH CHECK (true);

-- View: fingerprint_opportunities (candidates scored >= 6 joined with fingerprint)
CREATE OR REPLACE VIEW public.fingerprint_opportunities AS
SELECT
  fc.id AS candidate_id,
  fc.fingerprint_id,
  fc.account_id,
  fc.source,
  fc.year AS candidate_year,
  fc.make AS candidate_make,
  fc.model AS candidate_model,
  fc.variant AS candidate_variant,
  fc.kms AS candidate_kms,
  fc.price AS candidate_price,
  fc.location,
  fc.seller,
  fc.url,
  fc.match_score,
  fc.upgrade_flag,
  fc.downgrade_flag,
  fc.score_reasons,
  fc.status,
  fc.scraped_at,
  stc.make AS fp_make,
  stc.model AS fp_model,
  stc.variant AS fp_variant,
  stc.median_km AS fp_median_km,
  stc.median_sale_price AS fp_median_sale_price,
  stc.median_profit AS fp_median_profit,
  stc.target_score AS fp_target_score,
  stc.sales_count AS fp_sales_count,
  stc.fingerprint_type AS fp_type,
  stc.transmission AS fp_transmission,
  stc.body_type AS fp_body_type,
  stc.fuel_type AS fp_fuel_type
FROM public.firecrawl_candidates fc
JOIN public.sales_target_candidates stc ON stc.id = fc.fingerprint_id
WHERE fc.match_score >= 6
ORDER BY fc.upgrade_flag DESC, fc.match_score DESC;
