// =============================================================
// movement.js — Path validation and ground movement execution
//
// Movement scale: unit_type_config.move is user-facing (e.g. Infantry=2).
// Internally we use ×3 scale so road costs (2/3 of terrain cost) resolve
// to clean integers. Budget = unitType.move * 3.
//
// Terrain costs (×3 scale, from terrain_type_config):
//   foot units  → foot_cost  / foot_road_cost
//   mechanized  → mech_cost  / mech_road_cost  ('mechanized' in tags)
//   water       → always impassable to ground units (foot_cost IS NULL)
//   mountains   → mech_cost IS NULL → impassable to mechanized without road
//   heavy veg   → has_heavy_vegetation = true → impassable to mechanized
//
// Single-step paths (1 waypoint after start) are always permitted even if
// the cost would exceed budget; this lets a unit always enter an adjacent hex.
// =============================================================

import { isAdjacent } from './hexGeometry.js';

// ---------------------------------------------------------------------------
// Cost to enter a single hex for a given unit type.
// Returns Infinity for impassable hexes, otherwise the ×3 integer cost.
// ---------------------------------------------------------------------------
function enterCost(unitType, hex) {
  const isMech = Array.isArray(unitType.tags) && unitType.tags.includes('mechanized');
  const cfg = hex.terrain_type_config;

  // Water is impassable to all ground units.
  if (cfg.foot_cost == null) return Infinity;

  if (isMech) {
    // Heavy vegetation is impassable to mechanized units.
    if (hex.has_heavy_vegetation) return Infinity;

    if (hex.has_road) {
      // Road cost available → use it. Mountains become passable on roads.
      if (cfg.mech_road_cost != null) return cfg.mech_road_cost;
      // Road exists but no road cost defined for this terrain (shouldn't happen
      // per schema, but fall through to bare mech cost).
    }

    // No road: mountains (mech_cost IS NULL) are impassable.
    if (cfg.mech_cost == null) return Infinity;
    return cfg.mech_cost;
  } else {
    // Foot unit.
    if (hex.has_road && cfg.foot_road_cost != null) return cfg.foot_road_cost;
    return cfg.foot_cost; // foot_cost is never NULL per design
  }
}

// ---------------------------------------------------------------------------
// validatePath
//
// unitType  : { move: number, tags: string[] }
// path      : [{q, r}, ...] array of waypoints INCLUDING the starting hex
//             (path[0] = origin, path[path.length-1] = destination)
// hexesByKey: Map<"q,r", hex> where hex has:
//               terrain_type_config: { foot_cost, mech_cost, foot_road_cost, mech_road_cost }
//               has_road: boolean
//               has_heavy_vegetation: boolean
//
// Returns { valid: boolean, reason?: string }
// ---------------------------------------------------------------------------
export function validatePath(unitType, path, hexesByKey) {
  if (!path || path.length < 2) {
    return { valid: false, reason: 'Path must have at least a start and one destination.' };
  }

  const budget = unitType.move * 3;
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
// executeGroundMoves
//
// Executes all ground movement orders for a given game and turn in Phase 3.
// Steps:
//   1. Load all 'move' orders for the game + turn, joined with unit + unit_type_config.
//   2. Build each unit's path from ordered sequences (sequence 0 = start hex, then waypoints).
//   3. Load all hexes with their terrain config.
//   4. Validate each path; skip invalid ones (logged to errors).
//   5. Update unit positions to the final hex of their valid path.
//   6. Merge stacks that share (faction_id, unit_type_id, hex_q, hex_r).
//
// Returns { moved: number, skipped: number, errors: string[] }
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
          move
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
  for (const [unitId, entry] of unitOrdersMap) {
    entry.waypoints.sort((a, b) => a.sequence - b.sequence);
    // Waypoints already include the start hex at sequence 0 (sent by the client).
    // Do NOT prepend unit.hex_q/r again — that would double the start hex.
    const path = entry.waypoints.map((w) => ({ q: w.q, r: w.r }));
    unitPaths.push({ unitId, unit: entry.unit, unitType: entry.unitType, path });
  }

  // ------------------------------------------------------------------
  // 3. Load all hexes for the game with their terrain_type_config.
  //    We join terrain_type_config inline. The hexes table stores terrain
  //    as a name string that references terrain_type_config.name.
  // ------------------------------------------------------------------
  const { data: hexRows, error: hexError } = await db
    .from('hexes')
    .select(`
      hex_q,
      hex_r,
      terrain,
      has_road,
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
    return { moved: 0, skipped: 0, errors: [`Failed to load hexes: ${hexError.message}`], movedUnitIds: new Set() };
  }

  // Build lookup map.
  const hexesByKey = new Map();
  for (const hex of hexRows ?? []) {
    hexesByKey.set(`${hex.hex_q},${hex.hex_r}`, hex);
  }

  // ------------------------------------------------------------------
  // 4 + 5. Validate paths and collect valid moves; apply them.
  // ------------------------------------------------------------------
  const validMoves = []; // { unitId, finalQ, finalR }

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

  // Apply position updates.
  for (const { unitId, finalQ, finalR } of validMoves) {
    const { error: updateError } = await db
      .from('units')
      .update({ hex_q: finalQ, hex_r: finalR })
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
  // 6. Merge stacks: for each (faction_id, unit_type_id, hex_q, hex_r)
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

  return { moved, skipped, errors, movedUnitIds };
}
