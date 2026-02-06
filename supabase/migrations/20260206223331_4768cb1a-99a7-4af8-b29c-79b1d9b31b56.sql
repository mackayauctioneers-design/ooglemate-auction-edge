
-- ============================================================
-- Deal Truth Ledger — Full Schema
-- ============================================================

-- 1) deal_truth_ledger (the deal spine)
CREATE TABLE IF NOT EXISTS public.deal_truth_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'other',
  url_canonical text NOT NULL,
  listing_norm_id uuid NULL,
  matched_opportunity_id uuid NULL,
  vehicle_identifier text NULL,
  make text NULL,
  model text NULL,
  year int NULL,
  km int NULL,
  asking_price int NULL,
  status text NOT NULL DEFAULT 'identified'
    CHECK (status IN ('identified','approved','purchased','delivered','closed','aborted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT '',
  notes text NULL,
  UNIQUE (account_id, matched_opportunity_id),
  UNIQUE (account_id, url_canonical)
);

CREATE INDEX IF NOT EXISTS deal_truth_ledger_account_status_idx
  ON public.deal_truth_ledger(account_id, status, created_at DESC);

-- Enable RLS
ALTER TABLE public.deal_truth_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view deals"
  ON public.deal_truth_ledger FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert deals"
  ON public.deal_truth_ledger FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update deals"
  ON public.deal_truth_ledger FOR UPDATE
  USING (auth.uid() IS NOT NULL);


-- 2) deal_truth_events (append-only event timeline)
CREATE TABLE IF NOT EXISTS public.deal_truth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deal_truth_ledger(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS deal_truth_events_deal_idx
  ON public.deal_truth_events(deal_id, created_at);

ALTER TABLE public.deal_truth_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view events"
  ON public.deal_truth_events FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert events"
  ON public.deal_truth_events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- NO UPDATE or DELETE policies — append only


-- 3) deal_truth_artefacts (documents/photos tied to deal)
CREATE TABLE IF NOT EXISTS public.deal_truth_artefacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deal_truth_ledger(id) ON DELETE CASCADE,
  artefact_type text NOT NULL
    CHECK (artefact_type IN (
      'listing_snapshot','auction_invoice','tax_invoice',
      'buyer_fees_invoice','payment_receipt','transport_invoice',
      'arrival_photos','condition_report','other'
    )),
  file_url text NOT NULL,
  file_hash text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS deal_truth_artefacts_deal_idx
  ON public.deal_truth_artefacts(deal_id, artefact_type);

ALTER TABLE public.deal_truth_artefacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view artefacts"
  ON public.deal_truth_artefacts FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert artefacts"
  ON public.deal_truth_artefacts FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- NO UPDATE or DELETE policies — immutable


-- 4) Storage bucket for deal artefacts
INSERT INTO storage.buckets (id, name, public)
VALUES ('deal-artefacts', 'deal-artefacts', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Authenticated users can upload deal artefacts"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'deal-artefacts' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view deal artefacts"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'deal-artefacts' AND auth.uid() IS NOT NULL);


-- 5) Enable realtime for deal events (live timeline)
ALTER PUBLICATION supabase_realtime ADD TABLE public.deal_truth_events;
