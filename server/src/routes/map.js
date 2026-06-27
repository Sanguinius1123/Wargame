import { Router } from 'express';
import { adminDb } from '../db.js';
import { requireAuth, requireGM } from '../middleware/auth.js';
import { computeVisibility, markScouted } from '../utils/visibility.js';

const router = Router();

// GET /api/map/:gameId/hexes
// GM: all hexes with units. Player: fog-of-war filtered.
router.get('/:gameId/hexes', requireAuth, async (req, res) => {
  const { gameId } = req.params;
  const isGM = req.user.global_role === 'gm';

  // Load all hexes (GM queries bypass RLS via adminDb)
  const { data: hexes, error } = await adminDb
    .from('hexes')
    .select('id, hex_q, hex_r, terrain, owner_faction_id, has_light_vegetation, has_heavy_vegetation, has_urban, urban_hp, has_settlement, has_road, has_canal, has_railroad')
    .eq('game_id', gameId);
  if (error) return res.status(500).json({ error: error.message });

  // Load all units grouped by hex
  const { data: units } = await adminDb
    .from('units')
    .select('hex_q, hex_r, quantity, hp, faction_id, factions(name, color), unit_type_config(name, tags)')
    .eq('game_id', gameId);

  const unitsByHex = {};
  for (const u of units ?? []) {
    const k = `${u.hex_q},${u.hex_r}`;
    if (!unitsByHex[k]) unitsByHex[k] = [];
    unitsByHex[k].push({
      type: u.unit_type_config?.name,
      tags: u.unit_type_config?.tags ?? [],
      quantity: u.quantity,
      hp: u.hp,
      factionId: u.faction_id,
      factionName: u.factions?.name,
      factionColor: u.factions?.color,
    });
  }

  if (isGM) {
    return res.json(hexes.map(h => ({
      ...h,
      units: unitsByHex[`${h.hex_q},${h.hex_r}`] ?? [],
      visibility: 'visible',
    })));
  }

  // Player path: find their faction, compute visibility
  const { data: faction } = await adminDb
    .from('factions')
    .select('id')
    .eq('game_id', gameId)
    .eq('profile_id', req.user.id)
    .single();

  if (!faction) return res.status(403).json({ error: 'Not a participant in this game' });

  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', gameId).single();
  const { visible, scouted } = await computeVisibility(adminDb, faction.id, gameId);

  markScouted(adminDb, faction.id, gameId, visible, game?.current_turn ?? 0);

  res.json(hexes.map(h => {
    const k = `${h.hex_q},${h.hex_r}`;
    if (visible.has(k)) {
      return { ...h, units: unitsByHex[k] ?? [], visibility: 'visible' };
    }
    if (scouted.has(k)) {
      return { hex_q: h.hex_q, hex_r: h.hex_r, terrain: h.terrain, visibility: 'scouted', units: [] };
    }
    return { hex_q: h.hex_q, hex_r: h.hex_r, visibility: 'dark', units: [] };
  }));
});

// GET /api/map/:gameId/hexes/:q/:r — single hex detail
router.get('/:gameId/hexes/:q/:r', requireAuth, async (req, res) => {
  const { gameId, q, r } = req.params;

  const { data: hex } = await adminDb
    .from('hexes')
    .select('*, terrain_type_config(*)')
    .eq('game_id', gameId)
    .eq('hex_q', q)
    .eq('hex_r', r)
    .single();

  if (!hex) return res.status(404).json({ error: 'Hex not found' });

  const { data: units } = await adminDb
    .from('units')
    .select('id, quantity, hp, standing_order, fortification_level, faction_id, factions(name, color), unit_type_config(name, tags, to_hit, defense, penetration, atk_range, move, los, bombard_range, bombard_to_hit, overwatch_to_hit, overwatch_range)')
    .eq('game_id', gameId)
    .eq('hex_q', q)
    .eq('hex_r', r);

  res.json({ ...hex, units: units ?? [] });
});

// PATCH /api/map/:gameId/hexes/:q/:r — GM edits a hex
router.patch('/:gameId/hexes/:q/:r', requireGM, async (req, res) => {
  const { gameId, q, r } = req.params;
  const {
    terrain, owner_faction_id,
    has_light_vegetation, has_heavy_vegetation, has_urban, urban_hp,
    has_settlement, has_road, has_canal, has_railroad,
  } = req.body;

  const updates = {};
  if (terrain !== undefined) updates.terrain = terrain;
  if (owner_faction_id !== undefined) updates.owner_faction_id = owner_faction_id;
  if (has_light_vegetation !== undefined) updates.has_light_vegetation = has_light_vegetation;
  if (has_heavy_vegetation !== undefined) updates.has_heavy_vegetation = has_heavy_vegetation;
  if (has_urban !== undefined) updates.has_urban = has_urban;
  if (urban_hp !== undefined) updates.urban_hp = urban_hp;
  if (has_settlement !== undefined) updates.has_settlement = has_settlement;
  if (has_road !== undefined) updates.has_road = has_road;
  if (has_canal !== undefined) updates.has_canal = has_canal;
  if (has_railroad !== undefined) updates.has_railroad = has_railroad;

  const { data, error } = await adminDb
    .from('hexes')
    .update(updates)
    .eq('game_id', gameId)
    .eq('hex_q', q)
    .eq('hex_r', r)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/map/:gameId/orders — player queues orders for a unit
// Body: { unit_id, order_type, to_hex_q?, to_hex_r?, target_hex_q?, target_hex_r?, path? }
// path is an array of {q, r} steps for multi-hex movement; clears previous orders for this unit.
router.post('/:gameId/orders', requireAuth, async (req, res) => {
  const { unit_id, order_type = 'move', to_hex_q, to_hex_r, target_hex_q, target_hex_r, path } = req.body;

  // Verify player owns the unit
  const { data: unit } = await adminDb
    .from('units')
    .select('id, factions(profile_id)')
    .eq('id', unit_id)
    .single();

  if (!unit || unit.factions?.profile_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your unit' });
  }

  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', req.params.gameId).single();
  const turn = game.current_turn;

  // Clear existing orders for this unit this turn
  await adminDb.from('movement_orders').delete().eq('unit_id', unit_id).eq('turn', turn);

  // Build order rows — path[] for multi-step moves, single row otherwise
  const steps = Array.isArray(path) && path.length > 0
    ? path.map((step, i) => ({ unit_id, game_id: req.params.gameId, order_type: 'move', sequence: i, to_hex_q: step.q, to_hex_r: step.r, turn }))
    : [{ unit_id, game_id: req.params.gameId, order_type, sequence: 0, to_hex_q, to_hex_r, target_hex_q, target_hex_r, turn }];

  const { data, error } = await adminDb.from('movement_orders').insert(steps).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/map/:gameId/orders/:unitId — clear all orders for a unit this turn
router.delete('/:gameId/orders/:unitId', requireAuth, async (req, res) => {
  const { data: unit } = await adminDb
    .from('units')
    .select('id, factions(profile_id)')
    .eq('id', req.params.unitId)
    .single();

  if (!unit || unit.factions?.profile_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your unit' });
  }

  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', req.params.gameId).single();
  await adminDb.from('movement_orders').delete().eq('unit_id', req.params.unitId).eq('turn', game.current_turn);
  res.json({ ok: true });
});

export default router;
