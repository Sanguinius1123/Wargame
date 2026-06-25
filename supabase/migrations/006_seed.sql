-- =============================================================
-- 006_seed.sql — Dev map seed (small 10×10 test map)
-- Safe to re-run (ON CONFLICT DO NOTHING).
-- =============================================================

-- Dev game
INSERT INTO games (id, name, map_width, map_height)
VALUES ('00000000-0000-0000-0000-000000000001', 'Dev Game', 10, 10)
ON CONFLICT DO NOTHING;

-- Small 10×10 hex map with mixed terrain
-- Row r=0: plains strip (top)
INSERT INTO hexes (game_id, hex_q, hex_r, terrain, development)
SELECT '00000000-0000-0000-0000-000000000001', q, 0, 'plains', 0
FROM generate_series(0, 9) AS q
ON CONFLICT DO NOTHING;

-- Row r=1: mixed coast + plains
INSERT INTO hexes (game_id, hex_q, hex_r, terrain, development)
VALUES
  ('00000000-0000-0000-0000-000000000001', 0, 1, 'coast', 0),
  ('00000000-0000-0000-0000-000000000001', 1, 1, 'coast', 0),
  ('00000000-0000-0000-0000-000000000001', 2, 1, 'plains', 0),
  ('00000000-0000-0000-0000-000000000001', 3, 1, 'plains', 0),
  ('00000000-0000-0000-0000-000000000001', 4, 1, 'urban', 2),
  ('00000000-0000-0000-0000-000000000001', 5, 1, 'plains', 0),
  ('00000000-0000-0000-0000-000000000001', 6, 1, 'plains', 0),
  ('00000000-0000-0000-0000-000000000001', 7, 1, 'forest', 0),
  ('00000000-0000-0000-0000-000000000001', 8, 1, 'forest', 0),
  ('00000000-0000-0000-0000-000000000001', 9, 1, 'plains', 0)
ON CONFLICT DO NOTHING;

-- Row r=2
INSERT INTO hexes (game_id, hex_q, hex_r, terrain, development)
VALUES
  ('00000000-0000-0000-0000-000000000001', 0, 2, 'sea', 0),
  ('00000000-0000-0000-0000-000000000001', 1, 2, 'coast', 0),
  ('00000000-0000-0000-0000-000000000001', 2, 2, 'plains', 0),
  ('00000000-0000-0000-0000-000000000001', 3, 2, 'forest', 0),
  ('00000000-0000-0000-0000-000000000001', 4, 2, 'forest', 0),
  ('00000000-0000-0000-0000-000000000001', 5, 2, 'plains', 0),
  ('00000000-0000-0000-0000-000000000001', 6, 2, 'mountains', 0),
  ('00000000-0000-0000-0000-000000000001', 7, 2, 'mountains', 0),
  ('00000000-0000-0000-0000-000000000001', 8, 2, 'forest', 0),
  ('00000000-0000-0000-0000-000000000001', 9, 2, 'plains', 0)
ON CONFLICT DO NOTHING;

-- Rows r=3–7: plains middle band with some features
INSERT INTO hexes (game_id, hex_q, hex_r, terrain, development)
SELECT '00000000-0000-0000-0000-000000000001', q, r, 'plains', 0
FROM generate_series(0, 9) AS q, generate_series(3, 7) AS r
ON CONFLICT DO NOTHING;

-- Overwrite some middle hexes with interesting terrain
UPDATE hexes SET terrain = 'river'     WHERE game_id = '00000000-0000-0000-0000-000000000001' AND hex_q = 5 AND hex_r IN (3,4,5);
UPDATE hexes SET terrain = 'mountains' WHERE game_id = '00000000-0000-0000-0000-000000000001' AND hex_q = 2 AND hex_r IN (4,5);
UPDATE hexes SET terrain = 'urban', development = 1 WHERE game_id = '00000000-0000-0000-0000-000000000001' AND hex_q = 7 AND hex_r = 5;

-- Rows r=8–9: bottom strip
INSERT INTO hexes (game_id, hex_q, hex_r, terrain, development)
SELECT '00000000-0000-0000-0000-000000000001', q, r, 'plains', 0
FROM generate_series(0, 9) AS q, generate_series(8, 9) AS r
ON CONFLICT DO NOTHING;

UPDATE hexes SET terrain = 'urban', development = 2 WHERE game_id = '00000000-0000-0000-0000-000000000001' AND hex_q = 2 AND hex_r = 9;
UPDATE hexes SET terrain = 'urban', development = 2 WHERE game_id = '00000000-0000-0000-0000-000000000001' AND hex_q = 7 AND hex_r = 9;
