-- Fix handle_new_user trigger:
-- 1. Guard against OLD being NULL on INSERT (use OLD IS NULL check)
-- 2. Set explicit search_path so public schema tables are always found
-- 3. Fully qualify all table references
DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND (OLD IS NULL OR OLD.email_confirmed_at IS NULL) THEN
    INSERT INTO public.profiles (id, username, global_role)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
      CASE WHEN EXISTS (SELECT 1 FROM public.gm_whitelist WHERE email = NEW.email)
           THEN 'gm' ELSE 'player' END
    )
    ON CONFLICT (id) DO NOTHING;

    IF EXISTS (SELECT 1 FROM public.gm_whitelist WHERE email = NEW.email) THEN
      INSERT INTO public.game_participants (game_id, profile_id, role)
      SELECT id, NEW.id, 'gm' FROM public.games
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_confirmed
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
