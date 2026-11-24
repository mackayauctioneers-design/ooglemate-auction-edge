CREATE TABLE public.yard_links (
  ooglecars_dealership_id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.owner_access (
  ooglecars_user_id uuid PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.yard_links TO service_role;
GRANT ALL ON public.owner_access TO service_role;
ALTER TABLE public.yard_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_access ENABLE ROW LEVEL SECURITY;