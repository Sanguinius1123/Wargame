-- =============================================================
-- 002_auth.sql — Auth, games, participants
-- =============================================================

CREATE TABLE gm_whitelist (
  email TEXT PRIMARY KEY
);

INSERT INTO gm_whitelist (email) VALUES ('macarthur1123@gmail.com');

CREATE TABLE profiles (
  id          UUID  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT  NOT NULL UNIQUE,
  global_role TEXT  NOT NULL DEFAULT 'player' CHECK (global_role IN ('gm', 'player'))
);

CREATE TABLE games (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  current_turn  SMALLINT    NOT NULL DEFAULT 1,
  current_phase TEXT        NOT NULL DEFAULT 'orders' CHECK (current_phase IN ('orders', 'resolve', 'production')),
  map_width     SMALLINT    NOT NULL DEFAULT 20,  -- hex columns
  map_height    SMALLINT    NOT NULL DEFAULT 20,  -- hex rows
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE game_participants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('gm', 'player', 'observer')),
  UNIQUE (game_id, profile_id)
);

-- Auto-create profile on email confirmation; assign GM role from whitelist.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    INSERT INTO profiles (id, username, global_role)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
      CASE WHEN EXISTS (SELECT 1 FROM gm_whitelist WHERE email = NEW.email) THEN 'gm' ELSE 'player' END
    )
    ON CONFLICT (id) DO NOTHING;

    -- Auto-add GMs to all existing games.
    IF EXISTS (SELECT 1 FROM gm_whitelist WHERE email = NEW.email) THEN
      INSERT INTO game_participants (game_id, profile_id, role)
      SELECT id, NEW.id, 'gm' FROM games
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_confirmed
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- RLS
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE games             ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles are public" ON profiles FOR SELECT USING (TRUE);
CREATE POLICY "own profile writable" ON profiles FOR ALL USING (auth.uid() = id);

CREATE POLICY "participants read own games"
  ON games FOR SELECT
  USING (EXISTS (SELECT 1 FROM game_participants gp WHERE gp.game_id = games.id AND gp.profile_id = auth.uid()));

CREATE POLICY "participants read own participation"
  ON game_participants FOR SELECT
  USING (profile_id = auth.uid());
