// =============================================================
// movement.js — Path validation and ground movement execution
//
// Movement budget = unitType.move (direct, no internal scaling).
// Terrain costs are direct integers from terrain_type_config:
//   foot units  → foot_cost  (NULL = impassable)
//   mechanized  → mech_cost  ('mechanized' in tags; NULL = impassable)
//   water       → impassable to all ground units (foot_cost IS NULL)
//   mountains   → mech_cost IS NULL → impassable to mechanized
//   heavy veg   → has_heavy_vegetation = true → impassable to mechanized
//
// Single-step paths (1 waypoint after start) are always permitted even if
// the cost would exceed budget; this lets a unit always enter an adjacent hex.
// =============================================================

import { isAdjacent, hexDist, hexesInRange } from './hexGeometry.js';
import { fetchAll } from '../db.js';

// ---------------------------------------------------------------------------
// Dice helpers (kept inline — movement.js is self-contained).
// ---------------------------------------------------------------------------
function roll2d6() {
  return Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
}

// Detection roll-under check.
// Returns true if the moving unit is detected by the patrol.
function detectionCheck(detRating, stealthRating, distance) {
  const score = 7 + detRating - stealthRating - distance;
  if (score > 12) return true;
  if (score < 2) return false;
  return roll2d6() <= score;
}

// ---------------------------------------------------------------------------
// Cost to enter a single hex for a given unit type.
// Returns Infinity for impassable hexes, otherwise the direct integer cost.
// ---------------------------------------------------------------------------
function enterCost(unitType, hex) {
  const isMech = Array.isArray(unitType.tags) && unitType.tags.includes('mechanized');
  const cfg = hex.terrain_type_config;

  // Water is impassable to all ground units (foot_cost IS NULL).
  if (cfg.foot_cost == null) return Infinity;

  if (isMech) {
    // Heavy vegetation is impassable to mechanized units.
    if (hex.has_heavy_vegetation) return Infinity;
    // Mountains and wetlands: mech_cost IS NULL → impassable.
    if (cfg.mech_cost == null) return Infinity;
    return cfg.mech_cost;
  }

  return cfg.foot_cost;
}

// ---------------------------------------------------------------------------
// validatePath
//
// unitType  : { move: number, tags: string[] }
// path      : [{q, r}, ...] array of waypoints INCLUDING the starting hex
//             (path[0] = origin, path[path.length-1] = destination)
// hexesByKey: Map<"q,r", hex> where hex has:
//               terrain_type_config: { foot_cost, mech_cost }
//               has_heavy_vegetation: boolean
//
// Returns { valid: boolean, reason?: string }
// ---------------------------------------------------------------------------
export function validatePath(unitType, path, hexesByKey) {
  if (!path || path.length < 2) {
    return { valid: false, reason: 'Path must have at least a start and one destination.' };
  }

  const budget = unitType.move;
  const steps = path.length - 1; // number of hex transitions

  let totalCost = 0;

  for (let i = 0; i < steps; i++) {
    const from = path[i];
    const to = path[i + 1];

    // Verify adjacency at every step.
    if (!isAdjacent(from.q, from.r, to.q, to.r)) {
      return {
        valid: false,
        reason: `Step ${i + 1}: hex (${from.q},${from.r}) → (${to.q},${to.r}) is not adjacent.`,
      };
    }

    const hexKey = `${to.q},${to.r}`;
    const hex = hexesByKey.get(hexKey);
    if (!hex) {
      return { valid: false, reason: `Hex (${to.q},${to.r}) not found on map.` };
    }

    const cost = enterCost(unitType, hex);
    if (cost === Infinity) {
      return {
        valid: false,
        reason: `Hex (${to.q},${to.r}) is impassable for this unit type.`,
      };
    }

    totalCost += cost;

    // Single-step override: a unit can always enter the immediately adjacent hex
    // even if it's expensive. Only enforce the budget for paths longer than 1 step.
    if (steps === 1) {
      return { valid: true };
    }

    if (totalCost > budget) {
      return {
        valid: false,
        reason: `Path exceeds movement budget at step ${i + 1} (cost so far: ${totalCost}, budget: ${budget}).`,
      };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// runPatrolIntercepts
//
// After validMoves is built, check each destination hex against enemy patrol
// zones. If a patrol unit detects the mover and wins (or ties) combat, the
// move is cancelled. The patrol unit is physically moved to the intercepted
// hex in the DB.
//
// Parameters:
//   db           — Supabase client
//   gameId       — UUID string
//   turn         — current turn number
//   validMoves   — array of { unitId, finalQ, finalR, unit } objects (mutated in-place via cancelledMoves)
//   unitPathMap  — Map<unitId, { unit, unitType }> for moving unit config lookup
//
// Returns:
//   {
//     cancelledMoves : Set<unitId>  — unit IDs whose moves were cancelled
//     patrolUpdates  : Array        — { id, hex_q, hex_r, quantity, destroyed } for DB writes
//     combatLogRows  : Array        — rows to insert into combat_log
//     patrolIntercepts : number     — count of intercepts that actually fired
//     errors         : string[]
//   }
// ---------------------------------------------------------------------------
async function runPatrolIntercepts(db, gameId, turn, validMoves, unitPathMap) {
  const cancelledMoves = new Set();
  const patrolUpdates = [];   // { id, hex_q, hex_r, quantity, destroyed }
  const combatLogRows = [];
  const errors = [];
  let patrolIntercepts = 0;

  // -----------------------------------------------------------------------
  // 1. Load all ground patrol units from enemy factions.
  //    We need: id, faction_id, unit_type_id, hex_q, hex_r, quantity, standing_order.
  //    Also load their unit_type_config inline.
  //    Filter: standing_order = 'patrol', no 'air' or 'naval' tags.
  // -----------------------------------------------------------------------
  const { data: patrolRows, error: patrolErr } = await db
    .from('units')
    .select(`
      id,
      faction_id,
      unit_type_id,
      hex_q,
      hex_r,
      quantity,
      standing_order,
      unit_type_config!inner (
        id,
        name,
        tags,
        move,
        to_hit,
        defense,
        penetration,
        detection_rating,
        stealth_rating
      )
    `)
    .eq('game_id', gameId)
    .eq('standing_order', 'patrol');

  if (patrolErr) {
    errors.push(`Patrol intercept: failed to load patrol units — ${patrolErr.message}`);
    return { cancelledMoves, patrolUpdates, combatLogRows, patrolIntercepts, errors };
  }

  if (!patrolRows || patrolRows.length === 0) {
    return { cancelledMoves, patrolUpdates, combatLogRows, patrolIntercepts, errors };
  }

  // Filter to ground-only patrol units (no 'air' or 'naval' tag).
  const groundPatrols = patrolRows.filter((p) => {
    const tags = p.unit_type_config?.tags ?? [];
    return !tags.includes('air') && !tags.includes('naval');
  });

  if (groundPatrols.length === 0) {
    return { cancelledMoves, patrolUpdates, combatLogRows, patrolIntercepts, errors };
  }

  // Build a mutable working copy of each patrol unit's state so we can
  // track casualties across multiple potential intercepts in the same turn.
  // Map: patrol unit DB id → working state object
  const patrolState = new Map();
  for (const p of groundPatrols) {
    patrolState.set(p.id, {
      id: p.id,
      faction_id: p.faction_id,
      unit_type_id: p.unit_type_id,
      hex_q: p.hex_q,
      hex_r: p.hex_r,
      quantity: p.quantity,
      cfg: p.unit_type_config,
      interceptedHexQ: null,  // set when an intercept fires
      interceptedHexR: null,
      destroyed: false,
      hasIntercepted: false,  // one intercept per turn
    });
  }

  // -----------------------------------------------------------------------
  // 2. For each valid move, check if any enemy patrol covers the destination.
  // -----------------------------------------------------------------------
  for (const move of validMoves) {
    if (cancelledMoves.has(move.unitId)) continue; // already cancelled by a prior intercept

    // Get the moving unit's config (we need stealth_rating and combat stats).
    const moverEntry = unitPathMap.get(move.unitId);
    if (!moverEntry) continue;
    const moverUnit = moverEntry.unit;
    const moverCfg  = moverEntry.unitType; // has: tags, move, to_hit, defense, penetration, stealth_rating

    for (const [, patrol] of patrolState) {
      // Skip if already used this turn or already destroyed.
      if (patrol.hasIntercepted || patrol.destroyed) continue;

      // Skip if same faction as mover.
      if (patrol.faction_id === moverUnit.faction_id) continue;

      // Foot radius 1, mechanized radius 2 (per DESIGN.md patrol rules).
      const isMechPatrol = Array.isArray(patrol.cfg?.tags) && patrol.cfg.tags.includes('mechanized');
      const radius = isMechPatrol ? 2 : 1;

      // Check if the destination hex is within patrol zone.
      const patrolZone = hexesInRange(patrol.hex_q, patrol.hex_r, radius);
      const destKey = `${move.finalQ},${move.finalR}`;
      if (!patrolZone.has(destKey)) continue;

      // -----------------------------------------------------------------------
      // 3. Detection check.
      //    distance = hex distance between patrol and destination.
      //    MVP: use hex distance as proxy for LOS; full LOS not yet implemented.
      // -----------------------------------------------------------------------
      const dist = hexDist(patrol.hex_q, patrol.hex_r, move.finalQ, move.finalR);
      const detRating   = patrol.cfg.detection_rating ?? 0;
      const stealthRate = moverCfg.stealth_rating ?? 0;

      const detected = detectionCheck(detRating, stealthRate, dist);
      if (!detected) continue;

      // -----------------------------------------------------------------------
      // 4. Combat: both sides fire simultaneously.
      //    Patrol fires `patrol.quantity` dice at mover.
      //    Mover fires `moverUnit.quantity` dice at patrol.
      //    Units with to_hit == null cannot fire.
      // -----------------------------------------------------------------------
      patrolIntercepts++;
      patrol.hasIntercepted = true;
      patrol.interceptedHexQ = move.finalQ;
      patrol.interceptedHexR = move.finalR;

      let patrolCas = 0;
      let moverCas  = 0;
      const rollLog = [];

      // Patrol fires at mover.
      if (patrol.cfg.to_hit != null) {
        for (let i = 0; i < patrol.quantity; i++) {
          const attackRoll = roll2d6();
          if (attackRoll <= patrol.cfg.to_hit) {
            const saveTarget = Math.max(0, (moverCfg.defense ?? 6) - (patrol.cfg.penetration ?? 0));
            const saveRoll = roll2d6();
            if (saveRoll > saveTarget) {
              moverCas++;
              rollLog.push(`Patrol die ${i + 1}: attack ${attackRoll}/${patrol.cfg.to_hit} HIT, save ${saveRoll}/${saveTarget} CASUALTY`);
            } else {
              rollLog.push(`Patrol die ${i + 1}: attack ${attackRoll}/${patrol.cfg.to_hit} HIT, save ${saveRoll}/${saveTarget} SAVED`);
            }
          } else {
            rollLog.push(`Patrol die ${i + 1}: attack ${attackRoll}/${patrol.cfg.to_hit} MISS`);
          }
        }
      } else {
        rollLog.push(`Patrol unit (${patrol.cfg.name}): no to_hit — cannot fire.`);
      }

      // Mover fires at patrol simultaneously.
      if (moverCfg.to_hit != null) {
        for (let i = 0; i < moverUnit.quantity; i++) {
          const attackRoll = roll2d6();
          if (attackRoll <= moverCfg.to_hit) {
            const saveTarget = Math.max(0, (patrol.cfg.defense ?? 6) - (moverCfg.penetration ?? 0));
            const saveRoll = roll2d6();
            if (saveRoll > saveTarget) {
              patrolCas++;
              rollLog.push(`Mover die ${i + 1}: attack ${attackRoll}/${moverCfg.to_hit} HIT, save ${saveRoll}/${saveTarget} CASUALTY`);
            } else {
              rollLog.push(`Mover die ${i + 1}: attack ${attackRoll}/${moverCfg.to_hit} HIT, save ${saveRoll}/${saveTarget} SAVED`);
            }
          } else {
            rollLog.push(`Mover die ${i + 1}: attack ${attackRoll}/${moverCfg.to_hit} MISS`);
          }
        }
      } else {
        rollLog.push(`Mover unit (${moverCfg.name}): no to_hit — cannot fire.`);
      }

      // Apply casualties to local state.
      patrol.quantity  = Math.max(0, patrol.quantity  - patrolCas);
      moverUnit.quantity = Math.max(0, moverUnit.quantity - moverCas);

      // -----------------------------------------------------------------------
      // 5. Determine outcome.
      //    - Patrol wins  (mover qty → 0): cancel move, mover deleted from DB.
      //    - Patrol loses (patrol qty → 0): keep move, patrol deleted.
      //    - Both survive / tie: cancel move, patrol holds the hex.
      // -----------------------------------------------------------------------
      const patrolWon  = moverUnit.quantity <= 0;
      const patrolLost = patrol.quantity <= 0;

      let outcome;
      if (patrolWon) {
        outcome = 'patrol_wins';
        cancelledMoves.add(move.unitId);
        patrol.destroyed = patrolLost; // could theoretically be mutual
      } else if (patrolLost) {
        outcome = 'patrol_loses';
        patrol.destroyed = true;
        // Move continues — do NOT add to cancelledMoves.
      } else {
        // Both survive.
        outcome = 'tie';
        cancelledMoves.add(move.unitId);
      }

      combatLogRows.push({
        game_id: gameId,
        turn,
        phase: 3,
        hex_q: move.finalQ,
        hex_r: move.finalR,
        log_type: 'ground_patrol_intercept',
        faction_id: patrol.faction_id,
        data: {
          patrol_unit_id:   patrol.id,
          patrol_faction:   patrol.faction_id,
          patrol_type:      patrol.cfg.name,
          mover_unit_id:    move.unitId,
          mover_faction:    moverUnit.faction_id,
          mover_type:       moverCfg.name,
          detected:         true,
          distance:         dist,
          patrol_cas:       patrolCas,
          mover_cas:        moverCas,
          patrol_qty_after: patrol.quantity,
          mover_qty_after:  moverUnit.quantity,
          outcome,
          roll_log:         rollLog,
        },
      });

      // Once this move is cancelled we can stop checking more patrols for it.
      if (cancelledMoves.has(move.unitId)) break;
    }
  }

  // -----------------------------------------------------------------------
  // 6. Collect DB updates for all patrols that actually intercepted.
  // -----------------------------------------------------------------------
  for (const [, patrol] of patrolState) {
    if (!patrol.hasIntercepted) continue;

    patrolUpdates.push({
      id:         patrol.id,
      hex_q:      patrol.interceptedHexQ,
      hex_r:      patrol.interceptedHexR,
      quantity:   patrol.quantity,
      destroyed:  patrol.destroyed,
    });
  }

  return { cancelledMoves, patrolUpdates, combatLogRows, patrolIntercepts, errors };
}

// ---------------------------------------------------------------------------
// executeGroundMoves
//
// Executes all ground movement orders for a given game and turn in Phase 3.
// Steps:
//   1. Load all 'move' orders for the game + turn, joined with unit + unit_type_config.
//   2. Build each unit's path from ordered sequences (sequence 0 = start hex, then waypoints).
//   3. Load all hexes with their terrain config.
//   4. Validate each path; skip invalid ones (logged to errors).
//   4b. Ground patrol intercept pass (detection + combat; cancels intercepted moves).
//   5. Update unit positions to the final hex of their valid (non-cancelled) path.
//   7. Merge stacks that share (faction_id, unit_type_id, hex_q, hex_r).
//
// Returns { moved: number, skipped: number, errors: string[], movedUnitIds: Set, patrolIntercepts: number }
// ---------------------------------------------------------------------------
export async function executeGroundMoves(db, gameId, turn) {
  const errors = [];
  let moved = 0;
  let skipped = 0;
  const movedUnitIds = new Set();

  // ------------------------------------------------------------------
  // 1. Load movement orders joined with unit and unit_type_config.
  //    We need the unit's current position (hex_q, hex_r) as path origin
  //    plus all ordered waypoints from movement_orders.
  // ------------------------------------------------------------------
  const { data: orders, error: ordersError } = await db
    .from('movement_orders')
    .select(`
      id,
      unit_id,
      sequence,
      to_hex_q,
      to_hex_r,
      units!inner (
        id,
        hex_q,
        hex_r,
        faction_id,
        unit_type_id,
        quantity,
        unit_type_config!inner (
          id,
          name,
          tags,
          move,
          to_hit,
          defense,
          penetration,
          stealth_rating,
          detection_rating
        )
      )
    `)
    .eq('game_id', gameId)
    .eq('turn', turn)
    .eq('order_type', 'move')
    .not('to_hex_q', 'is', null)
    .order('sequence', { ascending: true });

  if (ordersError) {
    return { moved: 0, skipped: 0, errors: [`Failed to load orders: ${ordersError.message}`], movedUnitIds: new Set() };
  }

  if (!orders || orders.length === 0) {
    return { moved: 0, skipped: 0, errors: [], movedUnitIds: new Set() };
  }

  // ------------------------------------------------------------------
  // 2. Group orders by unit_id and sort by sequence.
  //    Build path as: [unit start hex, ...waypoints in sequence order]
  // ------------------------------------------------------------------
  const unitOrdersMap = new Map();

  for (const order of orders) {
    const unit = order.units;
    if (!unit) continue;

    if (!unitOrdersMap.has(order.unit_id)) {
      unitOrdersMap.set(order.unit_id, {
        unit,
        unitType: unit.unit_type_config,
        waypoints: [],
      });
    }

    const entry = unitOrdersMap.get(order.unit_id);
    entry.waypoints.push({
      sequence: order.sequence,
      q: order.to_hex_q,
      r: order.to_hex_r,
    });
  }

  // Sort each unit's waypoints by sequence and build full path.
  const unitPaths = [];
  // unitPathMap: Map<unitId, { unit, unitType }> — for patrol intercept lookups.
  const unitPathMap = new Map();
  for (const [unitId, entry] of unitOrdersMap) {
    entry.waypoints.sort((a, b) => a.sequence - b.sequence);
    // Waypoints already include the start hex at sequence 0 (sent by the client).
    // Do NOT prepend unit.hex_q/r again — that would double the start hex.
    const path = entry.waypoints.map((w) => ({ q: w.q, r: w.r }));
    unitPaths.push({ unitId, unit: entry.unit, unitType: entry.unitType, path });
    unitPathMap.set(unitId, { unit: entry.unit, unitType: entry.unitType });
  }

  // ------------------------------------------------------------------
  // 3. Load all hexes for the game with their terrain_type_config.
  //    We join terrain_type_config inline. The hexes table stores terrain
  //    as a name string that references terrain_type_config.name.
  // ------------------------------------------------------------------
  let hexRows;
  try {
    hexRows = await fetchAll(() => db.from('hexes')
      .select(`
        hex_q,
        hex_r,
        terrain,
        has_heavy_vegetation,
        terrain_type_config!inner (
          name,
          foot_cost,
          mech_cost
        )
      `)
      .eq('game_id', gameId));
  } catch (e) {
    return { moved: 0, skipped: 0, errors: [`Failed to load hexes: ${e.message}`], movedUnitIds: new Set() };
  }

  // Build lookup map.
  const hexesByKey = new Map();
  for (const hex of hexRows) {
    hexesByKey.set(`${hex.hex_q},${hex.hex_r}`, hex);
  }

  // ------------------------------------------------------------------
  // 4. Validate paths and collect valid moves.
  // ------------------------------------------------------------------
  const validMoves = []; // { unitId, finalQ, finalR, unit }

  for (const { unitId, unit, unitType, path } of unitPaths) {
    const result = validatePath(unitType, path, hexesByKey);
    if (!result.valid) {
      errors.push(`Unit ${unitId} (${unitType.name}): ${result.reason}`);
      skipped++;
      continue;
    }

    const finalHex = path[path.length - 1];
    validMoves.push({
      unitId,
      finalQ: finalHex.q,
      finalR: finalHex.r,
      unit,
    });
  }

  // ------------------------------------------------------------------
  // 4b. Ground patrol intercept pass.
  //     Run before any moves are applied. Cancelled moves are excluded
  //     from the position-update step below.
  // ------------------------------------------------------------------
  let patrolIntercepts = 0;
  {
    const interceptResult = await runPatrolIntercepts(
      db, gameId, turn, validMoves, unitPathMap
    );

    patrolIntercepts = interceptResult.patrolIntercepts;
    errors.push(...interceptResult.errors);

    // Apply patrol DB writes: move patrol to intercepted hex, update qty, delete if destroyed.
    for (const pu of interceptResult.patrolUpdates) {
      if (pu.destroyed) {
        const { error } = await db.from('units').delete().eq('id', pu.id);
        if (error) errors.push(`Patrol intercept: failed to delete destroyed patrol ${pu.id} — ${error.message}`);
      } else {
        const { error } = await db
          .from('units')
          .update({ hex_q: pu.hex_q, hex_r: pu.hex_r, quantity: pu.quantity })
          .eq('id', pu.id);
        if (error) errors.push(`Patrol intercept: failed to update patrol ${pu.id} — ${error.message}`);
      }
    }

    // Delete mover units that were eliminated (patrol_wins outcome).
    for (const move of validMoves) {
      if (!interceptResult.cancelledMoves.has(move.unitId)) continue;
      // Only delete if the mover's quantity was driven to 0 — check working copy.
      const moverEntry = unitPathMap.get(move.unitId);
      if (moverEntry && moverEntry.unit.quantity <= 0) {
        const { error } = await db.from('units').delete().eq('id', move.unitId);
        if (error) errors.push(`Patrol intercept: failed to delete eliminated mover ${move.unitId} — ${error.message}`);
      }
    }

    // Insert combat log rows for all intercepts.
    if (interceptResult.combatLogRows.length > 0) {
      const { error: logErr } = await db.from('combat_log').insert(interceptResult.combatLogRows);
      if (logErr) errors.push(`Patrol intercept: failed to insert combat log — ${logErr.message}`);
    }

    // Remove cancelled moves so they are NOT processed in step 5.
    const cancelledMoves = interceptResult.cancelledMoves;
    for (let i = validMoves.length - 1; i >= 0; i--) {
      if (cancelledMoves.has(validMoves[i].unitId)) {
        validMoves.splice(i, 1);
        skipped++;
      }
    }
  }

  // ------------------------------------------------------------------
  // 5. Apply position updates for non-cancelled moves.
  // ------------------------------------------------------------------
  for (const { unitId, finalQ, finalR } of validMoves) {
    const moverEntry = unitPathMap.get(unitId);
    const updatePayload = { hex_q: finalQ, hex_r: finalR };
    // Persist quantity changes from patrol intercept combat (casualties reduce in-memory copy).
    if (moverEntry?.unit?.quantity != null) updatePayload.quantity = moverEntry.unit.quantity;
    const { error: updateError } = await db
      .from('units')
      .update(updatePayload)
      .eq('id', unitId);

    if (updateError) {
      errors.push(`Unit ${unitId}: failed to update position — ${updateError.message}`);
      skipped++;
    } else {
      moved++;
      movedUnitIds.add(unitId);
    }
  }

  // ------------------------------------------------------------------
  // 7. Merge stacks: for each (faction_id, unit_type_id, hex_q, hex_r)
  //    that now has multiple rows, sum quantities and keep one row.
  //
  //    Strategy: load all units for the game, find duplicates, merge.
  // ------------------------------------------------------------------
  const { data: allUnits, error: allUnitsError } = await db
    .from('units')
    .select('id, faction_id, unit_type_id, hex_q, hex_r, quantity, hp')
    .eq('game_id', gameId);

  if (allUnitsError) {
    errors.push(`Stack merge: failed to load units — ${allUnitsError.message}`);
    return { moved, skipped, errors, movedUnitIds };
  }

  // Group by the merge key.
  const stackGroups = new Map();
  for (const unit of allUnits ?? []) {
    // Only merge quantity-based units (hp == null). Naval/bomber units use HP stacks
    // and should not be merged here (they belong in the naval phase anyway).
    if (unit.hp != null) continue;

    const key = `${unit.faction_id}|${unit.unit_type_id}|${unit.hex_q}|${unit.hex_r}`;
    if (!stackGroups.has(key)) {
      stackGroups.set(key, []);
    }
    stackGroups.get(key).push(unit);
  }

  // Merge groups that have more than one row.
  for (const [, group] of stackGroups) {
    if (group.length <= 1) continue;

    // Sort so the survivor (the one we'll keep) is first — pick the one with
    // the highest quantity so we minimise the quantity update delta.
    group.sort((a, b) => b.quantity - a.quantity);
    const [survivor, ...duplicates] = group;

    const totalQty = group.reduce((sum, u) => sum + u.quantity, 0);

    // Update the survivor's quantity.
    const { error: mergeUpdateError } = await db
      .from('units')
      .update({ quantity: totalQty })
      .eq('id', survivor.id);

    if (mergeUpdateError) {
      errors.push(`Stack merge: failed to update survivor ${survivor.id} — ${mergeUpdateError.message}`);
      continue;
    }

    // Delete the duplicates.
    const duplicateIds = duplicates.map((u) => u.id);
    const { error: mergeDeleteError } = await db
      .from('units')
      .delete()
      .in('id', duplicateIds);

    if (mergeDeleteError) {
      errors.push(`Stack merge: failed to delete duplicates — ${mergeDeleteError.message}`);
    }
  }

  return { moved, skipped, errors, movedUnitIds, patrolIntercepts };
}
