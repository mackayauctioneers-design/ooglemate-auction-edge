-- UNDO for carbitrage-wholesale-0001-franchise-columns.sql. Needs Macka's OK to run.
-- Run 0002's undo first. Refuses to run while any franchise request exists (it would lose who it was sent to).

BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.wholesale_tenders WHERE franchise_car OR target_buyer_ids IS NOT NULL) THEN
    RAISE EXCEPTION 'franchise or targeted requests exist; remove or keep them before undoing';
  END IF;
END $$;

-- Back to the live function as read on 20 Nov 2026 (floor skip, no switch, no targeting).
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
  SELECT * INTO c FROM public.wholesale_yard_commitment_v1(NEW.dealership_id);
  IF c.requests - 1 >= 3 AND c.sold_to_buyer::numeric / (c.requests - 1) >= 0.6 THEN prio := true; END IF;
  INSERT INTO public.wholesale_buyer_alerts (buyer_id, tender_id, phase, estimated_profit_cents, price_cents, retail_floor_cents, priority)
  SELECT b.id, NEW.id, 'tender', 0, 0, coalesce(NEW.value_car_floor_cents, NEW.retail_floor_cents, 0), prio
    FROM public.wholesale_buyers b
   WHERE b.approved AND b.active AND b.status = 'approved' AND NOT b.is_placeholder
  ON CONFLICT (buyer_id, tender_id) WHERE phase = 'tender' DO NOTHING;
  RETURN NEW;
END $function$;

DROP TABLE IF EXISTS public.carbitrage_switches;
ALTER TABLE public.wholesale_tenders DROP COLUMN IF EXISTS target_buyer_ids;
ALTER TABLE public.wholesale_tenders DROP COLUMN IF EXISTS franchise_car;

COMMIT;
