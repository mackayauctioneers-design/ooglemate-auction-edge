-- Fix security definer views by recreating with SECURITY INVOKER
DROP VIEW IF EXISTS public.hunt_external_candidates_v;
DROP VIEW IF EXISTS public.retail_listings_active_v;

CREATE VIEW public.hunt_external_candidates_v 
WITH (security_invoker = true)
AS
SELECT
  id,
  hunt_id,
  criteria_version,
  is_stale,
  source_url,
  source_name,
  title,
  raw_snippet,
  make,
  model,
  variant_raw,
  year,
  km,
  asking_price,
  location,
  COALESCE(is_listing, false) AS is_listing,
  COALESCE(verified, false) AS verified,
  page_type,
  listing_kind,
  decision,
  reject_reason,
  series_family AS ext_series_family,
  engine_family AS ext_engine_family,
  body_type AS ext_body_type,
  cab_type AS ext_cab_type,
  badge AS ext_badge,
  listing_intent AS ext_listing_intent,
  listing_intent_reason AS ext_listing_intent_reason,
  identity_key AS ext_identity_key,
  identity_confidence AS ext_identity_confidence,
  identity_evidence AS ext_identity_evidence
FROM public.hunt_external_candidates;

CREATE VIEW public.retail_listings_active_v 
WITH (security_invoker = true)
AS
SELECT
  id,
  source,
  source_listing_id,
  listing_url,
  title,
  description,
  make,
  model,
  variant_raw,
  year,
  km,
  asking_price,
  suburb,
  state,
  region_id,
  first_seen_at,
  series_family,
  engine_family,
  body_type,
  cab_type,
  badge,
  identity_key,
  identity_confidence,
  identity_evidence,
  listing_intent,
  listing_intent_reason,
  CASE WHEN lifecycle_status = 'active' AND delisted_at IS NULL THEN true ELSE false END AS is_active
FROM public.retail_listings;