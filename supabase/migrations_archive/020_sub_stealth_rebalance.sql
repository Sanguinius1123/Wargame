-- Migration 020: Submarine stealth rebalance
--
-- Problem: stealth_rating=6 on submarines vs detection_rating=6 on destroyers
-- gives 7+6-6-1=6 → 42% detection at range 1. Sub stealth was also trivially
-- bypassed because enemy subs were visible in the hexes API regardless.
--
-- Fix:
--   Sub stealth_rating 6 → 8
--     Regular ships (detection=2) at range 1: score = 7+2-8-1 = 0 < 2 → impossible
--     Destroyers (detection=7) at range 1:    score = 7+7-8-1 = 5 → 28% detection
--   Destroyer detection_rating 6 → 7
--     Makes destroyers a meaningful ASW platform (~28% per turn vs ~0% for others)
--
-- Updates both unit_type_templates (new games) and unit_type_config (existing games).

-- Templates (new games)
UPDATE unit_type_templates SET stealth_rating  = 8 WHERE name = 'Submarine';
UPDATE unit_type_templates SET detection_rating = 7 WHERE name = 'Destroyer';

-- Existing game configs
UPDATE unit_type_config SET stealth_rating  = 8 WHERE name = 'Submarine';
UPDATE unit_type_config SET detection_rating = 7 WHERE name = 'Destroyer';
