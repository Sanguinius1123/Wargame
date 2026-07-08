-- =============================================================
-- 009_fix_trigger.sql
--
-- Fixes handle_new_user trigger: migration 008 dropped the
-- SET search_path = public clause, which breaks SECURITY DEFINER
-- functions in Supabase (they can't resolve public.gm_whitelist).
--
-- Also updates the gm_whitelist check to match by username OR email.
-- =============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_username TEXT;
  v_role     TEXT;
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND (OLD IS NULL OR OLD.email_confirmed_at IS NULL) THEN
    v_username := COALESCE(
      NEW.raw_user_meta_data->>'username',
      split_part(NEW.email, '@', 1)
    );

    v_role := CASE
      WHEN EXISTS (SELECT 1 FROM public.gm_whitelist WHERE email    = NEW.email)
        OR EXISTS (SELECT 1 FROM public.gm_whitelist WHERE username = v_username)
      THEN 'gm' ELSE 'player'
    END;

    INSERT INTO public.profiles (id, username, global_role)
    VALUES (NEW.id, v_username, v_role)
    ON CONFLICT (id) DO NOTHING;

    IF v_role = 'gm' THEN
      INSERT INTO public.game_participants (game_id, profile_id, role)
      SELECT id, NEW.id, 'gm' FROM public.games
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
