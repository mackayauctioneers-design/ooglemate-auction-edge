-- Allow NULL heat_score for low-sample rows (gating)
ALTER TABLE retail_geo_heat_sa2_daily 
ALTER COLUMN heat_score DROP NOT NULL;