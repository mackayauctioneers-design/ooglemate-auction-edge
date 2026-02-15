-- Add notes column to opportunities for winner context
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS notes TEXT;
