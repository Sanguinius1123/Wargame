-- =============================================================
-- 014_map_library.sql — Stored map templates
-- GMs can save a game's hex layout as a named map template,
-- then load it into any game (wiping that game's existing hexes).
-- =============================================================

CREATE TABLE maps (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT    NOT NULL,
  description TEXT,
  created_by  UUID    REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- map_hexes mirrors the hexes table but is not tied to a game.
-- urban_hp is omitted — maps always spawn at full HP (4).
-- owner_faction_id is omitted — maps have no factions.
CREATE TABLE map_hexes (
  id                   UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id               UUID     NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  hex_q                SMALLINT NOT NULL,
  hex_r                SMALLINT NOT NULL,
  terrain              TEXT     NOT NULL DEFAULT 'plains',
  has_settlement       BOOLEAN  NOT NULL DEFAULT FALSE,
  settlement_name      TEXT,
  has_light_vegetation BOOLEAN  NOT NULL DEFAULT FALSE,
  has_heavy_vegetation BOOLEAN  NOT NULL DEFAULT FALSE,
  has_urban            BOOLEAN  NOT NULL DEFAULT FALSE,
  has_road             BOOLEAN  NOT NULL DEFAULT FALSE,
  has_railroad         BOOLEAN  NOT NULL DEFAULT FALSE,
  has_canal            BOOLEAN  NOT NULL DEFAULT FALSE,
  has_bridge           BOOLEAN  NOT NULL DEFAULT FALSE,
  UNIQUE (map_id, hex_q, hex_r)
);

ALTER TABLE maps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_hexes ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read maps (players need to see names in dropdowns).
CREATE POLICY "authenticated reads maps"
  ON maps FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated reads map_hexes"
  ON map_hexes FOR SELECT USING (auth.role() = 'authenticated');

-- Only GMs can write (server uses adminDb which bypasses RLS, but policies are here for direct access).
CREATE POLICY "gm writes maps"
  ON maps FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND global_role = 'gm')
  );

CREATE POLICY "gm writes map_hexes"
  ON map_hexes FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND global_role = 'gm')
  );
