-- NOT APPLIED. Needs Macka's OK, then Lovable applies it to the Ooglecars database.
-- Franchise wholesale, step 1 of 2: two small columns, one switch table, and the alert trigger made aware of both.
-- Backwards compatible: existing rows get target_buyer_ids NULL (= every approved buyer, exactly as today) and
-- franchise_car false (= alerts behave exactly as today). Undo: carbitrage-wholesale-0001-franchise-columns.undo.sql
-- Nothing in this file sends anything. The buyer alert switch is created OFF.

BEGIN;

-- Picked buyers: a proper column. NULL means every approved buyer.
ALTER TABLE public.wholesale_tenders ADD COLUMN IF NOT EXISTS target_buyer_ids uuid[];
-- Shown to buyers as "Franchise dealer, <state>". No dealer identity is ever stored here.
ALTER TABLE public.wholesale_tenders ADD COLUMN IF NOT EXISTS franchise_car boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.wholesale_tenders.target_buyer_ids IS 'Buyers this request was sent to. NULL = all approved buyers.';
COMMENT ON COLUMN public.wholesale_tenders.franchise_car IS 'Sent by a franchise dealer through Carbitrage. Buyer alerts for these are gated by carbitrage_switches.franchise_buyer_alerts.';

-- One place for go-live switches. Service role / security-definer functions only.
CREATE TABLE IF NOT EXISTS public.carbitrage_switches (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.carbitrage_switches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.carbitrage_switches FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.carbitrage_switches TO service_role;

INSERT INTO public.carbitrage_switches (key, enabled, note)
VALUES ('franchise_buyer_alerts', false, 'OFF. While off, a franchise request queues no buyer alerts at all. Macka turns it on: UPDATE public.carbitrage_switches SET enabled = true, updated_at = now() WHERE key = ''franchise_buyer_alerts'';')
ON CONFLICT (key) DO NOTHING;

-- Same function as live today (floor skip included), plus two things:
--  1. a franchise request queues no alerts while the switch is off
--  2. when the request names buyers, only those buyers are queued
CREATE OR REPLACE FUNCTION public.wholesale_alert_buyers_on_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record; prio boolean := false;
BEGIN
  IF NEW.status <> 'live' THEN RETURN NEW; END IF;
  IF coalesce(NEW.value_car_floor_cents, 0) <= 0 THEN RETURN NEW; END IF;
  IF NEW.franchise_car AND NOT coalesce((SELECT s.enabled FROM public.carbitrage_switches s WHERE s.key = 'franchise_buyer_alerts'), false) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO c FROM public.wholesale_yard_commitment_v1(NEW.dealership_id);
  IF c.requests - 1 >= 3 AND c.sold_to_buyer::numeric / (c.requests - 1) >= 0.6 THEN prio := true; END IF;
  INSERT INTO public.wholesale_buyer_alerts (buyer_id, tender_id, phase, estimated_profit_cents, price_cents, retail_floor_cents, priority)
  SELECT b.id, NEW.id, 'tender', 0, 0, coalesce(NEW.value_car_floor_cents, NEW.retail_floor_cents, 0), prio
    FROM public.wholesale_buyers b
   WHERE b.approved AND b.active AND b.status = 'approved' AND NOT b.is_placeholder
     AND (NEW.target_buyer_ids IS NULL OR b.id = ANY(NEW.target_buyer_ids))
  ON CONFLICT (buyer_id, tender_id) WHERE phase = 'tender' DO NOTHING;
  RETURN NEW;
END $function$;

COMMIT;
