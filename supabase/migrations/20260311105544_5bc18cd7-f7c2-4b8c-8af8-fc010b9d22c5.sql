ALTER TABLE operator_opportunities 
ADD COLUMN IF NOT EXISTS pricing_guide jsonb DEFAULT NULL;