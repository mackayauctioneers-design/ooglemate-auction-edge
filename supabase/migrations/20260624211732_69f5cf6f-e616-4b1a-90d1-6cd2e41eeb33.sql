
DROP INDEX IF EXISTS public.uq_raw_ingest_source_record;
ALTER TABLE public.raw_ingest_events
  ADD CONSTRAINT uq_raw_ingest_source_record UNIQUE (source, source_record_id);
