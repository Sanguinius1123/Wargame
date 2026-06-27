-- =============================================================
-- 006_seed.sql — Dev game + default unit roster + 20×20 hex map
-- Safe to re-run (ON CONFLICT DO NOTHING / ON CONFLICT DO NOTHING).
-- =============================================================

-- Dev game with fixed UUID for easy referencing during development.
INSERT INTO games (id, name, map_width, map_height)
VALUES ('00000000-0000-0000-0000-000000000001', 'Dev Game', 20, 20)
ON CONFLICT DO NOTHING;

-- =============================================================
-- Default unit roster for the dev game.
-- Column order matches unit_type_config definition:
--   game_id, name, tags,
--   to_hit, defense, penetration, atk_range,
--   move, los,
--   mat_cost, man_cost, slots,
--   stealth_rating, detection_rating,
--   atk_dice, hp, sonar_range, carrier_slots,
--   overwatch_to_hit, overwatch_pen, overwatch_range,
--   bombard_range, bombard_to_hit, bombard_pen
-- =============================================================
INSERT INTO unit_type_config (
  game_id, name, tags,
  to_hit, defense, penetration, atk_range,
  move, los,
  mat_cost, man_cost, slots,
  stealth_rating, detection_rating,
  atk_dice, hp, sonar_range, carrier_slots,
  overwatch_to_hit, overwatch_pen, overwatch_range,
  bombard_range, bombard_to_hit, bombard_pen
) VALUES

-- ── Ground units ──────────────────────────────────────────────
-- Infantry: basic foot soldier. Quantity stack.
(
  '00000000-0000-0000-0000-000000000001', 'Infantry',
  ARRAY['ground'],
  6, 6, 0, 1,
  2, 3,
  1, 0, 1,
  0, 2,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),
-- Armor: fast, armored, mechanized. Quantity stack.
(
  '00000000-0000-0000-0000-000000000001', 'Armor',
  ARRAY['ground', 'mobile', 'armored', 'mechanized'],
  7, 8, 2, 2,
  4, 3,
  4, 2, 2,
  0, 2,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),
-- Artillery: bombard-only. No direct fire (to_hit NULL, atk_range NULL).
-- Auto-destroyed if left alone vs enemies in close combat.
(
  '00000000-0000-0000-0000-000000000001', 'Artillery',
  ARRAY['ground', 'heavy'],
  NULL, 5, 1, NULL,
  2, 3,
  2, 1, 1,
  0, 2,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  8, 6, 1
),
-- AT Gun: direct-fire anti-armor. Patrol-eligible.
(
  '00000000-0000-0000-0000-000000000001', 'AT Gun',
  ARRAY['ground', 'heavy'],
  7, 6, 2, 2,
  2, 3,
  2, 1, 1,
  0, 2,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),
-- AA Gun: overwatch fires at aircraft in Phase 1. Passive; no order required.
(
  '00000000-0000-0000-0000-000000000001', 'AA Gun',
  ARRAY['ground', 'air', 'heavy'],
  5, 5, 1, 1,
  2, 3,
  2, 1, 1,
  0, 4,
  NULL, NULL, NULL, NULL,
  7, 0, 2,
  NULL, NULL, NULL
),
-- Supply: builds roads/airstrips/bridges/fortifications. Move OR build per turn. Mechanized.
(
  '00000000-0000-0000-0000-000000000001', 'Supply',
  ARRAY['ground', 'mobile', 'mechanized'],
  NULL, 3, 0, NULL,
  4, 3,
  2, 1, 1,
  0, 1,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),
-- Recon: stealthy scout with extended LOS and detection rating.
(
  '00000000-0000-0000-0000-000000000001', 'Recon',
  ARRAY['ground', 'stealth'],
  7, 6, 0, 2,
  3, 4,
  2, 1, 1,
  3, 3,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- ── Air units (move = air movement hexes; not subject to terrain costs) ──
-- Fighter: quantity stack; intercepts and sweeps.
(
  '00000000-0000-0000-0000-000000000001', 'Fighter',
  ARRAY['air'],
  7, 7, 0, 1,
  30, 5,
  4, 2, 2,
  0, 3,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),
-- Scout Plane: stealthy recon; extends faction LOS. Reports on return home.
(
  '00000000-0000-0000-0000-000000000001', 'Scout Plane',
  ARRAY['air', 'mobile', 'stealth'],
  NULL, 6, 0, NULL,
  35, 6,
  3, 1, 2,
  4, 4,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),
-- Bomber: HP-based (3 HP per bomber; quantity = ceil(hp/3)).
-- Bombing Run: To-Hit 7, Pen 1, 1 die per bomber per hex (flight group special).
-- Air-to-air (intercept): To-Hit 5, Pen 0, fires ceil(hp/3) dice.
(
  '00000000-0000-0000-0000-000000000001', 'Bomber',
  ARRAY['air', 'heavy'],
  5, 6, 0, 1,
  40, 5,
  5, 2, 3,
  0, 2,
  NULL, 3, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),
-- Transport Plane: carries ground units; no attack capability.
(
  '00000000-0000-0000-0000-000000000001', 'Transport Plane',
  ARRAY['air', 'ground'],
  NULL, 3, 0, NULL,
  25, 3,
  3, 1, 2,
  0, 1,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- ── Naval units (HP-based; atk_dice = attack dice per ship) ──
-- Destroyer: fast ASW platform; sonar range 3.
(
  '00000000-0000-0000-0000-000000000001', 'Destroyer',
  ARRAY['naval', 'mobile'],
  6, 6, 1, 1,
  5, 4,
  3, 1, 2,
  0, 6,
  1, 6, 3, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),
-- Frigate: AA overwatch platform.
(
  '00000000-0000-0000-0000-000000000001', 'Frigate',
  ARRAY['naval', 'air'],
  6, 7, 0, 1,
  4, 5,
  4, 2, 2,
  0, 5,
  1, 7, NULL, NULL,
  7, 1, 3,
  NULL, NULL, NULL
),
-- Cruiser: heavy surface combatant.
(
  '00000000-0000-0000-0000-000000000001', 'Cruiser',
  ARRAY['naval'],
  7, 7, 1, 2,
  3, 4,
  4, 2, 2,
  0, 4,
  2, 8, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),
-- Battleship: hardest-hitting naval unit. Bombards land/water (3-hex triangle).
-- Overwatch AA: point defense only (Range 1).
(
  '00000000-0000-0000-0000-000000000001', 'Battleship',
  ARRAY['naval', 'armored', 'heavy'],
  7, 9, 2, 3,
  4, 4,
  6, 3, 3,
  0, 3,
  3, 12, NULL, NULL,
  6, 0, 1,
  8, 6, 2
),
-- Transport Ship: carries ground units; no attack capability.
(
  '00000000-0000-0000-0000-000000000001', 'Transport Ship',
  ARRAY['naval', 'ground'],
  NULL, 4, 0, NULL,
  4, 4,
  2, 1, 1,
  0, 2,
  0, 5, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),
-- Carrier: floating airbase; carries up to 4 air units.
(
  '00000000-0000-0000-0000-000000000001', 'Carrier',
  ARRAY['naval', 'air'],
  6, 6, 0, 1,
  3, 5,
  5, 2, 3,
  0, 5,
  1, 10, NULL, 4,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),
-- Submarine: stealthy; undetected attack; sonar range 4.
(
  '00000000-0000-0000-0000-000000000001', 'Submarine',
  ARRAY['naval', 'stealth'],
  6, 7, 2, 1,
  4, 0,
  4, 2, 2,
  6, 5,
  2, 6, 4, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
);

-- =============================================================
-- Dev map: 20×20 hex grid (axial coordinates q, r).
-- Start with all plains, then overwrite zones with other terrain.
-- =============================================================

-- Base layer: all plains
INSERT INTO hexes (game_id, hex_q, hex_r, terrain)
SELECT '00000000-0000-0000-0000-000000000001', q, r, 'plains'
FROM generate_series(0, 19) AS q, generate_series(0, 19) AS r
ON CONFLICT DO NOTHING;

-- Water: left coast strip (naval access from the west)
UPDATE hexes
SET terrain = 'water'
WHERE game_id = '00000000-0000-0000-0000-000000000001'
  AND hex_q IN (0, 1) AND hex_r BETWEEN 5 AND 19;

-- Hills zone: central-left
UPDATE hexes
SET terrain = 'hills'
WHERE game_id = '00000000-0000-0000-0000-000000000001'
  AND hex_q BETWEEN 6 AND 9 AND hex_r BETWEEN 3 AND 8;

-- Mountains: central spine
UPDATE hexes
SET terrain = 'mountains'
WHERE game_id = '00000000-0000-0000-0000-000000000001'
  AND hex_q BETWEEN 10 AND 13 AND hex_r BETWEEN 5 AND 12;

-- Desert: southeast quadrant
UPDATE hexes
SET terrain = 'desert'
WHERE game_id = '00000000-0000-0000-0000-000000000001'
  AND hex_q BETWEEN 15 AND 19 AND hex_r BETWEEN 8 AND 19;

-- Wetlands: left-center
UPDATE hexes
SET terrain = 'wetlands'
WHERE game_id = '00000000-0000-0000-0000-000000000001'
  AND hex_q BETWEEN 3 AND 5 AND hex_r BETWEEN 10 AND 15;

-- =============================================================
-- Settlements and urban tiles.
-- Settlement hex: has_settlement=TRUE, has_urban=TRUE.
-- Surrounding 3×3 tiles (excluding settlement hex): has_urban=TRUE.
-- Settlement 1: northwest corner (q=4, r=3)
-- Settlement 2: northeast area (q=15, r=3)
-- =============================================================

-- Settlement 1 hex
UPDATE hexes
SET has_settlement = TRUE, has_urban = TRUE
WHERE game_id = '00000000-0000-0000-0000-000000000001'
  AND hex_q = 4 AND hex_r = 3;

-- Settlement 1 surrounding urban tiles
UPDATE hexes
SET has_urban = TRUE
WHERE game_id = '00000000-0000-0000-0000-000000000001'
  AND hex_q IN (3, 4, 5) AND hex_r IN (2, 3, 4)
  AND NOT (hex_q = 4 AND hex_r = 3);

-- Settlement 2 hex
UPDATE hexes
SET has_settlement = TRUE, has_urban = TRUE
WHERE game_id = '00000000-0000-0000-0000-000000000001'
  AND hex_q = 15 AND hex_r = 3;

-- Settlement 2 surrounding urban tiles
UPDATE hexes
SET has_urban = TRUE
WHERE game_id = '00000000-0000-0000-0000-000000000001'
  AND hex_q IN (14, 15, 16) AND hex_r IN (2, 3, 4)
  AND NOT (hex_q = 15 AND hex_r = 3);
