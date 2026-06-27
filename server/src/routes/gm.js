import { Router } from 'express';
import { adminDb } from '../db.js';
import { requireGM } from '../middleware/auth.js';

const router = Router();

// POST /api/gm/:gameId/units — place a unit on the map
router.post('/:gameId/units', requireGM, async (req, res) => {
  const { faction_id, unit_type_name, hex_q, hex_r, quantity = 1 } = req.body;

  const { data: unitType } = await adminDb
    .from('unit_type_config')
    .select('id')
    .eq('game_id', req.params.gameId)
    .eq('name', unit_type_name)
    .single();

  if (!unitType) return res.status(400).json({ error: `Unknown unit type: ${unit_type_name}` });

  const { data, error } = await adminDb
    .from('units')
    .upsert({
      game_id: req.params.gameId,
      faction_id,
      unit_type_id: unitType.id,
      hex_q,
      hex_r,
      quantity,
    }, { onConflict: 'faction_id,unit_type_id,hex_q,hex_r' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/gm/:gameId/units/:unitId
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

// POST /api/gm/:gameId/advance-turn — manually advance to next turn
router.post('/:gameId/advance-turn', requireGM, async (req, res) => {
  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', req.params.gameId).single();

  const currentTurn = game?.current_turn ?? 0;
  const nextTurn = currentTurn + 1;

  // TODO: implement full 4-phase resolution pipeline (combat, movement, production, collection)
  // For now: just clear orders and increment the turn counter.

  // Clear movement orders for this turn
  await adminDb
    .from('movement_orders')
    .delete()
    .eq('game_id', req.params.gameId)
    .eq('turn', currentTurn);

  // Advance turn
  const { data: updated, error } = await adminDb
    .from('games')
    .update({ current_turn: nextTurn })
    .eq('id', req.params.gameId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(updated);
});

export default router;
