-- =============================================================
-- 008_configure_game.sql
--
-- 1. Factions become player-optional: profile_id nullable so
--    factions can exist (with units) before a player is assigned.
-- 2. gm_whitelist gains a username column so GM accounts can be
--    provisioned by username (no real email required).
-- 3. handle_new_user trigger updated to check by username too.
-- 4. map_factions + map_units: faction slots and pre-placed units
--    stored as part of a saved map template.
-- =============================================================

-- ── 1. factions.profile_id → nullable, SET NULL on profile delete ──────────

ALTER TABLE factions
  ALTER COLUMN profile_id DROP NOT NULL;

ALTER TABLE factions
  DROP CONSTRAINT IF EXISTS factions_profile_id_fkey;

ALTER TABLE factions
  ADD CONSTRAINT factions_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- ── 2. gm_whitelist: add username column ──────────────────────────────────

ALTER TABLE gm_whitelist
  ADD COLUMN IF NOT EXISTS username TEXT;

-- ── 3. handle_new_user: check whitelist by email OR username ──────────────

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_username TEXT;
  v_role     TEXT;
BEGIN
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );

  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM gm_whitelist WHERE email    = NEW.email)
      OR EXISTS (SELECT 1 FROM gm_whitelist WHERE username = v_username)
    THEN 'gm' ELSE 'player'
  END INTO v_role;

  INSERT INTO public.profiles (id, username, global_role)
  VALUES (NEW.id, v_username, v_role)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ── 4. map_factions: named faction slots attached to a map template ────────
--    slot = display order (0-based). color carries into the game.

CREATE TABLE map_factions (
  id     UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID     NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name   TEXT     NOT NULL,
  color  TEXT     NOT NULL DEFAULT '#3b82f6',
  slot   SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (map_id, name)
);

-- ── 5. map_units: pre-placed units keyed by faction name + hex ────────────
--    unit_type_name matched against unit_type_config.name on game load.
--    Multiple rows of the same type in the same hex ARE allowed
--    (mirrors the units table which has no unique constraint).

CREATE TABLE map_units (
  id             UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id         UUID     NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  faction_name   TEXT     NOT NULL,
  hex_q          SMALLINT NOT NULL,
  hex_r          SMALLINT NOT NULL,
  unit_type_name TEXT     NOT NULL,
  quantity       SMALLINT NOT NULL DEFAULT 1 CHECK (quantity > 0)
);

-- ── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE map_factions ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_units    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated reads map_factions"
  ON map_factions FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "gm writes map_factions"
  ON map_factions FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND global_role = 'gm')
  );

CREATE POLICY "authenticated reads map_units"
  ON map_units FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "gm writes map_units"
  ON map_units FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND global_role = 'gm')
  );
