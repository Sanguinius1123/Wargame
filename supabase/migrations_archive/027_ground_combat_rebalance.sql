-- 027: Ground combat rebalance — combats resolving too slowly.
-- All ground units: to_hit +1, defense -1.
-- Artillery has no direct to_hit, so bombard_to_hit is bumped instead.

UPDATE unit_type_templates SET to_hit = to_hit + 1, defense = defense - 1
  WHERE name IN ('Infantry', 'AA Gun', 'AT Gun', 'Recon', 'Armor');

UPDATE unit_type_templates SET bombard_to_hit = bombard_to_hit + 1, defense = defense - 1
  WHERE name = 'Artillery';

UPDATE unit_type_config SET to_hit = to_hit + 1, defense = defense - 1
  WHERE name IN ('Infantry', 'AA Gun', 'AT Gun', 'Recon', 'Armor');

UPDATE unit_type_config SET bombard_to_hit = bombard_to_hit + 1, defense = defense - 1
  WHERE name = 'Artillery';
