
CREATE TABLE IF NOT EXISTS public.gmail_backfill_state (
  source            text PRIMARY KEY,
  run_id            uuid,
  page_token        text,
  query             text,
  total_estimate    bigint,
  messages_seen     bigint NOT NULL DEFAULT 0,
  messages_ingested bigint NOT NULL DEFAULT 0,
  messages_skipped  bigint NOT NULL DEFAULT 0,
  errors            bigint NOT NULL DEFAULT 0,
  finished_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gmail_backfill_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access gmail_backfill_state"
  ON public.gmail_backfill_state
  FOR ALL
  USING (false)
  WITH CHECK (false);
