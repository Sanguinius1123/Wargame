-- =============================================================
-- 008_build_and_winner.sql
-- Adds build order support and winner tracking
-- =============================================================

-- Add structure_type to movement_orders for build orders
ALTER TABLE movement_orders ADD COLUMN IF NOT EXISTS structure_type TEXT;

-- Expand order_type constraint to include 'build'
ALTER TABLE movement_orders DROP CONSTRAINT IF EXISTS movement_orders_order_type_check;
ALTER TABLE movement_orders ADD CONSTRAINT movement_orders_order_type_check
  CHECK (order_type IN (
    'move', 'bombard', 'retreat', 'pursue_if_retreat',
    'wait_turn', 'fortify', 'repair', 'build'
  ));

-- Track game winner on the games table
ALTER TABLE games ADD COLUMN IF NOT EXISTS winner_faction_id UUID REFERENCES factions(id) ON DELETE SET NULL;

-- Idempotent: auto_resolve may already exist from migration 007
ALTER TABLE games ADD COLUMN IF NOT EXISTS auto_resolve BOOLEAN NOT NULL DEFAULT true;
