-- 025: AA Gun detection_rating 4 → 1
-- AA Gun has no special ground-spotting ability. Detection vs air units will be
-- handled separately when the Phase 1 air system is built (air_detection_rating column).

UPDATE unit_type_templates SET detection_rating = 1 WHERE name = 'AA Gun';
UPDATE unit_type_config    SET detection_rating = 1 WHERE name = 'AA Gun';
