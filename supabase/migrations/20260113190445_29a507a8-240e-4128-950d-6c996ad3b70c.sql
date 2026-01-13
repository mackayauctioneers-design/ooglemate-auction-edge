-- Create auction_source_events table for audit trail
CREATE TABLE IF NOT EXISTS public.auction_source_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL,
  event_type text NOT NULL,
  message text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auction_source_events_source_key
  ON public.auction_source_events(source_key, created_at DESC);

-- RPC: re-enable + reset failures
CREATE OR REPLACE FUNCTION public.reenable_auction_source(p_source_key text, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  UPDATE public.auction_sources
  SET
    enabled = true,
    consecutive_failures = 0,
    last_error = null,
    auto_disabled_at = null,
    auto_disabled_reason = null,
    updated_at = now()
  WHERE source_key = p_source_key;

  INSERT INTO public.auction_source_events(source_key, event_type, message, meta)
  VALUES (p_source_key, 'reenabled', COALESCE(p_reason, 'manual re-enable'), jsonb_build_object('by','rpc'));
END;
$$;