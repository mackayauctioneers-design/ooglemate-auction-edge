-- RPC: Get hunt ID for a sale (verification)
CREATE OR REPLACE FUNCTION public.get_hunt_for_sale(p_sale_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hunt_id uuid;
BEGIN
  SELECT id INTO v_hunt_id
  FROM sale_hunts
  WHERE source_sale_id = p_sale_id
  ORDER BY created_at DESC
  LIMIT 1;
  
  RETURN v_hunt_id;
END;
$$;

-- RPC: Manual fallback to create hunt from sale
CREATE OR REPLACE FUNCTION public.create_hunt_from_sale(p_sale_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_hunt_id uuid;
BEGIN
  -- Get the sale record
  SELECT * INTO v_sale
  FROM dealer_sales
  WHERE id = p_sale_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found: %', p_sale_id;
  END IF;
  
  -- Check if hunt already exists
  SELECT id INTO v_hunt_id
  FROM sale_hunts
  WHERE source_sale_id = p_sale_id
  LIMIT 1;
  
  IF v_hunt_id IS NOT NULL THEN
    RETURN v_hunt_id;
  END IF;
  
  -- Create the hunt
  INSERT INTO sale_hunts (
    dealer_id,
    source_sale_id,
    year,
    make,
    model,
    variant_family,
    km,
    proven_exit_value,
    proven_exit_method,
    states,
    status
  ) VALUES (
    v_sale.dealer_id::uuid,
    v_sale.id,
    v_sale.year,
    v_sale.make,
    v_sale.model,
    v_sale.variant_raw,
    v_sale.km,
    COALESCE(v_sale.sell_price, v_sale.buy_price),
    'sale',
    CASE WHEN v_sale.state IS NOT NULL THEN ARRAY[v_sale.state] ELSE NULL END,
    'active'
  )
  RETURNING id INTO v_hunt_id;
  
  RETURN v_hunt_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_hunt_for_sale(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_hunt_from_sale(uuid) TO authenticated;