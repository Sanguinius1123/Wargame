import { Router } from 'express';
import { adminDb, fetchAll } from '../db.js';
import { requireGM } from '../middleware/auth.js';
import { resolveTurn } from '../utils/resolveTurn.js';

const router = Router();

// GET /api/gm/players — list all registered player profiles for faction assignment
router.get('/players', requireGM, async (req, res) => {
  const { data, error } = await adminDb
    .from('profiles')
    .select('id, username, global_role')
    .order('username');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// PATCH /api/gm/:gameId/factions/:factionId — update faction (assign player, rename, recolor)
router.patch('/:gameId/factions/:factionId', requireGM, async (req, res) => {
  const { gameId, factionId } = req.params;
  const { profile_id, name, color } = req.body;

  // Read current profile_id before update so we can sync participants
  const { data: current } = await adminDb
    .from('factions').select('id, profile_id').eq('id', factionId).single();

  const updates = {};
  if (profile_id !== undefined) updates.profile_id = profile_id || null;
  if (name     !== undefined) updates.name     = name;
  if (color    !== undefined) updates.color    = color;

  const { data: faction, error } = await adminDb
    .from('factions').update(updates).eq('id', factionId).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Sync game_participants when player assignment changes
  const oldId = current?.profile_id;
  const newId = updates.profile_id;
  if (profile_id !== undefined && oldId !== newId) {
    if (newId) {
      // GMs are already participants — don't overwrite their 'gm' role with 'player'.
      // The factions.profile_id assignment is enough for GMs to get a faction view.
      const { data: assignedProfile } = await adminDb
        .from('profiles').select('global_role').eq('id', newId).single();
      if (assignedProfile?.global_role !== 'gm') {
        await adminDb.from('game_participants').upsert(
          { game_id: gameId, profile_id: newId, role: 'player' },
          { onConflict: 'game_id,profile_id' }
        );
      }
    }
    if (oldId) {
      // Remove from participants only if they have no other factions in this game
      const { data: others } = await adminDb.from('factions')
        .select('id').eq('game_id', gameId).eq('profile_id', oldId);
      if (!others?.length) {
        await adminDb.from('game_participants')
          .delete().eq('game_id', gameId).eq('profile_id', oldId).eq('role', 'player');
      }
    }
  }

  res.json(faction);
});

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
  airstrip: 4, fortification: 12,
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

// POST /api/gm/:gameId/save-as-map — snapshot current game (hexes, factions, units)
router.post('/:gameId/save-as-map', requireGM, async (req, res) => {
  const { gameId } = req.params;
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  let hexes, factions, units;
  try {
    [hexes, factions, units] = await Promise.all([
      fetchAll(() => adminDb.from('hexes')
        .select('hex_q, hex_r, terrain, has_settlement, settlement_name, settlement_size, has_light_vegetation, has_heavy_vegetation, vegetation_hp, has_railroad')
        .eq('game_id', gameId)),
      adminDb.from('factions').select('id, name, color').eq('game_id', gameId)
        .then(r => { if (r.error) throw new Error(r.error.message); return r.data ?? []; }),
      fetchAll(() => adminDb.from('units')
        .select('faction_id, hex_q, hex_r, quantity, unit_type_config(name)')
        .eq('game_id', gameId)),
    ]);
  } catch (e) { return res.status(500).json({ error: e.message }); }

  if (!hexes.length) return res.status(400).json({ error: 'Game has no hexes to save' });

  const { data: map, error: mapErr } = await adminDb
    .from('maps')
    .insert({ name: name.trim(), description: description?.trim() ?? null, created_by: req.user.id })
    .select().single();
  if (mapErr) return res.status(500).json({ error: mapErr.message });

  try {
    await adminDb.from('map_hexes')
      .insert(hexes.map(h => ({ map_id: map.id, ...h })));

    if (factions.length) {
      await adminDb.from('map_factions')
        .insert(factions.map((f, i) => ({ map_id: map.id, name: f.name, color: f.color, slot: i })));
    }

    const factionNameById = Object.fromEntries(factions.map(f => [f.id, f.name]));
    const unitRows = units
      .filter(u => factionNameById[u.faction_id] && u.unit_type_config?.name)
      .map(u => ({
        map_id: map.id,
        faction_name: factionNameById[u.faction_id],
        hex_q: u.hex_q, hex_r: u.hex_r,
        unit_type_name: u.unit_type_config.name,
        quantity: u.quantity,
      }));
    if (unitRows.length) {
      await adminDb.from('map_units').insert(unitRows);
    }
  } catch (e) {
    await adminDb.from('maps').delete().eq('id', map.id);
    return res.status(500).json({ error: e.message });
  }

  res.json({ id: map.id, name: map.name, hex_count: hexes.length, faction_count: factions.length, unit_count: units.length });
});

// POST /api/gm/:gameId/load-map/:mapId — full reset: overwrites hexes, factions, and units.
// Clears all existing game state. Player assignments are lost and must be reassigned.
router.post('/:gameId/load-map/:mapId', requireGM, async (req, res) => {
  const { gameId, mapId } = req.params;

  let mapHexes, mapFactions, mapUnits;
  try {
    [mapHexes, mapFactions, mapUnits] = await Promise.all([
      fetchAll(() => adminDb.from('map_hexes')
        .select('hex_q, hex_r, terrain, has_settlement, settlement_name, settlement_size, has_light_vegetation, has_heavy_vegetation, vegetation_hp, has_railroad')
        .eq('map_id', mapId)),
      adminDb.from('map_factions').select('name, color, slot').eq('map_id', mapId).order('slot')
        .then(r => r.data ?? []),
      adminDb.from('map_units').select('faction_name, hex_q, hex_r, unit_type_name, quantity')
        .eq('map_id', mapId).then(r => r.data ?? []),
    ]);
  } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!mapHexes.length) return res.status(404).json({ error: 'Map not found or empty' });

  // Wipe all existing game state including factions and their player assignments
  await adminDb.from('units').delete().eq('game_id', gameId);
  await adminDb.from('movement_orders').delete().eq('game_id', gameId);
  await adminDb.from('buildings').delete().eq('game_id', gameId);
  await adminDb.from('production_queue').delete().eq('game_id', gameId);
  await adminDb.from('scouted_hexes').delete().eq('game_id', gameId);
  await adminDb.from('hexes').delete().eq('game_id', gameId);
  // Remove player participants (GM stays); delete factions so they're rebuilt from map
  const { data: playerParticipants } = await adminDb.from('factions')
    .select('profile_id').eq('game_id', gameId).not('profile_id', 'is', null);
  await adminDb.from('factions').delete().eq('game_id', gameId);
  for (const p of playerParticipants ?? []) {
    await adminDb.from('game_participants')
      .delete().eq('game_id', gameId).eq('profile_id', p.profile_id).eq('role', 'player');
  }

  // Insert hexes
  const { error: hexErr } = await adminDb.from('hexes').insert(mapHexes.map(h => ({
    game_id: gameId, ...h,
    vegetation_hp: h.vegetation_hp ?? (h.has_heavy_vegetation ? 20 : h.has_light_vegetation ? 8 : null),
  })));
  if (hexErr) return res.status(500).json({ error: hexErr.message });

  // Create factions from map template (no players assigned yet)
  const factionMap = {};
  for (const mf of mapFactions) {
    const { data: faction } = await adminDb.from('factions')
      .insert({ game_id: gameId, name: mf.name, color: mf.color, profile_id: null })
      .select('id, name').single();
    if (faction) factionMap[faction.name] = faction.id;
  }

  // Place pre-placed units
  if (mapUnits.length && Object.keys(factionMap).length) {
    const { data: unitTypes } = await adminDb.from('unit_type_config')
      .select('id, name').eq('game_id', gameId);
    const typeByName = Object.fromEntries((unitTypes ?? []).map(t => [t.name, t.id]));

    const unitRows = mapUnits
      .filter(u => factionMap[u.faction_name] && typeByName[u.unit_type_name])
      .map(u => ({
        game_id: gameId, faction_id: factionMap[u.faction_name],
        unit_type_id: typeByName[u.unit_type_name],
        hex_q: u.hex_q, hex_r: u.hex_r, quantity: u.quantity,
      }));
    if (unitRows.length) await adminDb.from('units').insert(unitRows);
  }

  res.json({
    loaded: mapHexes.length,
    factions: Object.keys(factionMap).length,
    units: mapUnits.length,
  });
});

// DELETE /api/gm/:gameId — permanently delete a game and all related data
// All child tables (hexes, factions, units, orders, fog, buildings, etc.)
// cascade-delete via FK constraints when the games row is removed.
router.delete('/:gameId', requireGM, async (req, res) => {
  const { gameId } = req.params;
  const { error } = await adminDb.from('games').delete().eq('id', gameId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: true });
});

export default router;
