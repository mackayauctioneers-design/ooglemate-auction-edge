
-- Phase 1: Taxonomy tables for canonical vehicle identity normalization

-- 1) Canonical models + aliases
CREATE TABLE IF NOT EXISTS public.taxonomy_models (
  id bigserial PRIMARY KEY,
  make text NOT NULL,
  canonical_model text NOT NULL,
  family_key text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (make, canonical_model)
);

CREATE INDEX IF NOT EXISTS taxonomy_models_make_idx ON public.taxonomy_models (make);
CREATE INDEX IF NOT EXISTS taxonomy_models_family_idx ON public.taxonomy_models (family_key);

ALTER TABLE public.taxonomy_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "taxonomy_models_read_all" ON public.taxonomy_models
  FOR SELECT USING (true);

-- 2) Variant rank (global hierarchy; optional model-specific)
CREATE TABLE IF NOT EXISTS public.taxonomy_variant_rank (
  id bigserial PRIMARY KEY,
  make text NOT NULL,
  model text NULL,
  canonical_variant text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  rank int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (make, model, canonical_variant)
);

CREATE INDEX IF NOT EXISTS taxonomy_variant_rank_make_model_idx ON public.taxonomy_variant_rank (make, model);
CREATE INDEX IF NOT EXISTS taxonomy_variant_rank_rank_idx ON public.taxonomy_variant_rank (rank);

ALTER TABLE public.taxonomy_variant_rank ENABLE ROW LEVEL SECURITY;

CREATE POLICY "taxonomy_variant_rank_read_all" ON public.taxonomy_variant_rank
  FOR SELECT USING (true);

-- 3) Dealer sales-truth aggregated fingerprints (assist layer)
CREATE TABLE IF NOT EXISTS public.dealer_sales_fingerprints (
  id bigserial PRIMARY KEY,
  dealer_id uuid NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  variant text NULL,
  year_from int NULL,
  year_to int NULL,
  km_from int NULL,
  km_to int NULL,
  count_sold int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dealer_id, make, model, variant, year_from, year_to, km_from, km_to)
);

CREATE INDEX IF NOT EXISTS dealer_sales_fingerprints_dealer_idx ON public.dealer_sales_fingerprints (dealer_id);
CREATE INDEX IF NOT EXISTS dealer_sales_fingerprints_make_model_idx ON public.dealer_sales_fingerprints (make, model);

ALTER TABLE public.dealer_sales_fingerprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dealer_sales_fingerprints_read_all" ON public.dealer_sales_fingerprints
  FOR SELECT USING (true);
