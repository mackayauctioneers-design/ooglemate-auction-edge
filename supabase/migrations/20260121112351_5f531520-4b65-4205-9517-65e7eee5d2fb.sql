-- Fix: Create heat lookup with fallback using plpgsql instead
CREATE OR REPLACE FUNCTION fn_get_exit_heat_with_fallback(
  p_state text,
  p_make text,
  p_model_family text,
  p_sa2_code text,
  p_date date DEFAULT current_date
)
RETURNS TABLE(heat_score numeric, heat_source text, sample_quality text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_heat numeric;
  v_source text;
  v_quality text;
BEGIN
  -- Try exact SA2 match first
  SELECT h.heat_score, 'sa2_exact', h.data_quality
  INTO v_heat, v_source, v_quality
  FROM retail_geo_heat_sa2_daily h
  WHERE h.date = p_date
    AND h.state = p_state
    AND h.make = p_make
    AND h.model_family = p_model_family
    AND h.sa2_code = p_sa2_code
  LIMIT 1;
  
  IF v_heat IS NOT NULL THEN
    heat_score := v_heat;
    heat_source := v_source;
    sample_quality := v_quality;
    RETURN NEXT;
    RETURN;
  END IF;
  
  -- Fallback: state-level average for this make/model
  SELECT 
    AVG(h.heat_score)::numeric,
    'state_avg',
    CASE WHEN COUNT(*) >= 5 THEN 'OK' ELSE 'LOW_SAMPLE' END
  INTO v_heat, v_source, v_quality
  FROM retail_geo_heat_sa2_daily h
  WHERE h.date = p_date
    AND h.state = p_state
    AND h.make = p_make
    AND h.model_family = p_model_family;
  
  IF v_heat IS NOT NULL THEN
    heat_score := v_heat;
    heat_source := v_source;
    sample_quality := v_quality;
    RETURN NEXT;
    RETURN;
  END IF;
  
  -- No data: return 0.5 as neutral
  heat_score := 0.5;
  heat_source := 'default';
  sample_quality := 'NO_DATA';
  RETURN NEXT;
END;
$$;