
-- 1. Track retry attempts per worker run
ALTER TABLE public.worker_runs
  ADD COLUMN IF NOT EXISTS attempt_n INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_worker_runs_dealer_action_started
  ON public.worker_runs (dealer_id, action, started_at DESC);

-- 2. Onboarding alerts — surfaced to operators when auto-remediation gives up
CREATE TABLE IF NOT EXISTS public.onboarding_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dealer_id UUID NOT NULL,
  gate TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error',
  message TEXT NOT NULL,
  attempt_n INTEGER NOT NULL DEFAULT 0,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_alerts TO authenticated;
GRANT ALL ON public.onboarding_alerts TO service_role;

ALTER TABLE public.onboarding_alerts ENABLE ROW LEVEL SECURITY;

-- Operators / admins (any authenticated user using OperatorGuard in UI) can read & manage.
CREATE POLICY "Authenticated read onboarding alerts"
  ON public.onboarding_alerts FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated update onboarding alerts"
  ON public.onboarding_alerts FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_alerts_open
  ON public.onboarding_alerts (dealer_id, gate)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_onboarding_alerts_open
  ON public.onboarding_alerts (created_at DESC)
  WHERE resolved_at IS NULL;

-- 3. Trigger: when a new dealer_profile is inserted with a website,
--    fire dealer-onboard-dispatch via pg_net asynchronously.
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.trigger_dealer_onboard_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT := 'https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/dealer-onboard-dispatch';
  v_anon TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bmNoeHNidXduZ2Ztd3ZzdmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzY4NzIsImV4cCI6MjA4MjY1Mjg3Mn0.EAtZMU4QRmk00Gomr7R25LR0OyJqZtMQA9ZK-7M19hM';
BEGIN
  IF NEW.dealer_website IS NULL OR length(trim(NEW.dealer_website)) = 0 THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon,
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object(
      'dealer_profile_id', NEW.id,
      'dealer_name',       NEW.dealer_name,
      'dealer_website',    NEW.dealer_website,
      'source',            'profile_insert_trigger'
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- never block the INSERT on a dispatch failure
  RAISE WARNING 'trigger_dealer_onboard_dispatch failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dealer_profiles_auto_dispatch ON public.dealer_profiles;
CREATE TRIGGER trg_dealer_profiles_auto_dispatch
  AFTER INSERT ON public.dealer_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_dealer_onboard_dispatch();
