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

import { fetchAll } from '../db.js';

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

  // Terrain defense bonus (hills +1, mountains +2, wetlands +1, etc.)
  bonus += hex.terrain_type_config?.defense_bonus ?? 0;

  if (hex.has_heavy_vegetation) {
    bonus += 2;
  } else if (hex.has_light_vegetation) {
    bonus += 1;
  }

  return bonus;
}

// ---------------------------------------------------------------------------
// detectionCheck — roll-under 2d6. Returns true if detected.
// ---------------------------------------------------------------------------
function detectionCheck(detRating, stealthRating, distance) {
  const score = 7 + detRating - stealthRating - distance;
  if (score > 12) return true;
  if (score < 2) return false;
  return roll2d6() <= score;
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
  const volleys = []; // structured summary, one entry per attacker faction

  const factionIds = [...factionGroups.keys()];

  for (const attackerFactionId of factionIds) {
    const attackers = factionGroups.get(attackerFactionId);

    const enemies = [];
    for (const fId of factionIds) {
      if (fId !== attackerFactionId) enemies.push(...factionGroups.get(fId));
    }
    if (!enemies.length) continue;

    const firingUnits = attackers.filter((u) => {
      const cfg = unitTypeById.get(u.unit_type_id);
      return cfg && cfg.to_hit != null;
    });

    if (!firingUnits.length) {
      log.push(`Faction ${attackerFactionId}: no units with to_hit — cannot fire.`);
      continue;
    }

    const totalDice = firingUnits.reduce((s, u) => s + u.quantity, 0);
    const targets = enemies.map((u) => ({ id: u.id, weight: u.quantity }));
    const dicePerTarget = distributeDice(totalDice, targets);

    // Build structured firing summary grouped by unit type.
    const byType = new Map();
    for (const u of firingUnits) {
      const name = unitTypeById.get(u.unit_type_id)?.name ?? 'Unknown';
      byType.set(name, (byType.get(name) ?? 0) + u.quantity);
    }
    const volley = {
      attacker_faction_id: attackerFactionId,
      firing_types: [...byType.entries()].map(([type, qty]) => ({ type, qty })),
      total_dice: totalDice,
      targets: [],
    };

    log.push(`Faction ${attackerFactionId} fires ${totalDice} dice against ${enemies.length} enemy unit(s).`);

    for (const enemy of enemies) {
      const dicesToRoll = dicePerTarget.get(enemy.id) ?? 0;
      if (dicesToRoll === 0) continue;

      const enemyCfg = unitTypeById.get(enemy.unit_type_id);
      if (!enemyCfg) continue;

      const hasFortBuilding = hexBuildings.some(
        b => b.type === 'fortification' && b.current_hp > 0 && b.owner_faction_id === enemy.faction_id
      );
      const bonus = defenseBonus(enemy, hex, hasFortBuilding);
      let hits = 0, saves = 0, enemyCasualties = 0;

      for (let d = 0; d < dicesToRoll; d++) {
        const firer = pickFiringUnit(firingUnits, unitTypeById);
        const toHit = firer?.to_hit ?? 6;
        const pen   = firer?.penetration ?? 0;

        const attackRoll = roll2d6();
        const hit = attackRoll <= toHit;

        if (!hit) {
          log.push(`  → Die vs unit ${enemy.id}: attack roll ${attackRoll} vs to_hit ${toHit} — miss.`);
          continue;
        }

        hits++;
        const saveTarget = enemyCfg.defense + bonus - pen;
        const saveRoll = roll2d6();
        const saved = saveRoll <= Math.max(0, saveTarget);

        log.push(
          `  → Die vs unit ${enemy.id} (${enemyCfg.name}): attack ${attackRoll}/${toHit} HIT, save ${saveRoll}/${Math.max(saveTarget, 0)}${saved ? ' SAVED' : ' CASUALTY'}${bonus ? ` (defense bonus +${bonus})` : ''}.`
        );

        if (saved) { saves++; } else { enemyCasualties++; }
      }

      if (enemyCasualties > 0) {
        casualties.set(enemy.id, (casualties.get(enemy.id) ?? 0) + enemyCasualties);
        log.push(`  Unit ${enemy.id} (${enemyCfg.name}): ${enemyCasualties} casualty/ies queued.`);
      }

      volley.targets.push({
        unit_id: enemy.id,
        type: enemyCfg.name,
        qty: enemy.quantity,
        dice: dicesToRoll,
        hits,
        saves,
        casualties: enemyCasualties,
      });
    }

    volleys.push(volley);
  }

  return { casualties, log, volleys };
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
  let allUnits;
  try {
    allUnits = await fetchAll(() => db.from('units')
      .select('id, faction_id, unit_type_id, hex_q, hex_r, quantity, hp, fortification_level, standing_order, unit_type_config(tags, stealth_rating, detection_rating)')
      .eq('game_id', gameId));
  } catch (e) {
    return {
      hexesFought: 0,
      totalCasualties: 0,
      errors: [`Failed to load units: ${e.message}`],
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
    // Naval units fight in Phase 2 only — exclude from Phase 3 ground combat.
    if (unit.unit_type_config?.tags?.includes('naval')) continue;
    const key = `${unit.hex_q},${unit.hex_r}`;
    if (!hexMap.has(key)) hexMap.set(key, new Map());
    const factions = hexMap.get(key);
    if (!factions.has(unit.faction_id)) factions.set(unit.faction_id, []);
    factions.get(unit.faction_id).push(unit);
  }

  // -----------------------------------------------------------------------
  // 2b. Stealth-safety filter.
  //     Units with standing_order='safety' and stealth_rating>0 are only
  //     visible to enemies that pass a detection roll. Undetected safety
  //     units are removed from their faction group — they don't fight this
  //     hex and their presence doesn't make the hex contested.
  //     Detection uses distance=0 (same hex) in the formula.
  // -----------------------------------------------------------------------
  for (const [, factions] of hexMap) {
    if (factions.size < 2) continue;

    for (const [factionId, units] of factions) {
      const undetected = [];

      for (const unit of units) {
        const utc = unit.unit_type_config;
        const stealthRating = utc?.stealth_rating ?? 0;
        if (stealthRating === 0) continue;                      // not stealthy
        if (unit.standing_order !== 'safety') continue;        // safety not active

        // Check if ANY enemy unit in this hex detects this unit.
        let anyEnemyDetects = false;
        for (const [eFactionId, eUnits] of factions) {
          if (eFactionId === factionId) continue;
          for (const eu of eUnits) {
            const eutc = eu.unit_type_config;
            if (detectionCheck(eutc?.detection_rating ?? 0, stealthRating, 0)) {
              anyEnemyDetects = true;
              break;
            }
          }
          if (anyEnemyDetects) break;
        }

        if (!anyEnemyDetects) undetected.push(unit.id);
      }

      // Remove undetected units from the combat group.
      if (undetected.length > 0) {
        const remaining = units.filter(u => !undetected.includes(u.id));
        if (remaining.length === 0) {
          factions.delete(factionId);
        } else {
          factions.set(factionId, remaining);
        }
      }
    }
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
  // 3a. Load faction names for readable combat log entries.
  // -----------------------------------------------------------------------
  const { data: factionRows } = await db.from('factions').select('id, name').eq('game_id', gameId);
  const factionNameById = new Map((factionRows ?? []).map(f => [f.id, f.name]));

  // -----------------------------------------------------------------------
  // 3. Load unit_type_config for all unit types present in the game.
  // -----------------------------------------------------------------------
  const unitTypeIds = [...new Set(allUnits.map((u) => u.unit_type_id))];

  const { data: unitTypeRows, error: utcError } = await db
    .from('unit_type_config')
    .select('id, name, to_hit, defense, penetration, tags, stealth_rating, detection_rating')
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
  const [hexRows, fortBuildingRows] = await Promise.all([
    fetchAll(() => db.from('hexes')
      .select('hex_q, hex_r, has_light_vegetation, has_heavy_vegetation, terrain_type_config(defense_bonus)')
      .eq('game_id', gameId)),
    fetchAll(() => db.from('buildings')
      .select('hex_q, hex_r, type, current_hp, owner_faction_id')
      .eq('game_id', gameId)
      .eq('type', 'fortification')),
  ]);

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
      terrain_type_config: { defense_bonus: 0 },
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

    const volleys = hexResult.volleys.map(v => ({
      ...v,
      attacker_faction: factionNameById.get(v.attacker_faction_id) ?? v.attacker_faction_id,
    }));

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
        volleys,
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
  // 7. Insert combat log rows.
  // -----------------------------------------------------------------------
  if (combatLogInserts.length > 0) {
    const { error: logError } = await db.from('combat_log').insert(combatLogInserts);
    if (logError) {
      errors.push(`Failed to insert combat log: ${logError.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // 8. Return summary.
  // -----------------------------------------------------------------------
  return { hexesFought, totalCasualties, errors };
}
