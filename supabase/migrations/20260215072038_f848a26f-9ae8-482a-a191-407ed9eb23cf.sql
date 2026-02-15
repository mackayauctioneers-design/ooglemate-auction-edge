-- Update source_type check to include new types
ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_source_type_check;
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_source_type_check 
  CHECK (source_type = ANY (ARRAY['buy_now','auction','fingerprint','market_deviation','replication','retail_deviation']));