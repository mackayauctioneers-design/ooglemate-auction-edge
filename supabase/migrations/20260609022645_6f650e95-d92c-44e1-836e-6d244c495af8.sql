-- Daily purchase limit tracking
CREATE TABLE IF NOT EXISTS public.daily_purchase_limits (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    dealer_id TEXT NOT NULL DEFAULT 'mackay',
    daily_limit INTEGER NOT NULL DEFAULT 150000,
    spent_today INTEGER NOT NULL DEFAULT 0,
    remaining INTEGER GENERATED ALWAYS AS (daily_limit - spent_today) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(date, dealer_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_purchase_limits TO authenticated;
GRANT ALL ON public.daily_purchase_limits TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.daily_purchase_limits_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.daily_purchase_limits_id_seq TO service_role;

ALTER TABLE public.daily_purchase_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read daily limits" ON public.daily_purchase_limits
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated write daily limits" ON public.daily_purchase_limits
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Wholesale purchase log
CREATE TABLE IF NOT EXISTS public.wholesale_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id TEXT,
    dealer_id TEXT NOT NULL DEFAULT 'mackay',
    rego TEXT NOT NULL,
    vin TEXT,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    year INTEGER,
    variant TEXT,
    odometer INTEGER,
    purchase_price INTEGER NOT NULL,
    predicted_trade INTEGER,
    predicted_retail INTEGER,
    predicted_gp INTEGER,
    discount_pct NUMERIC(5,2),
    tier TEXT CHECK (tier IN ('P1', 'P2', 'P3')),
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    actual_sale_price INTEGER,
    actual_gp INTEGER,
    sold_at TIMESTAMPTZ,
    days_to_sell INTEGER,
    gp_variance INTEGER GENERATED ALWAYS AS (
        COALESCE(actual_gp, 0) - COALESCE(predicted_gp, 0)
    ) STORED,
    status TEXT DEFAULT 'pending_review' CHECK (
        status IN ('pending_review', 'approved', 'rejected', 'purchased', 'in_stock', 'sold', 'written_off')
    ),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wholesale_purchases TO authenticated;
GRANT ALL ON public.wholesale_purchases TO service_role;

ALTER TABLE public.wholesale_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read wholesale" ON public.wholesale_purchases
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated write wholesale" ON public.wholesale_purchases
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_wholesale_dealer_date ON public.wholesale_purchases(dealer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wholesale_status ON public.wholesale_purchases(status);
CREATE INDEX IF NOT EXISTS idx_wholesale_rego ON public.wholesale_purchases(rego);

-- Guard-rail functions
CREATE OR REPLACE FUNCTION public.check_daily_purchase_limit(
    p_dealer_id TEXT,
    p_amount INTEGER
) RETURNS TABLE (
    can_approve BOOLEAN,
    current_spent INTEGER,
    remaining INTEGER,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit INTEGER;
    v_spent INTEGER;
    v_remaining INTEGER;
BEGIN
    INSERT INTO public.daily_purchase_limits (date, dealer_id, spent_today)
    VALUES (CURRENT_DATE, p_dealer_id, 0)
    ON CONFLICT (date, dealer_id) DO NOTHING;

    SELECT daily_limit, spent_today, daily_limit - spent_today
    INTO v_limit, v_spent, v_remaining
    FROM public.daily_purchase_limits
    WHERE date = CURRENT_DATE AND dealer_id = p_dealer_id;

    IF v_remaining >= p_amount THEN
        RETURN QUERY SELECT TRUE, v_spent, v_remaining,
            format('Approved. Remaining: $%s', v_remaining - p_amount);
    ELSE
        RETURN QUERY SELECT FALSE, v_spent, v_remaining,
            format('REJECTED. Limit: $%s | Spent: $%s | Remaining: $%s | Requested: $%s',
                v_limit, v_spent, v_remaining, p_amount);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_wholesale_purchase(
    p_alert_id TEXT,
    p_dealer_id TEXT,
    p_rego TEXT,
    p_vin TEXT,
    p_make TEXT,
    p_model TEXT,
    p_year INTEGER,
    p_variant TEXT,
    p_odometer INTEGER,
    p_purchase_price INTEGER,
    p_predicted_trade INTEGER,
    p_predicted_retail INTEGER,
    p_tier TEXT,
    p_approved_by TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_purchase_id UUID;
    v_limit_check RECORD;
BEGIN
    SELECT * INTO v_limit_check FROM public.check_daily_purchase_limit(p_dealer_id, p_purchase_price);

    IF NOT v_limit_check.can_approve THEN
        RAISE EXCEPTION 'Daily purchase limit exceeded: %', v_limit_check.message;
    END IF;

    INSERT INTO public.wholesale_purchases (
        alert_id, dealer_id, rego, vin, make, model, year, variant, odometer,
        purchase_price, predicted_trade, predicted_retail, predicted_gp,
        discount_pct, tier, approved_by, approved_at, status
    ) VALUES (
        p_alert_id, p_dealer_id, p_rego, p_vin, p_make, p_model, p_year, p_variant, p_odometer,
        p_purchase_price, p_predicted_trade, p_predicted_retail,
        COALESCE(p_predicted_retail, 0) - p_purchase_price,
        CASE WHEN p_predicted_trade > 0
            THEN ROUND(((p_predicted_trade - p_purchase_price)::NUMERIC / p_predicted_trade * 100), 2)
            ELSE 0
        END,
        p_tier, p_approved_by, NOW(), 'approved'
    ) RETURNING id INTO v_purchase_id;

    UPDATE public.daily_purchase_limits
    SET spent_today = spent_today + p_purchase_price,
        updated_at = NOW()
    WHERE date = CURRENT_DATE AND dealer_id = p_dealer_id;

    RETURN v_purchase_id;
END;
$$;

CREATE OR REPLACE VIEW public.cfo_wholesale_summary AS
SELECT
    dealer_id,
    COUNT(*) FILTER (WHERE status IN ('approved', 'purchased', 'in_stock')) as active_purchases,
    COUNT(*) FILTER (WHERE status = 'sold') as sold_count,
    SUM(purchase_price) FILTER (WHERE status IN ('approved', 'purchased', 'in_stock')) as total_exposure,
    SUM(predicted_gp) FILTER (WHERE status IN ('approved', 'purchased', 'in_stock')) as predicted_gp_remaining,
    SUM(actual_gp) FILTER (WHERE status = 'sold') as realized_gp,
    AVG(gp_variance) FILTER (WHERE status = 'sold') as avg_gp_variance,
    AVG(days_to_sell) FILTER (WHERE status = 'sold') as avg_days_to_sell
FROM public.wholesale_purchases
GROUP BY dealer_id;

GRANT SELECT ON public.cfo_wholesale_summary TO authenticated;
GRANT ALL ON public.cfo_wholesale_summary TO service_role;

INSERT INTO public.daily_purchase_limits (date, dealer_id, daily_limit, spent_today)
VALUES (CURRENT_DATE, 'mackay', 150000, 0)
ON CONFLICT (date, dealer_id) DO NOTHING;