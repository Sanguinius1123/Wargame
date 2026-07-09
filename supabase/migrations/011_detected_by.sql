-- 011_detected_by.sql
-- Tracks which factions have currently detected this unit (updated each Phase 4).
-- Reset to {} at start of each Phase 4 detection pass.
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS detected_by_factions UUID[] NOT NULL DEFAULT '{}';
