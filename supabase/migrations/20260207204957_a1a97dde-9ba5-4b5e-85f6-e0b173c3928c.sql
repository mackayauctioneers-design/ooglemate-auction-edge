
-- Upload mapping profiles: saved header→canonical field mappings per account
CREATE TABLE public.upload_mapping_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  profile_name TEXT NOT NULL,
  header_map JSONB NOT NULL DEFAULT '{}',
  source_headers TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, profile_name)
);

ALTER TABLE public.upload_mapping_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to upload_mapping_profiles"
  ON public.upload_mapping_profiles FOR ALL USING (true) WITH CHECK (true);

-- Add mapping profile reference to upload_batches
ALTER TABLE public.upload_batches
  ADD COLUMN IF NOT EXISTS raw_headers TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mapping_profile_id UUID REFERENCES public.upload_mapping_profiles(id);
