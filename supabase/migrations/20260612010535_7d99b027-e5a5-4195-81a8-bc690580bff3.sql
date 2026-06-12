ALTER TABLE hermes_raw_listings ADD COLUMN IF NOT EXISTS evaluated boolean DEFAULT false;
ALTER TABLE hermes_agent_heartbeats DISABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_raw_listings DISABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_evaluations DISABLE ROW LEVEL SECURITY;