-- Add vegetation_hp to map_hexes so saved templates preserve vegetation state.
ALTER TABLE map_hexes ADD COLUMN IF NOT EXISTS vegetation_hp INTEGER DEFAULT NULL;
