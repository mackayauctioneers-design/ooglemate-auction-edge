-- Outward Hunt Tables for Kiting Mode Web Discovery

-- Table: outward_hunt_runs (audit trail for outward scans)
CREATE TABLE IF NOT EXISTS public.outward_hunt_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_id uuid NOT NULL REFERENCES public.sale_hunts(id) ON DELETE CASCADE,
  dealer_id uuid NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error', 'partial')),
  provider text NOT NULL DEFAULT 'firecrawl',
  queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  results_found int DEFAULT 0,
  candidates_created int DEFAULT 0,
  error text NULL
);

CREATE INDEX idx_outward_hunt_runs_hunt_id ON public.outward_hunt_runs(hunt_id, started_at DESC);

-- Table: outward_candidates (discovered URLs from web search)
CREATE TABLE IF NOT EXISTS public.outward_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_id uuid NOT NULL REFERENCES public.sale_hunts(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'outward_web',
  provider text NOT NULL DEFAULT 'firecrawl',
  url text NOT NULL,
  domain text NULL,
  title text NULL,
  snippet text NULL,
  published_at timestamptz NULL,
  extracted jsonb NULL,
  classification jsonb NULL,
  match_score numeric(5,2) NULL,
  decision text NULL CHECK (decision IN ('BUY', 'WATCH', 'IGNORE')),
  reasons text[] DEFAULT '{}',
  alert_emitted boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hunt_id, url)
);

CREATE INDEX idx_outward_candidates_hunt_decision ON public.outward_candidates(hunt_id, decision);

-- Table: outward_candidate_links (link outward discovery to internal listing if found)
CREATE TABLE IF NOT EXISTS public.outward_candidate_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.outward_candidates(id) ON DELETE CASCADE,
  retail_listing_id uuid NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(candidate_id, retail_listing_id)
);

-- Add last_outward_scan_at and outward_interval_minutes to sale_hunts
ALTER TABLE public.sale_hunts 
  ADD COLUMN IF NOT EXISTS last_outward_scan_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS outward_interval_minutes int DEFAULT 360;

-- Enable RLS
ALTER TABLE public.outward_hunt_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outward_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outward_candidate_links ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Service role for edge functions, authenticated for read
CREATE POLICY "Service role full access on outward_hunt_runs" 
  ON public.outward_hunt_runs FOR ALL 
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on outward_candidates" 
  ON public.outward_candidates FOR ALL 
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on outward_candidate_links" 
  ON public.outward_candidate_links FOR ALL 
  USING (true) WITH CHECK (true);

-- RPC: Build high-quality outward search queries from hunt fingerprint
CREATE OR REPLACE FUNCTION public.rpc_build_outward_queries(p_hunt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hunt record;
  v_queries jsonb := '[]'::jsonb;
  v_base_query text;
  v_year_str text;
  v_model_str text;
  v_full_query text;
BEGIN
  -- Get hunt details
  SELECT * INTO v_hunt FROM sale_hunts WHERE id = p_hunt_id;
  
  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;
  
  -- Build year string
  v_year_str := COALESCE(v_hunt.year::text, '');
  
  -- Build model string (include series/variant codes if available)
  v_model_str := COALESCE(v_hunt.make, '') || ' ' || COALESCE(v_hunt.model, '');
  
  IF v_hunt.variant_family IS NOT NULL AND v_hunt.variant_family != '' THEN
    v_model_str := v_model_str || ' ' || v_hunt.variant_family;
  END IF;
  
  IF v_hunt.series_family IS NOT NULL AND v_hunt.series_family != '' THEN
    v_model_str := v_model_str || ' ' || v_hunt.series_family;
  END IF;
  
  IF v_hunt.engine_code IS NOT NULL AND v_hunt.engine_code != '' AND v_hunt.engine_code != 'UNKNOWN' THEN
    v_model_str := v_model_str || ' ' || v_hunt.engine_code;
  END IF;
  
  -- Build base query
  v_base_query := v_year_str || ' ' || trim(v_model_str);
  
  -- Add badge if present
  IF v_hunt.badge IS NOT NULL AND v_hunt.badge != '' THEN
    v_base_query := v_base_query || ' ' || v_hunt.badge;
  END IF;
  
  -- Query 1: Full base query with "for sale"
  v_full_query := trim(v_base_query) || ' for sale Australia';
  v_queries := v_queries || to_jsonb(v_full_query);
  
  -- Query 2: Add must-have tokens if present
  IF v_hunt.must_have_tokens IS NOT NULL AND array_length(v_hunt.must_have_tokens, 1) > 0 THEN
    v_full_query := trim(v_base_query) || ' ' || array_to_string(v_hunt.must_have_tokens, ' ');
    v_queries := v_queries || to_jsonb(v_full_query);
  END IF;
  
  -- Query 3: Site-specific for Pickles
  v_full_query := 'site:pickles.com.au ' || COALESCE(v_hunt.make, '') || ' ' || COALESCE(v_hunt.model, '');
  IF v_hunt.series_family IS NOT NULL THEN
    v_full_query := v_full_query || ' ' || v_hunt.series_family;
  END IF;
  v_queries := v_queries || to_jsonb(v_full_query);
  
  -- Query 4: Site-specific for Manheim
  v_full_query := 'site:manheim.com.au ' || COALESCE(v_hunt.make, '') || ' ' || COALESCE(v_hunt.model, '');
  v_queries := v_queries || to_jsonb(v_full_query);
  
  -- Query 5: Site-specific for Grays
  v_full_query := 'site:grays.com ' || COALESCE(v_hunt.make, '') || ' ' || COALESCE(v_hunt.model, '');
  v_queries := v_queries || to_jsonb(v_full_query);
  
  -- Query 6: Site-specific for Lloyds
  v_full_query := 'site:lloydsauctions.com.au ' || COALESCE(v_hunt.make, '') || ' ' || COALESCE(v_hunt.model, '');
  v_queries := v_queries || to_jsonb(v_full_query);
  
  -- Query 7: Carsguide
  v_full_query := 'site:carsguide.com.au ' || trim(v_base_query);
  v_queries := v_queries || to_jsonb(v_full_query);
  
  -- Query 8: Generic dealer search
  v_full_query := trim(v_base_query) || ' dealer stock';
  v_queries := v_queries || to_jsonb(v_full_query);
  
  RETURN v_queries;
END;
$$;