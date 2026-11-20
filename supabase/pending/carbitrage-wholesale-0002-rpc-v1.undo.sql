-- UNDO for carbitrage-wholesale-0002-rpc-v1.sql. Needs Macka's OK to run. Drops only the functions this file created.
BEGIN;
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_buyer_history_v1(uuid);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_buyer_price_v1(uuid, text, numeric, text);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_buyer_cars_v1(uuid);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_collected_v1(uuid, text);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_keep_v1(uuid, text);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_pick_v1(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_requests_v1(uuid, text);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_send_v1(uuid, jsonb, text, uuid[], jsonb);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_queue_alerts_v1(uuid, uuid);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_request_json_v1(public.wholesale_tenders, boolean);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_buyers_v1(uuid);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_whoami_v1(uuid);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_buyer_id_v1(uuid);
DROP FUNCTION IF EXISTS public.carbitrage_wholesale_dealership_v1(uuid);
COMMIT;
