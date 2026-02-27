
-- Make hunt_id nullable so OogleBot searches (no hunt) can use manus_search_tasks
ALTER TABLE manus_search_tasks ALTER COLUMN hunt_id DROP NOT NULL;

-- Add search_session_id for grouping OogleBot-triggered Manus tasks
ALTER TABLE manus_search_tasks ADD COLUMN IF NOT EXISTS search_session_id UUID;

-- Store the parsed filters so manus-webhook knows make/model without a hunt
ALTER TABLE manus_search_tasks ADD COLUMN IF NOT EXISTS search_filters JSONB;

-- Store parsed results directly on the task for easy frontend polling
ALTER TABLE manus_search_tasks ADD COLUMN IF NOT EXISTS results JSONB;

-- Index for polling by session
CREATE INDEX IF NOT EXISTS idx_manus_tasks_session ON manus_search_tasks(search_session_id);
