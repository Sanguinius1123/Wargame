-- =============================================================
-- 016_france_1940_map.sql
-- 40×40 WWII France theater map
--
-- Grid orientation (even-q flat-top offset):
--   q=0 (west/Atlantic) → q=39 (east/Rhine border)
--   r=0 (north/Channel) → r=39 (south/Mediterranean)
--   Scale: ~25 km per hex
--
-- Geography:
--   Pyrenees block SW (Spain off-map)
--   Alps block SE (Italy off-map)
--   Vosges ridge (eastern) with Saverne Gap chokepoint
--   Rivers: Seine (r=6, north), Loire (r=21, central),
--            Rhône/Saône (south through Lyon), Rhine (q=38-39)
--   10 settlements: Paris, Lille, Reims, Strasbourg, Dijon,
--                   Lyon, Tours, Nantes, Bordeaux, Marseille
-- =============================================================

DO $$
DECLARE
  mid UUID := '10000000-0000-0000-0000-000000000016';
BEGIN

  INSERT INTO maps (id, name, description) VALUES (
    mid,
    'France 1940',
    '40×40 hex WWII France theater. Pyrenees block SW, Alps block SE, Vosges ridge in east with Saverne Gap. Rivers: Seine (north), Loire (central spine), Rhône/Saône (south through Lyon), Rhine (eastern border). Ten settlements for two-faction play.'
  ) ON CONFLICT (id) DO NOTHING;

  -- Seed all 1600 hexes as plains
  INSERT INTO map_hexes (map_id, hex_q, hex_r, terrain)
  SELECT mid, q, r, 'plains'
  FROM generate_series(0,39) q, generate_series(0,39) r
  ON CONFLICT (map_id, hex_q, hex_r) DO NOTHING;

  -- ===========================================================
  -- WATER: Ocean / Sea borders
  -- ===========================================================

  -- Atlantic Ocean (west columns)
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid AND hex_q <= 1;

  -- English Channel (north coast)
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid
    AND hex_r = 0 AND hex_q BETWEEN 2 AND 27;
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid
    AND hex_r = 1 AND hex_q BETWEEN 4 AND 22;

  -- Bay of Biscay (SW coast toward Spain)
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid
    AND hex_q BETWEEN 2 AND 6 AND hex_r BETWEEN 34 AND 39;
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid
    AND hex_q = 7 AND hex_r >= 37;
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid
    AND hex_q = 2 AND hex_r BETWEEN 30 AND 34;

  -- Mediterranean (south coast)
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid
    AND hex_r >= 39 AND hex_q BETWEEN 15 AND 39;
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid
    AND hex_r >= 38 AND hex_q BETWEEN 20 AND 39;
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid
    AND hex_r >= 37 AND hex_q BETWEEN 26 AND 39;

  -- ===========================================================
  -- WATER: Rivers
  -- ===========================================================

  -- SEINE: east-west at r=6, then NW to Channel (Rouen area)
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid
    AND hex_r = 6 AND hex_q BETWEEN 13 AND 34;
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid AND (hex_q, hex_r) IN (
    (12,5),(11,5),(10,4),(9,4),(8,3),(7,3),(6,2),(5,2)
  );

  -- LOIRE: east-west at r=21
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid
    AND hex_r = 21 AND hex_q BETWEEN 4 AND 34;

  -- RHÔNE/SAÔNE: south from r=17 area through Lyon (27,26) to Mediterranean
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid AND (hex_q, hex_r) IN (
    (32,17),(32,18),(31,18),(31,19),(30,19),(30,20),(29,20),(29,21),
    (28,22),(28,23),(28,24),(28,25),(28,26),(28,27),(28,28),
    (28,29),(28,30),(28,31),(28,32),(28,33),(28,34),(28,35),(27,36),(27,37)
  );

  -- RHINE: eastern border river
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid
    AND hex_q = 38 AND hex_r BETWEEN 5 AND 25;
  UPDATE map_hexes SET terrain='water' WHERE map_id=mid
    AND hex_q = 39 AND hex_r BETWEEN 3 AND 27;

  -- ===========================================================
  -- MOUNTAINS (impassable for mechanized without road)
  -- ===========================================================

  -- PYRENEES (SW border, blocks Spain)
  UPDATE map_hexes SET terrain='mountains' WHERE map_id=mid
    AND hex_r BETWEEN 34 AND 38 AND hex_q BETWEEN 7 AND 21
    AND terrain='plains';

  -- ALPS (SE border, blocks Italy)
  UPDATE map_hexes SET terrain='mountains' WHERE map_id=mid
    AND hex_q BETWEEN 33 AND 37 AND hex_r BETWEEN 24 AND 36
    AND terrain='plains';
  UPDATE map_hexes SET terrain='mountains' WHERE map_id=mid
    AND hex_q BETWEEN 30 AND 32 AND hex_r BETWEEN 28 AND 35
    AND terrain='plains';

  -- VOSGES: northern block (above Saverne Gap at r=12-13)
  -- Narrowed to q=36-37 to leave Alsace plain at q=34-35
  UPDATE map_hexes SET terrain='mountains' WHERE map_id=mid
    AND hex_q BETWEEN 36 AND 37 AND hex_r BETWEEN 8 AND 11
    AND terrain='plains';
  -- VOSGES: southern block (below Saverne Gap)
  UPDATE map_hexes SET terrain='mountains' WHERE map_id=mid
    AND hex_q BETWEEN 36 AND 37 AND hex_r BETWEEN 14 AND 22
    AND terrain='plains';

  -- ===========================================================
  -- HILLS
  -- ===========================================================

  -- SAVERNE GAP (low pass through northern Vosges — critical chokepoint)
  UPDATE map_hexes SET terrain='hills' WHERE map_id=mid
    AND hex_q BETWEEN 36 AND 37 AND hex_r BETWEEN 12 AND 13
    AND terrain='plains';

  -- VOSGES FOOTHILLS (west face + Alsace corridor q=31-35)
  UPDATE map_hexes SET terrain='hills' WHERE map_id=mid
    AND hex_q BETWEEN 31 AND 35 AND hex_r BETWEEN 9 AND 22
    AND terrain='plains';

  -- ARDENNES (NE hills, "impassable" in 1940 — wrong, but it was believed)
  UPDATE map_hexes SET terrain='hills' WHERE map_id=mid
    AND hex_q BETWEEN 24 AND 33 AND hex_r BETWEEN 2 AND 7
    AND terrain='plains';

  -- MASSIF CENTRAL (large central highland plateau)
  UPDATE map_hexes SET terrain='hills' WHERE map_id=mid
    AND hex_q BETWEEN 16 AND 26 AND hex_r BETWEEN 24 AND 33
    AND terrain='plains';

  -- ARMORICAN MASSIF (Brittany upland — ancient granite hills)
  UPDATE map_hexes SET terrain='hills' WHERE map_id=mid
    AND hex_q BETWEEN 4 AND 13 AND hex_r BETWEEN 9 AND 18
    AND terrain='plains';

  -- JURA (between Vosges foothills and Alps — Belfort Gap at south end)
  UPDATE map_hexes SET terrain='hills' WHERE map_id=mid
    AND hex_q BETWEEN 30 AND 33 AND hex_r BETWEEN 22 AND 27
    AND terrain='plains';

  -- PYRENEES FOOTHILLS (north transition zone)
  UPDATE map_hexes SET terrain='hills' WHERE map_id=mid
    AND hex_r BETWEEN 30 AND 33 AND hex_q BETWEEN 8 AND 20
    AND terrain='plains';

  -- PROVENCE HILLS (between Massif Central and Mediterranean)
  UPDATE map_hexes SET terrain='hills' WHERE map_id=mid
    AND hex_q BETWEEN 21 AND 29 AND hex_r BETWEEN 34 AND 36
    AND terrain='plains';

  -- ===========================================================
  -- VEGETATION
  -- ===========================================================

  -- NORMANDY BOCAGE (NW France hedgerow country)
  UPDATE map_hexes SET has_light_vegetation=true WHERE map_id=mid
    AND hex_q BETWEEN 5 AND 15 AND hex_r BETWEEN 3 AND 10
    AND terrain='plains';

  -- ARDENNES FOREST (heavy forest — the hills that famously "couldn't be crossed")
  UPDATE map_hexes SET has_heavy_vegetation=true WHERE map_id=mid
    AND hex_q BETWEEN 24 AND 33 AND hex_r BETWEEN 2 AND 7
    AND terrain='hills';

  -- LANDES (vast SW coastal pine forest — flat but dense)
  UPDATE map_hexes SET has_heavy_vegetation=true WHERE map_id=mid
    AND hex_q BETWEEN 5 AND 10 AND hex_r BETWEEN 24 AND 32
    AND terrain='plains';

  -- LOIRE VALLEY WOODS (light forest between central settlements)
  UPDATE map_hexes SET has_light_vegetation=true WHERE map_id=mid
    AND hex_q BETWEEN 12 AND 21 AND hex_r BETWEEN 17 AND 22
    AND terrain='plains';

  -- ===========================================================
  -- SETTLEMENTS + URBAN TILES
  -- settlement hex = the city center (counts toward win condition)
  -- surrounding has_urban tiles = manpower + control threshold tiles
  -- Control = faction holds ≥ 3/4 of assigned urban tiles
  -- ===========================================================

  -- PARIS — capital, Seine crossing hub
  UPDATE map_hexes SET has_settlement=true, settlement_name='Paris', has_urban=true
    WHERE map_id=mid AND hex_q=21 AND hex_r=9;
  UPDATE map_hexes SET has_urban=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (20,9),(22,9),(21,8),(21,10),(20,10)
  );

  -- LILLE — northern gateway, Belgian border
  UPDATE map_hexes SET has_settlement=true, settlement_name='Lille', has_urban=true
    WHERE map_id=mid AND hex_q=23 AND hex_r=2;
  UPDATE map_hexes SET has_urban=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (22,2),(24,2),(23,3),(22,3)
  );

  -- REIMS — Champagne gateway, south of Ardennes
  UPDATE map_hexes SET has_settlement=true, settlement_name='Reims', has_urban=true
    WHERE map_id=mid AND hex_q=26 AND hex_r=9;
  UPDATE map_hexes SET has_urban=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (25,9),(27,9),(26,8),(26,10)
  );

  -- STRASBOURG — Alsace, Rhine bridgehead, Saverne Gap anchor
  UPDATE map_hexes SET has_settlement=true, settlement_name='Strasbourg', has_urban=true
    WHERE map_id=mid AND hex_q=35 AND hex_r=13;
  UPDATE map_hexes SET has_urban=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (34,13),(36,13),(35,12),(35,14)
  );

  -- DIJON — Burgundy crossroads, gateway between north and south
  UPDATE map_hexes SET has_settlement=true, settlement_name='Dijon', has_urban=true
    WHERE map_id=mid AND hex_q=29 AND hex_r=17;
  UPDATE map_hexes SET has_urban=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (28,17),(30,17),(29,16),(29,18)
  );

  -- LYON — major southern hub, Rhône/Saône confluence
  UPDATE map_hexes SET has_settlement=true, settlement_name='Lyon', has_urban=true
    WHERE map_id=mid AND hex_q=27 AND hex_r=26;
  UPDATE map_hexes SET has_urban=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (26,26),(27,25),(27,27),(26,27)
  );

  -- TOURS — Loire Valley bridgehead, central France
  UPDATE map_hexes SET has_settlement=true, settlement_name='Tours', has_urban=true
    WHERE map_id=mid AND hex_q=18 AND hex_r=20;
  UPDATE map_hexes SET has_urban=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (17,20),(19,20),(18,19),(17,19)
  );

  -- NANTES — Loire estuary, Atlantic port
  UPDATE map_hexes SET has_settlement=true, settlement_name='Nantes', has_urban=true
    WHERE map_id=mid AND hex_q=7 AND hex_r=18;
  UPDATE map_hexes SET has_urban=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (6,18),(8,18),(7,17),(7,19)
  );

  -- BORDEAUX — Gironde, major western port
  UPDATE map_hexes SET has_settlement=true, settlement_name='Bordeaux', has_urban=true
    WHERE map_id=mid AND hex_q=9 AND hex_r=28;
  UPDATE map_hexes SET has_urban=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (8,28),(10,28),(9,27),(9,29)
  );

  -- MARSEILLE — Mediterranean port, southern anchor
  UPDATE map_hexes SET has_settlement=true, settlement_name='Marseille', has_urban=true
    WHERE map_id=mid AND hex_q=30 AND hex_r=35;
  UPDATE map_hexes SET has_urban=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (29,35),(31,35),(30,34),(30,36)
  );

  -- ===========================================================
  -- ROADS
  -- Bridges placed where roads cross river hexes (terrain='water')
  -- ===========================================================

  -- PARIS (21,9) → LILLE (23,2) — Route du Nord / N1
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (21,9),(21,8),(21,7),(22,7),(22,6),(22,5),(22,4),(22,3),(23,3),(23,2)
  );
  UPDATE map_hexes SET has_bridge=true WHERE map_id=mid AND hex_q=22 AND hex_r=6;

  -- PARIS (21,9) → REIMS (26,9) — N3, east through Champagne
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (21,9),(22,9),(23,9),(24,9),(25,9),(26,9)
  );

  -- REIMS (26,9) → LILLE (23,2) — via Flanders
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (26,9),(26,8),(25,8),(25,7),(25,6),(24,6),(24,5),(24,4),(24,3),(23,3),(23,2)
  );
  UPDATE map_hexes SET has_bridge=true WHERE map_id=mid AND hex_q=25 AND hex_r=6;

  -- REIMS (26,9) → STRASBOURG (35,13) — via Lorraine, through Saverne Gap
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (26,9),(27,9),(28,9),(28,10),(29,10),(29,11),(30,11),(30,12),(31,12),
    (32,12),(33,12),(33,13),(34,13),(35,13)
  );

  -- PARIS (21,9) → DIJON (29,17) — Route de Bourgogne / N6
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (21,9),(22,9),(22,10),(23,10),(23,11),(24,11),(24,12),(25,12),(25,13),
    (26,13),(26,14),(27,14),(27,15),(28,15),(28,16),(29,16),(29,17)
  );

  -- STRASBOURG (35,13) → DIJON (29,17) — via Lorraine corridor west of Saône
  -- Routes west through foothills then south, avoiding Saône river crossings
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (35,13),(34,13),(33,13),(32,13),(31,13),(31,14),(31,15),(31,16),
    (30,16),(30,17),(29,17)
  );

  -- DIJON (29,17) → LYON (27,26) — N6, Rhône-Saône corridor
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (29,17),(29,18),(29,19),(29,20),(28,20),(27,20),(27,21),(27,22),
    (27,23),(27,24),(27,25),(27,26)
  );
  -- Bridge where Dijon→Lyon road crosses Loire (r=21)
  UPDATE map_hexes SET has_bridge=true WHERE map_id=mid AND hex_q=27 AND hex_r=21;

  -- LYON (27,26) → MARSEILLE (30,35) — N7, Rhône valley then cross to coast
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (27,26),(27,27),(27,28),(27,29),(27,30),(27,31),(27,32),(27,33),
    (27,34),(28,34),(29,34),(29,35),(30,35)
  );
  -- Bridge crossing Rhône near Avignon
  UPDATE map_hexes SET has_bridge=true WHERE map_id=mid AND hex_q=28 AND hex_r=34;

  -- PARIS (21,9) → TOURS (18,20) — N10/N20 south
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (21,9),(20,9),(20,10),(19,10),(19,11),(19,12),(19,13),(19,14),
    (18,14),(18,15),(18,16),(18,17),(18,18),(18,19),(18,20)
  );

  -- TOURS (18,20) → NANTES (7,18) — N23, west along Loire north bank
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (18,20),(17,20),(16,20),(15,20),(14,20),(13,20),(12,20),(11,20),
    (10,20),(9,20),(8,20),(8,19),(7,19),(7,18)
  );

  -- TOURS (18,20) → BORDEAUX (9,28) — N10 south via Poitiers
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (18,20),(18,21),(17,21),(16,21),(16,22),(15,22),(15,23),(14,23),
    (13,23),(12,24),(11,24),(11,25),(10,25),(10,26),(10,27),(10,28),(9,28)
  );
  -- Bridge where Tours→Bordeaux crosses Loire (r=21)
  UPDATE map_hexes SET has_bridge=true WHERE map_id=mid AND hex_q=18 AND hex_r=21;

  -- NANTES (7,18) → BORDEAUX (9,28) — Atlantic coast road
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (7,18),(7,19),(7,20),(7,21),(7,22),(7,23),(8,23),(8,24),(8,25),
    (8,26),(8,27),(9,27),(9,28)
  );
  -- Bridge where coast road crosses Loire estuary (r=21)
  UPDATE map_hexes SET has_bridge=true WHERE map_id=mid AND hex_q=7 AND hex_r=21;

  -- BORDEAUX (9,28) → MARSEILLE (30,35) — N113, southern route via Languedoc
  UPDATE map_hexes SET has_road=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (9,28),(10,28),(11,28),(12,28),(13,28),(13,29),(14,29),(15,29),
    (16,29),(17,29),(18,29),(18,30),(19,30),(20,30),(21,30),(22,30),
    (23,31),(24,31),(25,32),(26,32),(27,33),(28,33),(29,33),(29,34),(30,34),(30,35)
  );
  -- Bridge where southern road crosses Rhône at (28,33)
  UPDATE map_hexes SET has_bridge=true WHERE map_id=mid AND hex_q=28 AND hex_r=33;

  -- STRASBOURG RHINE BRIDGE — historic crossing into Germany
  UPDATE map_hexes SET has_road=true, has_bridge=true WHERE map_id=mid AND (hex_q,hex_r) IN (
    (36,13),(37,13),(38,13)
  );

  -- ===========================================================
  -- FORCE SETTLEMENT HEXES TO PLAINS
  -- Override any terrain that bulk-updates applied to city hexes
  -- ===========================================================
  UPDATE map_hexes SET terrain='plains' WHERE map_id=mid AND (hex_q,hex_r) IN (
    (21,9),  -- Paris
    (23,2),  -- Lille
    (26,9),  -- Reims
    (35,13), -- Strasbourg
    (29,17), -- Dijon
    (27,26), -- Lyon
    (18,20), -- Tours
    (7,18),  -- Nantes
    (9,28),  -- Bordeaux
    (30,35)  -- Marseille
  );

END $$;
