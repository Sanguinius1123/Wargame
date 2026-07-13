-- =============================================================
-- 005_fog.sql — Movement orders, production queue, combat log,
--   flight groups
-- (Fog of war / scouted_hexes has moved to 003_map.sql)
-- =============================================================

-- Movement and action orders. One row per unit per order step.
-- Multi-hex paths use sequence (0 = first step, 1 = second, etc.).
CREATE TABLE movement_orders (
  id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      UUID     NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  game_id      UUID     NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  order_type   TEXT     NOT NULL DEFAULT 'move'
               CHECK (order_type IN (
                 'move', 'bombard', 'retreat', 'pursue_if_retreat',
                 'wait_turn', 'fortify', 'repair'
               )),
  sequence     SMALLINT NOT NULL DEFAULT 0,   -- step index in multi-hex movement path
  to_hex_q     SMALLINT,                      -- destination hex (move / retreat)
  to_hex_r     SMALLINT,
  target_hex_q SMALLINT,                      -- bombardment target hex
  target_hex_r SMALLINT,
  turn         SMALLINT NOT NULL
);

-- Unit production queue.
-- pending = being built; ready = available to place next turn.
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

-- Combat log. One row per notable event per phase per turn.
-- data JSONB holds event-specific detail (units involved, rolls, casualties, etc.).
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

-- Flight groups for air missions, composed during the ordering phase.
-- path is an array of {q, r} waypoints for the mission route.
-- target_infra designates a specific infrastructure target for bombing runs (nullable).
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

-- RLS
ALTER TABLE movement_orders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE combat_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE flight_groups    ENABLE ROW LEVEL SECURITY;

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
  ON combat_log FOR ALL
  USING (is_gm_in_game(game_id));

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
