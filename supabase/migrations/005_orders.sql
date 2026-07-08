-- =============================================================
-- 005_orders.sql — Orders, production queue, combat log,
--   flight groups
-- =============================================================

-- Movement and action orders. One row per unit per step.
-- Multi-hex paths use sequence (0 = first step).
CREATE TABLE movement_orders (
  id             UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        UUID     NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  game_id        UUID     NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  order_type     TEXT     NOT NULL DEFAULT 'move'
                 CHECK (order_type IN (
                   'move', 'bombard', 'retreat', 'pursue_if_retreat',
                   'wait_turn', 'fortify', 'repair', 'build', 'split'
                 )),
  sequence       SMALLINT NOT NULL DEFAULT 0,
  to_hex_q       SMALLINT,
  to_hex_r       SMALLINT,
  target_hex_q   SMALLINT,
  target_hex_r   SMALLINT,
  structure_type TEXT,              -- build orders: 'road', 'bridge', 'airstrip', etc.
  turn           SMALLINT NOT NULL
);

-- Production queue.
-- Entire queue is lost if the factory is captured during Phase 3 (no refund).
CREATE TABLE production_queue (
  id            UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID     NOT NULL REFERENCES games(id)          ON DELETE CASCADE,
  faction_id    UUID     NOT NULL REFERENCES factions(id)       ON DELETE CASCADE,
  unit_type_id  UUID     NOT NULL REFERENCES unit_type_config(id),
  factory_hex_q SMALLINT NOT NULL,
  factory_hex_r SMALLINT NOT NULL,
  quantity      SMALLINT NOT NULL DEFAULT 1,
  status        TEXT     NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'ready')),
  created_turn  SMALLINT NOT NULL
);

-- Combat log. One row per notable event per phase.
-- data JSONB holds event-specific detail (units, rolls, casualties, etc.).
CREATE TABLE combat_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID        NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  turn       SMALLINT    NOT NULL,
  phase      SMALLINT    NOT NULL,   -- 1=air, 2=naval, 3=ground, 4=return/collect
  hex_q      SMALLINT    NOT NULL,
  hex_r      SMALLINT    NOT NULL,
  log_type   TEXT        NOT NULL,   -- 'combat', 'bombardment', 'air_strike', 'intercept', etc.
  faction_id UUID        REFERENCES factions(id) ON DELETE SET NULL,
  data       JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Flight groups for air missions. path = array of {q, r} waypoints.
CREATE TABLE flight_groups (
  id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      UUID     NOT NULL REFERENCES games(id)    ON DELETE CASCADE,
  faction_id   UUID     NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
  mission_type TEXT     NOT NULL
               CHECK (mission_type IN ('bombing_run', 'attack_run', 'scout', 'sweep')),
  path         JSONB    NOT NULL DEFAULT '[]',
  target_hex_q SMALLINT,
  target_hex_r SMALLINT,
  target_infra TEXT,
  status       TEXT     NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'in_flight', 'complete', 'destroyed')),
  turn         SMALLINT NOT NULL
);

-- Junction: which air units are in each flight group. One unit per group per turn.
CREATE TABLE flight_group_units (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_group_id UUID NOT NULL REFERENCES flight_groups(id) ON DELETE CASCADE,
  unit_id         UUID NOT NULL REFERENCES units(id)         ON DELETE CASCADE,
  UNIQUE (unit_id, flight_group_id)
);

-- RLS
ALTER TABLE movement_orders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE combat_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE flight_groups    ENABLE ROW LEVEL SECURITY;
ALTER TABLE flight_group_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own faction manages movement orders"
  ON movement_orders FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM units u JOIN factions f ON f.id = u.faction_id
      WHERE u.id = movement_orders.unit_id AND f.profile_id = auth.uid()
    )
    OR is_gm_in_game(game_id)
  );

CREATE POLICY "own faction reads movement orders"
  ON movement_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM units u JOIN factions f ON f.id = u.faction_id
      WHERE u.id = movement_orders.unit_id AND f.profile_id = auth.uid()
    )
    OR is_gm_in_game(game_id)
  );

CREATE POLICY "own faction manages production"
  ON production_queue FOR ALL
  USING (
    EXISTS (SELECT 1 FROM factions f WHERE f.id = production_queue.faction_id AND f.profile_id = auth.uid())
    OR is_gm_in_game(game_id)
  );

CREATE POLICY "participants read combat log"
  ON combat_log FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM game_participants gp
    WHERE gp.game_id = combat_log.game_id AND gp.profile_id = auth.uid()
  ));

CREATE POLICY "gm writes combat log"
  ON combat_log FOR ALL USING (is_gm_in_game(game_id));

CREATE POLICY "own faction manages flight groups"
  ON flight_groups FOR ALL
  USING (
    EXISTS (SELECT 1 FROM factions f WHERE f.id = flight_groups.faction_id AND f.profile_id = auth.uid())
    OR is_gm_in_game(game_id)
  );

CREATE POLICY "participants read flight groups"
  ON flight_groups FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM game_participants gp
    WHERE gp.game_id = flight_groups.game_id AND gp.profile_id = auth.uid()
  ));

CREATE POLICY "own faction manages flight group units"
  ON flight_group_units FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM flight_groups fg JOIN factions f ON f.id = fg.faction_id
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
