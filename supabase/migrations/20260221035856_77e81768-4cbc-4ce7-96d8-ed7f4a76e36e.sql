-- Drop old constraint and add STALE + DEAD to allowed lifecycle states
ALTER TABLE vehicle_listings DROP CONSTRAINT lifecycle_state_valid;

ALTER TABLE vehicle_listings ADD CONSTRAINT lifecycle_state_valid 
  CHECK (lifecycle_state = ANY (ARRAY['NEW', 'WATCH', 'BUY', 'BOUGHT', 'SOLD', 'AVOID', 'STALE', 'DEAD']));
