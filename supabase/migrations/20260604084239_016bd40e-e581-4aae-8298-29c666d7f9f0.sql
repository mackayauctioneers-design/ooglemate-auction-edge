
-- 1. Add account_id column
ALTER TABLE public.dealer_live_opportunities
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS dealer_live_opps_account_created_idx
  ON public.dealer_live_opportunities (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dealer_live_opps_account_status_idx
  ON public.dealer_live_opportunities (account_id, status);

-- 2. Account-scoped unique key so OpenClaw can upsert on (account_id, source, listing_id)
CREATE UNIQUE INDEX IF NOT EXISTS dealer_live_opps_account_uniq
  ON public.dealer_live_opportunities (account_id, source, listing_id)
  WHERE account_id IS NOT NULL;

-- 3. RLS: dealers view live opps for their linked accounts (mirrors matched_opportunities_v1)
DROP POLICY IF EXISTS "Dealers view live opps for their accounts" ON public.dealer_live_opportunities;
CREATE POLICY "Dealers view live opps for their accounts"
  ON public.dealer_live_opportunities
  FOR SELECT
  USING (
    account_id IN (
      SELECT dp.account_id
      FROM public.dealer_profiles dp
      JOIN public.dealer_profile_user_links dpul
        ON dpul.dealer_profile_id = dp.id
      WHERE dpul.user_id = auth.uid()
        AND dp.account_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Dealers update live opps for their accounts" ON public.dealer_live_opportunities;
CREATE POLICY "Dealers update live opps for their accounts"
  ON public.dealer_live_opportunities
  FOR UPDATE
  USING (
    account_id IN (
      SELECT dp.account_id
      FROM public.dealer_profiles dp
      JOIN public.dealer_profile_user_links dpul
        ON dpul.dealer_profile_id = dp.id
      WHERE dpul.user_id = auth.uid()
        AND dp.account_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Service role full access on dealer_live_opportunities" ON public.dealer_live_opportunities;
CREATE POLICY "Service role full access on dealer_live_opportunities"
  ON public.dealer_live_opportunities
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, UPDATE ON public.dealer_live_opportunities TO authenticated;
GRANT ALL ON public.dealer_live_opportunities TO service_role;

-- 4. Realtime
ALTER TABLE public.dealer_live_opportunities REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'dealer_live_opportunities'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dealer_live_opportunities;
  END IF;
END $$;
