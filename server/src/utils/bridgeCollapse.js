// bridgeCollapse.js
// Called when a bridge building is destroyed (HP → 0).
// 1. Removes has_road + has_bridge from the water hex.
// 2. For each ground unit stack on the hex, rolls 75% survival per unit.
// 3. Survivors escape:
//      - If they have movement orders containing the bridge hex:
//          • Bridge is intermediate → move to the next waypoint (far side)
//          • Bridge is the final waypoint → retreat to the previous waypoint
//      - Otherwise: pick a random adjacent land hex, preferring hexes
//        not occupied by enemy units. If all adjacent land hexes have enemies,
//        pick any.

import { offsetNeighbors } from './hexGeometry.js';

export async function handleBridgeCollapse(db, gameId, hexQ, hexR, turn, hexDataByKey) {
  const errors = [];
  const logEntries = [];

  // Remove road + bridge from the hex
  const { error: hexErr } = await db
    .from('hexes')
    .update({ has_road: false, has_bridge: false })
    .eq('game_id', gameId)
    .eq('hex_q', hexQ)
    .eq('hex_r', hexR);
  if (hexErr) errors.push(`Bridge collapse hex update: ${hexErr.message}`);

  // Find ground units on the hex (exclude air + naval by tag)
  const { data: units, error: unitErr } = await db
    .from('units')
    .select('id, faction_id, quantity, unit_type_config(name, tags)')
    .eq('game_id', gameId)
    .eq('hex_q', hexQ)
    .eq('hex_r', hexR);
  if (unitErr) {
    errors.push(`Bridge collapse unit query: ${unitErr.message}`);
    return { logEntries, errors };
  }

  const groundUnits = (units ?? []).filter(u => {
    const tags = u.unit_type_config?.tags ?? [];
    return !tags.includes('air') && !tags.includes('naval');
  });

  if (groundUnits.length === 0) return { logEntries, errors };

  // Load this turn's movement orders for the affected units
  const unitIds = groundUnits.map(u => u.id);
  const { data: orders } = await db
    .from('movement_orders')
    .select('unit_id, sequence, to_hex_q, to_hex_r')
    .eq('game_id', gameId)
    .eq('turn', turn)
    .in('unit_id', unitIds)
    .order('sequence', { ascending: true });

  const ordersByUnit = new Map();
  for (const o of orders ?? []) {
    if (!ordersByUnit.has(o.unit_id)) ordersByUnit.set(o.unit_id, []);
    ordersByUnit.get(o.unit_id).push(o);
  }

  // Find adjacent land hexes for fallback escape
  const neighbors = offsetNeighbors(hexQ, hexR);
  const landNeighbors = neighbors.filter(n => {
    const h = hexDataByKey.get(`${n.q},${n.r}`);
    return h && h.terrain !== 'water';
  });

  // Query units on adjacent land hexes to know who's there and how many
  const { data: neighborUnits } = await db
    .from('units')
    .select('hex_q, hex_r, faction_id, quantity')
    .eq('game_id', gameId);

  const neighborSet = new Set(landNeighbors.map(n => `${n.q},${n.r}`));

  // hexKey → { friendlyQty, enemyQty } (computed per unit below)
  const hexPresence = new Map(); // hexKey → { factions: Set, enemyQty: number }
  for (const u of neighborUnits ?? []) {
    const k = `${u.hex_q},${u.hex_r}`;
    if (!neighborSet.has(k)) continue;
    if (!hexPresence.has(k)) hexPresence.set(k, { factions: new Set(), enemyQty: 0 });
    hexPresence.get(k).factions.add(u.faction_id);
    hexPresence.get(k).rawUnits = hexPresence.get(k).rawUnits ?? [];
    hexPresence.get(k).rawUnits.push(u);
  }

  for (const unit of groundUnits) {
    const unitOrders = ordersByUnit.get(unit.id) ?? [];

    // Find the bridge hex in the unit's movement path
    const bridgeIdx = unitOrders.findIndex(
      o => o.to_hex_q === hexQ && o.to_hex_r === hexR
    );

    let destQ = null;
    let destR = null;

    if (bridgeIdx !== -1 && bridgeIdx < unitOrders.length - 1) {
      // Bridge was intermediate — sprint to the far land hex
      const next = unitOrders[bridgeIdx + 1];
      destQ = next.to_hex_q;
      destR = next.to_hex_r;
    } else if (bridgeIdx > 0) {
      // Bridge was final destination — retreat to previous waypoint
      const prev = unitOrders[bridgeIdx - 1];
      destQ = prev.to_hex_q;
      destR = prev.to_hex_r;
    } else {
      // No usable orders — pick adjacent land hex.
      // Prefer hexes with no enemies; if all have enemies, pick the one
      // with the fewest total enemy units (survivors enter close combat there).
      const withEnemyCount = landNeighbors.map(n => {
        const k = `${n.q},${n.r}`;
        const presence = hexPresence.get(k);
        const enemyQty = (presence?.rawUnits ?? [])
          .filter(u => u.faction_id !== unit.faction_id)
          .reduce((sum, u) => sum + (u.quantity ?? 1), 0);
        return { n, enemyQty };
      });

      const clear = withEnemyCount.filter(x => x.enemyQty === 0);
      const pool = clear.length > 0 ? clear : withEnemyCount;
      // Among equal-enemy-count hexes, pick randomly
      const minEnemy = Math.min(...pool.map(x => x.enemyQty));
      const best = pool.filter(x => x.enemyQty === minEnemy);
      const pick = best[Math.floor(Math.random() * best.length)];
      destQ = pick.n.q;
      destR = pick.n.r;
    }

    // Roll 75% survival per unit in the stack
    let survivors = 0;
    for (let i = 0; i < unit.quantity; i++) {
      if (Math.random() < 0.75) survivors++;
    }
    const casualties = unit.quantity - survivors;

    if (survivors === 0 || destQ === null) {
      const { error } = await db.from('units').delete().eq('id', unit.id);
      if (error) errors.push(`Bridge collapse delete unit ${unit.id}: ${error.message}`);
      survivors = 0;
    } else {
      const { error } = await db
        .from('units')
        .update({ hex_q: destQ, hex_r: destR, quantity: survivors })
        .eq('id', unit.id);
      if (error) errors.push(`Bridge collapse move unit ${unit.id}: ${error.message}`);
    }

    logEntries.push({
      unit_id: unit.id,
      faction_id: unit.faction_id,
      original_qty: unit.quantity,
      casualties,
      survivors,
      escaped_to: survivors > 0 && destQ !== null ? { q: destQ, r: destR } : null,
    });
  }

  return { logEntries, errors };
}
