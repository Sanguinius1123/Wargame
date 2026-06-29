-- 012_more_forests.sql
-- Add more heavy vegetation (forest) patches to the dev map.

DO $$
DECLARE gid UUID := '00000000-0000-0000-0000-000000000001';
BEGIN

  -- North-center forest (west of the mountains cluster)
  UPDATE hexes SET has_heavy_vegetation = true
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    (6,2),(7,2),(8,2),(7,3),(8,3)
  );

  -- East-center forest (between mountains and river, mid-map)
  UPDATE hexes SET has_heavy_vegetation = true
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    (13,6),(14,6),(13,7),(14,7)
  );

  -- Mid-west patch (below West Veldran, wedged between river and road)
  UPDATE hexes SET has_heavy_vegetation = true
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    (3,11),(3,12),(4,11)
  );

  -- South forest (between East Veldran and Crestholm)
  UPDATE hexes SET has_heavy_vegetation = true
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    (13,13),(13,14),(14,13),(14,14)
  );

  -- Extend NE forest southward
  UPDATE hexes SET has_heavy_vegetation = true
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    (16,3),(17,2)
  );

  -- Extend SW forest
  UPDATE hexes SET has_heavy_vegetation = true
  WHERE game_id = gid AND (hex_q, hex_r) IN (
    (0,13),(0,14)
  );

END $$;
