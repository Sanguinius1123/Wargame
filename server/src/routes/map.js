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
    .select('id, hex_q, hex_r, terrain, owner_faction_id, has_light_vegetation, has_heavy_vegetation, has_urban, urban_hp, has_settlement, settlement_name, has_road, has_bridge, has_canal, has_railroad')
    .eq('game_id', gameId)
    .limit(10000);
  if (error) return res.status(500).json({ error: error.message });

  // Load all units grouped by hex
  const { data: units } = await adminDb
    .from('units')
    .select('id, hex_q, hex_r, quantity, hp, faction_id, standing_order, fortification_level, factions(name, color), unit_type_config(name, tags, bombard_to_hit, bombard_range)')
    .eq('game_id', gameId)
    .limit(10000);

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
    .select('id, hex_q, hex_r, type, current_hp, max_hp, owner_faction_id')
    .eq('game_id', gameId)
    .limit(10000);

  const buildingsByHex = {};
  for (const b of buildings ?? []) {
    const k = `${b.hex_q},${b.hex_r}`;
    if (!buildingsByHex[k]) buildingsByHex[k] = [];
    buildingsByHex[k].push({ id: b.id, type: b.type, current_hp: b.current_hp, max_hp: b.max_hp, owner_faction_id: b.owner_faction_id });
  }

  // Load resource tiles
  const { data: resourceTiles } = await adminDb
    .from('resource_tiles')
    .select('id, hex_q, hex_r, tile_type, owner_faction_id')
    .eq('game_id', gameId)
    .limit(10000);

  const resourceTileByHex = {};
  for (const rt of resourceTiles ?? []) {
    resourceTileByHex[`${rt.hex_q},${rt.hex_r}`] = { id: rt.id, tile_type: rt.tile_type, owner_faction_id: rt.owner_faction_id };
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
        resource_tile: resourceTileByHex[hexKey] ?? null,
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

  const playerFactionId = faction.id;

  res.json(hexes.map(h => {
    const k = `${h.hex_q},${h.hex_r}`;
    if (visible.has(k)) {
      const allUnits = unitsByHex[k] ?? [];
      // For enemy units, strip to type + stack size only (fog of war on unit stats)
      const sanitizedUnits = allUnits.map(u => {
        if (u.factionId === playerFactionId) return u;
        return { id: u.id, type: u.type, tags: u.tags, quantity: u.quantity, hp: u.hp, factionId: u.factionId, factionName: u.factionName, factionColor: u.factionColor };
      });
      return { ...h, units: sanitizedUnits, buildings: buildingsByHex[k] ?? [], resource_tile: resourceTileByHex[k] ?? null, visibility: 'visible' };
    }
    if (scouted.has(k)) {
      return { hex_q: h.hex_q, hex_r: h.hex_r, terrain: h.terrain, visibility: 'scouted', units: [], buildings: [] };
    }
    return { hex_q: h.hex_q, hex_r: h.hex_r, visibility: 'dark', units: [], buildings: [] };
  }));
});

// GET /api/map/:gameId/hexes/:q/:r — single hex detail
// GM: full unit stats. Players: own units full, enemy units type+quantity only.
router.get('/:gameId/hexes/:q/:r', requireAuth, async (req, res) => {
  const { gameId, q, r } = req.params;
  const isGM = req.user.global_role === 'gm';

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

  if (isGM) return res.json({ ...hex, units: units ?? [] });

  // Player: find their faction, strip stats from enemy units
  const { data: playerFaction } = await adminDb
    .from('factions').select('id').eq('game_id', gameId).eq('profile_id', req.user.id).maybeSingle();
  const playerFactionId = playerFaction?.id;

  const sanitized = (units ?? []).map(u => {
    if (!playerFactionId || u.faction_id === playerFactionId) return u;
    return {
      id: u.id,
      quantity: u.quantity,
      hp: u.hp,
      faction_id: u.faction_id,
      factions: u.factions,
      unit_type_config: { name: u.unit_type_config?.name, tags: u.unit_type_config?.tags },
    };
  });

  res.json({ ...hex, units: sanitized });
});

// PATCH /api/map/:gameId/hexes/:q/:r — GM edits a hex
router.patch('/:gameId/hexes/:q/:r', requireGM, async (req, res) => {
  const { gameId, q, r } = req.params;
  const {
    terrain, owner_faction_id,
    has_light_vegetation, has_heavy_vegetation, has_urban, urban_hp,
    has_settlement, has_road, has_bridge, has_canal, has_railroad,
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
  if (has_bridge !== undefined) updates.has_bridge = has_bridge;
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

  // Sync bridge building with has_bridge attribute
  if (has_bridge === true) {
    const { data: existing } = await adminDb
      .from('buildings')
      .select('id')
      .eq('game_id', gameId).eq('hex_q', Number(q)).eq('hex_r', Number(r))
      .eq('type', 'bridge')
      .maybeSingle();
    if (!existing) {
      await adminDb.from('buildings').insert({
        game_id: gameId, hex_q: Number(q), hex_r: Number(r),
        type: 'bridge', current_hp: 4, max_hp: 4,
      });
    }
  } else if (has_bridge === false) {
    await adminDb.from('buildings')
      .delete()
      .eq('game_id', gameId).eq('hex_q', Number(q)).eq('hex_r', Number(r))
      .eq('type', 'bridge');
  }

  res.json(data);
});

// POST /api/map/:gameId/orders — player queues orders for a unit
// Body: { unit_id, order_type, to_hex_q?, to_hex_r?, target_hex_q?, target_hex_r?, path?, asFactionId?,
//         split_quantity? }
// split_quantity: if present, splits N units off into a new stack and applies the move path to that new stack.
// path is an array of {q, r} steps for multi-hex movement; clears previous orders for this unit.
// asFactionId: GM only — act on behalf of that faction (for testing / "view as player" mode).
router.post('/:gameId/orders', requireAuth, async (req, res) => {
  const { unit_id, order_type = 'move', to_hex_q, to_hex_r, target_hex_q, target_hex_r, path, asFactionId, structure_type, split_quantity } = req.body;
  const isGM = req.user.global_role === 'gm';
  const gameId = req.params.gameId;

  // Verify ownership: GM can act for any faction; players must own the unit
  const { data: unit } = await adminDb
    .from('units')
    .select('id, faction_id, unit_type_id, hex_q, hex_r, quantity, hp, factions(profile_id)')
    .eq('id', unit_id)
    .single();

  if (!unit) return res.status(404).json({ error: 'Unit not found' });

  if (isGM) {
    if (asFactionId && unit.faction_id !== asFactionId) {
      return res.status(403).json({ error: 'Unit does not belong to that faction' });
    }
  } else if (unit.factions?.profile_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your unit' });
  }

  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', gameId).single();
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const turn = game.current_turn;

  // Handle stack split: create a new unit row with split_quantity, apply orders to it
  let targetUnitId = unit_id;
  if (split_quantity != null) {
    const n = parseInt(split_quantity, 10);
    if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: 'split_quantity must be a positive integer' });
    if (unit.hp != null) return res.status(400).json({ error: 'HP-based units cannot be split' });
    if (n >= unit.quantity) return res.status(400).json({ error: 'split_quantity must be less than the stack size' });

    // Reduce original stack
    const { error: reduceErr } = await adminDb
      .from('units').update({ quantity: unit.quantity - n }).eq('id', unit_id);
    if (reduceErr) return res.status(500).json({ error: reduceErr.message });

    // Check if there's already a unit of the same type at the same hex for this faction
    // (could happen on a re-submit; if so, merge into it instead of creating new)
    const { data: newUnit, error: createErr } = await adminDb
      .from('units')
      .insert({ game_id: gameId, faction_id: unit.faction_id, unit_type_id: unit.unit_type_id, hex_q: unit.hex_q, hex_r: unit.hex_r, quantity: n })
      .select()
      .single();
    if (createErr) {
      // Roll back the reduction before bailing
      await adminDb.from('units').update({ quantity: unit.quantity }).eq('id', unit_id);
      return res.status(500).json({ error: createErr.message });
    }
    targetUnitId = newUnit.id;
  }

  // Clear existing orders for the target unit this turn
  await adminDb.from('movement_orders').delete().eq('unit_id', targetUnitId).eq('turn', turn);

  // Build order rows — path[] for multi-step moves, single row otherwise
  const steps = Array.isArray(path) && path.length > 0
    ? path.map((step, i) => ({ unit_id: targetUnitId, game_id: gameId, order_type: 'move', sequence: i, to_hex_q: step.q, to_hex_r: step.r, turn }))
    : [{ unit_id: targetUnitId, game_id: gameId, order_type, sequence: 0, to_hex_q, to_hex_r, target_hex_q, target_hex_r, structure_type: structure_type ?? null, turn }];

  const { data, error } = await adminDb.from('movement_orders').insert(steps).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ orders: data, split_unit_id: split_quantity != null ? targetUnitId : null });
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
  if (!game) return res.status(404).json({ error: 'Game not found' });
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
  if (!game) return res.status(404).json({ error: 'Game not found' });
  await adminDb.from('movement_orders').delete().eq('unit_id', req.params.unitId).eq('turn', game.current_turn);
  res.json({ ok: true });
});

// -----------------------------------------------------------------------
// Flight group routes
// -----------------------------------------------------------------------

// POST /api/map/:gameId/flight-groups
// Body: { mission_type, path, target_hex_q?, target_hex_r?, target_infra?, unit_ids[] }
router.post('/:gameId/flight-groups', requireAuth, async (req, res) => {
  const { gameId } = req.params;
  const { mission_type, path, target_hex_q, target_hex_r, target_infra, unit_ids = [] } = req.body;
  const isGM = req.user.global_role === 'gm';

  const validMissions = ['bombing_run', 'attack_run', 'scout', 'sweep'];
  if (!validMissions.includes(mission_type)) {
    return res.status(400).json({ error: `Invalid mission_type: ${mission_type}` });
  }
  if (!Array.isArray(unit_ids) || unit_ids.length === 0) {
    return res.status(400).json({ error: 'unit_ids must be a non-empty array' });
  }

  // Resolve player's faction
  const { data: faction } = isGM
    ? { data: null }
    : await adminDb.from('factions').select('id').eq('game_id', gameId).eq('profile_id', req.user.id).single();

  if (!isGM && !faction) return res.status(403).json({ error: 'Not a participant' });

  // Verify all units are air units belonging to the player's faction
  const { data: units, error: unitErr } = await adminDb
    .from('units')
    .select('id, faction_id, unit_type_id, factions(profile_id), unit_type_config(tags)')
    .eq('game_id', gameId)
    .in('id', unit_ids);

  if (unitErr) return res.status(500).json({ error: unitErr.message });
  if (!units?.length) return res.status(404).json({ error: 'No units found' });

  for (const u of units) {
    if (!isGM && u.factions?.profile_id !== req.user.id) {
      return res.status(403).json({ error: `Unit ${u.id} does not belong to your faction` });
    }
    if (!u.unit_type_config?.tags?.includes('air')) {
      return res.status(400).json({ error: `Unit ${u.id} is not an air unit` });
    }
  }

  const factionId = isGM ? units[0].faction_id : faction.id;
  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', gameId).single();
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const turn = game.current_turn;

  // Create the flight group
  const { data: group, error: groupErr } = await adminDb
    .from('flight_groups')
    .insert({
      game_id: gameId, faction_id: factionId,
      mission_type, path: path ?? [], status: 'pending', turn,
      target_hex_q: target_hex_q ?? null,
      target_hex_r: target_hex_r ?? null,
      target_infra: target_infra ?? null,
    })
    .select()
    .single();

  if (groupErr) return res.status(500).json({ error: groupErr.message });

  // Link units to the flight group
  const fgUnitRows = unit_ids.map(uid => ({
    flight_group_id: group.id,
    unit_id: uid,
  }));
  const { error: linkErr } = await adminDb.from('flight_group_units').insert(fgUnitRows);
  if (linkErr) {
    await adminDb.from('flight_groups').delete().eq('id', group.id);
    return res.status(500).json({ error: linkErr.message });
  }

  res.status(201).json({ ...group, unit_ids });
});

// GET /api/map/:gameId/flight-groups — this turn's flight groups for the requesting faction
router.get('/:gameId/flight-groups', requireAuth, async (req, res) => {
  const { gameId } = req.params;
  const isGM = req.user.global_role === 'gm';

  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', gameId).single();
  if (!game) return res.status(404).json({ error: 'Game not found' });

  let factionId = null;
  if (!isGM) {
    const { data: faction } = await adminDb.from('factions').select('id').eq('game_id', gameId).eq('profile_id', req.user.id).single();
    if (!faction) return res.status(403).json({ error: 'Not a participant' });
    factionId = faction.id;
  }

  let query = adminDb
    .from('flight_groups')
    .select('id, faction_id, mission_type, path, target_hex_q, target_hex_r, target_infra, status, turn')
    .eq('game_id', gameId)
    .eq('turn', game.current_turn);

  if (factionId) query = query.eq('faction_id', factionId);

  const { data: groups, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Attach unit_ids to each group
  if (groups?.length) {
    const { data: fgUnits } = await adminDb
      .from('flight_group_units')
      .select('flight_group_id, unit_id')
      .in('flight_group_id', groups.map(g => g.id));

    const unitMap = new Map();
    for (const row of fgUnits ?? []) {
      if (!unitMap.has(row.flight_group_id)) unitMap.set(row.flight_group_id, []);
      unitMap.get(row.flight_group_id).push(row.unit_id);
    }
    return res.json(groups.map(g => ({ ...g, unit_ids: unitMap.get(g.id) ?? [] })));
  }

  res.json(groups ?? []);
});

// DELETE /api/map/:gameId/flight-groups/:groupId — cancel a pending flight group
router.delete('/:gameId/flight-groups/:groupId', requireAuth, async (req, res) => {
  const { gameId, groupId } = req.params;
  const isGM = req.user.global_role === 'gm';

  const { data: group } = await adminDb
    .from('flight_groups')
    .select('id, faction_id, status, factions(profile_id)')
    .eq('id', groupId)
    .eq('game_id', gameId)
    .single();

  if (!group) return res.status(404).json({ error: 'Flight group not found' });
  if (!isGM && group.factions?.profile_id !== req.user.id) return res.status(403).json({ error: 'Not your flight group' });
  if (group.status !== 'pending') return res.status(400).json({ error: 'Can only cancel pending flight groups' });

  await adminDb.from('flight_groups').delete().eq('id', groupId);
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

// PATCH /api/map/:gameId/units/:unitId/standing-order
router.patch('/:gameId/units/:unitId/standing-order', requireAuth, async (req, res) => {
  const { gameId, unitId } = req.params;
  const { standing_order } = req.body;
  const isGM = req.user.global_role === 'gm';

  const validValues = [null, 'patrol'];
  if (!validValues.includes(standing_order)) {
    return res.status(400).json({ error: `Invalid standing_order value: ${standing_order}` });
  }

  const { data: unit } = await adminDb
    .from('units')
    .select('id, faction_id, factions(profile_id)')
    .eq('id', unitId)
    .eq('game_id', gameId)
    .single();

  if (!unit) return res.status(404).json({ error: 'Unit not found' });

  if (!isGM && unit.factions?.profile_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your unit' });
  }

  const { error } = await adminDb
    .from('units')
    .update({ standing_order: standing_order ?? null })
    .eq('id', unitId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/map/:gameId/combat-log?turn=N
// Players see their own game's combat log for any completed turn.
// Defaults to the last completed turn.
router.get('/:gameId/combat-log', requireAuth, async (req, res) => {
  const { gameId } = req.params;
  const isGM = req.user.global_role === 'gm';

  if (!isGM) {
    const { data: participant } = await adminDb
      .from('game_participants').select('id').eq('game_id', gameId).eq('profile_id', req.user.id).maybeSingle();
    if (!participant) return res.status(403).json({ error: 'Not a participant in this game' });
  }

  const { data: game } = await adminDb.from('games').select('current_turn').eq('id', gameId).single();
  const currentTurn = game?.current_turn ?? 1;
  const turn = req.query.turn != null ? Number(req.query.turn) : currentTurn - 1;

  if (turn < 0) return res.json({ turn: 0, current_turn: currentTurn, entries: [] });

  const { data: entries, error } = await adminDb
    .from('combat_log')
    .select('id, turn, phase, hex_q, hex_r, log_type, faction_id, data, created_at')
    .eq('game_id', gameId)
    .eq('turn', turn)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ turn, current_turn: currentTurn, entries: entries ?? [] });
});

export default router;
