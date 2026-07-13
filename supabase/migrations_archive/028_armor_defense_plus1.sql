-- 028: Armor defense +1 — dying too fast after global defense nerf in 027.

UPDATE unit_type_templates SET defense = defense + 1 WHERE name = 'Armor';
UPDATE unit_type_config SET defense = defense + 1 WHERE name = 'Armor';
