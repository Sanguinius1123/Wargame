// =============================================================
// phase4.js — Phase 4: Return & Collect
//
// Order of operations (matches CLAUDE.md Phase 4):
//   1. collectMaterials   — 1 mat per owned resource_tile
//   2. advanceProduction  — place completed production queue items
//   3. calculateManpower  — manpower from urban tiles connected to settlements
//   4. checkWinCondition  — 2/3 of settlements controlled
//   5. resetTurnReady     — clear turn_ready so next turn can begin
// =============================================================

import { hexDist, offsetNeighbors } from './hexGeometry.js';

// ---------------------------------------------------------------------------
// 1. collectMaterials
// For each resource_tile with an owner, add 1 material to that faction.
// ---------------------------------------------------------------------------
export async function collectMaterials(db, gameId) {
  const { data: tiles } = await db
    .from('resource_tiles')
    .select('owner_faction_id')
    .eq('game_id', gameId)
    .not('owner_faction_id', 'is', null);

  if (!tiles?.length) return { collected: 0 };

  // Tally per faction
  const deltas = {};
  for (const t of tiles) {
    deltas[t.owner_faction_id] = (deltas[t.owner_faction_id] ?? 0) + 1;
  }

  // Apply deltas
  const { data: factions } = await db
    .from('factions')
    .select('id, materials')
    .eq('game_id', gameId);

  for (const f of factions ?? []) {
    const gain = deltas[f.id] ?? 0;
    if (gain > 0) {
      await db.from('factions').update({ materials: f.materials + gain }).eq('id', f.id);
    }
  }

  return { collected: Object.values(deltas).reduce((s, v) => s + v, 0) };
}

// ---------------------------------------------------------------------------
// 2. advanceProduction
// Pending items from prior turns → place units at or adjacent to factory.
// Items created this turn stay pending (1-turn delay).
// ---------------------------------------------------------------------------
export async function advanceProduction(db, gameId, currentTurn) {
  const { data: ready } = await db
    .from('production_queue')
    .select('id, faction_id, unit_type_id, factory_hex_q, factory_hex_r, quantity')
    .eq('game_id', gameId)
    .eq('status', 'pending')
    .lt('created_turn', currentTurn);  // created before this turn = ready to place

  if (!ready?.length) return { placed: 0 };

  let placed = 0;

  for (const item of ready) {
    // Verify factory still belongs to this faction (may have been captured in Phase 3).
    const { data: factoryCheck } = await db
      .from('buildings')
      .select('id')
      .eq('game_id', gameId)
      .eq('hex_q', item.factory_hex_q)
      .eq('hex_r', item.factory_hex_r)
      .eq('type', 'factory')
      .eq('owner_faction_id', item.faction_id)
      .maybeSingle();

    if (!factoryCheck) {
      // Factory captured — production queue lost, no refund.
      await db.from('production_queue').delete().eq('id', item.id);
      continue;
    }

    // Try factory hex first, then adjacent hexes
    const candidates = [
      { q: item.factory_hex_q, r: item.factory_hex_r },
      ...offsetNeighbors(item.factory_hex_q, item.factory_hex_r),
    ];

    let spawned = false;
    for (const { q, r } of candidates) {
      // Check hex exists and is not water
      const { data: hex } = await db
        .from('hexes')
        .select('terrain')
        .eq('game_id', gameId).eq('hex_q', q).eq('hex_r', r)
        .single();

      if (!hex || hex.terrain === 'water') continue;

      // Check no enemy units on this hex
      const { data: enemies } = await db
        .from('units')
        .select('id')
        .eq('game_id', gameId).eq('hex_q', q).eq('hex_r', r)
        .neq('faction_id', item.faction_id);

      if (enemies?.length) continue;

      // Place unit (upsert merges stacks)
      const { data: existing } = await db
        .from('units')
        .select('id, quantity')
        .eq('game_id', gameId)
        .eq('faction_id', item.faction_id)
        .eq('unit_type_id', item.unit_type_id)
        .eq('hex_q', q).eq('hex_r', r)
        .maybeSingle();

      if (existing) {
        await db.from('units')
          .update({ quantity: existing.quantity + item.quantity })
          .eq('id', existing.id);
      } else {
        await db.from('units').insert({
          game_id: gameId,
          faction_id: item.faction_id,
          unit_type_id: item.unit_type_id,
          hex_q: q, hex_r: r,
          quantity: item.quantity,
        });
      }

      spawned = true;
      placed += item.quantity;
      break;
    }

    // Delete the queue item whether placed or not (lost if no valid spawn hex)
    await db.from('production_queue').delete().eq('id', item.id);
    if (!spawned) {
      // Production failed silently — factory blocked. Resources already spent.
    }
  }

  return { placed };
}

// ---------------------------------------------------------------------------
// 3. calculateManpower
// Settlement control: faction owns ≥ 3/4 of urban tiles assigned to it.
// Urban tile assignment: nearest settlement by hex distance.
// Manpower = count of urban tiles reachable (BFS) from controlled settlement.
// Manpower is NOT saved across turns (reset each Phase 4 before re-calculating).
// ---------------------------------------------------------------------------
export async function calculateManpower(db, gameId) {
  // Load all settlement hexes
  const { data: settlements } = await db
    .from('hexes')
    .select('hex_q, hex_r, owner_faction_id')
    .eq('game_id', gameId)
    .eq('has_settlement', true);

  if (!settlements?.length) return { assigned: {} };

  // Load all urban hexes
  const { data: urbanHexes } = await db
    .from('hexes')
    .select('hex_q, hex_r, owner_faction_id, urban_hp')
    .eq('game_id', gameId)
    .eq('has_urban', true);

  if (!urbanHexes?.length) return { assigned: {} };

  // Assign each urban tile to nearest settlement.
  // Tie-break: prefer settlement owned by same faction as the urban tile.
  const urbanAssignment = new Map(); // "q,r" → settlement {hex_q, hex_r, owner_faction_id}

  for (const urban of urbanHexes) {
    let bestDist = Infinity;
    let bestSett = null;

    for (const sett of settlements) {
      const d = hexDist(urban.hex_q, urban.hex_r, sett.hex_q, sett.hex_r);
      if (d < bestDist) {
        bestDist = d; bestSett = sett;
      } else if (d === bestDist) {
        // Tie-break: same faction as the urban tile wins.
        // Only replace if the candidate matches and the current winner doesn't.
        const candidateMatch = sett.owner_faction_id === urban.owner_faction_id;
        const prevMatch = bestSett?.owner_faction_id === urban.owner_faction_id;
        if (candidateMatch && !prevMatch) bestSett = sett;
      }
    }

    if (bestSett) urbanAssignment.set(`${urban.hex_q},${urban.hex_r}`, bestSett);
  }

  // For each settlement: count total assigned tiles and faction-owned tiles.
  const settKey = (s) => `${s.hex_q},${s.hex_r}`;
  const settTotals = new Map();   // settKey → { total, byFaction: Map<faction_id, count> }
  const settObj    = new Map();   // settKey → settlement

  for (const sett of settlements) {
    settTotals.set(settKey(sett), { total: 0, byFaction: new Map() });
    settObj.set(settKey(sett), sett);
  }

  for (const [, sett] of urbanAssignment) {
    const k = settKey(sett);
    const entry = settTotals.get(k);
    if (!entry) continue;
    entry.total++;
  }

  // Now count owned tiles per faction per settlement
  const urbanByKey = new Map(urbanHexes.map(u => [`${u.hex_q},${u.hex_r}`, u]));

  for (const [urbanKey, sett] of urbanAssignment) {
    const urban = urbanByKey.get(urbanKey);
    if (!urban?.owner_faction_id) continue;
    const k = settKey(sett);
    const entry = settTotals.get(k);
    if (!entry) continue;
    const prev = entry.byFaction.get(urban.owner_faction_id) ?? 0;
    entry.byFaction.set(urban.owner_faction_id, prev + 1);
  }

  // Determine which factions control each settlement (≥ 3/4 of assigned tiles).
  const controlledBy = new Map(); // settKey → faction_id or null

  for (const [k, entry] of settTotals) {
    let controller = null;
    for (const [fid, owned] of entry.byFaction) {
      if (entry.total > 0 && owned / entry.total >= 0.75) {
        controller = fid;
        break;
      }
    }
    controlledBy.set(k, controller);

    // Update settlement hex owner to match controller
    const sett = settObj.get(k);
    await db.from('hexes')
      .update({ owner_faction_id: controller })
      .eq('game_id', gameId).eq('hex_q', sett.hex_q).eq('hex_r', sett.hex_r);
  }

  // BFS from each controlled settlement through contiguous urban tiles to count manpower.
  // Only urban tiles that produce (urban_hp >= 3, i.e. not heavily damaged) count.
  const hexIndex = new Map(urbanHexes.map(u => [`${u.hex_q},${u.hex_r}`, u]));

  const factionManpower = new Map();

  for (const [k, factionId] of controlledBy) {
    if (!factionId) continue;
    const sett = settObj.get(k);

    let count = 0;
    const visited = new Set([`${sett.hex_q},${sett.hex_r}`]);
    const queue = [{ q: sett.hex_q, r: sett.hex_r }];

    // Count the settlement hex itself if it is urban, owned, and producing.
    const settUrban = hexIndex.get(`${sett.hex_q},${sett.hex_r}`);
    if (settUrban && settUrban.owner_faction_id === factionId && settUrban.urban_hp >= 3) {
      count++;
    }

    while (queue.length) {
      const { q, r } = queue.shift();
      for (const { q: nq, r: nr } of offsetNeighbors(q, r)) {
        const nk = `${nq},${nr}`;
        if (visited.has(nk)) continue;
        visited.add(nk);
        const urban = hexIndex.get(nk);
        // Must be urban, owned by this faction, and producing (hp ≥ 3)
        if (urban && urban.owner_faction_id === factionId && urban.urban_hp >= 3) {
          count++;
          queue.push({ q: nq, r: nr });
        }
      }
    }

    const prev = factionManpower.get(factionId) ?? 0;
    factionManpower.set(factionId, prev + count);
  }

  // Reset all factions' manpower then assign
  const { data: allFactions } = await db
    .from('factions').select('id').eq('game_id', gameId);

  for (const f of allFactions ?? []) {
    const mp = factionManpower.get(f.id) ?? 0;
    await db.from('factions').update({ manpower: mp }).eq('id', f.id);
  }

  return { assigned: Object.fromEntries(factionManpower) };
}

// ---------------------------------------------------------------------------
// 4. checkWinCondition
// A faction wins if it controls ≥ 2/3 of all settlement hexes at end of Phase 4.
// Returns { winner: faction_id | null }
// ---------------------------------------------------------------------------
export async function checkWinCondition(db, gameId) {
  const { data: settlements } = await db
    .from('hexes')
    .select('owner_faction_id')
    .eq('game_id', gameId)
    .eq('has_settlement', true);

  if (!settlements?.length) return { winner: null };

  const total = settlements.length;
  const byfaction = {};
  for (const s of settlements) {
    if (s.owner_faction_id) {
      byfaction[s.owner_faction_id] = (byfaction[s.owner_faction_id] ?? 0) + 1;
    }
  }

  const threshold = 2 / 3;
  for (const [fid, count] of Object.entries(byfaction)) {
    if (count / total >= threshold) {
      await db.from('games').update({ winner_faction_id: fid }).eq('id', gameId);
      return { winner: fid };
    }
  }

  return { winner: null };
}

// ---------------------------------------------------------------------------
// 5. processRepairOrders
// Naval at Harbor, air at Airbase — repair 1 HP, costs ceil(mat/4) + ceil(man/4).
// ---------------------------------------------------------------------------
export async function processRepairOrders(db, gameId, currentTurn) {
  const { data: repairOrders } = await db
    .from('movement_orders')
    .select('unit_id')
    .eq('game_id', gameId)
    .eq('turn', currentTurn)
    .eq('order_type', 'repair');

  if (!repairOrders?.length) return { repaired: 0 };

  let repaired = 0;

  for (const order of repairOrders) {
    const { data: unit } = await db
      .from('units')
      .select('id, hp, hex_q, hex_r, faction_id, unit_type_config(hp, mat_cost, man_cost, tags)')
      .eq('id', order.unit_id)
      .single();

    if (!unit || unit.hp == null) continue;

    const maxHp = unit.unit_type_config?.hp;
    if (!maxHp || unit.hp >= maxHp) continue;

    const tags = unit.unit_type_config?.tags ?? [];
    const facilityType = tags.includes('naval') ? 'harbor' : tags.includes('air') ? 'airbase' : null;
    if (!facilityType) continue;

    const { data: facility } = await db
      .from('buildings')
      .select('id')
      .eq('game_id', gameId)
      .eq('hex_q', unit.hex_q).eq('hex_r', unit.hex_r)
      .eq('type', facilityType)
      .gte('current_hp', 1)
      .maybeSingle();

    if (!facility) continue;

    const matCost = Math.ceil((unit.unit_type_config?.mat_cost ?? 2) / 4);
    const manCost = Math.ceil((unit.unit_type_config?.man_cost ?? 1) / 4);

    const { data: faction } = await db
      .from('factions').select('id, materials, manpower').eq('id', unit.faction_id).single();

    if (!faction || faction.materials < matCost || faction.manpower < manCost) continue;

    await Promise.all([
      db.from('factions').update({ materials: faction.materials - matCost, manpower: faction.manpower - manCost }).eq('id', faction.id),
      db.from('units').update({ hp: unit.hp + 1 }).eq('id', unit.id),
    ]);
    repaired++;
  }

  return { repaired };
}

// ---------------------------------------------------------------------------
// 6. processBuildOrders
// Supply trucks build structures. One-turn build → structure at full HP,
// truck consumed (except roads and canals).
// ---------------------------------------------------------------------------
const STRUCTURE_MAX_HP = { fortification: 4, bridge: 4, airstrip: 4 };

export async function processBuildOrders(db, gameId, currentTurn) {
  const { data: buildOrders } = await db
    .from('movement_orders')
    .select('unit_id, target_hex_q, target_hex_r, structure_type')
    .eq('game_id', gameId)
    .eq('turn', currentTurn)
    .eq('order_type', 'build');

  if (!buildOrders?.length) return { built: 0 };

  let built = 0;

  for (const order of buildOrders) {
    const { structure_type, unit_id, target_hex_q, target_hex_r } = order;
    if (!structure_type) continue;

    const { data: unit } = await db
      .from('units')
      .select('id, hex_q, hex_r, faction_id, quantity')
      .eq('id', unit_id).single();
    if (!unit) continue;

    const tq = target_hex_q ?? unit.hex_q;
    const tr = target_hex_r ?? unit.hex_r;

    if (structure_type === 'road') {
      await db.from('hexes').update({ has_road: true })
        .eq('game_id', gameId).eq('hex_q', tq).eq('hex_r', tr);
      built++;
      continue;
    }

    if (structure_type === 'canal') {
      // Canal: deduct 10 manpower, set has_canal, truck NOT consumed
      const { data: faction } = await db
        .from('factions').select('id, manpower').eq('id', unit.faction_id).single();
      if (!faction || faction.manpower < 10) continue;
      await db.from('factions').update({ manpower: faction.manpower - 10 }).eq('id', faction.id);
      await db.from('hexes').update({ has_canal: true })
        .eq('game_id', gameId).eq('hex_q', tq).eq('hex_r', tr);
      built++;
      continue;
    }

    const maxHp = STRUCTURE_MAX_HP[structure_type];
    if (!maxHp) continue;

    // Create or replace existing building at full HP; consume truck
    const { error } = await db.from('buildings').upsert({
      game_id: gameId, hex_q: tq, hex_r: tr,
      type: structure_type, current_hp: maxHp, max_hp: maxHp,
      owner_faction_id: unit.faction_id,
    }, { onConflict: 'game_id,hex_q,hex_r,type' });

    if (error) continue;

    // Consume supply truck
    const newQty = unit.quantity - 1;
    if (newQty <= 0) {
      await db.from('units').delete().eq('id', unit.id);
    } else {
      await db.from('units').update({ quantity: newQty }).eq('id', unit.id);
    }
    built++;
  }

  return { built };
}

// ---------------------------------------------------------------------------
// 7. resetTurnReady
// Clears turn_ready for all players so the next ordering phase can begin.
// ---------------------------------------------------------------------------
export async function resetTurnReady(db, gameId) {
  await db.from('game_participants')
    .update({ turn_ready: false })
    .eq('game_id', gameId)
    .eq('role', 'player');
}

// ---------------------------------------------------------------------------
// runPhase4 — convenience wrapper for advance-turn
// ---------------------------------------------------------------------------
export async function runPhase4(db, gameId, currentTurn) {
  // Repair and build both deduct faction resources — must be sequential to avoid read-modify-write races.
  const repairResult = await processRepairOrders(db, gameId, currentTurn);
  const buildResult  = await processBuildOrders(db, gameId, currentTurn);
  // Materials collection and production do not deduct resources — safe to parallelize.
  const [materials, production] = await Promise.all([
    collectMaterials(db, gameId),
    advanceProduction(db, gameId, currentTurn),
  ]);

  // calculateManpower must finish before checkWinCondition (writes settlement owners).
  const manpower = await calculateManpower(db, gameId);
  const winResult = await checkWinCondition(db, gameId);

  await resetTurnReady(db, gameId);

  return {
    materials_collected: materials.collected,
    units_placed: production.placed,
    units_repaired: repairResult.repaired,
    structures_built: buildResult.built,
    manpower: manpower.assigned,
    winner: winResult.winner,
  };
}
