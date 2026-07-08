-- =============================================================
-- 003_map.sql — Hexes, fog of war, map library
-- =============================================================

-- One row per hex per game. Vegetation and urban are attributes, not terrain types.
-- owner_faction_id only tracked for objective hexes (settlement, urban, resource tile).
-- FK to factions wired in 004_factions_units.sql (factions not yet created).
CREATE TABLE hexes (
  id                   UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id              UUID     NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  hex_q                SMALLINT NOT NULL,
  hex_r                SMALLINT NOT NULL,
  terrain              TEXT     NOT NULL DEFAULT 'plains' REFERENCES terrain_type_config(name),
  owner_faction_id     UUID,
  -- Settlement
  has_settlement       BOOLEAN  NOT NULL DEFAULT FALSE,
  settlement_name      TEXT,
  settlement_size      SMALLINT NOT NULL DEFAULT 1,        -- visual tier: 1=village, 5=town, 9=city
  -- Vegetation (HP is source of truth; booleans kept in sync for query performance)
  has_light_vegetation BOOLEAN  NOT NULL DEFAULT FALSE,    -- stealth +1
  has_heavy_vegetation BOOLEAN  NOT NULL DEFAULT FALSE,    -- stealth +2; mechanized impassable
  vegetation_hp        INTEGER,                            -- NULL=no veg; 1-10=light; 11+=heavy
  -- Urban
  has_urban            BOOLEAN  NOT NULL DEFAULT FALSE,
  urban_hp             SMALLINT NOT NULL DEFAULT 4 CHECK (urban_hp BETWEEN 0 AND 4),
  -- Infrastructure
  has_railroad         BOOLEAN  NOT NULL DEFAULT FALSE,    -- stub for future use
  has_canal            BOOLEAN  NOT NULL DEFAULT FALSE,    -- allows naval through wetlands
  has_airstrip         BOOLEAN  NOT NULL DEFAULT FALSE,    -- temporary airstrip built by supply
  UNIQUE (game_id, hex_q, hex_r)
);

ALTER TABLE hexes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gm reads all hexes"
  ON hexes FOR SELECT USING (is_gm_in_game(game_id));

CREATE POLICY "gm writes hexes"
  ON hexes FOR ALL USING (is_gm_in_game(game_id));

-- Historical record of which hexes each faction has ever seen.
-- "Scouted" is DB-internal: shows last-known terrain on dark hexes.
-- Display states are only Visible / Dark — scouted is not a third state.
-- FK to factions wired in 004_factions_units.sql.
CREATE TABLE scouted_hexes (
  id                UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id           UUID     NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  faction_id        UUID     NOT NULL,
  hex_q             SMALLINT NOT NULL,
  hex_r             SMALLINT NOT NULL,
  last_scouted_turn SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (faction_id, hex_q, hex_r)
);

ALTER TABLE scouted_hexes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system writes scouted hexes"
  ON scouted_hexes FOR ALL USING (is_gm_in_game(game_id));

-- Deferred to 004: "own faction reads scouted hexes" and "players read scouted hexes"
-- need the factions table to exist.

-- =============================================================
-- Map library — named terrain templates, not tied to any game.
-- GMs save a game's hex layout here; load it into any new game.
-- =============================================================

CREATE TABLE maps (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  description TEXT,
  created_by  UUID        REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mirrors hexes but without game_id, owner, or unit/combat columns.
CREATE TABLE map_hexes (
  id                   UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id               UUID     NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  hex_q                SMALLINT NOT NULL,
  hex_r                SMALLINT NOT NULL,
  terrain              TEXT     NOT NULL DEFAULT 'plains',
  has_settlement       BOOLEAN  NOT NULL DEFAULT FALSE,
  settlement_name      TEXT,
  settlement_size      SMALLINT NOT NULL DEFAULT 1,
  has_light_vegetation BOOLEAN  NOT NULL DEFAULT FALSE,
  has_heavy_vegetation BOOLEAN  NOT NULL DEFAULT FALSE,
  vegetation_hp        INTEGER,
  has_railroad         BOOLEAN  NOT NULL DEFAULT FALSE,
  UNIQUE (map_id, hex_q, hex_r)
);

ALTER TABLE maps      ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_hexes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated reads maps"
  ON maps FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated reads map_hexes"
  ON map_hexes FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "gm writes maps"
  ON maps FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND global_role = 'gm')
  );

CREATE POLICY "gm writes map_hexes"
  ON map_hexes FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND global_role = 'gm')
  );
