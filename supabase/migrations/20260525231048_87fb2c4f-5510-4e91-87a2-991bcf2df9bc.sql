
-- Queue for scraped sources that did not bind to an existing account
CREATE TABLE IF NOT EXISTS public.dealer_unmapped_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  adapter text,
  source_slug text NOT NULL,
  source_label text,
  source_url text,
  sample_payload jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrences integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  resolved_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dealer_unmapped_sources_open_uidx
  ON public.dealer_unmapped_sources (source, source_slug)
  WHERE status = 'pending';

ALTER TABLE public.dealer_unmapped_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage unmapped sources"
  ON public.dealer_unmapped_sources
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Append-only snapshots of each worker-ingest run for diffing
CREATE TABLE IF NOT EXISTS public.dealer_inventory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  dealer_id uuid REFERENCES public.dealer_profiles(id) ON DELETE SET NULL,
  source text NOT NULL,
  adapter text,
  worker_run_id uuid,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  listing_ids text[] NOT NULL DEFAULT '{}',
  listing_count integer NOT NULL DEFAULT 0,
  raw_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dealer_inventory_snapshots_account_source_idx
  ON public.dealer_inventory_snapshots (account_id, source, snapshot_at DESC);

ALTER TABLE public.dealer_inventory_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage inventory snapshots"
  ON public.dealer_inventory_snapshots
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
