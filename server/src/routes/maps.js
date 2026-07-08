import { Router } from 'express';
import { adminDb } from '../db.js';
import { requireAuth, requireGM } from '../middleware/auth.js';

const router = Router();

// GET /api/maps — list all saved map templates with hex + faction counts
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await adminDb
    .from('maps')
    .select('id, name, description, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const ids = (data ?? []).map(m => m.id);
  let hexCounts = {}, factionCounts = {};

  if (ids.length > 0) {
    const [{ data: hexRows }, { data: facRows }] = await Promise.all([
      adminDb.from('map_hexes').select('map_id').in('map_id', ids),
      adminDb.from('map_factions').select('map_id').in('map_id', ids),
    ]);
    for (const r of hexRows ?? []) hexCounts[r.map_id] = (hexCounts[r.map_id] ?? 0) + 1;
    for (const r of facRows ?? []) factionCounts[r.map_id] = (factionCounts[r.map_id] ?? 0) + 1;
  }

  res.json((data ?? []).map(m => ({
    ...m,
    hex_count:     hexCounts[m.id]     ?? 0,
    faction_count: factionCounts[m.id] ?? 0,
  })));
});

// GET /api/maps/:mapId/factions — list faction slots for a map template
router.get('/:mapId/factions', requireAuth, async (req, res) => {
  const { data, error } = await adminDb
    .from('map_factions')
    .select('id, name, color, slot')
    .eq('map_id', req.params.mapId)
    .order('slot');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// POST /api/maps/:mapId/factions — add a faction slot to a map template
router.post('/:mapId/factions', requireGM, async (req, res) => {
  const { name, color = '#3b82f6' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  // Auto-assign next slot index
  const { data: existing } = await adminDb
    .from('map_factions').select('slot').eq('map_id', req.params.mapId).order('slot', { ascending: false }).limit(1);
  const slot = (existing?.[0]?.slot ?? -1) + 1;

  const { data, error } = await adminDb.from('map_factions')
    .insert({ map_id: req.params.mapId, name: name.trim(), color, slot })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/maps/:mapId/factions/:id — update name or color of a faction slot
router.patch('/:mapId/factions/:id', requireGM, async (req, res) => {
  const updates = {};
  if (req.body.name  !== undefined) updates.name  = req.body.name;
  if (req.body.color !== undefined) updates.color = req.body.color;

  const { data, error } = await adminDb.from('map_factions')
    .update(updates).eq('id', req.params.id).eq('map_id', req.params.mapId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/maps/:mapId/factions/:id — remove a faction slot (and its pre-placed units)
router.delete('/:mapId/factions/:id', requireGM, async (req, res) => {
  // Also delete any map_units belonging to this faction
  const { data: faction } = await adminDb.from('map_factions')
    .select('name').eq('id', req.params.id).single();
  if (faction) {
    await adminDb.from('map_units')
      .delete().eq('map_id', req.params.mapId).eq('faction_name', faction.name);
  }
  await adminDb.from('map_factions').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// GET /api/maps/:mapId/units — list pre-placed units for a map template
router.get('/:mapId/units', requireAuth, async (req, res) => {
  const { data, error } = await adminDb
    .from('map_units')
    .select('id, faction_name, hex_q, hex_r, unit_type_name, quantity')
    .eq('map_id', req.params.mapId);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// POST /api/maps/:mapId/units — add or update a pre-placed unit
// Body: { faction_name, hex_q, hex_r, unit_type_name, quantity }
router.post('/:mapId/units', requireGM, async (req, res) => {
  const { faction_name, hex_q, hex_r, unit_type_name, quantity = 1 } = req.body;
  if (!faction_name || hex_q == null || hex_r == null || !unit_type_name) {
    return res.status(400).json({ error: 'faction_name, hex_q, hex_r, unit_type_name required' });
  }

  const { data, error } = await adminDb.from('map_units')
    .insert({ map_id: req.params.mapId, faction_name, hex_q, hex_r, unit_type_name, quantity })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/maps/:mapId/units/:id — update quantity of a pre-placed unit
router.patch('/:mapId/units/:id', requireGM, async (req, res) => {
  const { quantity } = req.body;
  if (!quantity || quantity < 1) {
    await adminDb.from('map_units').delete().eq('id', req.params.id);
    return res.json({ deleted: true });
  }
  const { data, error } = await adminDb.from('map_units')
    .update({ quantity }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/maps/:mapId/units/:id — remove a pre-placed unit
router.delete('/:mapId/units/:id', requireGM, async (req, res) => {
  await adminDb.from('map_units').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

export default router;
