
-- Dealer Profit Patterns — the "tradable pattern universe"
CREATE TABLE public.dealer_profit_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  trim_class TEXT NOT NULL,
  year_min INT NOT NULL,
  year_max INT NOT NULL,
  km_min INT NOT NULL,
  km_max INT NOT NULL,
  total_flips INT NOT NULL DEFAULT 0,
  median_buy_price NUMERIC,
  median_sell_price NUMERIC,
  median_profit NUMERIC,
  median_km NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, make, model, trim_class, year_min, year_max, km_min, km_max)
);

ALTER TABLE public.dealer_profit_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read patterns"
  ON public.dealer_profit_patterns FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert patterns"
  ON public.dealer_profit_patterns FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update patterns"
  ON public.dealer_profit_patterns FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete patterns"
  ON public.dealer_profit_patterns FOR DELETE
  USING (auth.role() = 'authenticated');

CREATE INDEX idx_profit_patterns_account ON public.dealer_profit_patterns(account_id);
CREATE INDEX idx_profit_patterns_lookup ON public.dealer_profit_patterns(make, model, trim_class);
