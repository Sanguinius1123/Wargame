-- Remove penetration from artillery bombardment (balance: saves at full defense value)
UPDATE unit_type_templates SET bombard_pen = 0 WHERE name = 'Artillery';
UPDATE unit_type_config    SET bombard_pen = 0 WHERE name = 'Artillery';
