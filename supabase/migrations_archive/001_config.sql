-- =============================================================
-- 001_config.sql — Terrain type config + GM helper function
-- All movement costs stored in ×3 scale (user value × 3) so that
-- the 2/3 road multiplier resolves to clean integers.
-- road_cost = terrain_cost × 2 in ×3 scale (= user value × 2)
-- NULL cost = impassable (without road where noted)
-- =============================================================

CREATE TABLE terrain_type_config (
  name           TEXT     PRIMARY KEY,
  elevation      SMALLINT NOT NULL DEFAULT 0,    -- 0=flat, 1=hills, 2=mountains
  combat_mod     SMALLINT NOT NULL DEFAULT 0,    -- attack bonus for units fighting FROM this terrain
  blocks_los     BOOLEAN  NOT NULL DEFAULT FALSE,
  foot_cost      SMALLINT,                       -- NULL = impassable to foot (never happens per design)
  mech_cost      SMALLINT,                       -- NULL = impassable to mechanized without road
  naval_cost     SMALLINT,                       -- NULL = impassable to naval
  foot_road_cost SMALLINT,                       -- road cost for foot; NULL = road doesn't help
  mech_road_cost SMALLINT                        -- road cost for mechanized; NULL = road doesn't help
);

-- All costs in ×3 scale. User-facing values: plains=1, hills=2, mountains=4, desert=2(mech=1), wetlands=2(mech=4), water=1(naval)
-- Road cost = terrain_cost × 2 in ×3 scale
INSERT INTO terrain_type_config
  (name,        elevation, combat_mod, blocks_los, foot_cost, mech_cost, naval_cost, foot_road_cost, mech_road_cost)
VALUES
  ('plains',    0,         0,          FALSE,      3,         3,         NULL,       2,              2),
  ('hills',     1,         1,          FALSE,      6,         6,         NULL,       4,              4),
  ('mountains', 2,         2,          TRUE,       12,        NULL,      NULL,       8,              8),
  ('desert',    0,         0,          FALSE,      6,         3,         NULL,       4,              2),
  ('wetlands',  0,         -1,         FALSE,      6,         12,        NULL,       4,              8),
  ('water',     0,         0,          FALSE,      NULL,      NULL,      3,          NULL,           NULL);

-- is_gm_in_game is defined in 002_auth.sql (after game_participants is created)
