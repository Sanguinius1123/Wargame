// =============================================================
// captureObjectives.js — Auto-capture objective hexes after Phase 3
//
// Rules (from DESIGN.md):
//   - owner_faction_id only tracked for hexes with settlements, urban tiles,
//     resource tiles, or buildings.
//   - If exactly one faction has units in an objective hex → that faction captures it.
//   - Contested hexes (multiple factions) → ownership unchanged.
//   - Empty hexes → ownership unchanged (last occupier retains it).
//
// On capture:
//   - Hex owner_faction_id updated.
//   - Buildings in the hex transfer to the new owner.
//   - Lost factory → production queue for previous owner cleared (no refund).
//   - Resource tiles in the hex transfer to the new owner.
// =============================================================

export async function captureObjectives(db, gameId) {
  const captures = [];
  const errors = [];

  // Load all units, group by hex
  const { data: allUnits, error: unitsErr } = await db
    .from('units')
    .select('id, faction_id, hex_q, hex_r')
    .eq('game_id', gameId);
  if (unitsErr) return { captures, errors: [unitsErr.message] };

  const unitsByHex = new Map();
  for (const u of allUnits ?? []) {
    const k = `${u.hex_q},${u.hex_r}`;
    if (!unitsByHex.has(k)) unitsByHex.set(k, new Set());
    unitsByHex.get(k).add(u.faction_id);
  }

  // Load all objective hexes: has_settlement, or has any building/resource tile
  const { data: objectiveHexes, error: hexErr } = await db
    .from('hexes')
    .select('hex_q, hex_r, owner_faction_id, has_settlement')
    .eq('game_id', gameId)
    .or('has_settlement.eq.true,owner_faction_id.not.is.null');
  if (hexErr) return { captures, errors: [hexErr.message] };

  // Also load buildings and resource tiles to get ALL objective hexes even if
  // the hex flags don't indicate it yet
  const { data: buildings } = await db
    .from('buildings')
    .select('hex_q, hex_r, type, owner_faction_id')
    .eq('game_id', gameId);
  const { data: resourceTiles } = await db
    .from('resource_tiles')
    .select('hex_q, hex_r, owner_faction_id')
    .eq('game_id', gameId);

  // Collect all objective hex keys
  const objectiveKeys = new Set();
  for (const h of objectiveHexes ?? []) objectiveKeys.add(`${h.hex_q},${h.hex_r}`);
  for (const b of buildings ?? []) objectiveKeys.add(`${b.hex_q},${b.hex_r}`);
  for (const r of resourceTiles ?? []) objectiveKeys.add(`${r.hex_q},${r.hex_r}`);

  // Build lookup for current hex ownership
  const hexOwner = new Map();
  for (const h of objectiveHexes ?? []) {
    hexOwner.set(`${h.hex_q},${h.hex_r}`, h.owner_faction_id);
  }

  // Process each objective hex
  for (const hexKey of objectiveKeys) {
    const factionsPresent = unitsByHex.get(hexKey);
    if (!factionsPresent || factionsPresent.size !== 1) continue; // contested or empty

    const capturingFaction = [...factionsPresent][0];
    const currentOwner = hexOwner.get(hexKey);
    if (capturingFaction === currentOwner) continue; // already owned by this faction

    const [q, r] = hexKey.split(',').map(Number);
    const previousOwner = currentOwner;

    // Update hex owner
    const { error: hexUpdateErr } = await db
      .from('hexes')
      .update({ owner_faction_id: capturingFaction })
      .eq('game_id', gameId)
      .eq('hex_q', q)
      .eq('hex_r', r);
    if (hexUpdateErr) { errors.push(`Hex (${q},${r}) owner update: ${hexUpdateErr.message}`); continue; }

    // Transfer buildings in this hex
    const hexBuildings = (buildings ?? []).filter(b => b.hex_q === q && b.hex_r === r);
    for (const bldg of hexBuildings) {
      if (bldg.type === 'fortification') continue; // not ownable — personal to defender
      await db.from('buildings').update({ owner_faction_id: capturingFaction })
        .eq('game_id', gameId).eq('hex_q', q).eq('hex_r', r).eq('type', bldg.type);

      // Lost factory → clear the previous owner's production queue for this hex
      if (bldg.type === 'factory' && previousOwner) {
        await db.from('production_queue').delete()
          .eq('game_id', gameId)
          .eq('faction_id', previousOwner)
          .eq('factory_hex_q', q)
          .eq('factory_hex_r', r);
      }
    }

    // Transfer resource tiles in this hex
    const hexResource = (resourceTiles ?? []).find(rt => rt.hex_q === q && rt.hex_r === r);
    if (hexResource) {
      await db.from('resource_tiles').update({ owner_faction_id: capturingFaction })
        .eq('game_id', gameId).eq('hex_q', q).eq('hex_r', r);
    }

    captures.push({ hex_q: q, hex_r: r, from: previousOwner, to: capturingFaction });
  }

  return { captures, errors };
}
