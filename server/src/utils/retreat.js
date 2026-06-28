// =============================================================
// retreat.js — Phase 3 Retreat and Pursue-if-Retreat orders
//
// Runs BEFORE regular movement (executeGroundMoves) in Phase 3.
//
// Retreat order rules:
//   - Only valid if the unit's hex is contested (enemy units present).
//   - Unit moves to an adjacent non-enemy hex. If none exist (surrounded),
//     the order is cancelled and the unit stays.
//   - Enemies in the original hex fire range-1 shots at the retreater as it
//     leaves. Retreater does NOT fire back.
//   - Attack formula: 2d6 ≤ to_hit → hit; 2d6 ≤ (defense + bonus − pen) → saved.
//   - Retreat fire from all enemies is simultaneous; casualties applied after
//     all retreats are processed.
//
// Pursue-if-Retreat rules:
//   - Conditional: only activates if ≥1 enemy unit retreated FROM the hex
//     this turn.
//   - Pursuit roll: 2d6 ≤ (5 + avg_pursuer_move − avg_retreater_move).
//     Natural 2 always succeeds. Natural 12 always fails.
//   - avg_pursuer_move  = mean unit_type_config.move of pursuing units.
//   - avg_retreater_move = mean unit_type_config.move of units that retreated.
//   - On success: pursuer moves to the retreater's vacated (original) hex.
//   - Auto-fails if that hex is impassable for the pursuer type (foot_cost IS NULL
//     = water, or mechanized checks applied).
//
// Axial hex neighbours (flat-top, axial coordinates):
//   [+1,0], [-1,0], [0,+1], [0,-1], [+1,-1], [-1,+1]
//
// Returns { retreatCount, pursuitCount, casualties: Map<unit_id, number>, errors }
// =============================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { offsetNeighbors } from './hexGeometry.js';

function hexKey(q, r) {
  return `${q},${r}`;
}

function roll2d6() {
  return Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
}

// Defense bonus for a retreating unit in its original hex.
// Uses the same stacking rules as combat.js (no elevation bonus — same-hex fire).
function defenseBonus(unit, hex, hasFortificationBuilding = false) {
  let bonus = 0;
  if (unit.fortification_level === 1) bonus += 1;
  if (hasFortificationBuilding) bonus += 1;
  if (hex.has_heavy_vegetation) {
    bonus += 2;
  } else if (hex.has_light_vegetation) {
    bonus += 1;
  }
  return bonus;
}

// Is hex passable for a given unit type?
// Returns true if the unit can enter the hex.
// Ground units cannot enter Water (foot_cost IS NULL).
// Mechanized units cannot enter Mountains without road (mech_cost IS NULL when no road)
// or hexes with has_heavy_vegetation.
function isPassable(unitTypeCfg, hex) {
  const isMech =
    Array.isArray(unitTypeCfg.tags) && unitTypeCfg.tags.includes('mechanized');

  // foot_cost IS NULL means water — impassable to all ground units.
  if (hex.terrain_type_config.foot_cost == null) return false;

  if (isMech) {
    if (hex.has_heavy_vegetation) return false;
    if (hex.has_road) {
      // Road exists — check if road cost is defined for mechanized.
      if (hex.terrain_type_config.mech_road_cost != null) return true;
    }
    // No usable road: mountains (mech_cost IS NULL) impassable.
    if (hex.terrain_type_config.mech_cost == null) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// executeRetreatsAndPursuit
//
// db     : Supabase client
// gameId : UUID string
// turn   : current turn integer
// ---------------------------------------------------------------------------
export async function executeRetreatsAndPursuit(db, gameId, turn) {
  const errors = [];
  let retreatCount = 0;
  let pursuitCount = 0;
  const globalCasualties = new Map(); // unit_id → cumulative casualty count
  const combatLogInserts = [];

  // -------------------------------------------------------------------------
  // 1. Load retreat and pursue_if_retreat orders for this game and turn.
  // -------------------------------------------------------------------------
  const { data: orders, error: ordersError } = await db
    .from('movement_orders')
    .select(`
      id,
      unit_id,
      order_type,
      to_hex_q,
      to_hex_r
    `)
    .eq('game_id', gameId)
    .eq('turn', turn)
    .in('order_type', ['retreat', 'pursue_if_retreat']);

  if (ordersError) {
    return {
      retreatCount: 0,
      pursuitCount: 0,
      casualties: globalCasualties,
      errors: [`Failed to load retreat/pursuit orders: ${ordersError.message}`],
    };
  }

  if (!orders || orders.length === 0) {
    return { retreatCount: 0, pursuitCount: 0, casualties: globalCasualties, errors: [] };
  }

  // -------------------------------------------------------------------------
  // 2. Load all units for the game with their unit_type_config stats.
  // -------------------------------------------------------------------------
  const { data: allUnits, error: unitsError } = await db
    .from('units')
    .select(`
      id,
      faction_id,
      unit_type_id,
      hex_q,
      hex_r,
      quantity,
      hp,
      fortification_level,
      unit_type_config!inner (
        id,
        name,
        tags,
        move,
        to_hit,
        defense,
        penetration
      )
    `)
    .eq('game_id', gameId);

  if (unitsError) {
    return {
      retreatCount: 0,
      pursuitCount: 0,
      casualties: globalCasualties,
      errors: [`Failed to load units: ${unitsError.message}`],
    };
  }

  if (!allUnits || allUnits.length === 0) {
    return { retreatCount: 0, pursuitCount: 0, casualties: globalCasualties, errors: [] };
  }

  // -------------------------------------------------------------------------
  // 3. Load all hex terrain data (needed for passability + defense bonuses).
  // -------------------------------------------------------------------------
  const { data: hexRows, error: hexError } = await db
    .from('hexes')
    .select(`
      hex_q,
      hex_r,
      has_road,
      has_light_vegetation,
      has_heavy_vegetation,
      terrain_type_config!inner (
        name,
        foot_cost,
        mech_cost,
        foot_road_cost,
        mech_road_cost
      )
    `)
    .eq('game_id', gameId);

  if (hexError) {
    return {
      retreatCount: 0,
      pursuitCount: 0,
      casualties: globalCasualties,
      errors: [`Failed to load hexes: ${hexError.message}`],
    };
  }

  const hexesByKey = new Map();
  for (const h of hexRows ?? []) {
    hexesByKey.set(hexKey(h.hex_q, h.hex_r), h);
  }

  // Load fortification buildings for defense bonus during retreat fire.
  const { data: fortBuildingRows } = await db
    .from('buildings')
    .select('hex_q, hex_r, current_hp, owner_faction_id')
    .eq('game_id', gameId)
    .eq('type', 'fortification');

  const fortBuildingsByHex = new Map();
  for (const b of fortBuildingRows ?? []) {
    const k = hexKey(b.hex_q, b.hex_r);
    if (!fortBuildingsByHex.has(k)) fortBuildingsByHex.set(k, []);
    fortBuildingsByHex.get(k).push(b);
  }

  // -------------------------------------------------------------------------
  // 4. Build working data structures.
  //
  //    unitById   : Map<unit_id, unit>
  //    hexUnits   : Map<hexKey, unit[]>    — mutable; updated as retreats move units
  // -------------------------------------------------------------------------
  const unitById = new Map();
  for (const u of allUnits) {
    unitById.set(u.id, {
      ...u,
      unitTypeCfg: u.unit_type_config,
    });
  }

  // Build hex → units map (tracks current positions, mutated during retreat processing).
  const hexUnits = new Map();
  for (const u of unitById.values()) {
    const k = hexKey(u.hex_q, u.hex_r);
    if (!hexUnits.has(k)) hexUnits.set(k, []);
    hexUnits.get(k).push(u);
  }

  // Helper: is the given hex contested (has units from 2+ factions)?
  function isContested(k) {
    const units = hexUnits.get(k) ?? [];
    const factionSet = new Set(units.map((u) => u.faction_id));
    return factionSet.size >= 2;
  }

  // Separate orders by type.
  const retreatOrders = orders.filter((o) => o.order_type === 'retreat');
  const pursueOrders  = orders.filter((o) => o.order_type === 'pursue_if_retreat');

  // -------------------------------------------------------------------------
  // 5. Process retreats (simultaneous — all fire is queued before applying).
  //
  //    retreatedFrom : Map<hexKey, { retreaterFactionId, avgRetreaterMove }>
  //      Populated for each successful retreat. Used later by pursuit logic.
  //    retreatFireQueue : Array<{ targetId, toHit, pen, defenseBonus, originKey }>
  //      Each entry represents one firing die against the retreater.
  // -------------------------------------------------------------------------

  // Track which original hexes had successful retreats and from which faction,
  // storing avg move of retreaters for pursuit roll.
  // Map<originalHexKey, { retreaterFactionId, retreaterMoves: number[], retreaterIds: string[] }>
  const retreatedFromHex = new Map();

  // Fire dice queued from all retreats, resolved simultaneously.
  // { targetId, toHit, pen, defBonus }
  const retreatFireQueue = [];

  for (const order of retreatOrders) {
    const unit = unitById.get(order.unit_id);
    if (!unit) {
      errors.push(`Retreat: unit ${order.unit_id} not found.`);
      continue;
    }

    const originKey = hexKey(unit.hex_q, unit.hex_r);

    // 5a. Verify the hex is contested.
    if (!isContested(originKey)) {
      // Not locked — order ignored silently (unit can retreat freely in regular move).
      continue;
    }

    // 5b. Find adjacent non-enemy hexes as candidate retreat destinations.
    const enemyUnitsInHex = (hexUnits.get(originKey) ?? []).filter(
      (u) => u.faction_id !== unit.faction_id
    );

    // A retreat destination is valid if:
    //   - it is adjacent,
    //   - it has no enemy units currently (enemy = other faction),
    //   - it is passable for this unit type.
    const candidates = [];
    for (const { q: nq, r: nr } of offsetNeighbors(unit.hex_q, unit.hex_r)) {
      const nk = hexKey(nq, nr);

      const destHex = hexesByKey.get(nk);
      if (!destHex) continue; // off-map

      if (!isPassable(unit.unitTypeCfg, destHex)) continue;

      const unitsAtDest = hexUnits.get(nk) ?? [];
      const hasEnemy = unitsAtDest.some((u) => u.faction_id !== unit.faction_id);
      if (hasEnemy) continue;

      candidates.push({ q: nq, r: nr, k: nk });
    }

    if (candidates.length === 0) {
      // Surrounded — retreat cancelled.
      errors.push(
        `Retreat: unit ${order.unit_id} (${unit.unitTypeCfg.name}) at (${unit.hex_q},${unit.hex_r}) is surrounded — retreat cancelled.`
      );
      continue;
    }

    // 5c. Pick a destination.
    //   If the player specified a destination (to_hex_q/r), honour it if valid.
    //   Otherwise pick the first candidate (arbitrary but deterministic).
    let dest = candidates[0];
    if (order.to_hex_q != null && order.to_hex_r != null) {
      const requested = candidates.find(
        (c) => c.q === order.to_hex_q && c.r === order.to_hex_r
      );
      if (requested) {
        dest = requested;
      }
      // If the requested destination is invalid, fall back to first candidate silently.
    }

    // 5d. Queue retreat fire from every enemy unit in the original hex.
    const hex = hexesByKey.get(originKey) ?? {
      has_light_vegetation: false,
      has_heavy_vegetation: false,
    };
    const hasFortBuilding = (fortBuildingsByHex.get(originKey) ?? []).some(
      b => b.current_hp > 0 && b.owner_faction_id === unit.faction_id
    );
    const bonus = defenseBonus(unit, hex, hasFortBuilding);

    for (const enemy of enemyUnitsInHex) {
      const eCfg = enemy.unitTypeCfg;
      if (eCfg.to_hit == null) continue; // non-firing unit (Artillery, Supply, etc.)

      // Enemy fires quantity dice at the retreater.
      const dice = enemy.quantity ?? 1;
      for (let d = 0; d < dice; d++) {
        retreatFireQueue.push({
          targetId:   unit.id,
          toHit:      eCfg.to_hit,
          pen:        eCfg.penetration ?? 0,
          defBonus:   bonus,
          targetCfg:  unit.unitTypeCfg,
          originKey,
        });
      }
    }

    // 5e. Move unit in our working data structures.
    //   Save original coords BEFORE overwriting so we can undo on DB failure.
    const origQ = unit.hex_q;
    const origR = unit.hex_r;

    //   Remove from old hex.
    const oldHexList = hexUnits.get(originKey) ?? [];
    hexUnits.set(originKey, oldHexList.filter((u) => u.id !== unit.id));

    //   Update unit's position in unitById.
    unit.hex_q = dest.q;
    unit.hex_r = dest.r;

    //   Add to new hex.
    if (!hexUnits.has(dest.k)) hexUnits.set(dest.k, []);
    hexUnits.get(dest.k).push(unit);

    // 5f. Persist the new position to DB.
    const { error: moveError } = await db
      .from('units')
      .update({ hex_q: dest.q, hex_r: dest.r })
      .eq('id', unit.id);

    if (moveError) {
      errors.push(
        `Retreat: failed to move unit ${unit.id} to (${dest.q},${dest.r}) — ${moveError.message}`
      );
      // Undo in-memory move: remove from dest, restore to origin.
      hexUnits.set(dest.k, (hexUnits.get(dest.k) ?? []).filter((u) => u.id !== unit.id));
      unit.hex_q = origQ;
      unit.hex_r = origR;
      if (!hexUnits.has(originKey)) hexUnits.set(originKey, []);
      hexUnits.get(originKey).push(unit);
      continue;
    }

    // 5g. Record the retreat for pursuit tracking.
    if (!retreatedFromHex.has(originKey)) {
      retreatedFromHex.set(originKey, {
        retreaterFactionId: unit.faction_id,
        retreaterMoves: [],
        retreaterIds: [],   // track specific unit IDs so pursuit can find their destination
      });
    }
    const retreatRecord = retreatedFromHex.get(originKey);
    retreatRecord.retreaterMoves.push(unit.unitTypeCfg.move);
    retreatRecord.retreaterIds.push(unit.id);

    // 5h. Build combat log entry for this retreat.
    combatLogInserts.push({
      game_id: gameId,
      turn,
      phase: 3,
      hex_q: unit.hex_q, // already updated — log destination
      hex_r: unit.hex_r,
      log_type: 'retreat',
      faction_id: unit.faction_id,
      data: {
        event: 'retreat',
        unit_id: unit.id,
        unit_type: unit.unitTypeCfg.name,
        from_hex: { q: Number(originKey.split(',')[0]), r: Number(originKey.split(',')[1]) },
        to_hex: { q: dest.q, r: dest.r },
      },
    });

    retreatCount++;
  }

  // -------------------------------------------------------------------------
  // 6. Resolve retreat fire (all dice rolled simultaneously).
  // -------------------------------------------------------------------------
  const retreatFireLog = [];

  for (const die of retreatFireQueue) {
    const targetUnit = unitById.get(die.targetId);
    if (!targetUnit) continue; // already destroyed or not found

    const attackRoll = roll2d6();
    const hit = attackRoll <= die.toHit;

    if (!hit) {
      retreatFireLog.push(
        `Retreat fire vs unit ${die.targetId} (${die.targetCfg.name}): attack ${attackRoll}/${die.toHit} — miss.`
      );
      continue;
    }

    const saveTarget = die.targetCfg.defense + die.defBonus - die.pen;
    const saveRoll = roll2d6();
    const saved = saveRoll <= Math.max(saveTarget, 0);

    retreatFireLog.push(
      `Retreat fire vs unit ${die.targetId} (${die.targetCfg.name}): attack ${attackRoll}/${die.toHit} HIT, save ${saveRoll}/${Math.max(saveTarget, 0)}${saved ? ' SAVED' : ' CASUALTY'}${die.defBonus ? ` (defense bonus +${die.defBonus})` : ''}.`
    );

    if (!saved) {
      globalCasualties.set(die.targetId, (globalCasualties.get(die.targetId) ?? 0) + 1);
    }
  }

  if (retreatFireLog.length > 0) {
    combatLogInserts.push({
      game_id: gameId,
      turn,
      phase: 3,
      hex_q: 0,
      hex_r: 0,
      log_type: 'combat',
      faction_id: null,
      data: {
        event: 'retreat_fire',
        log: retreatFireLog,
        casualties: Object.fromEntries(globalCasualties),
      },
    });
  }

  // -------------------------------------------------------------------------
  // 7. Apply retreat fire casualties.
  //
  //    HP units:       subtract casualties from hp; delete if hp ≤ 0.
  //    Quantity units: subtract from quantity; delete if qty ≤ 0.
  // -------------------------------------------------------------------------
  for (const [unitId, count] of globalCasualties) {
    const unit = unitById.get(unitId);
    if (!unit) continue;

    if (unit.hp != null) {
      const newHp = unit.hp - count;
      if (newHp <= 0) {
        const { error } = await db.from('units').delete().eq('id', unitId);
        if (error) errors.push(`Retreat casualty: failed to delete unit ${unitId} — ${error.message}`);
        else unitById.delete(unitId);
      } else {
        const { error } = await db.from('units').update({ hp: newHp }).eq('id', unitId);
        if (error) errors.push(`Retreat casualty: failed to update hp for unit ${unitId} — ${error.message}`);
        else unit.hp = newHp;
      }
    } else {
      const newQty = (unit.quantity ?? 1) - count;
      if (newQty <= 0) {
        const { error } = await db.from('units').delete().eq('id', unitId);
        if (error) errors.push(`Retreat casualty: failed to delete unit ${unitId} — ${error.message}`);
        else unitById.delete(unitId);
      } else {
        const { error } = await db.from('units').update({ quantity: newQty }).eq('id', unitId);
        if (error) errors.push(`Retreat casualty: failed to update quantity for unit ${unitId} — ${error.message}`);
        else unit.quantity = newQty;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 8. Process Pursue-if-Retreat orders.
  //
  //    For each pursuer: check if any enemy retreated from their current hex.
  //    If yes, roll 2d6 ≤ (5 + avg_pursuer_move − avg_retreater_move).
  //    Natural 2 always succeeds; natural 12 always fails.
  //    On success, move pursuer to the vacated (retreater's original) hex,
  //    provided it is passable for the pursuer.
  // -------------------------------------------------------------------------
  for (const order of pursueOrders) {
    const pursuer = unitById.get(order.unit_id);
    if (!pursuer) {
      // Unit may have been destroyed by retreat fire.
      continue;
    }

    const currentKey = hexKey(pursuer.hex_q, pursuer.hex_r);

    // Find whether any enemy retreated FROM this hex.
    const retreatRecord = retreatedFromHex.get(currentKey);
    if (!retreatRecord) {
      // No enemy retreated from here — pursue order does not activate.
      continue;
    }

    // Ensure the retreating faction is actually an enemy (different faction).
    if (retreatRecord.retreaterFactionId === pursuer.faction_id) {
      // Friendly units retreated — pursuit doesn't apply.
      continue;
    }

    // Compute averages.
    const pursuerUnitsInHex = (hexUnits.get(currentKey) ?? []).filter(
      (u) => u.faction_id === pursuer.faction_id && unitById.has(u.id)
    );

    const avgPursuerMove =
      pursuerUnitsInHex.length > 0
        ? pursuerUnitsInHex.reduce((s, u) => s + (u.unitTypeCfg.move ?? 0), 0) /
          pursuerUnitsInHex.length
        : (pursuer.unitTypeCfg.move ?? 0);

    const avgRetreaterMove =
      retreatRecord.retreaterMoves.length > 0
        ? retreatRecord.retreaterMoves.reduce((s, v) => s + v, 0) /
          retreatRecord.retreaterMoves.length
        : 0;

    // 8a. Auto-fail: check if the destination (retreater's original hex = currentKey)
    //    is passable for the pursuer. The pursuer wants to move INTO the hex the
    //    retreater just vacated — which is actually their own current hex.
    //    Wait — the pursuer is already IN the original contested hex.
    //    The retreater LEFT the hex. The pursuer stays in the now-vacated hex.
    //    "Pursuer moves to the hex the retreater vacated" = the currentKey itself
    //    (the pursuer is already there). So pursuit means the pursuer stays put
    //    and "wins" the hex — there is no position change needed unless we interpret
    //    it as chasing into the retreater's DESTINATION hex.
    //
    //    Re-reading CLAUDE.md: "On success: pursuer moves to the hex the retreater
    //    vacated (the retreater's original hex, which they just left)."
    //    The retreater's original hex IS the pursuer's current hex — so successful
    //    pursuit means no position change (pursuer is already there). The auto-fail
    //    check is whether the retreater's DESTINATION is impassable (i.e., the
    //    retreater can't be caught if they fled to somewhere the pursuer can't follow).
    //
    //    Implementing as written: "Auto-fails if retreater destination is impassable
    //    to pursuer." We stored retreater's destination implicitly — the retreater
    //    moved away from currentKey to some neighbour. We need to find that hex.
    //    The retreater's new position was set in unitById during step 5e.
    //
    //    We'll check all adjacent hexes that the retreater might have gone to.
    //    Since we moved them already, find units of the retreating faction in
    //    adjacent hexes that were updated this phase.

    // Locate the retreater's destination hex using the IDs we tracked during
    // step 5g. These IDs are only units that retreated FROM currentKey, so
    // there is no cross-hex contamination in multi-retreat turns.
    let retreaterDestKey = null;
    for (const rId of retreatRecord.retreaterIds) {
      const rUnit = unitById.get(rId);
      if (!rUnit) continue;
      const rCurrentKey = hexKey(rUnit.hex_q, rUnit.hex_r);
      if (rCurrentKey !== currentKey) {
        retreaterDestKey = rCurrentKey;
        break;
      }
    }

    // Check auto-fail: is the retreater's destination impassable?
    if (retreaterDestKey) {
      const destHex = hexesByKey.get(retreaterDestKey);
      if (!destHex || !isPassable(pursuer.unitTypeCfg, destHex)) {
        combatLogInserts.push({
          game_id: gameId,
          turn,
          phase: 3,
          hex_q: pursuer.hex_q,
          hex_r: pursuer.hex_r,
          log_type: 'combat',
          faction_id: pursuer.faction_id,
          data: {
            event: 'pursuit_auto_fail',
            unit_id: pursuer.id,
            reason: 'Retreater destination is impassable for pursuer.',
          },
        });
        continue;
      }
    }

    // 8b. Pursuit roll.
    const rollTarget = 5 + avgPursuerMove - avgRetreaterMove;
    const pursuitRoll = roll2d6();

    const success =
      pursuitRoll === 2 ||  // natural 2 always succeeds
      (pursuitRoll !== 12 && pursuitRoll <= rollTarget); // natural 12 always fails

    combatLogInserts.push({
      game_id: gameId,
      turn,
      phase: 3,
      hex_q: pursuer.hex_q,
      hex_r: pursuer.hex_r,
      log_type: 'combat',
      faction_id: pursuer.faction_id,
      data: {
        event: 'pursuit_roll',
        unit_id: pursuer.id,
        unit_type: pursuer.unitTypeCfg.name,
        roll: pursuitRoll,
        roll_target: rollTarget,
        avg_pursuer_move: avgPursuerMove,
        avg_retreater_move: avgRetreaterMove,
        success,
      },
    });

    if (!success) {
      continue;
    }

    // 8c. Successful pursuit — pursuer is already in the vacated hex (currentKey).
    //    No position update needed. The "pursuit" is that the pursuer holds the
    //    hex the retreater fled from. Log it.
    combatLogInserts.push({
      game_id: gameId,
      turn,
      phase: 3,
      hex_q: pursuer.hex_q,
      hex_r: pursuer.hex_r,
      log_type: 'combat',
      faction_id: pursuer.faction_id,
      data: {
        event: 'pursuit_success',
        unit_id: pursuer.id,
        unit_type: pursuer.unitTypeCfg.name,
        held_hex: { q: pursuer.hex_q, r: pursuer.hex_r },
        retreater_fled_to: retreaterDestKey,
      },
    });

    pursuitCount++;
  }

  // -------------------------------------------------------------------------
  // 9. Insert all combat log rows.
  // -------------------------------------------------------------------------
  if (combatLogInserts.length > 0) {
    const { error: logError } = await db.from('combat_log').insert(combatLogInserts);
    if (logError) {
      errors.push(`Failed to insert combat log: ${logError.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // 10. Return summary.
  // -------------------------------------------------------------------------
  return { retreatCount, pursuitCount, casualties: globalCasualties, errors };
}
