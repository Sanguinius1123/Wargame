-- =============================================================
-- 003_map.sql — Hex map
-- =============================================================

-- Helper: is the current user a GM in this game?
CREATE OR REPLACE FUNCTION is_gm_in_game(p_game_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM game_participants
    WHERE game_id = p_game_id AND profile_id = auth.uid() AND role = 'gm'
  );
$$;

-- One row per hex on the map.
CREATE TABLE hexes (
  id              UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID     NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  hex_q           SMALLINT NOT NULL,
  hex_r           SMALLINT NOT NULL,
  terrain         TEXT     NOT NULL DEFAULT 'plains' REFERENCES terrain_type_config(name),
  development     SMALLINT NOT NULL DEFAULT 0 CHECK (development BETWEEN 0 AND 3),
  owner_faction_id UUID,   -- FK added after factions table exists
  UNIQUE (game_id, hex_q, hex_r)
);

-- RLS
ALTER TABLE hexes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gm reads all hexes"
  ON hexes FOR SELECT
  USING (is_gm_in_game(game_id));

CREATE POLICY "gm writes hexes"
  ON hexes FOR ALL
  USING (is_gm_in_game(game_id));

-- Players see hexes they have scouted or currently own — defined after fog table exists.
