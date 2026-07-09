-- 010_continuous_bombard.sql
-- Adds continuous bombard target to units table.
-- When set, the unit auto-fires at this hex every turn until cleared.
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS continuous_bombard_q SMALLINT,
  ADD COLUMN IF NOT EXISTS continuous_bombard_r SMALLINT;
