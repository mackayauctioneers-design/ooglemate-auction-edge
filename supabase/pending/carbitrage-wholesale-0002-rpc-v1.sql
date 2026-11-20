-- NOT APPLIED. Needs Macka's OK, then Lovable applies it to the Ooglecars database. Run 0001 first.
-- Franchise wholesale, step 2 of 2: the functions the Carbitrage app calls. Same pattern as the existing _v1 functions
-- (wholesale_buyer_upsert_v1, deliver_bot_staff_message_to_v1): SECURITY DEFINER, service_role only, the signed-in
-- user's id passed in after the app has verified their Supabase sign-in. No new tables, no new auth, no RLS change.
-- Dealers are dealership_members of a dealership with wholesale_pricing on. Buyers are approved wholesale_buyers rows
-- (wholesale_buyers.user_id). Nothing here emails or messages anyone. Buyer alerts only queue when
-- carbitrage_switches.franchise_buyer_alerts is on, and then go through the existing queue and per-buyer yard bots.
-- Undo: carbitrage-wholesale-0002-rpc-v1.undo.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_dealership_v1(_user uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT m.dealership_id
    FROM public.dealership_members m
    JOIN public.dealership_features f
      ON f.dealership_id = m.dealership_id AND f.feature_key = 'wholesale_pricing' AND f.enabled
   WHERE m.user_id = _user
   ORDER BY m.joined_at
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_buyer_id_v1(_user uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT b.id FROM public.wholesale_buyers b
   WHERE b.user_id = _user AND b.approved AND b.active AND b.status = 'approved' AND NOT b.is_placeholder
   ORDER BY b.created_at
   LIMIT 1
$$;

-- Who is this signed-in user? Dealer and/or buyer. Names only.
CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_whoami_v1(_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'dealer', (SELECT jsonb_build_object('id', d.id, 'name', d.name) FROM public.dealerships d WHERE d.id = public.carbitrage_wholesale_dealership_v1(_user)),
    'buyer',  (SELECT jsonb_build_object('id', b.id, 'name', b.contact_name) FROM public.wholesale_buyers b WHERE b.id = public.carbitrage_wholesale_buyer_id_v1(_user))
  )
$$;

-- Approved buyers a dealer can send to (names only, no contact details).
CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_buyers_v1(_user uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF public.carbitrage_wholesale_dealership_v1(_user) IS NULL THEN RAISE EXCEPTION 'not_a_wholesale_dealer'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.contact_name) ORDER BY b.created_at, b.contact_name)
                     FROM public.wholesale_buyers b
                    WHERE b.approved AND b.active AND b.status = 'approved' AND NOT b.is_placeholder), '[]'::jsonb);
END $$;

-- Dealer-side view of one request. _detail adds the guide and the contact blocks used on the handover screen.
CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_request_json_v1(_t public.wholesale_tenders, _detail boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sent jsonb; prices jsonb; waiting jsonb; acc record; d record;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.contact_name) ORDER BY b.created_at, b.contact_name), '[]'::jsonb) INTO sent
    FROM public.wholesale_buyers b
   WHERE b.approved AND b.active AND b.status = 'approved' AND NOT b.is_placeholder
     AND (_t.target_buyer_ids IS NULL OR b.id = ANY(_t.target_buyer_ids));
  SELECT coalesce(jsonb_agg(jsonb_build_object('bidId', x.id, 'buyerId', x.buyer_id, 'name', w.contact_name, 'amountCents', x.amount_cents, 'note', x.note, 'at', x.updated_at) ORDER BY x.amount_cents DESC), '[]'::jsonb)
    INTO prices
    FROM public.wholesale_bids x JOIN public.wholesale_buyers w ON w.id = x.buyer_id
   WHERE x.tender_id = _t.id AND x.bidder_kind = 'wholesale_buyer';
  SELECT coalesce(jsonb_agg(s ORDER BY ord), '[]'::jsonb) INTO waiting
    FROM (SELECT s, ord FROM jsonb_array_elements(sent) WITH ORDINALITY AS t(s, ord)
           WHERE NOT EXISTS (SELECT 1 FROM public.wholesale_bids y WHERE y.tender_id = _t.id AND y.buyer_id = (s->>'id')::uuid)) q;
  RETURN jsonb_build_object(
    'code', _t.public_code, 'status', _t.status, 'outcome', _t.outcome,
    'car', jsonb_build_object('rego', _t.rego, 'year', _t.year, 'make', _t.make, 'model', _t.model, 'badge', _t.badge, 'km', _t.km, 'state', _t.state),
    'floorCents', _t.value_car_floor_cents, 'note', _t.seller_notes,
    'sentTo', sent, 'prices', prices, 'waiting', waiting,
    'acceptedBidId', _t.accepted_bid_id, 'buyerOfRecord', _t.buyer_of_record, 'finalSaleCents', _t.final_sale_cents,
    'createdAt', _t.created_at, 'updatedAt', _t.updated_at, 'franchise', _t.franchise_car
  ) || CASE WHEN _detail THEN (
    SELECT jsonb_build_object(
      'guide', _t.value_car_snapshot,
      'buyer', (SELECT jsonb_build_object('business', w.business_name, 'person', w.contact_name, 'phone', w.contact_phone, 'email', w.contact_email)
                  FROM public.wholesale_bids a JOIN public.wholesale_buyers w ON w.id = a.buyer_id WHERE a.id = _t.accepted_bid_id),
      'dealer', (SELECT jsonb_build_object('business', dl.name, 'person', NULL, 'phone', dl.phone, 'email', dl.email, 'address', dl.address)
                   FROM public.dealerships dl WHERE dl.id = _t.dealership_id))
  ) ELSE '{}'::jsonb END;
END $$;

-- Queue the existing buyer alert path for one request. Only ever called when the switch is on.
CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_queue_alerts_v1(_dealership uuid, _tender uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE h text := encode(sha256(convert_to('wholesale-alerts-due:' || _dealership::text || ':tender:' || _tender::text, 'UTF8')), 'hex'); due uuid;
BEGIN
  -- Same id the Ooglecars app computes (alertDueId in src/lib/wholesale/alert-queue.ts), so a retry can never double-queue.
  due := (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-a' || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid;
  INSERT INTO public.wholesale_notification_log (id, channel, kind, body, tender_id, dealership_id)
  VALUES (due, 'log', 'buyer_alerts_due', 'pending', _tender, _dealership)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- Send a car. The guide (floor etc.) comes from the Carbitrage engine through the app. No floor, no request.
CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_send_v1(_user uuid, _car jsonb, _note text, _buyer_ids uuid[], _guide jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE dl uuid := public.carbitrage_wholesale_dealership_v1(_user); floor_dollars numeric; approved uuid[]; targets uuid[]; code text; t public.wholesale_tenders; tries int := 0; alerts_on boolean;
        alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  IF dl IS NULL THEN RAISE EXCEPTION 'not_a_wholesale_dealer'; END IF;
  floor_dollars := nullif(_guide->>'floor_dollars', '')::numeric;
  IF floor_dollars IS NULL OR floor_dollars <= 0 THEN RAISE EXCEPTION 'floor_required'; END IF;
  SELECT coalesce(array_agg(b.id), '{}') INTO approved FROM public.wholesale_buyers b
   WHERE b.approved AND b.active AND b.status = 'approved' AND NOT b.is_placeholder;
  IF _buyer_ids IS NULL THEN targets := approved;
  ELSE SELECT coalesce(array_agg(x), '{}') INTO targets FROM unnest(_buyer_ids) x WHERE x = ANY(approved);
  END IF;
  IF coalesce(array_length(targets, 1), 0) = 0 THEN RAISE EXCEPTION 'no_buyers'; END IF;
  LOOP
    code := 'WT-' || (SELECT string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '') FROM generate_series(1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.wholesale_tenders WHERE public_code = code);
    tries := tries + 1; IF tries > 20 THEN RAISE EXCEPTION 'code_collision'; END IF;
  END LOOP;
  INSERT INTO public.wholesale_tenders
    (dealership_id, public_code, status, rego, year, make, model, badge, km, colour, state, seller_notes, opens_at,
     retail_floor_cents, value_car_floor_cents, value_car_snapshot, created_by, franchise_car, target_buyer_ids)
  VALUES
    (dl, code, 'live', nullif(_car->>'rego', ''), (_car->>'year')::int, _car->>'make', _car->>'model', _car->>'badge', (_car->>'km')::int,
     nullif(_car->>'colour', ''), _car->>'state', nullif(btrim(coalesce(_note, '')), ''), now(),
     (floor_dollars * 100)::int, (floor_dollars * 100)::int, _guide, _user, true,
     CASE WHEN cardinality(targets) = cardinality(approved) THEN NULL ELSE targets END)
  RETURNING * INTO t;
  SELECT coalesce(s.enabled, false) INTO alerts_on FROM (SELECT enabled FROM public.carbitrage_switches WHERE key = 'franchise_buyer_alerts') s;
  IF coalesce(alerts_on, false) THEN PERFORM public.carbitrage_wholesale_queue_alerts_v1(dl, t.id); END IF;
  RETURN jsonb_build_object('code', t.public_code, 'sentTo', cardinality(targets), 'alertsQueued', coalesce(alerts_on, false));
END $$;

CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_requests_v1(_user uuid, _code text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE dl uuid := public.carbitrage_wholesale_dealership_v1(_user);
BEGIN
  IF dl IS NULL THEN RAISE EXCEPTION 'not_a_wholesale_dealer'; END IF;
  IF _code IS NOT NULL THEN
    RETURN (SELECT public.carbitrage_wholesale_request_json_v1(t, true) FROM public.wholesale_tenders t WHERE t.dealership_id = dl AND t.public_code = _code AND t.franchise_car);
  END IF;
  RETURN coalesce((SELECT jsonb_agg(public.carbitrage_wholesale_request_json_v1(t, false) ORDER BY t.created_at DESC)
                     FROM public.wholesale_tenders t WHERE t.dealership_id = dl AND t.franchise_car), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_pick_v1(_user uuid, _code text, _bid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE dl uuid := public.carbitrage_wholesale_dealership_v1(_user); t public.wholesale_tenders; chosen record; best int;
BEGIN
  IF dl IS NULL THEN RAISE EXCEPTION 'not_a_wholesale_dealer'; END IF;
  SELECT * INTO t FROM public.wholesale_tenders WHERE dealership_id = dl AND public_code = _code AND franchise_car FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF t.status <> 'live' THEN RAISE EXCEPTION 'not_open'; END IF;
  -- One price per buyer per car (wholesale_bids_one_buyer), so the bid id is the buyer's current price.
  SELECT x.id, x.amount_cents, w.business_name INTO chosen
    FROM public.wholesale_bids x JOIN public.wholesale_buyers w ON w.id = x.buyer_id
   WHERE x.id = _bid AND x.tender_id = t.id AND x.bidder_kind = 'wholesale_buyer';
  IF NOT FOUND THEN RAISE EXCEPTION 'bid_not_found'; END IF;
  SELECT max(z.amount_cents) INTO best FROM public.wholesale_bids z WHERE z.tender_id = t.id AND z.bidder_kind = 'wholesale_buyer';
  UPDATE public.wholesale_tenders SET status = 'accepted', accepted_bid_id = chosen.id, buyer_of_record = chosen.business_name,
         best_bid_cents = best, final_sale_cents = chosen.amount_cents, updated_at = now() WHERE id = t.id;
  RETURN jsonb_build_object('ok', true, 'code', t.public_code);
END $$;

CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_keep_v1(_user uuid, _code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE dl uuid := public.carbitrage_wholesale_dealership_v1(_user); n int;
BEGIN
  IF dl IS NULL THEN RAISE EXCEPTION 'not_a_wholesale_dealer'; END IF;
  UPDATE public.wholesale_tenders SET status = 'declined', updated_at = now()
   WHERE dealership_id = dl AND public_code = _code AND franchise_car AND status = 'live';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'not_open'; END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_collected_v1(_user uuid, _code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE dl uuid := public.carbitrage_wholesale_dealership_v1(_user); n int;
BEGIN
  IF dl IS NULL THEN RAISE EXCEPTION 'not_a_wholesale_dealer'; END IF;
  UPDATE public.wholesale_tenders SET outcome = 'completed', sold_at = now(), sold_cents = final_sale_cents, sold_channel = 'wholesale', updated_at = now()
   WHERE dealership_id = dl AND public_code = _code AND franchise_car AND status = 'accepted';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'not_picked'; END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Buyer side. Returns what a buyer may see: the car, "Franchise dealer, <state>", the dealer's note and the guide.
-- Never the dealership, rego, VIN, contact or user.
CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_buyer_cars_v1(_user uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid := public.carbitrage_wholesale_buyer_id_v1(_user); who record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_an_approved_buyer'; END IF;
  SELECT b.id, b.contact_name INTO who FROM public.wholesale_buyers b WHERE b.id = me;
  RETURN jsonb_build_object('buyer', jsonb_build_object('id', who.id, 'name', who.contact_name), 'cars', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'code', t.public_code, 'year', t.year, 'make', t.make, 'model', t.model, 'badge', t.badge, 'km', t.km, 'state', t.state,
      'sellerLabel', CASE WHEN t.franchise_car THEN 'Franchise dealer' ELSE 'Used car yard' END || ', ' || coalesce(t.state, ''),
      'franchise', t.franchise_car, 'note', t.seller_notes,
      'guide', CASE WHEN t.value_car_snapshot IS NULL THEN NULL ELSE (t.value_car_snapshot || '{"outlier_ads": []}'::jsonb) END,
      'myPriceCents', (SELECT x.amount_cents FROM public.wholesale_bids x WHERE x.tender_id = t.id AND x.buyer_id = me),
      'locked', t.status <> 'live') ORDER BY t.created_at DESC)
      FROM public.wholesale_tenders t
     WHERE t.franchise_car
       AND (t.target_buyer_ids IS NULL OR me = ANY(t.target_buyer_ids))
       AND (t.status = 'live' OR EXISTS (SELECT 1 FROM public.wholesale_bids x WHERE x.tender_id = t.id AND x.buyer_id = me))
       AND t.status IN ('live', 'accepted', 'declined')), '[]'::jsonb));
END $$;

-- A buyer's price. One row per buyer per car, as today; changes are UPDATEs and the existing trigger keeps every change in
-- wholesale_bid_events, so the buyer sees the whole trail. The existing price-lock trigger refuses it once the dealer has picked.
CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_buyer_price_v1(_user uuid, _code text, _amount_dollars numeric, _note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid := public.carbitrage_wholesale_buyer_id_v1(_user); t public.wholesale_tenders;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_an_approved_buyer'; END IF;
  SELECT * INTO t FROM public.wholesale_tenders WHERE public_code = _code AND franchise_car FOR UPDATE;
  IF NOT FOUND OR (t.target_buyer_ids IS NOT NULL AND NOT me = ANY(t.target_buyer_ids)) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF t.status <> 'live' THEN RAISE EXCEPTION 'locked'; END IF;
  IF _amount_dollars IS NULL OR _amount_dollars < 1 OR _amount_dollars > 20000000 THEN RAISE EXCEPTION 'bad_amount'; END IF;
  INSERT INTO public.wholesale_bids (tender_id, bidder_kind, buyer_id, amount_cents, kind, note)
  VALUES (t.id, 'wholesale_buyer', me, round(_amount_dollars * 100)::int, 'offer', nullif(left(btrim(coalesce(_note, '')), 300), ''))
  ON CONFLICT (tender_id, buyer_id) WHERE buyer_id IS NOT NULL
  DO UPDATE SET amount_cents = EXCLUDED.amount_cents, note = EXCLUDED.note, updated_at = now();
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_buyer_history_v1(_user uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE me uuid := public.carbitrage_wholesale_buyer_id_v1(_user);
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not_an_approved_buyer'; END IF;
  RETURN jsonb_build_object('rows', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'ref', t.public_code, 'year', t.year, 'make', t.make, 'model', t.model, 'badge', t.badge, 'km', t.km, 'state', t.state,
      'sellerLabel', CASE WHEN t.franchise_car THEN 'Franchise dealer' ELSE 'Used car yard' END || ', ' || coalesce(t.state, ''),
      'franchise', t.franchise_car,
      'events', (SELECT jsonb_agg(jsonb_build_object('amount', x.amount_cents / 100.0, 'at', x.created_at, 'note', x.note) ORDER BY x.created_at, x.id)
                   FROM public.wholesale_bid_events x WHERE x.tender_id = t.id AND x.buyer_id = me),
      'outcome', CASE WHEN t.status = 'declined' THEN 'dealer_kept'
                      WHEN t.status = 'accepted' THEN CASE WHEN EXISTS (SELECT 1 FROM public.wholesale_bids w WHERE w.id = t.accepted_bid_id AND w.buyer_id = me) THEN 'picked' ELSE 'not_picked' END
                      ELSE 'open' END,
      'outcomeAt', CASE WHEN t.status IN ('accepted', 'declined') THEN t.updated_at ELSE NULL END) ORDER BY t.created_at DESC)
      FROM public.wholesale_tenders t
     WHERE t.franchise_car AND EXISTS (SELECT 1 FROM public.wholesale_bids x WHERE x.tender_id = t.id AND x.buyer_id = me)), '[]'::jsonb));
END $$;

-- Lock the door: service role only, like the other _v1 functions.
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'carbitrage_wholesale_%_v1' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

COMMIT;
