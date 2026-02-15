
-- Winners watchlist: top profitable vehicle groups from uploaded sales logs
CREATE TABLE public.winners_watchlist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant TEXT,
  year_min INTEGER,
  year_max INTEGER,
  total_profit NUMERIC,
  avg_profit NUMERIC,
  times_sold INTEGER DEFAULT 0,
  last_sale_price NUMERIC,
  last_sale_date DATE,
  rank INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, make, model, variant)
);

ALTER TABLE public.winners_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on winners_watchlist"
  ON public.winners_watchlist FOR ALL
  USING (true) WITH CHECK (true);

CREATE INDEX idx_winners_watchlist_lookup ON public.winners_watchlist (make, model);
CREATE INDEX idx_winners_watchlist_rank ON public.winners_watchlist (account_id, rank);
