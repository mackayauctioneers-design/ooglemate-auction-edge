
-- Drop the old constraint
ALTER TABLE public.sales_target_candidates
  DROP CONSTRAINT IF EXISTS uq_sales_target_shape;

-- Drop any existing index with same name
DROP INDEX IF EXISTS uq_sales_target_shape;

-- Create unique index with engine_code included
CREATE UNIQUE INDEX uq_sales_target_shape ON public.sales_target_candidates (
  account_id, make, model,
  COALESCE(variant, ''),
  COALESCE(transmission, ''),
  COALESCE(fuel_type, ''),
  COALESCE(body_type, ''),
  COALESCE(drive_type, ''),
  COALESCE(engine_code, '')
);
