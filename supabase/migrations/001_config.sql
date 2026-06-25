-- =============================================================
-- 001_config.sql — Terrain and unit type config tables
-- All tunable values live here. Change a value = UPDATE row, not schema migration.
-- =============================================================

CREATE TABLE terrain_type_config (
  name         TEXT    PRIMARY KEY,
  move_cost    SMALLINT NOT NULL DEFAULT 1,  -- movement points to enter
  defense_bonus SMALLINT NOT NULL DEFAULT 0, -- added to defender strength
  blocks_los   BOOLEAN  NOT NULL DEFAULT FALSE,
  production   SMALLINT NOT NULL DEFAULT 0,  -- per hex per turn (× development)
  manpower     SMALLINT NOT NULL DEFAULT 0   -- per hex per turn (× development)
);

INSERT INTO terrain_type_config (name, move_cost, defense_bonus, blocks_los, production, manpower) VALUES
  ('plains',    1, 0, FALSE, 1, 1),
  ('forest',    2, 1, TRUE,  0, 0),
  ('mountains', 3, 2, TRUE,  0, 0),
  ('coast',     1, 0, FALSE, 1, 1),
  ('sea',       1, 0, FALSE, 0, 0),  -- naval units only
  ('urban',     1, 1, FALSE, 3, 2),
  ('river',     2, 0, FALSE, 0, 0);

CREATE TABLE unit_type_config (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT    NOT NULL UNIQUE,
  category        TEXT    NOT NULL CHECK (category IN ('ground', 'naval', 'air')),
  attack          SMALLINT NOT NULL DEFAULT 1,
  defense         SMALLINT NOT NULL DEFAULT 1,
  movement        SMALLINT NOT NULL DEFAULT 2,
  los_range       SMALLINT NOT NULL DEFAULT 2,
  attack_range    SMALLINT NOT NULL DEFAULT 1, -- 1 = adjacent only, 2 = artillery range
  production_cost SMALLINT NOT NULL DEFAULT 2,
  manpower_cost   SMALLINT NOT NULL DEFAULT 1,
  is_buildable    BOOLEAN  NOT NULL DEFAULT TRUE,
  is_stub         BOOLEAN  NOT NULL DEFAULT FALSE -- TRUE = air units, not yet implemented
);

INSERT INTO unit_type_config (name, category, attack, defense, movement, los_range, attack_range, production_cost, manpower_cost) VALUES
  ('Infantry',   'ground', 2, 2, 2, 2, 1, 1, 2),
  ('Armor',      'ground', 4, 2, 4, 3, 1, 3, 1),
  ('Artillery',  'ground', 5, 1, 2, 2, 2, 4, 1),
  ('Supply',     'ground', 0, 0, 3, 2, 1, 2, 1),
  ('Destroyer',  'naval',  3, 2, 5, 4, 1, 3, 1),
  ('Battleship', 'naval',  6, 4, 3, 4, 1, 6, 2),
  ('Transport',  'naval',  0, 1, 4, 3, 1, 2, 1);

-- Air stubs — not yet implemented
INSERT INTO unit_type_config (name, category, attack, defense, movement, los_range, attack_range, production_cost, manpower_cost, is_stub) VALUES
  ('Fighter', 'air', 3, 2, 8, 6, 1, 4, 1, TRUE),
  ('Bomber',  'air', 6, 1, 7, 4, 1, 5, 1, TRUE);
