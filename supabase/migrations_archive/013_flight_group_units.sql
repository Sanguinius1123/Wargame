-- =============================================================
-- 013_flight_group_units.sql
-- Junction table linking air units to flight groups.
-- A unit can only be in one flight group per turn.
-- =============================================================

CREATE TABLE flight_group_units (
  id              UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_group_id UUID     NOT NULL REFERENCES flight_groups(id) ON DELETE CASCADE,
  unit_id         UUID     NOT NULL REFERENCES units(id)         ON DELETE CASCADE,
  UNIQUE (unit_id, flight_group_id)
);

ALTER TABLE flight_group_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own faction manages flight group units"
  ON flight_group_units FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM flight_groups fg
      JOIN factions f ON f.id = fg.faction_id
      WHERE fg.id = flight_group_units.flight_group_id
        AND (f.profile_id = auth.uid() OR is_gm_in_game(fg.game_id))
    )
  );

CREATE POLICY "participants read flight group units"
  ON flight_group_units FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM flight_groups fg
      JOIN game_participants gp ON gp.game_id = fg.game_id
      WHERE fg.id = flight_group_units.flight_group_id
        AND gp.profile_id = auth.uid()
    )
  );
