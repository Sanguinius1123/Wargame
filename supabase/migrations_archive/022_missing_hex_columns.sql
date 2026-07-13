-- Add hex columns that are defined in 003_map.sql but were not present
-- in the DB because the migration was applied before those fields were added.

ALTER TABLE hexes
  ADD COLUMN IF NOT EXISTS has_urban   BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS urban_hp    SMALLINT NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS has_canal   BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_airstrip BOOLEAN NOT NULL DEFAULT FALSE;

-- has_road is no longer part of the model (removed). Skipped intentionally.
