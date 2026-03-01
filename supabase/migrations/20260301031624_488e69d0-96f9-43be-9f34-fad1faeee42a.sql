
-- Allow 'critical' priority for mega-dealer sources
ALTER TABLE public.dealer_outbound_sources DROP CONSTRAINT dealer_outbound_sources_priority_check;
ALTER TABLE public.dealer_outbound_sources ADD CONSTRAINT dealer_outbound_sources_priority_check 
  CHECK (priority = ANY (ARRAY['critical'::text, 'high'::text, 'normal'::text, 'low'::text]));
