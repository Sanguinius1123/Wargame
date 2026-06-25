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
  const { production, manpower } = req.body;
  const updates = {};
  if (production !== undefined) updates.production = production;
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

  // Simple advance: increment turn, clear orders, collect resources
  const nextTurn = (game?.current_turn ?? 0) + 1;

  // Collect resources from owned hexes
  const { data: hexes } = await adminDb
    .from('hexes')
    .select('owner_faction_id, terrain, development, terrain_type_config(production, manpower)')
    .eq('game_id', req.params.gameId)
    .not('owner_faction_id', 'is', null);

  const factionDeltas = {};
  for (const hex of hexes ?? []) {
    const fid = hex.owner_faction_id;
    if (!factionDeltas[fid]) factionDeltas[fid] = { production: 0, manpower: 0 };
    const dev = Math.max(1, hex.development);
    factionDeltas[fid].production += (hex.terrain_type_config?.production ?? 0) * dev;
    factionDeltas[fid].manpower   += (hex.terrain_type_config?.manpower   ?? 0) * dev;
  }

  for (const [fid, delta] of Object.entries(factionDeltas)) {
    const { data: faction } = await adminDb.from('factions').select('production, manpower').eq('id', fid).single();
    await adminDb.from('factions').update({
      production: (faction?.production ?? 0) + delta.production,
      manpower:   (faction?.manpower   ?? 0) + delta.manpower,
    }).eq('id', fid);
  }

  // Apply movement orders
  const { data: orders } = await adminDb
    .from('movement_orders')
    .select('unit_id, to_hex_q, to_hex_r')
    .eq('game_id', req.params.gameId)
    .eq('turn', game.current_turn);

  for (const order of orders ?? []) {
    await adminDb.from('units').update({ hex_q: order.to_hex_q, hex_r: order.to_hex_r }).eq('id', order.unit_id);
  }

  // Clear orders for this turn
  await adminDb.from('movement_orders').delete().eq('game_id', req.params.gameId).eq('turn', game.current_turn);

  // Advance turn
  const { data: updated } = await adminDb
    .from('games')
    .update({ current_turn: nextTurn })
    .eq('id', req.params.gameId)
    .select()
    .single();

  res.json(updated);
});

export default router;
