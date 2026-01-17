-- Add must-have keyword fields to sale_hunts
ALTER TABLE public.sale_hunts
ADD COLUMN IF NOT EXISTS must_have_raw text NULL,
ADD COLUMN IF NOT EXISTS must_have_tokens text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS must_have_mode text DEFAULT 'soft' CHECK (must_have_mode IN ('soft', 'strict'));

-- Add comment for documentation
COMMENT ON COLUMN public.sale_hunts.must_have_raw IS 'Raw free-text buyer must-have requirements';
COMMENT ON COLUMN public.sale_hunts.must_have_tokens IS 'Normalized uppercase tokens extracted from must_have_raw';
COMMENT ON COLUMN public.sale_hunts.must_have_mode IS 'strict = must match to qualify, soft = boosts score';