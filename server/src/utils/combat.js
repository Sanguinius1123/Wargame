// =============================================================
// combat.js — Phase 3 ground combat resolution
//
// Simultaneous fire: all dice from all factions in a contested hex
// are rolled at the same time. Casualties are collected and applied
// only after every contested hex has been resolved.
//
// Roll-under 2d6: a roll of 2d6 ≤ target number succeeds.
// Higher target = more accurate / better save.
//
// Attack flow (per contested hex):
//   1. Each unit with to_hit != null fires `quantity` dice.
//   2. Dice distributed among all enemy units proportionally by
//      quantity (largest-remainder rounding).
//   3. For each die vs a target: roll 2d6 ≤ to_hit → hit.
//   4. For each hit: roll 2d6 ≤ (defense + defense_bonus - pen) → saved,
//      else 1 casualty.
//
// Defense bonuses (additive):
//   fortification_level = 1 → +1
//   has_heavy_vegetation → +2
//   has_light_vegetation (and not heavy) → +1
//   Elevation bonus does NOT apply in close combat (same hex).
//
// Units with to_hit IS NULL (Artillery, Supply, Scout Plane, etc.)
//   do NOT fire but CAN receive fire.
//
// Artillery auto-destroy: after all casualties are applied, any unit
//   with to_hit IS NULL found alone in a hex with enemies is deleted.
// =============================================================

// ---------------------------------------------------------------------------
// roll2d6 — Roll two six-sided dice and return the sum (2–12).
// ---------------------------------------------------------------------------
function roll2d6() {
  return Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
}

// ---------------------------------------------------------------------------
// distributeDice
//
// Distribute `totalDice` integer dice among targets proportionally by weight
// using largest-remainder (Hamilton) rounding so the sum always equals totalDice.
//
// targets : [{ id, weight }]  where weight = unit.quantity (≥ 1)
// Returns : Map<id, number>   dice allocated to each target (0 if weight = 0)
// ---------------------------------------------------------------------------
export function distributeDice(totalDice, targets) {
  const result = new Map();
  if (!targets.length || totalDice <= 0) {
    for (const t of targets) result.set(t.id, 0);
    return result;
  }

  const totalWeight = targets.reduce((s, t) => s + t.weight, 0);
  if (totalWeight <= 0) {
    for (const t of targets) result.set(t.id, 0);
    return result;
  }

  // Exact fractional allocations and floor values.
  const exact = targets.map((t) => ({
    id: t.id,
    exact: (t.weight / totalWeight) * totalDice,
    floor: 0,
    remainder: 0,
  }));

  for (const e of exact) {
    e.floor = Math.floor(e.exact);
    e.remainder = e.exact - e.floor;
  }

  let distributed = exact.reduce((s, e) => s + e.floor, 0);
  const remaining = totalDice - distributed;

  // Assign leftover dice to entries with the largest remainders.
  exact.sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < remaining; i++) {
    exact[i].floor += 1;
  }

  for (const e of exact) {
    result.set(e.id, e.floor);
  }

  return result;
}

// ---------------------------------------------------------------------------
// defenseBonus
//
// Compute additive defense bonus for a unit defending in a given hex.
// In close combat (same hex) elevation does NOT apply.
// ---------------------------------------------------------------------------
export function defenseBonus(unit, hex, hasFortificationBuilding = false) {
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

// ---------------------------------------------------------------------------
// resolveHexCombat
//
// Resolve one round of simultaneous close combat in a contested hex.
//
// factionGroups : Map<faction_id, unit[]>
//   Each unit has: { id, faction_id, unit_type_id, quantity, hp,
//                    fortification_level }
//
// hex : { has_light_vegetation, has_heavy_vegetation }
//
// unitTypeById : Map<unit_type_id, { id, name, to_hit, defense, penetration, tags }>
//
// hexBuildings : Array<{ type, current_hp, owner_faction_id }> — buildings in this hex
//
// Returns: {
//   casualties : Map<unit_id, number>  — total casualties per unit (not yet applied)
//   log        : string[]              — human-readable roll-by-roll log
// }
// ---------------------------------------------------------------------------
function resolveHexCombat(factionGroups, hex, unitTypeById, hexBuildings = []) {
  const casualties = new Map(); // unit_id → casualty count
  const log = [];

  const factionIds = [...factionGroups.keys()];

  // For each attacking faction, fire at all enemy factions.
  for (const attackerFactionId of factionIds) {
    const attackers = factionGroups.get(attackerFactionId);

    // Gather all enemy units (all other factions in this hex).
    const enemies = [];
    for (const fId of factionIds) {
      if (fId !== attackerFactionId) {
        enemies.push(...factionGroups.get(fId));
      }
    }

    if (!enemies.length) continue;

    // Only units with to_hit can fire.
    const firingUnits = attackers.filter((u) => {
      const cfg = unitTypeById.get(u.unit_type_id);
      return cfg && cfg.to_hit != null;
    });

    if (!firingUnits.length) {
      log.push(`Faction ${attackerFactionId}: no units with to_hit — cannot fire.`);
      continue;
    }

    // Build the total dice pool across all firing units.
    // Each firing unit contributes `quantity` dice.
    const totalDice = firingUnits.reduce((s, u) => s + u.quantity, 0);

    // Build target list with weights = quantity.
    const targets = enemies.map((u) => ({ id: u.id, weight: u.quantity }));

    // Distribute the total dice pool among enemy units.
    const dicePerTarget = distributeDice(totalDice, targets);

    log.push(
      `Faction ${attackerFactionId} fires ${totalDice} dice against ${enemies.length} enemy unit(s).`
    );

    // We need the per-firing-unit to_hit in case individual units differ.
    // However, for proportional allocation the dice pool is aggregate.
    // We attribute dice to firing units in proportion to their quantity so
    // we can apply the correct to_hit per die.
    //
    // Simpler approach that is faithful to the rules: allocate dice to targets
    // and then for each die pick the to_hit of a random firing unit weighted
    // by its contribution to the pool. This matches "the group fires together".
    //
    // For each target unit, roll its allocated dice.
    for (const enemy of enemies) {
      const dicesToRoll = dicePerTarget.get(enemy.id) ?? 0;
      if (dicesToRoll === 0) continue;

      const enemyCfg = unitTypeById.get(enemy.unit_type_id);
      if (!enemyCfg) continue;

      const hasFortBuilding = hexBuildings.some(
        b => b.type === 'fortification' && b.current_hp > 0 && b.owner_faction_id === enemy.faction_id
      );
      const bonus = defenseBonus(enemy, hex, hasFortBuilding);
      let enemyCasualties = 0;

      for (let d = 0; d < dicesToRoll; d++) {
        // Each die is attributed to one firing unit so to_hit and penetration
        // are always from the same unit (no split-draw mismatches).
        const firer = pickFiringUnit(firingUnits, unitTypeById);
        const toHit = firer?.to_hit ?? 6;
        const pen   = firer?.penetration ?? 0;

        const attackRoll = roll2d6();
        const hit = attackRoll <= toHit;

        if (!hit) {
          log.push(
            `  → Die vs unit ${enemy.id}: attack roll ${attackRoll} vs to_hit ${toHit} — miss.`
          );
          continue;
        }

        // Hit! Roll save.
        const saveTarget = enemyCfg.defense + bonus - pen;
        const saveRoll = roll2d6();
        const saved = saveRoll <= Math.max(0, saveTarget);

        log.push(
          `  → Die vs unit ${enemy.id} (${enemyCfg.name}): attack ${attackRoll}/${toHit} HIT, save ${saveRoll}/${Math.max(saveTarget, 0)}${saved ? ' SAVED' : ' CASUALTY'}${bonus ? ` (defense bonus +${bonus})` : ''}.`
        );

        if (!saved) {
          enemyCasualties += 1;
        }
      }

      if (enemyCasualties > 0) {
        casualties.set(enemy.id, (casualties.get(enemy.id) ?? 0) + enemyCasualties);
        log.push(`  Unit ${enemy.id} (${enemyCfg.name}): ${enemyCasualties} casualty/ies queued.`);
      }
    }
  }

  return { casualties, log };
}

// ---------------------------------------------------------------------------
// pickFiringUnit
//
// Select one firing unit from the pool weighted by quantity.
// A single die is attributed to one unit so its to_hit AND penetration
// are used together — the two attributes must not come from different units.
// ---------------------------------------------------------------------------
function pickFiringUnit(firingUnits, unitTypeById) {
  const total = firingUnits.reduce((s, u) => s + u.quantity, 0);
  let roll = Math.random() * total;
  for (const u of firingUnits) {
    roll -= u.quantity;
    if (roll <= 0) return unitTypeById.get(u.unit_type_id) ?? null;
  }
  return unitTypeById.get(firingUnits[firingUnits.length - 1].unit_type_id) ?? null;
}

// ---------------------------------------------------------------------------
// executeGroundCombat
//
// Find all contested hexes in the game, resolve simultaneous combat, apply
// casualties, handle artillery auto-destroy, and log everything.
//
// db      : Supabase client
// gameId  : UUID string
// turn    : current turn number (integer)
//
// Returns: { hexesFought: number, totalCasualties: number, errors: string[] }
// ---------------------------------------------------------------------------
export async function executeGroundCombat(db, gameId, turn) {
  const errors = [];
  let hexesFought = 0;
  let totalCasualties = 0;

  // -----------------------------------------------------------------------
  // 1. Load all units for the game.
  // -----------------------------------------------------------------------
  const { data: allUnits, error: unitsError } = await db
    .from('units')
    .select('id, faction_id, unit_type_id, hex_q, hex_r, quantity, hp, fortification_level')
    .eq('game_id', gameId)
    .limit(10000);

  if (unitsError) {
    return {
      hexesFought: 0,
      totalCasualties: 0,
      errors: [`Failed to load units: ${unitsError.message}`],
    };
  }

  if (!allUnits || allUnits.length === 0) {
    return { hexesFought: 0, totalCasualties: 0, errors: [] };
  }

  // -----------------------------------------------------------------------
  // 2. Group units by hex. Find hexes with 2+ different factions.
  // -----------------------------------------------------------------------
  // hexKey → Map<faction_id, unit[]>
  const hexMap = new Map();

  for (const unit of allUnits) {
    const key = `${unit.hex_q},${unit.hex_r}`;
    if (!hexMap.has(key)) hexMap.set(key, new Map());
    const factions = hexMap.get(key);
    if (!factions.has(unit.faction_id)) factions.set(unit.faction_id, []);
    factions.get(unit.faction_id).push(unit);
  }

  // Filter to contested hexes only.
  const contestedHexes = [];
  for (const [key, factions] of hexMap) {
    if (factions.size >= 2) {
      const [q, r] = key.split(',').map(Number);
      contestedHexes.push({ key, q, r, factions });
    }
  }

  if (contestedHexes.length === 0) {
    return { hexesFought: 0, totalCasualties: 0, errors: [] };
  }

  // -----------------------------------------------------------------------
  // 3. Load unit_type_config for all unit types present in the game.
  // -----------------------------------------------------------------------
  const unitTypeIds = [...new Set(allUnits.map((u) => u.unit_type_id))];

  const { data: unitTypeRows, error: utcError } = await db
    .from('unit_type_config')
    .select('id, name, to_hit, defense, penetration, tags')
    .eq('game_id', gameId)
    .in('id', unitTypeIds);

  if (utcError) {
    return {
      hexesFought: 0,
      totalCasualties: 0,
      errors: [`Failed to load unit_type_config: ${utcError.message}`],
    };
  }

  const unitTypeById = new Map();
  for (const cfg of unitTypeRows ?? []) {
    unitTypeById.set(cfg.id, cfg);
  }

  // -----------------------------------------------------------------------
  // 4. Load hex data for vegetation info; load fortification buildings.
  // -----------------------------------------------------------------------
  const [{ data: hexRows, error: hexError }, { data: fortBuildingRows }] = await Promise.all([
    db.from('hexes')
      .select('hex_q, hex_r, has_light_vegetation, has_heavy_vegetation')
      .eq('game_id', gameId)
      .limit(10000),
    db.from('buildings')
      .select('hex_q, hex_r, type, current_hp, owner_faction_id')
      .eq('game_id', gameId)
      .limit(10000)
      .eq('type', 'fortification'),
  ]);

  if (hexError) {
    return {
      hexesFought: 0,
      totalCasualties: 0,
      errors: [`Failed to load hexes: ${hexError.message}`],
    };
  }

  const hexDataByKey = new Map();
  for (const h of hexRows ?? []) {
    hexDataByKey.set(`${h.hex_q},${h.hex_r}`, h);
  }

  const fortBuildingsByHex = new Map();
  for (const b of fortBuildingRows ?? []) {
    const k = `${b.hex_q},${b.hex_r}`;
    if (!fortBuildingsByHex.has(k)) fortBuildingsByHex.set(k, []);
    fortBuildingsByHex.get(k).push(b);
  }

  // -----------------------------------------------------------------------
  // 5. Resolve combat for each contested hex.
  //    Accumulate ALL casualties before applying any of them.
  // -----------------------------------------------------------------------
  // unit_id → total casualties across all hex battles
  const globalCasualties = new Map();
  const combatLogInserts = [];

  for (const { key, q, r, factions } of contestedHexes) {
    const hex = hexDataByKey.get(key) ?? {
      has_light_vegetation: false,
      has_heavy_vegetation: false,
    };
    const hexBuildings = fortBuildingsByHex.get(key) ?? [];

    let hexResult;
    try {
      hexResult = resolveHexCombat(factions, hex, unitTypeById, hexBuildings);
    } catch (err) {
      errors.push(`Hex (${q},${r}): combat resolution error — ${err.message}`);
      continue;
    }

    // Accumulate casualties.
    for (const [unitId, count] of hexResult.casualties) {
      globalCasualties.set(unitId, (globalCasualties.get(unitId) ?? 0) + count);
    }

    hexesFought++;

    // Build log payload.
    const factionsInvolved = [...factions.keys()];
    const casualtiesObj = {};
    for (const [unitId, count] of hexResult.casualties) {
      casualtiesObj[unitId] = count;
    }

    combatLogInserts.push({
      game_id: gameId,
      turn,
      phase: 3,
      hex_q: q,
      hex_r: r,
      log_type: 'combat',
      faction_id: null,
      data: {
        factions: factionsInvolved,
        casualties: casualtiesObj,
        log: hexResult.log,
      },
    });
  }

  // -----------------------------------------------------------------------
  // 6. Apply casualties in a single pass after all hexes are resolved.
  //    HP units: subtract 1 HP per casualty, delete if hp ≤ 0.
  //    Quantity units: subtract 1 quantity per casualty, delete if qty ≤ 0.
  // -----------------------------------------------------------------------
  const unitById = new Map(allUnits.map((u) => [u.id, u]));

  for (const [unitId, count] of globalCasualties) {
    const unit = unitById.get(unitId);
    if (!unit) continue;

    totalCasualties += count;

    if (unit.hp != null) {
      // HP-based unit (naval, bombers).
      const newHp = unit.hp - count;
      if (newHp <= 0) {
        const { error } = await db.from('units').delete().eq('id', unitId);
        if (error) errors.push(`Failed to delete unit ${unitId}: ${error.message}`);
      } else {
        const { error } = await db
          .from('units')
          .update({ hp: newHp })
          .eq('id', unitId);
        if (error) errors.push(`Failed to update hp for unit ${unitId}: ${error.message}`);
      }
    } else {
      // Quantity-based unit (ground, fighters).
      const newQty = unit.quantity - count;
      if (newQty <= 0) {
        const { error } = await db.from('units').delete().eq('id', unitId);
        if (error) errors.push(`Failed to delete unit ${unitId}: ${error.message}`);
      } else {
        const { error } = await db
          .from('units')
          .update({ quantity: newQty })
          .eq('id', unitId);
        if (error) errors.push(`Failed to update quantity for unit ${unitId}: ${error.message}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // 7. Artillery auto-destroy pass.
  //    After casualties: reload all remaining units, find any non-firing unit
  //    (to_hit IS NULL) that is in a hex with enemy units → delete it.
  // -----------------------------------------------------------------------
  const { data: survivingUnits, error: survivingError } = await db
    .from('units')
    .select('id, faction_id, unit_type_id, hex_q, hex_r')
    .eq('game_id', gameId);

  if (survivingError) {
    errors.push(`Artillery auto-destroy: failed to reload units — ${survivingError.message}`);
  } else {
    // Re-build hex → factions map from surviving units.
    const survivingHexMap = new Map();
    for (const unit of survivingUnits ?? []) {
      const key = `${unit.hex_q},${unit.hex_r}`;
      if (!survivingHexMap.has(key)) survivingHexMap.set(key, []);
      survivingHexMap.get(key).push(unit);
    }

    for (const [, hexUnits] of survivingHexMap) {
      // Check if hex is still contested after casualties.
      const factionsPresent = new Set(hexUnits.map((u) => u.faction_id));
      if (factionsPresent.size < 2) continue;

      // Find non-firing units (to_hit IS NULL).
      for (const unit of hexUnits) {
        const cfg = unitTypeById.get(unit.unit_type_id);
        if (!cfg || cfg.to_hit != null) continue; // skip firing units

        // This non-firing unit is alone with enemies — check if its faction
        // has any other unit in the hex.
        const sameFactionsUnit = hexUnits.find(
          (u) => u.id !== unit.id && u.faction_id === unit.faction_id
        );

        // "Alone vs enemies" means no friendly FIRING unit shares the hex.
        // The rule says auto-destroyed if alone vs enemies (to_hit = NULL, cannot fight back).
        // We interpret "alone" as: the only unit from its faction, or all surviving
        // friendly units also lack to_hit (no one can fight back regardless).
        const friendlyFiringUnit = hexUnits.find((u) => {
          if (u.faction_id !== unit.faction_id) return false;
          if (u.id === unit.id) return false;
          const uCfg = unitTypeById.get(u.unit_type_id);
          return uCfg && uCfg.to_hit != null;
        });

        if (!friendlyFiringUnit) {
          // No friendly unit with to_hit exists — this unit is auto-destroyed.
          const { error } = await db.from('units').delete().eq('id', unit.id);
          if (error) {
            errors.push(`Artillery auto-destroy: failed to delete unit ${unit.id} — ${error.message}`);
          } else {
            combatLogInserts.push({
              game_id: gameId,
              turn,
              phase: 3,
              hex_q: unit.hex_q,
              hex_r: unit.hex_r,
              log_type: 'combat',
              faction_id: unit.faction_id,
              data: {
                event: 'auto_destroy',
                unit_id: unit.id,
                unit_type_id: unit.unit_type_id,
                reason: 'Non-firing unit left alone against enemies (no friendly unit with to_hit).',
              },
            });
            totalCasualties += 1;
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // 8. Insert combat log rows.
  // -----------------------------------------------------------------------
  if (combatLogInserts.length > 0) {
    const { error: logError } = await db.from('combat_log').insert(combatLogInserts);
    if (logError) {
      errors.push(`Failed to insert combat log: ${logError.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // 9. Return summary.
  // -----------------------------------------------------------------------
  return { hexesFought, totalCasualties, errors };
}
