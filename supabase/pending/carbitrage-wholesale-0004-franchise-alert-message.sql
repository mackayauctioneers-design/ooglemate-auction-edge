-- NOT APPLIED. Needs Macka's OK first (20 Nov 2026).
-- Franchise wholesale, step 4: the wording of a buyer alert for a franchise car. One new read-only function. Nothing else.
--
-- Why: the existing buyer alert says where the car is and links to the Ooglecars buyer desk. A franchise car must (a) never name the
-- dealer, (b) say "franchise dealer" and the state, and (c) link to the Carbitrage buyer view, where only that buyer's own price
-- shows. The alert worker in the Ooglecars app calls this function for a request where franchise_car is true and sends the text
-- the same way it sends alerts today (each buyer's own yard bot, and the existing notification log row). Without this function the
-- worker would use the normal wording and link.
--
-- The function sends nothing, writes nothing, and returns NULL when the car is not a franchise car, the buyer is not approved, or
-- the buyer was not picked for that car. Service role only. It does not touch the franchise_buyer_alerts switch (still OFF).
-- Undo: carbitrage-wholesale-0004-franchise-alert-message.undo.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_alert_message_v1(_buyer uuid, _tender uuid, _base_url text DEFAULT 'https://carbitrage.com.au') RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'code', t.public_code,
    'link', rtrim(_base_url, '/') || '/portal/buyer-view?car=' || t.public_code,
    'text', 'New car to price from a franchise dealer' || coalesce(' (' || nullif(btrim(t.state), '') || ')', '') || ': '
            || t.year || ' ' || t.make || ' ' || t.model || ' ' || t.badge || ', ' || to_char(t.km, 'FM999,999,999') || ' km. Code ' || t.public_code
            || '. The Carbitrage guide is on your buyer desk. Price it here: ' || rtrim(_base_url, '/') || '/portal/buyer-view?car=' || t.public_code)
    FROM public.wholesale_tenders t
    JOIN public.wholesale_buyers b ON b.id = _buyer
   WHERE t.id = _tender
     AND t.franchise_car
     AND b.approved AND b.active AND b.status = 'approved' AND NOT b.is_placeholder
     AND (t.target_buyer_ids IS NULL OR b.id = ANY(t.target_buyer_ids))
$$;

REVOKE ALL ON FUNCTION public.carbitrage_wholesale_alert_message_v1(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carbitrage_wholesale_alert_message_v1(uuid, uuid, text) TO service_role;

COMMIT;
