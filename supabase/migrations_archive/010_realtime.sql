-- Enable Supabase Realtime on the games table.
-- Clients subscribe to UPDATE events so they can reload when a turn advances.
ALTER PUBLICATION supabase_realtime ADD TABLE games;
