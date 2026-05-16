
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS easycars_post_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS easycars_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS easycars_ready_by text,
  ADD COLUMN IF NOT EXISTS easycars_posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS easycars_posted_by text,
  ADD COLUMN IF NOT EXISTS easycars_stock_number_manual text,
  ADD COLUMN IF NOT EXISTS easycars_post_note text;

ALTER TABLE public.trades
  DROP CONSTRAINT IF EXISTS trades_easycars_post_status_chk;
ALTER TABLE public.trades
  ADD CONSTRAINT trades_easycars_post_status_chk
  CHECK (easycars_post_status IN ('pending','manual_ready','manual_posted'));

CREATE INDEX IF NOT EXISTS idx_trades_easycars_post_status
  ON public.trades (easycars_post_status);

-- Allow admins to read & update trades for the manual posting workflow
DROP POLICY IF EXISTS "Admins can view trades" ON public.trades;
CREATE POLICY "Admins can view trades"
  ON public.trades
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update trades" ON public.trades;
CREATE POLICY "Admins can update trades"
  ON public.trades
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
