ALTER TABLE public.outward_search_results
  ADD COLUMN IF NOT EXISTS condition_grade text,
  ADD COLUMN IF NOT EXISTS condition_score integer,
  ADD COLUMN IF NOT EXISTS major_defects text,
  ADD COLUMN IF NOT EXISTS interior_notes text,
  ADD COLUMN IF NOT EXISTS exterior_notes text,
  ADD COLUMN IF NOT EXISTS mechanical_notes text;