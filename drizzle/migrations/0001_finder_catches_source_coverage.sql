CREATE TABLE public.finder_catches (
  catch_id text PRIMARY KEY,
  found_at timestamptz NOT NULL,
  updated_at timestamptz,
  source text NOT NULL,
  finder text,
  finders text[],
  url text,
  year int,
  make text,
  model text,
  badge text,
  km int,
  state text,
  seller_type text,
  ask numeric,
  floor numeric,
  gap_dollars numeric,
  gap_pct numeric,
  floor_basis text,
  engine_confidence text,
  comp_count int,
  check_this boolean,
  closes_at timestamptz,
  alert_line text,
  alerted_to text,
  alerted_at timestamptz,
  status text CHECK (status IS NULL OR status IN ('live','expired','sold','bought')),
  corrected boolean,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX finder_catches_found_at_idx ON public.finder_catches (found_at DESC);
CREATE INDEX finder_catches_source_idx ON public.finder_catches (source);

CREATE TABLE public.source_coverage (
  date date NOT NULL,
  source text NOT NULL,
  listings_scanned int,
  new int,
  errors int,
  catches int,
  quiet boolean,
  well_below_market_flagged int,
  sales jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, source)
);

GRANT SELECT ON public.finder_catches TO authenticated;
GRANT ALL ON public.finder_catches TO service_role;
GRANT SELECT ON public.source_coverage TO authenticated;
GRANT ALL ON public.source_coverage TO service_role;

ALTER TABLE public.finder_catches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_coverage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read finder catches" ON public.finder_catches FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins read source coverage" ON public.source_coverage FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));