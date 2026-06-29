-- =============================================================
-- 011_bridge_names_map.sql
-- Adds has_bridge and settlement_name columns, then rebuilds the
-- dev test map with interesting terrain, a meandering river, two
-- bridge crossings, roads, settlements, and vegetation.
-- =============================================================

ALTER TABLE hexes ADD COLUMN IF NOT EXISTS has_bridge      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE hexes ADD COLUMN IF NOT EXISTS settlement_name TEXT;

-- ---------------------------------------------------------------
-- Rebuild dev game map  (game_id = dev UUID)
-- ---------------------------------------------------------------
DO $$
DECLARE
  gid UUID := '00000000-0000-0000-0000-000000000001';
BEGIN

  DELETE FROM units           WHERE game_id = gid;
  DELETE FROM movement_orders WHERE game_id = gid;
  DELETE FROM buildings       WHERE game_id = gid;
  DELETE FROM production_queue WHERE game_id = gid;
  DELETE FROM scouted_hexes   WHERE game_id = gid;
  DELETE FROM hexes           WHERE game_id = gid;

  -- Base: all plains
  INSERT INTO hexes (game_id, hex_q, hex_r, terrain)
  SELECT gid, q, r, 'plains'
  FROM generate_series(0,19) q, generate_series(0,19) r;

  -- ---- River (top-right → bottom-left, meandering) ----
  UPDATE hexes SET terrain = 'water'
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    (17,1),(16,1),(16,2),(15,2),(15,3),(14,3),(14,4),(13,4),(13,5),(12,5),
    (12,6),(11,6),(10,6),(10,7),(9,7),(9,8),(8,8),(8,9),(7,9),(7,10),
    (6,10),(6,11),(5,11),(5,12),(4,12),(4,13),(3,13),(3,14),(2,14),(2,15),
    (2,16),(1,16),(1,17)
  );

  -- ---- Hills (NE corner + SE hills) ----
  UPDATE hexes SET terrain = 'hills'
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    (15,1),(16,0),(17,0),(18,0),(18,1),(18,2),(18,3),
    (14,15),(15,15),(15,16),(16,16)
  );

  -- ---- Mountains (north of center) ----
  UPDATE hexes SET terrain = 'mountains'
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    (11,3),(12,3),(11,4)
  );

  -- ---- Bridges (water hexes where roads cross) ----
  UPDATE hexes SET has_bridge = true
  WHERE game_id = gid AND (hex_q, hex_r) IN ((10,7),(8,9));

  -- ---- Roads ----
  -- NW road: Dunmore → West Veldran
  -- W-E road via Bridge 1: W.Veldran → (9,6)→bridge(10,7)→(11,7)→E.Veldran
  -- W-E road via Bridge 2: W.Veldran → (7,8)→bridge(8,9)→(9,9)→E.Veldran
  -- SE road: E.Veldran → Crestholm
  UPDATE hexes SET has_road = true
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    (2,2),(2,3),(2,4),(3,4),(3,5),(3,6),(3,7),(4,7),(4,8),(4,9),
    (5,9),(6,9),(6,8),(7,8),(7,7),(8,7),(8,6),(9,6),
    (10,7),
    (11,7),(12,7),(12,8),(12,9),
    (8,9),
    (9,9),(10,9),(11,9),
    (12,10),(13,10),(14,10),(15,10),(15,11),(15,12),
    (16,12),(16,13),(16,14),(16,15),(17,15),(17,16),(17,17)
  );

  -- ---- Settlements ----
  UPDATE hexes SET has_settlement = true, settlement_name = 'Dunmore'
  WHERE game_id = gid AND hex_q = 2  AND hex_r = 2;

  UPDATE hexes SET has_settlement = true, settlement_name = 'West Veldran'
  WHERE game_id = gid AND hex_q = 5  AND hex_r = 9;

  UPDATE hexes SET has_settlement = true, settlement_name = 'East Veldran'
  WHERE game_id = gid AND hex_q = 12 AND hex_r = 10;

  UPDATE hexes SET has_settlement = true, settlement_name = 'Crestholm'
  WHERE game_id = gid AND hex_q = 17 AND hex_r = 17;

  -- ---- Urban tiles (each settlement + surrounding hexes) ----
  UPDATE hexes SET has_urban = true
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    -- Dunmore
    (2,2),(1,2),(2,1),(2,3),(3,2),
    -- West Veldran
    (5,9),(4,9),(4,10),(5,8),(5,10),(6,9),
    -- East Veldran
    (12,10),(11,10),(12,9),(12,11),(13,9),(13,10),
    -- Crestholm
    (17,17),(16,17),(17,16),(17,18),(18,17)
  );

  -- ---- Heavy vegetation ----
  UPDATE hexes SET has_heavy_vegetation = true
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    -- NE forest
    (17,3),(18,3),(18,4),(18,5),(17,4),
    -- SW forest
    (1,13),(1,14),(2,13)
  );

  -- ---- Light vegetation ----
  UPDATE hexes SET has_light_vegetation = true
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    -- West woodland
    (1,8),(1,9),(1,10),(2,9),(2,10),(2,11),(1,11),
    -- East scrub
    (17,5),(18,6),(15,7),(16,7),(15,8)
  );

  -- ---- Factories at every settlement ----
  INSERT INTO buildings (game_id, hex_q, hex_r, type, current_hp, max_hp)
  VALUES
    (gid,  2,  2, 'factory', 20, 20),
    (gid,  5,  9, 'factory', 20, 20),
    (gid, 12, 10, 'factory', 20, 20),
    (gid, 17, 17, 'factory', 20, 20);

END $$;
