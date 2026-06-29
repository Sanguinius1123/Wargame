// =============================================================
// ordersPhase.js — End-of-phase order processing
//
// processEndOfPhase3: Applies fortification changes after all
// ground movement has resolved in Phase 3.
//
// Rules:
//   - Any unit that moved this turn loses its fortification bonus.
//   - Any unit with a 'fortify' order that did NOT move and is NOT
//     in a contested hex (enemy faction present) gains fortification_level 1.
//   - Contested = any enemy faction unit shares the same hex.
// =============================================================

/**
 * processEndOfPhase3
 *
 * @param {object} db         - Supabase admin client
 * @param {string} gameId     - UUID of the game
 * @param {number} turn       - Current turn number
 * @param {Set<string>} movedUnitIds - Set of unit UUIDs that successfully moved this turn
 * @returns {{ fortified: number, cleared: number }}
 */
export async function processEndOfPhase3(db, gameId, turn, movedUnitIds = new Set()) {
  let fortified = 0;
  let cleared = 0;

  // ------------------------------------------------------------------
  // Step 1: Clear fortification for every unit that moved this turn.
  // ------------------------------------------------------------------
  for (const unitId of movedUnitIds) {
    const { error } = await db
      .from('units')
      .update({ fortification_level: 0 })
      .eq('id', unitId);

    if (!error) {
      cleared++;
    }
  }

  // ------------------------------------------------------------------
  // Step 2: Load all fortify orders for this game and turn.
  // ------------------------------------------------------------------
  const { data: fortifyOrders, error: ordersError } = await db
    .from('movement_orders')
    .select('unit_id')
    .eq('game_id', gameId)
    .eq('turn', turn)
    .eq('order_type', 'fortify');

  if (ordersError || !fortifyOrders || fortifyOrders.length === 0) {
    return { fortified, cleared };
  }

  // ------------------------------------------------------------------
  // Step 3: Load all units for the game to build a hex → factions map.
  //         This lets us detect contested hexes.
  // ------------------------------------------------------------------
  const { data: allUnits, error: unitsError } = await db
    .from('units')
    .select('id, faction_id, hex_q, hex_r')
    .eq('game_id', gameId);

  if (unitsError || !allUnits) {
    return { fortified, cleared };
  }

  // Build a map: "hex_q,hex_r" → Set of faction_ids present
  const hexFactions = new Map();
  for (const unit of allUnits) {
    const k = `${unit.hex_q},${unit.hex_r}`;
    if (!hexFactions.has(k)) hexFactions.set(k, new Set());
    hexFactions.get(k).add(unit.faction_id);
  }

  // Also build a map: unit_id → unit (for quick lookup of hex and faction)
  const unitById = new Map();
  for (const unit of allUnits) {
    unitById.set(unit.id, unit);
  }

  // ------------------------------------------------------------------
  // Step 4: Process each fortify order.
  // ------------------------------------------------------------------
  for (const order of fortifyOrders) {
    const { unit_id } = order;

    // Skip if the unit moved this turn (already cleared in step 1)
    if (movedUnitIds.has(unit_id)) continue;

    const unit = unitById.get(unit_id);
    if (!unit) continue;

    const hexKey = `${unit.hex_q},${unit.hex_r}`;
    const factionsInHex = hexFactions.get(hexKey) ?? new Set();

    // Contested = more than one faction present in the hex
    const isContested = factionsInHex.size > 1;
    if (isContested) continue;

    // Grant fortification bonus
    const { error: updateError } = await db
      .from('units')
      .update({ fortification_level: 1 })
      .eq('id', unit_id);

    if (!updateError) {
      fortified++;
    }
  }

  return { fortified, cleared };
}
