
CREATE TABLE IF NOT EXISTS public.wholesale_manager_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  listing_norm_id uuid,
  dealer_id text NOT NULL,
  account_id uuid REFERENCES public.accounts(id),
  tier integer NOT NULL CHECK (tier IN (1, 2, 3, 4)),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected', 'escalated', 'bid_placed', 'won', 'lost', 'expired')),
  max_bid integer,
  est_gp integer,
  est_hold_days integer,
  confidence_score integer CHECK (confidence_score BETWEEN 0 AND 100),
  historical_proof jsonb DEFAULT '{}',
  pattern_flags text[] DEFAULT '{}',
  make text,
  model text,
  variant text,
  year integer,
  km integer,
  asking_price integer,
  listing_url text,
  source_searched text,
  assigned_manager text DEFAULT 'hermes',
  reviewed_at timestamptz,
  decision_reason text,
  auction_close_at timestamptz,
  bid_placed_at timestamptz,
  bid_amount integer,
  bid_result text CHECK (bid_result IN ('pending', 'won', 'lost', 'withdrawn')),
  telegram_sent boolean,
  telegram_message_id text,
  telegram_error text,
  dedup_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wholesale_manager_queue TO authenticated;
GRANT ALL ON public.wholesale_manager_queue TO service_role;

CREATE INDEX IF NOT EXISTS idx_wmq_status ON public.wholesale_manager_queue(status);
CREATE INDEX IF NOT EXISTS idx_wmq_dealer ON public.wholesale_manager_queue(dealer_id);
CREATE INDEX IF NOT EXISTS idx_wmq_tier ON public.wholesale_manager_queue(tier);
CREATE INDEX IF NOT EXISTS idx_wmq_created ON public.wholesale_manager_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wmq_account ON public.wholesale_manager_queue(account_id);

ALTER TABLE public.wholesale_manager_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dealers can view their own queue"
  ON public.wholesale_manager_queue FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.dealer_profiles dp
      WHERE dp.account_id = wholesale_manager_queue.account_id
      AND dp.user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

CREATE POLICY "Service role can manage queue"
  ON public.wholesale_manager_queue FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.trg_wmq_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wmq_updated_at ON public.wholesale_manager_queue;
CREATE TRIGGER trg_wmq_updated_at
  BEFORE UPDATE ON public.wholesale_manager_queue
  FOR EACH ROW EXECUTE FUNCTION public.trg_wmq_updated_at();

CREATE OR REPLACE VIEW public.v_wholesale_manager_dashboard AS
SELECT
  wmq.id,
  wmq.dealer_id,
  wmq.account_id,
  a.display_name as dealer_name,
  wmq.tier,
  wmq.status,
  wmq.make,
  wmq.model,
  wmq.year,
  wmq.km,
  wmq.asking_price,
  wmq.max_bid,
  wmq.est_gp,
  wmq.est_hold_days,
  wmq.confidence_score,
  wmq.historical_proof,
  wmq.pattern_flags,
  wmq.listing_url,
  wmq.source_searched,
  wmq.assigned_manager,
  wmq.reviewed_at,
  wmq.decision_reason,
  wmq.created_at,
  wmq.updated_at,
  CASE
    WHEN wmq.tier = 1 THEN 'PROVEN'
    WHEN wmq.tier = 2 THEN 'STRONG'
    WHEN wmq.tier = 3 THEN 'EXTENSION'
    WHEN wmq.tier = 4 THEN 'SPECULATIVE'
  END as tier_label,
  CASE
    WHEN wmq.status = 'pending' THEN 'PENDING REVIEW'
    WHEN wmq.status = 'reviewing' THEN 'UNDER REVIEW'
    WHEN wmq.status = 'approved' THEN 'APPROVED - READY TO BID'
    WHEN wmq.status = 'rejected' THEN 'REJECTED'
    WHEN wmq.status = 'escalated' THEN 'ESCALATED TO DEALER'
    WHEN wmq.status = 'bid_placed' THEN 'BID PLACED'
    WHEN wmq.status = 'won' THEN 'WON - ADD TO OPEN POSITIONS'
    WHEN wmq.status = 'lost' THEN 'LOST'
    WHEN wmq.status = 'expired' THEN 'EXPIRED'
  END as status_label,
  CASE
    WHEN wmq.auction_close_at IS NOT NULL
         AND wmq.auction_close_at < now() + interval '2 hours'
         AND wmq.status IN ('pending', 'reviewing')
    THEN 'URGENT'
    WHEN wmq.auction_close_at IS NOT NULL
         AND wmq.auction_close_at < now() + interval '6 hours'
         AND wmq.status IN ('pending', 'reviewing')
    THEN 'SOON'
    ELSE 'NORMAL'
  END as urgency
FROM public.wholesale_manager_queue wmq
LEFT JOIN public.accounts a ON a.id = wmq.account_id;

GRANT SELECT ON public.v_wholesale_manager_dashboard TO authenticated;
GRANT SELECT ON public.v_wholesale_manager_dashboard TO service_role;
