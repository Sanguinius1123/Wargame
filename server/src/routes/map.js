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
    .select('id, hex_q, hex_r, quantity, hp, faction_id, standing_order, fortification_level, factions(name, color), unit_type_config(name, tags, bombard_to_hit, bombard_range)')
    .eq('game_id', gameId);

  const unitsByHex = {};
  for (const u of units ?? []) {
    const k = `${u.hex_q},${u.hex_r}`;
    if (!unitsByHex[k]) unitsByHex[k] = [];
    unitsByHex[k].push({
      id: u.id,
      type: u.unit_type_config?.name,
      tags: u.unit_type_config?.tags ?? [],
      bombard_to_hit: u.unit_type_config?.bombard_to_hit ?? null,
      bombard_range:  u.unit_type_config?.bombard_range  ?? null,
      quantity: u.quantity,
      hp: u.hp,
      standing_order: u.standing_order,
      fortification_level: u.fortification_level,
      factionId: u.faction_id,
      factionName: u.factions?.name,
      factionColor: u.factions?.color,
    });
  }

  // Load all buildings grouped by hex
  const { data: buildings } = await adminDb
    .from('buildings')
    .select('hex_q, hex_r, type, current_hp, max_hp, owner_faction_id')
    .eq('game_id', gameId);

  const buildingsByHex = {};
  for (const b of buildings ?? []) {
    const k = `${b.hex_q},${b.hex_r}`;
    if (!buildingsByHex[k]) buildingsByHex[k] = [];
    buildingsByHex[k].push({ type: b.type, current_hp: b.current_hp, max_hp: b.max_hp, owner_faction_id: b.owner_faction_id });
  }

  // GM viewing as a specific faction: apply that faction's FOW
  const viewAsFactionId = isGM ? (req.query.viewAs ?? null) : null;

  if (isGM && !viewAsFactionId) {
    return res.json(hexes.map(h => {
      const hexKey = `${h.hex_q},${h.hex_r}`;
      return {
        ...h,
        units: unitsByHex[hexKey] ?? [],
        buildings: buildingsByHex[hexKey] ?? [],
        visibility: 'visible',
      };
    }));
  }

  // Player path (or GM viewing as a faction): find their faction, compute visibility
  const { data: faction } = isGM
    ? await adminDb.from('factions').select('id').eq('id', viewAsFactionId).single()
    : await adminDb.from('factions').select('id').eq('game_id', gameId).eq('profile_id', req.user.id).single();

  if (!faction) return res.status(403).json({ error: 'Not a participant in this game' });

  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', gameId).single();
  const { visible, scouted } = await computeVisibility(adminDb, faction.id, gameId);

  await markScouted(adminDb, faction.id, gameId, visible, game?.current_turn ?? 0);

  res.json(hexes.map(h => {
    const k = `${h.hex_q},${h.hex_r}`;
    if (visible.has(k)) {
      return { ...h, units: unitsByHex[k] ?? [], buildings: buildingsByHex[k] ?? [], visibility: 'visible' };
    }
    if (scouted.has(k)) {
      return { hex_q: h.hex_q, hex_r: h.hex_r, terrain: h.terrain, visibility: 'scouted', units: [], buildings: [] };
    }
    return { hex_q: h.hex_q, hex_r: h.hex_r, visibility: 'dark', units: [], buildings: [] };
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
// Body: { unit_id, order_type, to_hex_q?, to_hex_r?, target_hex_q?, target_hex_r?, path?, asFactionId? }
// path is an array of {q, r} steps for multi-hex movement; clears previous orders for this unit.
// asFactionId: GM only — act on behalf of that faction (for testing / "view as player" mode).
router.post('/:gameId/orders', requireAuth, async (req, res) => {
  const { unit_id, order_type = 'move', to_hex_q, to_hex_r, target_hex_q, target_hex_r, path, asFactionId } = req.body;
  const isGM = req.user.global_role === 'gm';

  // Verify ownership: GM can act for any faction; players must own the unit
  const { data: unit } = await adminDb
    .from('units')
    .select('id, faction_id, factions(profile_id)')
    .eq('id', unit_id)
    .single();

  if (!unit) return res.status(404).json({ error: 'Unit not found' });

  if (isGM) {
    // GM acting as faction: verify unit belongs to the specified faction
    if (asFactionId && unit.faction_id !== asFactionId) {
      return res.status(403).json({ error: 'Unit does not belong to that faction' });
    }
    // GM without asFactionId: full access, no restriction
  } else if (unit.factions?.profile_id !== req.user.id) {
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

// POST /api/map/:gameId/production — queue unit production at a factory hex
// Body: { unit_type_name, factory_hex_q, factory_hex_r, quantity? }
router.post('/:gameId/production', requireAuth, async (req, res) => {
  const { gameId } = req.params;
  const { unit_type_name, factory_hex_q, factory_hex_r, quantity = 1 } = req.body;

  // Find player's faction
  const { data: faction } = await adminDb
    .from('factions').select('id, materials, manpower')
    .eq('game_id', gameId).eq('profile_id', req.user.id).single();
  if (!faction) return res.status(403).json({ error: 'Not a participant' });

  // Verify factory exists and belongs to player
  const { data: factory } = await adminDb
    .from('buildings')
    .select('id, current_hp, max_hp')
    .eq('game_id', gameId).eq('hex_q', factory_hex_q).eq('hex_r', factory_hex_r)
    .eq('type', 'factory').eq('owner_faction_id', faction.id).single();
  if (!factory || factory.current_hp < factory.max_hp) {
    return res.status(400).json({ error: 'No operational factory at that hex' });
  }

  // Look up unit type for this game
  const { data: unitType } = await adminDb
    .from('unit_type_config').select('id, mat_cost, man_cost, slots')
    .eq('game_id', gameId).eq('name', unit_type_name).single();
  if (!unitType) return res.status(400).json({ error: `Unknown unit type: ${unit_type_name}` });

  // Check factory slot capacity vs existing queue
  const slots = Math.floor(factory.current_hp / 2);
  const { data: existingQueue } = await adminDb
    .from('production_queue').select('quantity, unit_type_config(slots)')
    .eq('game_id', gameId).eq('faction_id', faction.id)
    .eq('factory_hex_q', factory_hex_q).eq('factory_hex_r', factory_hex_r)
    .eq('status', 'pending');
  const usedSlots = (existingQueue ?? []).reduce((s, q) => s + (q.unit_type_config?.slots ?? 1) * q.quantity, 0);
  const needed = unitType.slots * quantity;
  if (usedSlots + needed > slots) {
    return res.status(400).json({ error: `Factory only has ${slots - usedSlots} slot(s) free (need ${needed})` });
  }

  // Check and deduct resources
  const totalMat = unitType.mat_cost * quantity;
  const totalMan = unitType.man_cost * quantity;
  if (faction.materials < totalMat) return res.status(400).json({ error: `Need ${totalMat} materials, have ${faction.materials}` });
  if (faction.manpower < totalMan) return res.status(400).json({ error: `Need ${totalMan} manpower, have ${faction.manpower}` });

  await adminDb.from('factions').update({
    materials: faction.materials - totalMat,
    manpower: faction.manpower - totalMan,
  }).eq('id', faction.id);

  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', gameId).single();
  const { data, error } = await adminDb.from('production_queue').insert({
    game_id: gameId, faction_id: faction.id, unit_type_id: unitType.id,
    factory_hex_q, factory_hex_r, quantity, created_turn: game.current_turn,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /api/map/:gameId/production — player's pending production queue + all unit types
router.get('/:gameId/production', requireAuth, async (req, res) => {
  const { gameId } = req.params;
  const { data: faction } = await adminDb
    .from('factions').select('id')
    .eq('game_id', gameId).eq('profile_id', req.user.id).single();
  if (!faction) return res.status(403).json({ error: 'Not a participant' });

  const [{ data: queue }, { data: unitTypes }] = await Promise.all([
    adminDb.from('production_queue')
      .select('id, unit_type_id, factory_hex_q, factory_hex_r, quantity, created_turn, unit_type_config(name, mat_cost, man_cost, slots)')
      .eq('game_id', gameId)
      .eq('faction_id', faction.id)
      .eq('status', 'pending'),
    adminDb.from('unit_type_config')
      .select('id, name, mat_cost, man_cost, slots, tags')
      .eq('game_id', gameId)
      .order('name'),
  ]);

  res.json({
    queue: (queue ?? []).map(q => ({
      id: q.id,
      unit_type_id: q.unit_type_id,
      unit_type_name: q.unit_type_config?.name,
      mat_cost: q.unit_type_config?.mat_cost,
      man_cost: q.unit_type_config?.man_cost,
      slots: q.unit_type_config?.slots,
      factory_hex_q: q.factory_hex_q,
      factory_hex_r: q.factory_hex_r,
      quantity: q.quantity,
      created_turn: q.created_turn,
    })),
    unit_types: unitTypes ?? [],
  });
});

// DELETE /api/map/:gameId/orders/:unitId — clear all orders for a unit this turn
// GM can clear orders for any unit (for "view as player" and testing).
router.delete('/:gameId/orders/:unitId', requireAuth, async (req, res) => {
  const isGM = req.user.global_role === 'gm';
  if (!isGM) {
    const { data: unit } = await adminDb
      .from('units')
      .select('id, factions(profile_id)')
      .eq('id', req.params.unitId)
      .eq('game_id', req.params.gameId)
      .single();
    if (!unit || unit.factions?.profile_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your unit' });
    }
  }

  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', req.params.gameId).single();
  await adminDb.from('movement_orders').delete().eq('unit_id', req.params.unitId).eq('turn', game.current_turn);
  res.json({ ok: true });
});

// GET /api/map/:gameId/orders/:unitId — get current-turn orders for a unit
router.get('/:gameId/orders/:unitId', requireAuth, async (req, res) => {
  const { gameId, unitId } = req.params;
  const isGM = req.user.global_role === 'gm';

  // Load the unit and verify ownership
  const { data: unit } = await adminDb
    .from('units')
    .select('id, faction_id, factions(profile_id)')
    .eq('id', unitId)
    .single();

  if (!unit) return res.status(404).json({ error: 'Unit not found' });

  if (!isGM && unit.factions?.profile_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your unit' });
  }

  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', gameId).single();
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const { data: orders, error } = await adminDb
    .from('movement_orders')
    .select('order_type, sequence, to_hex_q, to_hex_r, target_hex_q, target_hex_r')
    .eq('unit_id', unitId)
    .eq('game_id', gameId)
    .eq('turn', game.current_turn)
    .order('sequence', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ orders: orders ?? [] });
});

export default router;
