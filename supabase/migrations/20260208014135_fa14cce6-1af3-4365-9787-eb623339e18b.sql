
ALTER TABLE upload_batches
DROP CONSTRAINT upload_batches_upload_type_check;

ALTER TABLE upload_batches
ADD CONSTRAINT upload_batches_upload_type_check
CHECK (
  upload_type IN (
    'sales',
    'sales_csv',
    'sales_pdf',
    'sales_universal',
    'sales_log',
    'sales_ai',
    'inventory',
    'manual_candidates',
    'other'
  )
);
