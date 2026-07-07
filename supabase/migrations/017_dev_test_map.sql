-- =============================================================
-- 017_dev_test_map.sql
-- 1. Remove France 1940 map template + francene game
-- 2. Add settlement_size column to hexes + map_hexes
-- 3. Create Dev 10×10 map template (all terrain types, 3 settlements, rail)
-- 4. Rebuild dev game (00000000-0000-0000-0000-000000000001) with that map
--
-- Layout (q=col west→east, r=row north→south):
--   Mountains  : q=6-7, r=0-1  (NE peaks)
--   Hills      : q=4-7, r=2-4 and q=5, r=0-1
--   Water      : q=8-9 (eastern coast)
--   Wetlands   : q=0-2, r=6-9  (SW marsh)
--   Desert     : q=3-5, r=6-9  (S dry)
--   Plains     : everything else
--   Heavy veg  : q=0, r=3-5    (western dense forest)
--   Light veg  : q=1-3, r=1-4  (central forest)
--   Settlements: Northkeep(3,1), Hillcrest(5,3), Eastport(7,4)
--   Railroad   : Northkeep→(4,1)→(4,2)→(5,2)→Hillcrest→(6,3)→(6,4)→Eastport
-- =============================================================

-- ── Cleanup ──────────────────────────────────────────────────────────────────

DELETE FROM games WHERE id = 'ea46fde6-6167-4430-8b2b-452b6f82c6d3';
DELETE FROM maps  WHERE id = '10000000-0000-0000-0000-000000000016';

-- ── Schema additions ─────────────────────────────────────────────────────────

ALTER TABLE hexes     ADD COLUMN IF NOT EXISTS settlement_size SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE map_hexes ADD COLUMN IF NOT EXISTS settlement_size SMALLINT NOT NULL DEFAULT 0;

-- ── Map template ─────────────────────────────────────────────────────────────

INSERT INTO maps (id, name, description) VALUES (
  '10000000-0000-0000-0000-000000000017',
  'Dev 10×10',
  'Test map covering all terrain types. Three settlements connected by rail, eastern coastline, hills/mountains NE, wetlands SW, desert S.'
);

INSERT INTO map_hexes (map_id, hex_q, hex_r, terrain) VALUES
-- q=0 (r=6-9 wetlands)
('10000000-0000-0000-0000-000000000017', 0, 0, 'plains'),
('10000000-0000-0000-0000-000000000017', 0, 1, 'plains'),
('10000000-0000-0000-0000-000000000017', 0, 2, 'plains'),
('10000000-0000-0000-0000-000000000017', 0, 3, 'plains'),
('10000000-0000-0000-0000-000000000017', 0, 4, 'plains'),
('10000000-0000-0000-0000-000000000017', 0, 5, 'plains'),
('10000000-0000-0000-0000-000000000017', 0, 6, 'wetlands'),
('10000000-0000-0000-0000-000000000017', 0, 7, 'wetlands'),
('10000000-0000-0000-0000-000000000017', 0, 8, 'wetlands'),
('10000000-0000-0000-0000-000000000017', 0, 9, 'wetlands'),
-- q=1 (r=6-9 wetlands)
('10000000-0000-0000-0000-000000000017', 1, 0, 'plains'),
('10000000-0000-0000-0000-000000000017', 1, 1, 'plains'),
('10000000-0000-0000-0000-000000000017', 1, 2, 'plains'),
('10000000-0000-0000-0000-000000000017', 1, 3, 'plains'),
('10000000-0000-0000-0000-000000000017', 1, 4, 'plains'),
('10000000-0000-0000-0000-000000000017', 1, 5, 'plains'),
('10000000-0000-0000-0000-000000000017', 1, 6, 'wetlands'),
('10000000-0000-0000-0000-000000000017', 1, 7, 'wetlands'),
('10000000-0000-0000-0000-000000000017', 1, 8, 'wetlands'),
('10000000-0000-0000-0000-000000000017', 1, 9, 'wetlands'),
-- q=2 (r=6-9 wetlands)
('10000000-0000-0000-0000-000000000017', 2, 0, 'plains'),
('10000000-0000-0000-0000-000000000017', 2, 1, 'plains'),
('10000000-0000-0000-0000-000000000017', 2, 2, 'plains'),
('10000000-0000-0000-0000-000000000017', 2, 3, 'plains'),
('10000000-0000-0000-0000-000000000017', 2, 4, 'plains'),
('10000000-0000-0000-0000-000000000017', 2, 5, 'plains'),
('10000000-0000-0000-0000-000000000017', 2, 6, 'wetlands'),
('10000000-0000-0000-0000-000000000017', 2, 7, 'wetlands'),
('10000000-0000-0000-0000-000000000017', 2, 8, 'wetlands'),
('10000000-0000-0000-0000-000000000017', 2, 9, 'wetlands'),
-- q=3 (r=6-9 desert; settlement Northkeep at r=1)
('10000000-0000-0000-0000-000000000017', 3, 0, 'plains'),
('10000000-0000-0000-0000-000000000017', 3, 1, 'plains'),
('10000000-0000-0000-0000-000000000017', 3, 2, 'plains'),
('10000000-0000-0000-0000-000000000017', 3, 3, 'plains'),
('10000000-0000-0000-0000-000000000017', 3, 4, 'plains'),
('10000000-0000-0000-0000-000000000017', 3, 5, 'plains'),
('10000000-0000-0000-0000-000000000017', 3, 6, 'desert'),
('10000000-0000-0000-0000-000000000017', 3, 7, 'desert'),
('10000000-0000-0000-0000-000000000017', 3, 8, 'desert'),
('10000000-0000-0000-0000-000000000017', 3, 9, 'desert'),
-- q=4 (hills r=2-4; desert r=6-9)
('10000000-0000-0000-0000-000000000017', 4, 0, 'plains'),
('10000000-0000-0000-0000-000000000017', 4, 1, 'plains'),
('10000000-0000-0000-0000-000000000017', 4, 2, 'hills'),
('10000000-0000-0000-0000-000000000017', 4, 3, 'hills'),
('10000000-0000-0000-0000-000000000017', 4, 4, 'hills'),
('10000000-0000-0000-0000-000000000017', 4, 5, 'plains'),
('10000000-0000-0000-0000-000000000017', 4, 6, 'desert'),
('10000000-0000-0000-0000-000000000017', 4, 7, 'desert'),
('10000000-0000-0000-0000-000000000017', 4, 8, 'desert'),
('10000000-0000-0000-0000-000000000017', 4, 9, 'desert'),
-- q=5 (hills r=0-4; desert r=7-9; settlement Hillcrest at r=3)
('10000000-0000-0000-0000-000000000017', 5, 0, 'hills'),
('10000000-0000-0000-0000-000000000017', 5, 1, 'hills'),
('10000000-0000-0000-0000-000000000017', 5, 2, 'hills'),
('10000000-0000-0000-0000-000000000017', 5, 3, 'hills'),
('10000000-0000-0000-0000-000000000017', 5, 4, 'hills'),
('10000000-0000-0000-0000-000000000017', 5, 5, 'plains'),
('10000000-0000-0000-0000-000000000017', 5, 6, 'plains'),
('10000000-0000-0000-0000-000000000017', 5, 7, 'desert'),
('10000000-0000-0000-0000-000000000017', 5, 8, 'desert'),
('10000000-0000-0000-0000-000000000017', 5, 9, 'desert'),
-- q=6 (mountains r=0-1; hills r=2-3; plains r=4-9)
('10000000-0000-0000-0000-000000000017', 6, 0, 'mountains'),
('10000000-0000-0000-0000-000000000017', 6, 1, 'mountains'),
('10000000-0000-0000-0000-000000000017', 6, 2, 'hills'),
('10000000-0000-0000-0000-000000000017', 6, 3, 'hills'),
('10000000-0000-0000-0000-000000000017', 6, 4, 'plains'),
('10000000-0000-0000-0000-000000000017', 6, 5, 'plains'),
('10000000-0000-0000-0000-000000000017', 6, 6, 'plains'),
('10000000-0000-0000-0000-000000000017', 6, 7, 'plains'),
('10000000-0000-0000-0000-000000000017', 6, 8, 'plains'),
('10000000-0000-0000-0000-000000000017', 6, 9, 'plains'),
-- q=7 (mountains r=0-1; hills r=2-3; plains r=4-9; settlement Eastport at r=4)
('10000000-0000-0000-0000-000000000017', 7, 0, 'mountains'),
('10000000-0000-0000-0000-000000000017', 7, 1, 'mountains'),
('10000000-0000-0000-0000-000000000017', 7, 2, 'hills'),
('10000000-0000-0000-0000-000000000017', 7, 3, 'hills'),
('10000000-0000-0000-0000-000000000017', 7, 4, 'plains'),
('10000000-0000-0000-0000-000000000017', 7, 5, 'plains'),
('10000000-0000-0000-0000-000000000017', 7, 6, 'plains'),
('10000000-0000-0000-0000-000000000017', 7, 7, 'plains'),
('10000000-0000-0000-0000-000000000017', 7, 8, 'plains'),
('10000000-0000-0000-0000-000000000017', 7, 9, 'plains'),
-- q=8 (water — eastern coast)
('10000000-0000-0000-0000-000000000017', 8, 0, 'water'),
('10000000-0000-0000-0000-000000000017', 8, 1, 'water'),
('10000000-0000-0000-0000-000000000017', 8, 2, 'water'),
('10000000-0000-0000-0000-000000000017', 8, 3, 'water'),
('10000000-0000-0000-0000-000000000017', 8, 4, 'water'),
('10000000-0000-0000-0000-000000000017', 8, 5, 'water'),
('10000000-0000-0000-0000-000000000017', 8, 6, 'water'),
('10000000-0000-0000-0000-000000000017', 8, 7, 'water'),
('10000000-0000-0000-0000-000000000017', 8, 8, 'water'),
('10000000-0000-0000-0000-000000000017', 8, 9, 'water'),
-- q=9 (water — open sea)
('10000000-0000-0000-0000-000000000017', 9, 0, 'water'),
('10000000-0000-0000-0000-000000000017', 9, 1, 'water'),
('10000000-0000-0000-0000-000000000017', 9, 2, 'water'),
('10000000-0000-0000-0000-000000000017', 9, 3, 'water'),
('10000000-0000-0000-0000-000000000017', 9, 4, 'water'),
('10000000-0000-0000-0000-000000000017', 9, 5, 'water'),
('10000000-0000-0000-0000-000000000017', 9, 6, 'water'),
('10000000-0000-0000-0000-000000000017', 9, 7, 'water'),
('10000000-0000-0000-0000-000000000017', 9, 8, 'water'),
('10000000-0000-0000-0000-000000000017', 9, 9, 'water');

UPDATE map_hexes SET has_heavy_vegetation = TRUE
WHERE map_id = '10000000-0000-0000-0000-000000000017'
  AND (hex_q, hex_r) IN ((0,3),(0,4),(0,5));

UPDATE map_hexes SET has_light_vegetation = TRUE
WHERE map_id = '10000000-0000-0000-0000-000000000017'
  AND (hex_q, hex_r) IN ((1,1),(1,2),(1,3),(1,4),(1,5),(2,2),(2,3),(2,4),(3,2),(3,3));

UPDATE map_hexes SET has_settlement = TRUE, settlement_name = 'Northkeep', settlement_size = 10
  WHERE map_id = '10000000-0000-0000-0000-000000000017' AND hex_q = 3 AND hex_r = 1;

UPDATE map_hexes SET has_settlement = TRUE, settlement_name = 'Hillcrest', settlement_size = 12
  WHERE map_id = '10000000-0000-0000-0000-000000000017' AND hex_q = 5 AND hex_r = 3;

UPDATE map_hexes SET has_settlement = TRUE, settlement_name = 'Eastport', settlement_size = 15
  WHERE map_id = '10000000-0000-0000-0000-000000000017' AND hex_q = 7 AND hex_r = 4;

-- Railroad: Northkeep(3,1)→(4,1)→(4,2)→(5,2)→Hillcrest(5,3)→(6,3)→(6,4)→Eastport(7,4)
UPDATE map_hexes SET has_railroad = TRUE
WHERE map_id = '10000000-0000-0000-0000-000000000017'
  AND (hex_q, hex_r) IN ((3,1),(4,1),(4,2),(5,2),(5,3),(6,3),(6,4),(7,4));

-- ── Rebuild dev game ─────────────────────────────────────────────────────────

DO $$
DECLARE
  gid UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  UPDATE games SET map_width = 10, map_height = 10 WHERE id = gid;

  DELETE FROM units            WHERE game_id = gid;
  DELETE FROM movement_orders  WHERE game_id = gid;
  DELETE FROM buildings        WHERE game_id = gid;
  DELETE FROM production_queue WHERE game_id = gid;
  DELETE FROM scouted_hexes    WHERE game_id = gid;
  DELETE FROM hexes            WHERE game_id = gid;

  INSERT INTO hexes (game_id, hex_q, hex_r, terrain) VALUES
  -- q=0
  (gid,0,0,'plains'),(gid,0,1,'plains'),(gid,0,2,'plains'),(gid,0,3,'plains'),
  (gid,0,4,'plains'),(gid,0,5,'plains'),
  (gid,0,6,'wetlands'),(gid,0,7,'wetlands'),(gid,0,8,'wetlands'),(gid,0,9,'wetlands'),
  -- q=1
  (gid,1,0,'plains'),(gid,1,1,'plains'),(gid,1,2,'plains'),(gid,1,3,'plains'),
  (gid,1,4,'plains'),(gid,1,5,'plains'),
  (gid,1,6,'wetlands'),(gid,1,7,'wetlands'),(gid,1,8,'wetlands'),(gid,1,9,'wetlands'),
  -- q=2
  (gid,2,0,'plains'),(gid,2,1,'plains'),(gid,2,2,'plains'),(gid,2,3,'plains'),
  (gid,2,4,'plains'),(gid,2,5,'plains'),
  (gid,2,6,'wetlands'),(gid,2,7,'wetlands'),(gid,2,8,'wetlands'),(gid,2,9,'wetlands'),
  -- q=3
  (gid,3,0,'plains'),(gid,3,1,'plains'),(gid,3,2,'plains'),(gid,3,3,'plains'),
  (gid,3,4,'plains'),(gid,3,5,'plains'),
  (gid,3,6,'desert'),(gid,3,7,'desert'),(gid,3,8,'desert'),(gid,3,9,'desert'),
  -- q=4
  (gid,4,0,'plains'),(gid,4,1,'plains'),(gid,4,2,'hills'),(gid,4,3,'hills'),
  (gid,4,4,'hills'),(gid,4,5,'plains'),
  (gid,4,6,'desert'),(gid,4,7,'desert'),(gid,4,8,'desert'),(gid,4,9,'desert'),
  -- q=5
  (gid,5,0,'hills'),(gid,5,1,'hills'),(gid,5,2,'hills'),(gid,5,3,'hills'),
  (gid,5,4,'hills'),(gid,5,5,'plains'),(gid,5,6,'plains'),
  (gid,5,7,'desert'),(gid,5,8,'desert'),(gid,5,9,'desert'),
  -- q=6
  (gid,6,0,'mountains'),(gid,6,1,'mountains'),
  (gid,6,2,'hills'),(gid,6,3,'hills'),
  (gid,6,4,'plains'),(gid,6,5,'plains'),(gid,6,6,'plains'),
  (gid,6,7,'plains'),(gid,6,8,'plains'),(gid,6,9,'plains'),
  -- q=7
  (gid,7,0,'mountains'),(gid,7,1,'mountains'),
  (gid,7,2,'hills'),(gid,7,3,'hills'),
  (gid,7,4,'plains'),(gid,7,5,'plains'),(gid,7,6,'plains'),
  (gid,7,7,'plains'),(gid,7,8,'plains'),(gid,7,9,'plains'),
  -- q=8 (coast)
  (gid,8,0,'water'),(gid,8,1,'water'),(gid,8,2,'water'),(gid,8,3,'water'),
  (gid,8,4,'water'),(gid,8,5,'water'),(gid,8,6,'water'),
  (gid,8,7,'water'),(gid,8,8,'water'),(gid,8,9,'water'),
  -- q=9 (sea)
  (gid,9,0,'water'),(gid,9,1,'water'),(gid,9,2,'water'),(gid,9,3,'water'),
  (gid,9,4,'water'),(gid,9,5,'water'),(gid,9,6,'water'),
  (gid,9,7,'water'),(gid,9,8,'water'),(gid,9,9,'water');

  UPDATE hexes SET has_heavy_vegetation = TRUE WHERE game_id = gid
    AND (hex_q, hex_r) IN ((0,3),(0,4),(0,5));

  UPDATE hexes SET has_light_vegetation = TRUE WHERE game_id = gid
    AND (hex_q, hex_r) IN ((1,1),(1,2),(1,3),(1,4),(1,5),(2,2),(2,3),(2,4),(3,2),(3,3));

  UPDATE hexes SET has_settlement = TRUE, settlement_name = 'Northkeep', settlement_size = 10
    WHERE game_id = gid AND hex_q = 3 AND hex_r = 1;
  UPDATE hexes SET has_settlement = TRUE, settlement_name = 'Hillcrest', settlement_size = 12
    WHERE game_id = gid AND hex_q = 5 AND hex_r = 3;
  UPDATE hexes SET has_settlement = TRUE, settlement_name = 'Eastport',  settlement_size = 15
    WHERE game_id = gid AND hex_q = 7 AND hex_r = 4;

  UPDATE hexes SET has_railroad = TRUE WHERE game_id = gid
    AND (hex_q, hex_r) IN ((3,1),(4,1),(4,2),(5,2),(5,3),(6,3),(6,4),(7,4));

  INSERT INTO buildings (game_id, hex_q, hex_r, type, current_hp, max_hp) VALUES
    (gid, 3, 1, 'factory', 20, 20),
    (gid, 5, 3, 'factory', 20, 20),
    (gid, 7, 4, 'factory', 20, 20),
    (gid, 7, 4, 'harbor',  10, 10);
END $$;
