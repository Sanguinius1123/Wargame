-- =============================================================
-- 006_settings.sql — Game settings + unit type templates
--
-- A "setting" is a named ruleset (e.g. "Great War") that defines
-- the unit roster. On game creation, the server copies the chosen
-- setting's templates into unit_type_config for that game.
--
-- Unit stats reflect final values as of migration 029 in the old set:
--   - Ground combat rebalance (to_hit +1, defense -1 for all ground)
--   - Armor defense +1 (post-rebalance nerf was too strong)
--   - Artillery bombard_pen 0 (removed penetration for balance)
--   - Sub stealth_rating 8, Destroyer detection_rating 7
--   - AA Gun detection_rating 1 (no special ground-spotting)
--   - Artillery bombard_range 6, Recon move 1
-- =============================================================

CREATE TABLE settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT
);

-- Mirrors unit_type_config but keyed by setting_id instead of game_id.
CREATE TABLE unit_type_templates (
  id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_id       UUID     NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  name             TEXT     NOT NULL,
  tags             TEXT[]   NOT NULL DEFAULT '{}',
  to_hit           SMALLINT,
  defense          SMALLINT NOT NULL DEFAULT 6,
  penetration      SMALLINT NOT NULL DEFAULT 0,
  atk_range        SMALLINT,
  move             SMALLINT NOT NULL DEFAULT 1,
  los              SMALLINT NOT NULL DEFAULT 1,
  mat_cost         SMALLINT NOT NULL DEFAULT 1,
  man_cost         SMALLINT NOT NULL DEFAULT 0,
  slots            SMALLINT NOT NULL DEFAULT 1,
  stealth_rating   SMALLINT NOT NULL DEFAULT 0,
  detection_rating SMALLINT NOT NULL DEFAULT 2,
  atk_dice         SMALLINT,
  hp               SMALLINT,
  sonar_range      SMALLINT,
  carrier_slots    SMALLINT,
  overwatch_to_hit SMALLINT,
  overwatch_pen    SMALLINT,
  overwatch_range  SMALLINT,
  bombard_range    SMALLINT,
  bombard_to_hit   SMALLINT,
  bombard_pen      SMALLINT,
  UNIQUE (setting_id, name)
);

-- Wire setting_id FK on games now that settings exists.
ALTER TABLE games
  ADD CONSTRAINT games_setting_id_fkey
  FOREIGN KEY (setting_id) REFERENCES settings(id) ON DELETE SET NULL;

ALTER TABLE settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_type_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone reads settings"
  ON settings FOR SELECT USING (TRUE);

CREATE POLICY "anyone reads unit type templates"
  ON unit_type_templates FOR SELECT USING (TRUE);

-- =============================================================
-- Great War setting — WW1/WW2 era operational warfare
-- =============================================================

INSERT INTO settings (id, name, description) VALUES (
  '10000000-0000-0000-0000-000000000001',
  'Great War',
  'WW1/WW2 era operational warfare. Infantry pushes through mud, armor breaks the line, artillery levels cities, and naval fleets contest the seas.'
);

INSERT INTO unit_type_templates (
  setting_id, name, tags,
  to_hit, defense, penetration, atk_range,
  move, los, mat_cost, man_cost, slots,
  stealth_rating, detection_rating,
  atk_dice, hp, sonar_range, carrier_slots,
  overwatch_to_hit, overwatch_pen, overwatch_range,
  bombard_range, bombard_to_hit, bombard_pen
) VALUES

-- ── Ground ───────────────────────────────────────────────────────────────────

('10000000-0000-0000-0000-000000000001', 'Infantry',
  ARRAY['ground'],
  7, 5, 0, 1,   1, 1,  1, 1, 1,  0, 2,
  NULL,NULL,NULL,NULL,  NULL,NULL,NULL,  NULL,NULL,NULL),

('10000000-0000-0000-0000-000000000001', 'Armor',
  ARRAY['ground','mobile','armored','mechanized'],
  8, 8, 2, 2,   2, 1,  4, 2, 2,  0, 2,
  NULL,NULL,NULL,NULL,  NULL,NULL,NULL,  NULL,NULL,NULL),

-- Artillery: bombard-only; no direct fire. Auto-destroyed alone vs enemies in close combat.
('10000000-0000-0000-0000-000000000001', 'Artillery',
  ARRAY['ground','heavy'],
  NULL, 4, 0, NULL,   1, 1,  2, 1, 1,  0, 2,
  NULL,NULL,NULL,NULL,  NULL,NULL,NULL,  6, 7, 0),

('10000000-0000-0000-0000-000000000001', 'AT Gun',
  ARRAY['ground','heavy'],
  8, 5, 2, 2,   1, 1,  2, 1, 1,  0, 2,
  NULL,NULL,NULL,NULL,  NULL,NULL,NULL,  NULL,NULL,NULL),

-- AA Gun: overwatch fires at detected aircraft passively in Phase 1.
('10000000-0000-0000-0000-000000000001', 'AA Gun',
  ARRAY['ground','air','heavy'],
  6, 4, 1, 1,   1, 1,  2, 1, 1,  0, 1,
  NULL,NULL,NULL,NULL,  7, 0, 2,  NULL,NULL,NULL),

('10000000-0000-0000-0000-000000000001', 'Recon',
  ARRAY['ground','mobile','stealth'],
  8, 5, 0, 2,   1, 1,  2, 1, 1,  3, 3,
  NULL,NULL,NULL,NULL,  NULL,NULL,NULL,  NULL,NULL,NULL),

-- ── Air ──────────────────────────────────────────────────────────────────────

('10000000-0000-0000-0000-000000000001', 'Fighter',
  ARRAY['air'],
  7, 7, 0, 1,   30, 5,  4, 2, 2,  0, 3,
  NULL,NULL,NULL,NULL,  NULL,NULL,NULL,  NULL,NULL,NULL),

-- Scout Plane: LOS only; reports on return to home base.
('10000000-0000-0000-0000-000000000001', 'Scout Plane',
  ARRAY['air','stealth'],
  NULL, 6, 0, NULL,   35, 6,  3, 1, 2,  4, 4,
  NULL,NULL,NULL,NULL,  NULL,NULL,NULL,  NULL,NULL,NULL),

-- Bomber: HP-based (3 HP per aircraft). Bombing run stats handled in air phase code.
('10000000-0000-0000-0000-000000000001', 'Bomber',
  ARRAY['air','heavy'],
  5, 6, 0, 1,   40, 5,  5, 2, 3,  0, 2,
  NULL, 3, NULL, NULL,  NULL,NULL,NULL,  NULL,NULL,NULL),

('10000000-0000-0000-0000-000000000001', 'Transport Plane',
  ARRAY['air','ground'],
  NULL, 3, 0, NULL,   25, 3,  3, 1, 2,  0, 1,
  NULL,NULL,NULL,NULL,  NULL,NULL,NULL,  NULL,NULL,NULL),

-- ── Naval (HP-based; atk_dice = attack dice per ship) ────────────────────────

-- Destroyer: fast ASW platform. detection_rating 7 gives ~28% detection vs sub at range 1.
('10000000-0000-0000-0000-000000000001', 'Destroyer',
  ARRAY['naval','mobile'],
  6, 6, 1, 1,   3, 4,  3, 1, 2,  0, 7,
  1, 6, 3, NULL,  NULL,NULL,NULL,  NULL,NULL,NULL),

-- Frigate: AA overwatch platform.
('10000000-0000-0000-0000-000000000001', 'Frigate',
  ARRAY['naval','air'],
  6, 7, 0, 1,   3, 5,  4, 2, 2,  0, 5,
  1, 7, NULL, NULL,  7, 1, 3,  NULL,NULL,NULL),

('10000000-0000-0000-0000-000000000001', 'Cruiser',
  ARRAY['naval'],
  7, 7, 1, 2,   3, 4,  4, 2, 2,  0, 4,
  2, 8, NULL, NULL,  NULL,NULL,NULL,  NULL,NULL,NULL),

-- Battleship: bombards any hex in range. AA point-defense only.
('10000000-0000-0000-0000-000000000001', 'Battleship',
  ARRAY['naval','armored','heavy'],
  7, 9, 2, 3,   3, 4,  6, 3, 3,  0, 3,
  3, 12, NULL, NULL,  6, 0, 1,  8, 6, 2),

('10000000-0000-0000-0000-000000000001', 'Transport Ship',
  ARRAY['naval','ground'],
  NULL, 4, 0, NULL,   3, 4,  2, 1, 1,  0, 2,
  0, 5, NULL, NULL,  NULL,NULL,NULL,  NULL,NULL,NULL),

-- Carrier: floating airbase. carrier_slots = 4.
('10000000-0000-0000-0000-000000000001', 'Carrier',
  ARRAY['naval','air'],
  6, 6, 0, 1,   3, 5,  5, 2, 3,  0, 5,
  1, 10, NULL, 4,  NULL,NULL,NULL,  NULL,NULL,NULL),

-- Submarine: stealth_rating 8 makes it invisible to regular ships (detection impossible).
-- Destroyers (det=7) detect at ~28% per turn at range 1.
('10000000-0000-0000-0000-000000000001', 'Submarine',
  ARRAY['naval','stealth'],
  6, 7, 2, 1,   3, 0,  4, 2, 2,  8, 5,
  2, 6, 4, NULL,  NULL,NULL,NULL,  NULL,NULL,NULL);
