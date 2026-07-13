-- =============================================================
-- 018_strategic_terrain.sql — Strategic rework: terrain + units
--
-- 1. Simplify terrain_type_config
--    - Drop ×3 internal scale — all costs are now direct (1, 2, NULL)
--    - Drop road costs, blocks_los, combat_mod (obsolete)
--    - Add defense_bonus column (static defense modifier for occupants)
-- 2. Drop obsolete hex columns (roads, bridges, canals, urban tiles removed)
-- 3. Update unit_type_config for dev game
--    - foot=1, mech=2, naval=3; LOS=1 for all ground units
--    - Delete Supply unit (no more supply trucks)
-- =============================================================

-- ── terrain_type_config overhaul ─────────────────────────────────────────────

ALTER TABLE terrain_type_config ADD COLUMN IF NOT EXISTS defense_bonus SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE terrain_type_config DROP COLUMN IF EXISTS blocks_los;
ALTER TABLE terrain_type_config DROP COLUMN IF EXISTS combat_mod;
ALTER TABLE terrain_type_config DROP COLUMN IF EXISTS foot_road_cost;
ALTER TABLE terrain_type_config DROP COLUMN IF EXISTS mech_road_cost;

-- Update all terrain costs to direct (non-×3) values and defense bonuses.
-- foot_cost NULL = impassable to foot (never, but consistent).
-- mech_cost NULL = impassable to mechanized.
-- naval_cost NULL = impassable to naval.
UPDATE terrain_type_config SET foot_cost=1, mech_cost=1, naval_cost=NULL, defense_bonus=0, elevation=0 WHERE name='plains';
UPDATE terrain_type_config SET foot_cost=1, mech_cost=2, naval_cost=NULL, defense_bonus=1, elevation=1 WHERE name='hills';
UPDATE terrain_type_config SET foot_cost=1, mech_cost=NULL, naval_cost=NULL, defense_bonus=2, elevation=2 WHERE name='mountains';
UPDATE terrain_type_config SET foot_cost=1, mech_cost=1, naval_cost=NULL, defense_bonus=0, elevation=0 WHERE name='desert';
UPDATE terrain_type_config SET foot_cost=1, mech_cost=NULL, naval_cost=NULL, defense_bonus=1, elevation=0 WHERE name='wetlands';
UPDATE terrain_type_config SET foot_cost=NULL, mech_cost=NULL, naval_cost=1, defense_bonus=0, elevation=0 WHERE name='water';

-- ── Drop obsolete hex columns ─────────────────────────────────────────────────
-- Roads, bridges, canals, and urban tiles removed from the strategic design.

ALTER TABLE hexes     DROP COLUMN IF EXISTS has_road;
ALTER TABLE hexes     DROP COLUMN IF EXISTS has_bridge;
ALTER TABLE hexes     DROP COLUMN IF EXISTS has_canal;
ALTER TABLE hexes     DROP COLUMN IF EXISTS has_urban;
ALTER TABLE hexes     DROP COLUMN IF EXISTS urban_hp;

ALTER TABLE map_hexes DROP COLUMN IF EXISTS has_road;
ALTER TABLE map_hexes DROP COLUMN IF EXISTS has_bridge;
ALTER TABLE map_hexes DROP COLUMN IF EXISTS has_canal;
ALTER TABLE map_hexes DROP COLUMN IF EXISTS has_urban;

-- ── unit_type_config for dev game ────────────────────────────────────────────
-- Ground: foot=1, mechanized=2; LOS simplified to 1 for all ground units.
UPDATE unit_type_config SET move=1, los=1
  WHERE game_id='00000000-0000-0000-0000-000000000001'
    AND name IN ('Infantry','Artillery','AT Gun','AA Gun');

UPDATE unit_type_config SET move=2, los=1
  WHERE game_id='00000000-0000-0000-0000-000000000001'
    AND name IN ('Armor','Recon');

-- Naval: all ships move=3.
UPDATE unit_type_config SET move=3
  WHERE game_id='00000000-0000-0000-0000-000000000001'
    AND name IN ('Destroyer','Frigate','Cruiser','Battleship','Transport Ship','Carrier','Submarine');

-- Remove Supply unit (supply truck mechanic removed from design).
DELETE FROM unit_type_config
  WHERE game_id='00000000-0000-0000-0000-000000000001' AND name='Supply';
