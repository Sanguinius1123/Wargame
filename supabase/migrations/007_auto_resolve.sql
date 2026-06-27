-- 007_auto_resolve.sql
-- Adds auto_resolve flag to games so GM can control whether turns advance
-- automatically when all players click Finish Turn, or always require GM to commit.

ALTER TABLE games ADD COLUMN IF NOT EXISTS auto_resolve BOOLEAN NOT NULL DEFAULT true;
