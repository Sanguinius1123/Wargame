-- 024: Stat tweaks
-- Artillery bombard_range 8 → 6 (shorter effective range)
-- Recon move 2 → 1 (same speed as foot infantry)

UPDATE unit_type_templates SET bombard_range = 6 WHERE name = 'Artillery';
UPDATE unit_type_templates SET move = 1          WHERE name = 'Recon';

UPDATE unit_type_config    SET bombard_range = 6 WHERE name = 'Artillery';
UPDATE unit_type_config    SET move = 1          WHERE name = 'Recon';
