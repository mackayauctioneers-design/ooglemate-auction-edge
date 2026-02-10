
-- Sourcing watchlist: fingerprint-level watches linked to Bob insights
CREATE TABLE public.sourcing_watchlist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  -- Fingerprint fields
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant TEXT,
  year_min INT,
  year_max INT,
  drivetrain TEXT,
  fuel_type TEXT,
  transmission TEXT,
  -- Metadata
  confidence_level TEXT NOT NULL DEFAULT 'LOW',
  watch_type TEXT NOT NULL DEFAULT 'watch' CHECK (watch_type IN ('watch', 'hunt', 'ignore')),
  originating_insight TEXT,
  -- Optional link to a specific listing
  linked_listing_id UUID REFERENCES public.vehicle_listings(id),
  linked_listing_url TEXT,
  -- Lifecycle
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_sourcing_watchlist_user_account ON public.sourcing_watchlist(user_id, account_id);
CREATE INDEX idx_sourcing_watchlist_make_model ON public.sourcing_watchlist(make, model);

-- Enable RLS
ALTER TABLE public.sourcing_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own sourcing watchlist"
  ON public.sourcing_watchlist FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create sourcing watchlist items"
  ON public.sourcing_watchlist FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sourcing watchlist items"
  ON public.sourcing_watchlist FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sourcing watchlist items"
  ON public.sourcing_watchlist FOR DELETE
  USING (auth.uid() = user_id);

-- Updated_at trigger
CREATE TRIGGER update_sourcing_watchlist_updated_at
  BEFORE UPDATE ON public.sourcing_watchlist
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
