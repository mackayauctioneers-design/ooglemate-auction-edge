-- Normalized listing details table
-- Stores structured, extracted data from raw listings

CREATE TABLE IF NOT EXISTS listing_details_norm (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  account_id uuid NOT NULL,
  raw_id uuid NOT NULL REFERENCES listing_details_raw(id) ON DELETE CASCADE,
  
  url_canonical text NOT NULL,
  domain text NOT NULL,
  dealer_slug text NOT NULL,
  
  -- Core extracted fields
  make text NULL,
  model text NULL,
  variant text NULL,
  year int NULL,
  km int NULL,
  price int NULL,
  
  -- Additional structured data
  transmission text NULL,
  fuel_type text NULL,
  body_type text NULL,
  colour text NULL,
  rego text NULL,
  stock_number text NULL,
  
  -- Extraction metadata
  extraction_confidence text NOT NULL DEFAULT 'low'
    CHECK (extraction_confidence IN ('low', 'medium', 'high')),
  extracted_fields jsonb NULL,
  extraction_errors jsonb NULL,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE (raw_id)
);

-- Index for downstream queries
CREATE INDEX idx_listing_details_norm_domain ON listing_details_norm(domain);
CREATE INDEX idx_listing_details_norm_make_model ON listing_details_norm(make, model);

-- RLS
ALTER TABLE listing_details_norm ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read normalized listings"
ON listing_details_norm FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Service role can insert normalized listings"
ON listing_details_norm FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Service role can update normalized listings"
ON listing_details_norm FOR UPDATE TO authenticated
USING (true);