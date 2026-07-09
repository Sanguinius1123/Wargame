-- 012_detected_quantities.sql
-- Replace detected_by_factions (boolean) with detected_quantities (JSONB map of faction_id → count).
-- This allows showing only the detected portion of a stealthy unit stack.
ALTER TABLE units DROP COLUMN IF EXISTS detected_by_factions;
ALTER TABLE units ADD COLUMN IF NOT EXISTS detected_quantities JSONB NOT NULL DEFAULT '{}';
