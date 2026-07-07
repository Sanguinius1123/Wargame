-- =============================================================
-- 019_settings.sql — Game settings system
--
-- Introduces a "setting" concept: a named ruleset (e.g. "Great War")
-- that defines the unit roster for a game. A settings table holds
-- named settings; unit_type_templates mirrors unit_type_config but
-- is keyed by setting_id rather than game_id. When a new game is
-- created the server copies the chosen setting's templates into
-- unit_type_config for that game.
--
-- Also seeds the "Great War" setting (WW1/WW2 era) and backfills
-- any existing games that have no unit types.
-- =============================================================

-- ── Settings ──────────────────────────────────────────────────────────────────

CREATE TABLE settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads settings" ON settings FOR SELECT USING (true);

-- ── Unit type templates (per setting) ────────────────────────────────────────
-- Mirrors unit_type_config exactly except keyed by setting_id.

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

ALTER TABLE unit_type_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads unit type templates" ON unit_type_templates FOR SELECT USING (true);

-- ── Link games to their setting ───────────────────────────────────────────────

ALTER TABLE games ADD COLUMN IF NOT EXISTS setting_id UUID REFERENCES settings(id) ON DELETE SET NULL;

-- ── Great War setting ─────────────────────────────────────────────────────────

INSERT INTO settings (id, name, description) VALUES (
  '10000000-0000-0000-0000-000000000001',
  'Great War',
  'WW1/WW2 era operational warfare. Infantry pushes through mud, armor breaks the line, artillery levels cities, and naval fleets contest the seas.'
);

-- ── Great War unit roster ─────────────────────────────────────────────────────
-- Ground: foot move=1, mechanized move=2, LOS=1 (strategic scale)
-- Air:    fighter=30, scout=35, bomber=40, transport=25
-- Naval:  all move=3 (HP-based)

INSERT INTO unit_type_templates (
  setting_id, name, tags,
  to_hit, defense, penetration, atk_range,
  move, los,
  mat_cost, man_cost, slots,
  stealth_rating, detection_rating,
  atk_dice, hp, sonar_range, carrier_slots,
  overwatch_to_hit, overwatch_pen, overwatch_range,
  bombard_range, bombard_to_hit, bombard_pen
) VALUES

-- ── Ground ────────────────────────────────────────────────────────────────────

-- Infantry: rifle squad. Foot movement. Core manpower sink.
(
  '10000000-0000-0000-0000-000000000001', 'Infantry',
  ARRAY['ground'],
  6, 6, 0, 1,
  1, 1,
  1, 1, 1,
  0, 2,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- Armor: tank battalion. Mechanized; smashes infantry defenses.
(
  '10000000-0000-0000-0000-000000000001', 'Armor',
  ARRAY['ground', 'mobile', 'armored', 'mechanized'],
  7, 8, 2, 2,
  2, 1,
  4, 2, 2,
  0, 2,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- Artillery: indirect fire only. Bombard range 8. No direct fire whatsoever.
(
  '10000000-0000-0000-0000-000000000001', 'Artillery',
  ARRAY['ground', 'heavy'],
  NULL, 5, 1, NULL,
  1, 1,
  2, 1, 1,
  0, 2,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  8, 6, 1
),

-- AT Gun: dedicated anti-armor direct fire. Pen 2 counters tanks.
(
  '10000000-0000-0000-0000-000000000001', 'AT Gun',
  ARRAY['ground', 'heavy'],
  7, 6, 2, 2,
  1, 1,
  2, 1, 1,
  0, 2,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- AA Gun: overwatch fires at aircraft passively in Phase 1. No direct-fire order needed.
(
  '10000000-0000-0000-0000-000000000001', 'AA Gun',
  ARRAY['ground', 'air', 'heavy'],
  5, 5, 1, 1,
  1, 1,
  2, 1, 1,
  0, 4,
  NULL, NULL, NULL, NULL,
  7, 0, 2,
  NULL, NULL, NULL
),

-- Recon: stealthy ground scout. Extended detection rating.
(
  '10000000-0000-0000-0000-000000000001', 'Recon',
  ARRAY['ground', 'mobile', 'stealth'],
  7, 6, 0, 2,
  2, 1,
  2, 1, 1,
  3, 3,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- ── Air ───────────────────────────────────────────────────────────────────────

-- Fighter: air superiority. Quantity stack. Intercept and sweep missions.
(
  '10000000-0000-0000-0000-000000000001', 'Fighter',
  ARRAY['air'],
  7, 7, 0, 1,
  30, 5,
  4, 2, 2,
  0, 3,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- Scout Plane: stealthy recon; LOS extended, reports on return home.
(
  '10000000-0000-0000-0000-000000000001', 'Scout Plane',
  ARRAY['air', 'stealth'],
  NULL, 6, 0, NULL,
  35, 6,
  3, 1, 2,
  4, 4,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- Bomber: HP-based (3 HP per aircraft). Quantity = ceil(hp/3).
-- Air-to-air: To-Hit 5, Pen 0, fires ceil(hp/3) dice in intercept.
-- Bombing Run: To-Hit 7, Pen 1, 1 die per bomber per hex.
(
  '10000000-0000-0000-0000-000000000001', 'Bomber',
  ARRAY['air', 'heavy'],
  5, 6, 0, 1,
  40, 5,
  5, 2, 3,
  0, 2,
  NULL, 3, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- Transport Plane: carries ground units; no attack capability.
(
  '10000000-0000-0000-0000-000000000001', 'Transport Plane',
  ARRAY['air', 'ground'],
  NULL, 3, 0, NULL,
  25, 3,
  3, 1, 2,
  0, 1,
  NULL, NULL, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- ── Naval (HP-based; atk_dice = attack dice per ship) ────────────────────────

-- Destroyer: fast anti-submarine platform. Sonar range 3.
(
  '10000000-0000-0000-0000-000000000001', 'Destroyer',
  ARRAY['naval', 'mobile'],
  6, 6, 1, 1,
  3, 4,
  3, 1, 2,
  0, 6,
  1, 6, 3, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- Frigate: AA overwatch platform. Fires at aircraft in Phase 1.
(
  '10000000-0000-0000-0000-000000000001', 'Frigate',
  ARRAY['naval', 'air'],
  6, 7, 0, 1,
  3, 5,
  4, 2, 2,
  0, 5,
  1, 7, NULL, NULL,
  7, 1, 3,
  NULL, NULL, NULL
),

-- Cruiser: heavy surface combatant. Good pen and HP.
(
  '10000000-0000-0000-0000-000000000001', 'Cruiser',
  ARRAY['naval'],
  7, 7, 1, 2,
  3, 4,
  4, 2, 2,
  0, 4,
  2, 8, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- Battleship: most powerful naval unit. Bombards land/water (3-hex triangle).
-- AA overwatch: point defense only (range 1).
(
  '10000000-0000-0000-0000-000000000001', 'Battleship',
  ARRAY['naval', 'armored', 'heavy'],
  7, 9, 2, 3,
  3, 4,
  6, 3, 3,
  0, 3,
  3, 12, NULL, NULL,
  6, 0, 1,
  8, 6, 2
),

-- Transport Ship: carries ground units for amphibious landings. No attack.
(
  '10000000-0000-0000-0000-000000000001', 'Transport Ship',
  ARRAY['naval', 'ground'],
  NULL, 4, 0, NULL,
  3, 4,
  2, 1, 1,
  0, 2,
  0, 5, NULL, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- Carrier: floating airbase. Carries up to 4 air units.
(
  '10000000-0000-0000-0000-000000000001', 'Carrier',
  ARRAY['naval', 'air'],
  6, 6, 0, 1,
  3, 5,
  5, 2, 3,
  0, 5,
  1, 10, NULL, 4,
  NULL, NULL, NULL,
  NULL, NULL, NULL
),

-- Submarine: stealthy; undetected attack against surface ships. Sonar range 4.
(
  '10000000-0000-0000-0000-000000000001', 'Submarine',
  ARRAY['naval', 'stealth'],
  6, 7, 2, 1,
  3, 0,
  4, 2, 2,
  6, 5,
  2, 6, 4, NULL,
  NULL, NULL, NULL,
  NULL, NULL, NULL
);

-- ── Backfill existing games ───────────────────────────────────────────────────
-- Any game with 0 unit_type_config rows gets the Great War roster.

DO $$
DECLARE
  gw UUID := '10000000-0000-0000-0000-000000000001';
  g  RECORD;
BEGIN
  FOR g IN
    SELECT id FROM games
    WHERE id NOT IN (SELECT DISTINCT game_id FROM unit_type_config)
  LOOP
    INSERT INTO unit_type_config (
      game_id, name, tags,
      to_hit, defense, penetration, atk_range,
      move, los,
      mat_cost, man_cost, slots,
      stealth_rating, detection_rating,
      atk_dice, hp, sonar_range, carrier_slots,
      overwatch_to_hit, overwatch_pen, overwatch_range,
      bombard_range, bombard_to_hit, bombard_pen
    )
    SELECT
      g.id, name, tags,
      to_hit, defense, penetration, atk_range,
      move, los,
      mat_cost, man_cost, slots,
      stealth_rating, detection_rating,
      atk_dice, hp, sonar_range, carrier_slots,
      overwatch_to_hit, overwatch_pen, overwatch_range,
      bombard_range, bombard_to_hit, bombard_pen
    FROM unit_type_templates
    WHERE setting_id = gw;

    UPDATE games SET setting_id = gw WHERE id = g.id;
  END LOOP;
END $$;
