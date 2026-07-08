-- =============================================================
-- 004_factions_units.sql — Unit type config, factions, units,
--   buildings, resource tiles, faction relationships
-- =============================================================

-- Per-game unit roster (copied from unit_type_templates on game creation).
CREATE TABLE unit_type_config (
  id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id          UUID     NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name             TEXT     NOT NULL,
  tags             TEXT[]   NOT NULL DEFAULT '{}',
  to_hit           SMALLINT,                       -- NULL = no direct fire
  defense          SMALLINT NOT NULL DEFAULT 6,
  penetration      SMALLINT NOT NULL DEFAULT 0,
  atk_range        SMALLINT,                       -- NULL = no direct fire range
  move             SMALLINT NOT NULL DEFAULT 1,
  los              SMALLINT NOT NULL DEFAULT 1,
  mat_cost         SMALLINT NOT NULL DEFAULT 1,
  man_cost         SMALLINT NOT NULL DEFAULT 0,
  slots            SMALLINT NOT NULL DEFAULT 1,
  stealth_rating   SMALLINT NOT NULL DEFAULT 0,
  detection_rating SMALLINT NOT NULL DEFAULT 2,
  atk_dice         SMALLINT,                       -- naval only: attack dice per ship
  hp               SMALLINT,                       -- NULL = quantity-based; set for naval + bombers
  sonar_range      SMALLINT,
  carrier_slots    SMALLINT,
  overwatch_to_hit SMALLINT,
  overwatch_pen    SMALLINT,
  overwatch_range  SMALLINT,
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

-- Wire deferred FKs now that factions exists.
ALTER TABLE hexes
  ADD CONSTRAINT hexes_owner_faction_id_fkey
  FOREIGN KEY (owner_faction_id) REFERENCES factions(id) ON DELETE SET NULL;

ALTER TABLE scouted_hexes
  ADD CONSTRAINT scouted_hexes_faction_id_fkey
  FOREIGN KEY (faction_id) REFERENCES factions(id) ON DELETE CASCADE;

ALTER TABLE games
  ADD CONSTRAINT games_winner_faction_id_fkey
  FOREIGN KEY (winner_faction_id) REFERENCES factions(id) ON DELETE SET NULL;

-- Deferred from 003: needs factions table.
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

-- Unit stacks. One row per (faction, unit_type, hex) is the common case,
-- but split stacks may create multiple rows of the same type in the same hex.
-- Phase 4 auto-merges stacks after movement.
CREATE TABLE units (
  id                  UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id             UUID     NOT NULL REFERENCES games(id)          ON DELETE CASCADE,
  faction_id          UUID     NOT NULL REFERENCES factions(id)       ON DELETE CASCADE,
  unit_type_id        UUID     NOT NULL REFERENCES unit_type_config(id),
  hex_q               SMALLINT NOT NULL,
  hex_r               SMALLINT NOT NULL,
  quantity            SMALLINT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  hp                  SMALLINT,
  standing_order      TEXT     NOT NULL DEFAULT 'hold_position'
                      CHECK (standing_order IN ('hold_position', 'patrol', 'hold_fire', 'fortify')),
  fortification_level SMALLINT NOT NULL DEFAULT 0 CHECK (fortification_level IN (0, 1))
  -- No UNIQUE constraint: split stacks can share the same (faction, type, hex).
);

-- Buildings with HP. Not operational until current_hp = max_hp.
-- Slots = floor(current_hp / 2).
CREATE TABLE buildings (
  id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id          UUID     NOT NULL REFERENCES games(id)      ON DELETE CASCADE,
  hex_q            SMALLINT NOT NULL,
  hex_r            SMALLINT NOT NULL,
  type             TEXT     NOT NULL
                   CHECK (type IN (
                     'factory', 'airbase', 'harbor', 'airstrip',
                     'bridge', 'fortification', 'control_point'
                   )),
  current_hp       SMALLINT NOT NULL DEFAULT 0 CHECK (current_hp >= 0),
  max_hp           SMALLINT NOT NULL,
  owner_faction_id UUID     REFERENCES factions(id) ON DELETE SET NULL,
  UNIQUE (game_id, hex_q, hex_r, type)
);

-- GM-placed resource tiles. Each produces 1 material/turn when controlled.
CREATE TABLE resource_tiles (
  id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id          UUID     NOT NULL REFERENCES games(id)      ON DELETE CASCADE,
  hex_q            SMALLINT NOT NULL,
  hex_r            SMALLINT NOT NULL,
  tile_type        TEXT     NOT NULL,
  owner_faction_id UUID     REFERENCES factions(id) ON DELETE SET NULL,
  UNIQUE (game_id, hex_q, hex_r)
);

-- Diplomatic relationships (symmetric; one ordered row per faction pair).
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
  ON unit_type_config FOR ALL USING (is_gm_in_game(game_id));

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
  ON units FOR SELECT USING (is_gm_in_game(game_id));

CREATE POLICY "own units always visible"
  ON units FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM factions f WHERE f.id = units.faction_id AND f.profile_id = auth.uid()
  ));

CREATE POLICY "gm writes units"
  ON units FOR ALL USING (is_gm_in_game(game_id));

CREATE POLICY "participants read buildings"
  ON buildings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM game_participants gp
    WHERE gp.game_id = buildings.game_id AND gp.profile_id = auth.uid()
  ));

CREATE POLICY "gm manages buildings"
  ON buildings FOR ALL USING (is_gm_in_game(game_id));

CREATE POLICY "participants read resource tiles"
  ON resource_tiles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM game_participants gp
    WHERE gp.game_id = resource_tiles.game_id AND gp.profile_id = auth.uid()
  ));

CREATE POLICY "gm manages resource tiles"
  ON resource_tiles FOR ALL USING (is_gm_in_game(game_id));

CREATE POLICY "participants read relationships"
  ON faction_relationships FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM game_participants gp
    WHERE gp.game_id = faction_relationships.game_id AND gp.profile_id = auth.uid()
  ));

CREATE POLICY "gm writes relationships"
  ON faction_relationships FOR ALL USING (is_gm_in_game(game_id));
