-- =============================================================
-- 004_factions_and_units.sql — Factions, resources, units
-- =============================================================

CREATE TABLE factions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID        NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  profile_id UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  color      TEXT        NOT NULL DEFAULT '#3b82f6',
  production INTEGER     NOT NULL DEFAULT 0 CHECK (production >= 0),
  manpower   INTEGER     NOT NULL DEFAULT 0 CHECK (manpower >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, profile_id)
);

-- Wire faction FK onto hexes now that factions exists.
ALTER TABLE hexes
  ADD CONSTRAINT hexes_owner_faction_id_fkey
  FOREIGN KEY (owner_faction_id) REFERENCES factions(id) ON DELETE SET NULL;

-- Unit stacks. One row per (faction, hex, unit_type).
CREATE TABLE units (
  id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      UUID     NOT NULL REFERENCES games(id)          ON DELETE CASCADE,
  faction_id   UUID     NOT NULL REFERENCES factions(id)       ON DELETE CASCADE,
  unit_type_id UUID     NOT NULL REFERENCES unit_type_config(id),
  hex_q        SMALLINT NOT NULL,
  hex_r        SMALLINT NOT NULL,
  quantity     SMALLINT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  UNIQUE (faction_id, unit_type_id, hex_q, hex_r)
);

-- Queued movement orders (cleared each turn after resolve).
CREATE TABLE movement_orders (
  id         UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id    UUID     NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  game_id    UUID     NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  to_hex_q   SMALLINT NOT NULL,
  to_hex_r   SMALLINT NOT NULL,
  turn       SMALLINT NOT NULL
);

-- RLS
ALTER TABLE factions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE units            ENABLE ROW LEVEL SECURITY;
ALTER TABLE movement_orders  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "participants read factions"
  ON factions FOR SELECT
  USING (EXISTS (SELECT 1 FROM game_participants gp WHERE gp.game_id = factions.game_id AND gp.profile_id = auth.uid()));

CREATE POLICY "own faction or gm writes faction"
  ON factions FOR ALL
  USING (profile_id = auth.uid() OR is_gm_in_game(game_id));

-- Units visible only in hexes the player can currently see (policy added after fog table).
CREATE POLICY "gm reads all units"
  ON units FOR SELECT
  USING (is_gm_in_game(game_id));

CREATE POLICY "own units always visible"
  ON units FOR SELECT
  USING (EXISTS (SELECT 1 FROM factions f WHERE f.id = units.faction_id AND f.profile_id = auth.uid()));

CREATE POLICY "gm writes units"
  ON units FOR ALL
  USING (is_gm_in_game(game_id));

CREATE POLICY "own faction writes movement orders"
  ON movement_orders FOR ALL
  USING (EXISTS (SELECT 1 FROM units u JOIN factions f ON f.id = u.faction_id WHERE u.id = movement_orders.unit_id AND f.profile_id = auth.uid())
    OR is_gm_in_game(game_id));
