-- =============================================================================
-- SALES_NORMALISED (single source of truth inside Supabase)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sales_normalised (
  id bigserial PRIMARY KEY,
  source_row_id text UNIQUE,             -- stable row id from sheet (or hash)
  dealer_name text,
  sale_date date,
  make text,
  model text,
  variant_used text,
  variant_family text,
  year int,
  km int,
  sale_price numeric,
  gross_profit numeric,
  days_in_stock int,
  transmission text,
  fuel text,
  drivetrain text,
  region_id text,
  updated_at timestamptz DEFAULT now()
);

-- Lookup indexes
CREATE INDEX IF NOT EXISTS sales_norm_lookup_idx
  ON public.sales_normalised (make, model, variant_used, sale_date DESC);

CREATE INDEX IF NOT EXISTS sales_norm_year_km_idx
  ON public.sales_normalised (year, km);

CREATE INDEX IF NOT EXISTS sales_norm_region_idx
  ON public.sales_normalised (region_id);