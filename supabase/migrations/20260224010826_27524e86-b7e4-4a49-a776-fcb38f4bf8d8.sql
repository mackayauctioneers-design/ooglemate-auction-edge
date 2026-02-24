
-- Enums for OogleBot
CREATE TYPE public.ooglebot_urgency AS ENUM ('normal', 'high', 'urgent');
CREATE TYPE public.ooglebot_status AS ENUM ('active', 'fulfilled', 'expired', 'paused');

-- OogleBot Jobs table
CREATE TABLE public.ooglebot_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_name TEXT NOT NULL,
  dealer_contact TEXT,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant TEXT,
  year_min INT NOT NULL,
  year_max INT NOT NULL,
  km_max INT NOT NULL,
  budget_ceiling NUMERIC NOT NULL,
  urgency public.ooglebot_urgency NOT NULL DEFAULT 'normal',
  status public.ooglebot_status NOT NULL DEFAULT 'active',
  expiry_date TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  last_match_at TIMESTAMPTZ,
  notes TEXT
);

ALTER TABLE public.ooglebot_jobs ENABLE ROW LEVEL SECURITY;

-- Only operators (admins) can manage ooglebot jobs
CREATE POLICY "Admins can manage ooglebot_jobs"
  ON public.ooglebot_jobs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- OogleBot Matches table
CREATE TABLE public.ooglebot_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ooglebot_job_id UUID NOT NULL REFERENCES public.ooglebot_jobs(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'vehicle_listings',
  effective_cost NUMERIC NOT NULL,
  ask_price NUMERIC,
  make TEXT,
  model TEXT,
  variant TEXT,
  year INT,
  km INT,
  location TEXT,
  listing_url TEXT,
  days_listed INT,
  rank_position INT NOT NULL CHECK (rank_position BETWEEN 1 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ooglebot_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage ooglebot_matches"
  ON public.ooglebot_matches FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Index for fast job scanning
CREATE INDEX idx_ooglebot_jobs_active ON public.ooglebot_jobs(status) WHERE status = 'active';
CREATE INDEX idx_ooglebot_matches_job ON public.ooglebot_matches(ooglebot_job_id);
