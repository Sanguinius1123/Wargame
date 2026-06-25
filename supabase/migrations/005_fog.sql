-- =============================================================
-- 005_fog.sql — Fog of war and allied vision stub
-- =============================================================

-- Historical record of which hexes each faction has ever seen.
CREATE TABLE scouted_hexes (
  id                UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id           UUID     NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  faction_id        UUID     NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  hex_q             SMALLINT NOT NULL,
  hex_r             SMALLINT NOT NULL,
  last_scouted_turn SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (faction_id, hex_q, hex_r)
);

-- Allied vision sharing stub. enabled is always FALSE until the mechanic is built.
-- Exists so the schema supports it without requiring a migration later.
CREATE TABLE allied_vision (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      UUID    NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  faction_a_id UUID    NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  faction_b_id UUID    NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (faction_a_id, faction_b_id)
);

-- Player hex RLS: can see hexes they own or have scouted.
CREATE POLICY "players read owned or scouted hexes"
  ON hexes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM factions f
      WHERE f.game_id = hexes.game_id AND f.profile_id = auth.uid()
        AND (
          hexes.owner_faction_id = f.id
          OR EXISTS (
            SELECT 1 FROM scouted_hexes sh
            WHERE sh.faction_id = f.id AND sh.hex_q = hexes.hex_q AND sh.hex_r = hexes.hex_r AND sh.game_id = hexes.game_id
          )
        )
    )
  );

-- RLS
ALTER TABLE scouted_hexes ENABLE ROW LEVEL SECURITY;
ALTER TABLE allied_vision  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own faction reads scouted hexes"
  ON scouted_hexes FOR SELECT
  USING (EXISTS (SELECT 1 FROM factions f WHERE f.id = scouted_hexes.faction_id AND f.profile_id = auth.uid())
    OR is_gm_in_game(game_id));

CREATE POLICY "gm writes scouted hexes"
  ON scouted_hexes FOR ALL
  USING (is_gm_in_game(game_id));

CREATE POLICY "participants read allied vision"
  ON allied_vision FOR SELECT
  USING (EXISTS (SELECT 1 FROM game_participants gp WHERE gp.game_id = allied_vision.game_id AND gp.profile_id = auth.uid()));

CREATE POLICY "gm writes allied vision"
  ON allied_vision FOR ALL
  USING (is_gm_in_game(game_id));
