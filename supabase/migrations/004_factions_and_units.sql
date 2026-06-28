-- =============================================================
-- 004_factions_and_units.sql — Unit type config, factions, units,
--   buildings, resource tiles, faction relationships
-- =============================================================

-- unit_type_config is PER GAME. Each game seeds its own unit roster.
-- Move is stored in user-facing values; the engine multiplies by 3 internally.
-- Naval and bomber units use HP (not quantity stacks).
-- Fighters and ground units use quantity stacks.
CREATE TABLE unit_type_config (
  id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id          UUID     NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name             TEXT     NOT NULL,
  tags             TEXT[]   NOT NULL DEFAULT '{}',
  -- Direct fire (NULL = no direct fire capability)
  to_hit           SMALLINT,
  defense          SMALLINT NOT NULL DEFAULT 6,
  penetration      SMALLINT NOT NULL DEFAULT 0,
  atk_range        SMALLINT,                       -- NULL = no direct fire range
  -- Movement (user-facing; engine uses ×3 scale internally)
  move             SMALLINT NOT NULL DEFAULT 2,
  los              SMALLINT NOT NULL DEFAULT 3,
  -- Production cost
  mat_cost         SMALLINT NOT NULL DEFAULT 1,
  man_cost         SMALLINT NOT NULL DEFAULT 0,
  slots            SMALLINT NOT NULL DEFAULT 1,    -- production slot cost = ceil(mat_cost/2)
  -- Stealth / detection
  stealth_rating   SMALLINT NOT NULL DEFAULT 0,
  detection_rating SMALLINT NOT NULL DEFAULT 2,
  -- Naval / bomber only (NULL for ground / fighter)
  atk_dice         SMALLINT,                       -- attack dice per ship (naval only)
  hp               SMALLINT,                       -- NULL = quantity-based; set for naval and bombers
  sonar_range      SMALLINT,                       -- submarine / destroyer sonar (hard cap)
  carrier_slots    SMALLINT,                       -- carrier air capacity
  -- Overwatch AA fire (AA Gun, Frigate, Battleship — fires at aircraft passively in Phase 1)
  overwatch_to_hit SMALLINT,
  overwatch_pen    SMALLINT,
  overwatch_range  SMALLINT,
  -- Bombardment (Artillery, Battleship — indirect fire via Bombard order)
  bombard_range    SMALLINT,
  bombard_to_hit   SMALLINT,
  bombard_pen      SMALLINT,
  UNIQUE (game_id, name)
);

CREATE TABLE factions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID        NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  profile_id UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  color      TEXT        NOT NULL DEFAULT '#3b82f6',
  materials  INTEGER     NOT NULL DEFAULT 0 CHECK (materials >= 0),
  manpower   INTEGER     NOT NULL DEFAULT 0 CHECK (manpower >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, profile_id)
);

-- Wire faction FKs now that factions table exists.
ALTER TABLE hexes
  ADD CONSTRAINT hexes_owner_faction_id_fkey
  FOREIGN KEY (owner_faction_id) REFERENCES factions(id) ON DELETE SET NULL;

ALTER TABLE scouted_hexes
  ADD CONSTRAINT scouted_hexes_faction_id_fkey
  FOREIGN KEY (faction_id) REFERENCES factions(id) ON DELETE CASCADE;

-- Deferred from 003: needs factions table
CREATE POLICY "own faction reads scouted hexes"
  ON scouted_hexes FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM factions f WHERE f.id = scouted_hexes.faction_id AND f.profile_id = auth.uid())
    OR is_gm_in_game(game_id)
  );

CREATE POLICY "players read scouted hexes"
  ON hexes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM factions f
      WHERE f.game_id = hexes.game_id AND f.profile_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM scouted_hexes sh
          WHERE sh.faction_id = f.id
            AND sh.hex_q = hexes.hex_q
            AND sh.hex_r = hexes.hex_r
            AND sh.game_id = hexes.game_id
        )
    )
  );

-- Unit stacks. One row per (faction, unit_type, hex). Ground units auto-merge.
-- Naval units and bombers use hp; ground/fighter units use quantity.
-- Split stacks by assigning different movement orders.
CREATE TABLE units (
  id                  UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id             UUID     NOT NULL REFERENCES games(id)          ON DELETE CASCADE,
  faction_id          UUID     NOT NULL REFERENCES factions(id)       ON DELETE CASCADE,
  unit_type_id        UUID     NOT NULL REFERENCES unit_type_config(id),
  hex_q               SMALLINT NOT NULL,
  hex_r               SMALLINT NOT NULL,
  quantity            SMALLINT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  hp                  SMALLINT,                    -- NULL = quantity-based; used for naval/bombers
  standing_order      TEXT     NOT NULL DEFAULT 'hold_position'
                      CHECK (standing_order IN ('hold_position', 'patrol', 'hold_fire', 'fortify')),
  fortification_level SMALLINT NOT NULL DEFAULT 0 CHECK (fortification_level IN (0, 1)),
  UNIQUE (faction_id, unit_type_id, hex_q, hex_r)
);

-- Buildings with HP. Factory/Airbase/Harbor built by players (1 mat + 1 man per HP).
-- Airstrip/Bridge/Fortification built by Supply truck (truck consumed on completion).
-- Not operational until current_hp = max_hp.
-- Production slots = floor(current_hp / 2).
CREATE TABLE buildings (
  id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id          UUID     NOT NULL REFERENCES games(id)      ON DELETE CASCADE,
  hex_q            SMALLINT NOT NULL,
  hex_r            SMALLINT NOT NULL,
  type             TEXT     NOT NULL
                   CHECK (type IN ('factory', 'airbase', 'harbor', 'airstrip', 'bridge', 'fortification')),
  current_hp       SMALLINT NOT NULL DEFAULT 0 CHECK (current_hp >= 0),
  max_hp           SMALLINT NOT NULL,
  owner_faction_id UUID     REFERENCES factions(id) ON DELETE SET NULL,
  UNIQUE (game_id, hex_q, hex_r, type)
);

-- GM-placed resource tiles. Each produces 1 material/turn when controlled by a faction.
CREATE TABLE resource_tiles (
  id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id          UUID     NOT NULL REFERENCES games(id)      ON DELETE CASCADE,
  hex_q            SMALLINT NOT NULL,
  hex_r            SMALLINT NOT NULL,
  tile_type        TEXT     NOT NULL,  -- 'mine', 'lumbermill', 'quarry', 'farm', 'port', etc.
  owner_faction_id UUID     REFERENCES factions(id) ON DELETE SET NULL,
  UNIQUE (game_id, hex_q, hex_r)
);

-- Diplomatic relationships between factions (symmetric pairs; one row per ordered pair).
CREATE TABLE faction_relationships (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      UUID NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  faction_a_id UUID NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  faction_b_id UUID NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'neutral'
               CHECK (relationship IN ('war', 'allied', 'neutral')),
  UNIQUE (game_id, faction_a_id, faction_b_id)
);

-- RLS
ALTER TABLE unit_type_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE factions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE units                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE buildings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_tiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE faction_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "participants read unit types"
  ON unit_type_config FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM game_participants gp
    WHERE gp.game_id = unit_type_config.game_id AND gp.profile_id = auth.uid()
  ));

CREATE POLICY "gm writes unit types"
  ON unit_type_config FOR ALL
  USING (is_gm_in_game(game_id));

CREATE POLICY "participants read factions"
  ON factions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM game_participants gp
    WHERE gp.game_id = factions.game_id AND gp.profile_id = auth.uid()
  ));

CREATE POLICY "own faction or gm writes faction"
  ON factions FOR ALL
  USING (profile_id = auth.uid() OR is_gm_in_game(game_id));

CREATE POLICY "gm reads all units"
  ON units FOR SELECT
  USING (is_gm_in_game(game_id));

CREATE POLICY "own units always visible"
  ON units FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM factions f WHERE f.id = units.faction_id AND f.profile_id = auth.uid()
  ));

CREATE POLICY "gm writes units"
  ON units FOR ALL
  USING (is_gm_in_game(game_id));

CREATE POLICY "participants read buildings"
  ON buildings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM game_participants gp
    WHERE gp.game_id = buildings.game_id AND gp.profile_id = auth.uid()
  ));

CREATE POLICY "gm manages buildings"
  ON buildings FOR ALL
  USING (is_gm_in_game(game_id));

CREATE POLICY "participants read resource tiles"
  ON resource_tiles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM game_participants gp
    WHERE gp.game_id = resource_tiles.game_id AND gp.profile_id = auth.uid()
  ));

CREATE POLICY "gm manages resource tiles"
  ON resource_tiles FOR ALL
  USING (is_gm_in_game(game_id));

CREATE POLICY "participants read relationships"
  ON faction_relationships FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM game_participants gp
    WHERE gp.game_id = faction_relationships.game_id AND gp.profile_id = auth.uid()
  ));

CREATE POLICY "gm writes relationships"
  ON faction_relationships FOR ALL
  USING (is_gm_in_game(game_id));
