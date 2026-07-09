-- Add 'safety' to the standing_order CHECK constraint for submarine stealth mode.
ALTER TABLE units DROP CONSTRAINT IF EXISTS units_standing_order_check;
ALTER TABLE units ADD CONSTRAINT units_standing_order_check
  CHECK (standing_order IN ('hold_position', 'patrol', 'hold_fire', 'fortify', 'safety'));
