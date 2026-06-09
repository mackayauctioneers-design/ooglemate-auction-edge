ALTER TABLE public.dealer_sales_truth
ADD CONSTRAINT unique_dealer_stock
UNIQUE (dealer_id, stock_number);