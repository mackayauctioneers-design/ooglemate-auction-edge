CREATE TABLE IF NOT EXISTS public.telegram_sent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id text NOT NULL,
  dedup_key text NOT NULL,
  text_preview text,
  telegram_message_id text,
  telegram_ok boolean,
  telegram_error text,
  ttl_hours integer NOT NULL DEFAULT 24,
  sent_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.telegram_sent_log TO service_role;

CREATE INDEX IF NOT EXISTS telegram_sent_log_chat_dedup_idx
  ON public.telegram_sent_log(chat_id, dedup_key, sent_at DESC);
CREATE INDEX IF NOT EXISTS telegram_sent_log_sent_at_idx
  ON public.telegram_sent_log(sent_at DESC);

ALTER TABLE public.telegram_sent_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on telegram_sent_log"
  ON public.telegram_sent_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);