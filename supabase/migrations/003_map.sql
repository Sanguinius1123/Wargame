-- =============================================================
-- 003_map.sql — Hexes + fog of war (scouted_hexes)
-- =============================================================

-- One row per hex on the map.
-- Vegetation and urban are hex attributes, not terrain types.
-- Buildings with HP (factory, airbase, harbor, etc.) live in the buildings table (004).
-- owner_faction_id only tracked for objective hexes (settlement, urban, resource tile).
CREATE TABLE hexes (
  id                   UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id              UUID     NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  hex_q                SMALLINT NOT NULL,
  hex_r                SMALLINT NOT NULL,
  terrain              TEXT     NOT NULL DEFAULT 'plains' REFERENCES terrain_type_config(name),
  -- Ownership (only meaningful for objective hexes)
  owner_faction_id     UUID,    -- FK to factions added in 004 after factions table exists
  -- Objective flags
  has_settlement       BOOLEAN  NOT NULL DEFAULT FALSE,  -- major city; counts toward win condition
  -- Vegetation attributes (no HP; heavy veg blocks mechanized; both block LOS into-but-not-through)
  has_light_vegetation BOOLEAN  NOT NULL DEFAULT FALSE,  -- stealth bonus +1
  has_heavy_vegetation BOOLEAN  NOT NULL DEFAULT FALSE,  -- stealth bonus +2; mechanized impassable
  -- Urban (4 HP tracked here; at 1-2 HP produces no manpower; at 0 HP treated as destroyed)
  has_urban            BOOLEAN  NOT NULL DEFAULT FALSE,
  urban_hp             SMALLINT NOT NULL DEFAULT 4 CHECK (urban_hp BETWEEN 0 AND 4),
  -- Infrastructure (boolean flags; roads and canals are immune to bombardment)
  has_road             BOOLEAN  NOT NULL DEFAULT FALSE,
  has_railroad         BOOLEAN  NOT NULL DEFAULT FALSE,  -- stub for future use
  has_canal            BOOLEAN  NOT NULL DEFAULT FALSE,  -- allows naval movement through wetlands
  UNIQUE (game_id, hex_q, hex_r)
);

ALTER TABLE hexes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gm reads all hexes"
  ON hexes FOR SELECT USING (is_gm_in_game(game_id));

CREATE POLICY "gm writes hexes"
  ON hexes FOR ALL USING (is_gm_in_game(game_id));

-- Historical record of which hexes each faction has ever seen.
-- "Scouted" is an internal DB concept: terrain is shown on dark hexes the player has visited.
-- It is NOT a display state — only Visible / Dark exist in the client.
CREATE TABLE scouted_hexes (
  id                UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id           UUID     NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  faction_id        UUID     NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  hex_q             SMALLINT NOT NULL,
  hex_r             SMALLINT NOT NULL,
  last_scouted_turn SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (faction_id, hex_q, hex_r)
);

ALTER TABLE scouted_hexes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own faction reads scouted hexes"
  ON scouted_hexes FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM factions f WHERE f.id = scouted_hexes.faction_id AND f.profile_id = auth.uid())
    OR is_gm_in_game(game_id)
  );

CREATE POLICY "system writes scouted hexes"
  ON scouted_hexes FOR ALL
  USING (is_gm_in_game(game_id));

-- Player hex visibility: can see hexes they have scouted.
-- (Unit-based visibility is handled in the server; scouted_hexes is the persistent record.)
-- Added here after scouted_hexes is defined, even though faction FK isn't wired until 004.
-- The subquery will work once factions exist at runtime.
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
