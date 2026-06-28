import { Router } from 'express';
import { adminDb } from '../db.js';
import { requireGM } from '../middleware/auth.js';
import { resolveTurn } from '../utils/resolveTurn.js';

const router = Router();

// POST /api/gm/:gameId/units — place or add to a unit stack on the map
// If a stack of the same faction+type already exists at that hex, quantity is added to it.
router.post('/:gameId/units', requireGM, async (req, res) => {
  const { faction_id, unit_type_name, hex_q, hex_r, quantity = 1 } = req.body;
  const gameId = req.params.gameId;

  const { data: unitType } = await adminDb
    .from('unit_type_config')
    .select('id')
    .eq('game_id', gameId)
    .eq('name', unit_type_name)
    .single();

  if (!unitType) return res.status(400).json({ error: `Unknown unit type: ${unit_type_name}` });

  // Check for existing stack
  const { data: existing } = await adminDb
    .from('units')
    .select('id, quantity')
    .eq('game_id', gameId)
    .eq('faction_id', faction_id)
    .eq('unit_type_id', unitType.id)
    .eq('hex_q', hex_q)
    .eq('hex_r', hex_r)
    .maybeSingle();

  if (existing) {
    const { data, error } = await adminDb
      .from('units')
      .update({ quantity: existing.quantity + quantity })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  const { data, error } = await adminDb
    .from('units')
    .insert({ game_id: gameId, faction_id, unit_type_id: unitType.id, hex_q, hex_r, quantity })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/gm/:gameId/units/:unitId — adjust unit quantity by a delta
// Body: { quantity_delta: number }  positive = add, negative = remove
// Deletes the unit if quantity reaches 0.
router.patch('/:gameId/units/:unitId', requireGM, async (req, res) => {
  const { quantity_delta } = req.body;
  if (quantity_delta === undefined) return res.status(400).json({ error: 'quantity_delta required' });

  const { data: unit } = await adminDb
    .from('units')
    .select('id, quantity')
    .eq('id', req.params.unitId)
    .single();

  if (!unit) return res.status(404).json({ error: 'Unit not found' });

  const newQty = unit.quantity + quantity_delta;
  if (newQty <= 0) {
    await adminDb.from('units').delete().eq('id', unit.id);
    return res.json({ deleted: true });
  }

  const { data, error } = await adminDb
    .from('units')
    .update({ quantity: newQty })
    .eq('id', unit.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/gm/:gameId/units/:unitId — remove entire unit stack
router.delete('/:gameId/units/:unitId', requireGM, async (req, res) => {
  await adminDb.from('units').delete().eq('id', req.params.unitId);
  res.json({ ok: true });
});

// PATCH /api/gm/:gameId/factions/:factionId/resources
router.patch('/:gameId/factions/:factionId/resources', requireGM, async (req, res) => {
  const { materials, manpower } = req.body;
  const updates = {};
  if (materials !== undefined) updates.materials = materials;
  if (manpower !== undefined) updates.manpower = manpower;

  const { data, error } = await adminDb
    .from('factions')
    .update(updates)
    .eq('id', req.params.factionId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/gm/:gameId/settings — update game-level GM settings
// Body: { auto_resolve?: boolean }
router.patch('/:gameId/settings', requireGM, async (req, res) => {
  const { auto_resolve } = req.body;
  const updates = {};
  if (auto_resolve !== undefined) updates.auto_resolve = auto_resolve;
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  const { data, error } = await adminDb
    .from('games')
    .update(updates)
    .eq('id', req.params.gameId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─── Building management ────────────────────────────────────────────────────

const BUILDING_MAX_HP = {
  factory: 20, airbase: 10, harbor: 10,
  airstrip: 4, bridge: 4, fortification: 4,
};

// POST /api/gm/:gameId/buildings — place a building (full HP by default = operational)
router.post('/:gameId/buildings', requireGM, async (req, res) => {
  const { hex_q, hex_r, type, owner_faction_id, current_hp } = req.body;
  if (!type || hex_q == null || hex_r == null) {
    return res.status(400).json({ error: 'type, hex_q, hex_r required' });
  }
  const max_hp = BUILDING_MAX_HP[type];
  if (!max_hp) return res.status(400).json({ error: `Unknown building type: ${type}` });

  const hp = current_hp != null ? Math.min(Number(current_hp), max_hp) : max_hp;
  const { data, error } = await adminDb.from('buildings').insert({
    game_id: req.params.gameId,
    hex_q: Number(hex_q), hex_r: Number(hex_r),
    type, max_hp, current_hp: hp,
    owner_faction_id: owner_faction_id || null,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/gm/:gameId/buildings/:id — update HP or owner
router.patch('/:gameId/buildings/:id', requireGM, async (req, res) => {
  const updates = {};
  if (req.body.current_hp !== undefined) updates.current_hp = Number(req.body.current_hp);
  if (req.body.owner_faction_id !== undefined) updates.owner_faction_id = req.body.owner_faction_id || null;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

  const { data, error } = await adminDb.from('buildings').update(updates)
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/gm/:gameId/buildings/:id
router.delete('/:gameId/buildings/:id', requireGM, async (req, res) => {
  await adminDb.from('buildings').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// ─── Resource tile management ────────────────────────────────────────────────

// POST /api/gm/:gameId/resource-tiles — place or update resource tile on a hex
router.post('/:gameId/resource-tiles', requireGM, async (req, res) => {
  const { hex_q, hex_r, tile_type = 'resource', owner_faction_id } = req.body;
  if (hex_q == null || hex_r == null) return res.status(400).json({ error: 'hex_q, hex_r required' });

  const { data, error } = await adminDb.from('resource_tiles').upsert({
    game_id: req.params.gameId,
    hex_q: Number(hex_q), hex_r: Number(hex_r),
    tile_type, owner_faction_id: owner_faction_id || null,
  }, { onConflict: 'game_id,hex_q,hex_r' }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/gm/:gameId/resource-tiles/:id
router.delete('/:gameId/resource-tiles/:id', requireGM, async (req, res) => {
  await adminDb.from('resource_tiles').delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// ─── Combat log ──────────────────────────────────────────────────────────────

// GET /api/gm/:gameId/combat-log?turn=N
// Returns combat_log entries for the given turn (defaults to last completed turn).
router.get('/:gameId/combat-log', requireGM, async (req, res) => {
  const { gameId } = req.params;
  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', gameId).single();
  const currentTurn = game?.current_turn ?? 1;
  const turn = req.query.turn != null ? Number(req.query.turn) : currentTurn - 1;

  if (turn < 0) return res.json({ turn: 0, entries: [] });

  const { data: entries, error } = await adminDb
    .from('combat_log')
    .select('id, turn, phase, hex_q, hex_r, log_type, faction_id, data, created_at')
    .eq('game_id', gameId)
    .eq('turn', turn)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ turn, current_turn: currentTurn, entries: entries ?? [] });
});

// POST /api/gm/:gameId/advance-turn — resolve current turn and advance
router.post('/:gameId/advance-turn', requireGM, async (req, res) => {
  try {
    const result = await resolveTurn(adminDb, req.params.gameId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
