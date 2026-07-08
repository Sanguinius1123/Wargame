-- =============================================================
-- 001_config.sql — Terrain type configuration
-- Direct movement cost scale (1 = 1 hex per move point).
-- mech_cost NULL = mechanized impassable. naval_cost NULL = no naval access.
-- =============================================================

CREATE TABLE terrain_type_config (
  name          TEXT     PRIMARY KEY,
  elevation     SMALLINT NOT NULL DEFAULT 0,    -- 0=flat, 1=hills, 2=mountains
  defense_bonus SMALLINT NOT NULL DEFAULT 0,    -- additive save bonus for defenders
  foot_cost     SMALLINT,                       -- movement cost for foot units
  mech_cost     SMALLINT,                       -- movement cost for mechanized (NULL = impassable)
  naval_cost    SMALLINT                        -- movement cost for naval (NULL = impassable)
);

INSERT INTO terrain_type_config (name, elevation, defense_bonus, foot_cost, mech_cost, naval_cost) VALUES
  ('plains',    0, 0,  1, 1,    NULL),
  ('hills',     1, 1,  1, 2,    NULL),
  ('mountains', 2, 2,  1, NULL, NULL),
  ('desert',    0, 0,  1, 1,    NULL),
  ('wetlands',  0, 1,  1, NULL, NULL),
  ('water',     0, 0,  NULL, NULL, 1);
