-- Add vegetation_hp as the single source of truth for vegetation state.
-- Thresholds: >= 11 = heavy, 1–10 = light, 0 = cleared.
-- Booleans are kept in sync by server code but remain for performance filtering.

ALTER TABLE hexes ADD COLUMN IF NOT EXISTS vegetation_hp INTEGER DEFAULT NULL;

-- Populate from existing boolean flags using the defined random ranges.
UPDATE hexes
SET vegetation_hp = floor(random() * 5 + 16)::integer   -- 16–20
WHERE has_heavy_vegetation = true;

UPDATE hexes
SET vegetation_hp = floor(random() * 5 + 6)::integer    -- 6–10
WHERE has_light_vegetation = true AND has_heavy_vegetation = false;

-- Hexes with no vegetation stay NULL.
