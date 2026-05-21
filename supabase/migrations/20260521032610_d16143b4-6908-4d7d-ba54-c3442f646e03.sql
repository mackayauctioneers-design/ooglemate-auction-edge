ALTER TABLE public.dealer_replacement_fingerprints
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmed',
ADD COLUMN IF NOT EXISTS notes TEXT;