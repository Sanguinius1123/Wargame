-- =============================================================
-- 015_control_point.sql
-- Adds 'control_point' building type and 'split' order type.
-- Control points are GM-placeable objective markers for skirmish/test modes.
-- =============================================================

ALTER TABLE buildings DROP CONSTRAINT IF EXISTS buildings_type_check;
ALTER TABLE buildings ADD CONSTRAINT buildings_type_check
  CHECK (type IN (
    'factory', 'airbase', 'harbor', 'airstrip',
    'bridge', 'fortification', 'control_point'
  ));

ALTER TABLE movement_orders DROP CONSTRAINT IF EXISTS movement_orders_order_type_check;
ALTER TABLE movement_orders ADD CONSTRAINT movement_orders_order_type_check
  CHECK (order_type IN (
    'move', 'bombard', 'retreat', 'pursue_if_retreat',
    'wait_turn', 'fortify', 'repair', 'build', 'split'
  ));
