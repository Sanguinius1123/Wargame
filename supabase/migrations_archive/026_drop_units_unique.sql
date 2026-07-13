-- 026: Allow multiple stacks of same unit type in same hex (for split command).
-- The UNIQUE constraint on (faction_id, unit_type_id, hex_q, hex_r) prevented
-- creating a second row when splitting a stack in place.
-- Phase 4 now auto-merges stacks of the same type that share a hex after movement.

ALTER TABLE units DROP CONSTRAINT IF EXISTS units_faction_id_unit_type_id_hex_q_hex_r_key;
