
-- 1. hermes_locks
CREATE TABLE IF NOT EXISTS public.hermes_locks (
  lock_key TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hermes_locks TO authenticated;
GRANT ALL ON public.hermes_locks TO service_role;

ALTER TABLE public.hermes_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages hermes_locks" ON public.hermes_locks;
CREATE POLICY "Service role manages hermes_locks"
  ON public.hermes_locks FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 2. dealer_context grants (table exists, policy exists, but no GRANTs → PostgREST permission denied)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_context TO authenticated;
GRANT ALL ON public.dealer_context TO service_role;
