-- Add status constraint to allow new PDF statuses
-- First check if there's a constraint and update it
ALTER TABLE public.va_upload_batches DROP CONSTRAINT IF EXISTS va_upload_batches_status_check;

ALTER TABLE public.va_upload_batches 
ADD CONSTRAINT va_upload_batches_status_check 
CHECK (status IN ('pending', 'parsing', 'parsed', 'ingesting', 'completed', 'failed', 'received_pdf', 'pending_manual_extract'));