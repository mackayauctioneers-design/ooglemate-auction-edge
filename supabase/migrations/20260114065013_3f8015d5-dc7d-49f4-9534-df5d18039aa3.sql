-- ============================================================================
-- DEALER SALES DATA → FINGERPRINTS SYSTEM
-- Part 1: Core Tables
-- ============================================================================

-- 1. dealer_sales: Primary storage for all dealer sales data (VA + self-upload)
CREATE TABLE IF NOT EXISTS public.dealer_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id TEXT NOT NULL,
  dealer_name TEXT,
  
  -- Core sale fields
  sold_date DATE NOT NULL,
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  variant_raw TEXT,
  km INTEGER,
  
  -- Pricing
  buy_price NUMERIC,
  sell_price NUMERIC,
  gross_profit NUMERIC GENERATED ALWAYS AS (sell_price - buy_price) STORED,
  
  -- Location
  state TEXT,
  region_id TEXT,
  
  -- Source tracking
  source_channel TEXT,
  data_source TEXT NOT NULL DEFAULT 'VA' CHECK (data_source IN ('VA', 'DEALER_UPLOAD')),
  
  -- Fingerprint linkage
  fingerprint TEXT,
  fingerprint_version INTEGER DEFAULT 2,
  fingerprint_confidence INTEGER,
  
  -- Metadata
  import_batch_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_sales_dealer ON public.dealer_sales(dealer_id);
CREATE INDEX IF NOT EXISTS idx_dealer_sales_fingerprint ON public.dealer_sales(fingerprint);
CREATE INDEX IF NOT EXISTS idx_dealer_sales_sold_date ON public.dealer_sales(sold_date DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_sales_make_model ON public.dealer_sales(make, model);

-- 2. sales_import_batches
CREATE TABLE IF NOT EXISTS public.sales_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id TEXT NOT NULL,
  dealer_name TEXT,
  source_type TEXT NOT NULL DEFAULT 'VA' CHECK (source_type IN ('VA', 'DEALER_UPLOAD')),
  file_name TEXT,
  row_count INTEGER,
  imported_count INTEGER,
  rejected_count INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  error_message TEXT,
  imported_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- 3. sales_import_mappings
CREATE TABLE IF NOT EXISTS public.sales_import_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id TEXT NOT NULL UNIQUE,
  dealer_name TEXT,
  column_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. va_sales_tasks
CREATE TABLE IF NOT EXISTS public.va_sales_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id TEXT NOT NULL,
  dealer_name TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'REQUEST_SALES_DATA' CHECK (task_type IN ('REQUEST_SALES_DATA', 'FOLLOW_UP', 'CLEAN_DATA', 'IMPORT')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'received', 'partial', 'complete', 'rejected', 'overdue')),
  priority INTEGER DEFAULT 50,
  last_data_received_at TIMESTAMPTZ,
  expected_frequency TEXT DEFAULT 'monthly' CHECK (expected_frequency IN ('weekly', 'monthly', 'quarterly')),
  next_due_at TIMESTAMPTZ,
  assigned_to TEXT,
  notes TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_va_sales_tasks_dealer ON public.va_sales_tasks(dealer_id);
CREATE INDEX IF NOT EXISTS idx_va_sales_tasks_status ON public.va_sales_tasks(status);
CREATE INDEX IF NOT EXISTS idx_va_sales_tasks_priority ON public.va_sales_tasks(priority DESC);

-- 5. Enhance fingerprint_profit_stats
ALTER TABLE public.fingerprint_profit_stats 
ADD COLUMN IF NOT EXISTS data_freshness_days INTEGER,
ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 50,
ADD COLUMN IF NOT EXISTS dominant_region TEXT,
ADD COLUMN IF NOT EXISTS last_sale_source TEXT;

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE public.dealer_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_import_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_sales_tasks ENABLE ROW LEVEL SECURITY;

-- dealer_sales: Admin/internal can read all
CREATE POLICY "Admin and internal can view dealer sales"
ON public.dealer_sales FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'internal')
  )
);

CREATE POLICY "Admin and internal can insert dealer sales"
ON public.dealer_sales FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'internal')
  )
);

CREATE POLICY "Admin and internal can update dealer sales"
ON public.dealer_sales FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'internal')
  )
);

-- sales_import_batches
CREATE POLICY "Admin and internal can view import batches"
ON public.sales_import_batches FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'internal')
  )
);

CREATE POLICY "Admin and internal can insert import batches"
ON public.sales_import_batches FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'internal')
  )
);

CREATE POLICY "Admin and internal can update import batches"
ON public.sales_import_batches FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'internal')
  )
);

-- sales_import_mappings
CREATE POLICY "Admin and internal can view import mappings"
ON public.sales_import_mappings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'internal')
  )
);

CREATE POLICY "Admin and internal can insert import mappings"
ON public.sales_import_mappings FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'internal')
  )
);

CREATE POLICY "Admin and internal can update import mappings"
ON public.sales_import_mappings FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'internal')
  )
);

-- va_sales_tasks
CREATE POLICY "Admin and internal can manage VA sales tasks"
ON public.va_sales_tasks FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'internal')
  )
);

-- ============================================================================
-- Triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_dealer_sales_updated_at ON public.dealer_sales;
CREATE TRIGGER update_dealer_sales_updated_at
BEFORE UPDATE ON public.dealer_sales
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_sales_import_mappings_updated_at ON public.sales_import_mappings;
CREATE TRIGGER update_sales_import_mappings_updated_at
BEFORE UPDATE ON public.sales_import_mappings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_va_sales_tasks_updated_at ON public.va_sales_tasks;
CREATE TRIGGER update_va_sales_tasks_updated_at
BEFORE UPDATE ON public.va_sales_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- RPC Functions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_sale_fingerprint(
  p_year INTEGER,
  p_make TEXT,
  p_model TEXT,
  p_variant_raw TEXT DEFAULT NULL,
  p_km INTEGER DEFAULT NULL,
  p_region_id TEXT DEFAULT NULL
)
RETURNS TABLE(fingerprint TEXT, confidence INTEGER) AS $$
DECLARE
  v_variant TEXT;
  v_km_band TEXT;
  v_conf INTEGER := 40;
BEGIN
  v_variant := COALESCE(NULLIF(TRIM(p_variant_raw), ''), 'base');
  
  IF p_km IS NOT NULL THEN
    v_km_band := CASE
      WHEN p_km < 50000 THEN '0-50k'
      WHEN p_km < 100000 THEN '50-100k'
      WHEN p_km < 150000 THEN '100-150k'
      ELSE '150k+'
    END;
    v_conf := v_conf + 10;
  ELSE
    v_km_band := 'unknown';
  END IF;
  
  IF p_variant_raw IS NOT NULL AND p_variant_raw != '' THEN
    v_conf := v_conf + 20;
  END IF;
  IF p_region_id IS NOT NULL THEN
    v_conf := v_conf + 10;
  END IF;
  
  fingerprint := LOWER(
    p_year::TEXT || '|' || 
    TRIM(p_make) || '|' || 
    TRIM(p_model) || '|' || 
    v_variant || '|' ||
    v_km_band
  );
  confidence := LEAST(v_conf, 100);
  
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_va_sales_task_queue()
RETURNS TABLE(
  id UUID,
  dealer_id TEXT,
  dealer_name TEXT,
  task_type TEXT,
  status TEXT,
  priority INTEGER,
  computed_priority INTEGER,
  last_data_received_at TIMESTAMPTZ,
  days_since_data INTEGER,
  expected_frequency TEXT,
  next_due_at TIMESTAMPTZ,
  is_overdue BOOLEAN,
  assigned_to TEXT,
  notes TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    t.dealer_id,
    t.dealer_name,
    t.task_type,
    t.status,
    t.priority,
    (t.priority + GREATEST(0, EXTRACT(DAY FROM (now() - COALESCE(t.next_due_at, now())))::INTEGER * 2))::INTEGER as computed_priority,
    t.last_data_received_at,
    EXTRACT(DAY FROM (now() - t.last_data_received_at))::INTEGER as days_since_data,
    t.expected_frequency,
    t.next_due_at,
    (t.next_due_at IS NOT NULL AND t.next_due_at < now()) as is_overdue,
    t.assigned_to,
    t.notes
  FROM public.va_sales_tasks t
  WHERE t.status NOT IN ('complete', 'rejected')
  ORDER BY computed_priority DESC, t.created_at;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_stale_dealers(p_days_threshold INTEGER DEFAULT 90)
RETURNS TABLE(
  dealer_id TEXT,
  dealer_name TEXT,
  last_sale_date DATE,
  days_stale INTEGER,
  total_sales INTEGER,
  has_active_task BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  WITH dealer_stats AS (
    SELECT 
      ds.dealer_id,
      ds.dealer_name,
      MAX(ds.sold_date) as last_sale,
      COUNT(*)::INTEGER as sale_count
    FROM public.dealer_sales ds
    GROUP BY ds.dealer_id, ds.dealer_name
  )
  SELECT 
    s.dealer_id,
    s.dealer_name,
    s.last_sale as last_sale_date,
    EXTRACT(DAY FROM (CURRENT_DATE - s.last_sale))::INTEGER as days_stale,
    s.sale_count as total_sales,
    EXISTS(
      SELECT 1 FROM public.va_sales_tasks t 
      WHERE t.dealer_id = s.dealer_id 
      AND t.status NOT IN ('complete', 'rejected')
    ) as has_active_task
  FROM dealer_stats s
  WHERE EXTRACT(DAY FROM (CURRENT_DATE - s.last_sale)) >= p_days_threshold
  ORDER BY days_stale DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;