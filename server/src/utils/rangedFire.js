// =============================================================
// rangedFire.js — Phase 3 ranged fire step
//
// Runs AFTER all ground movement completes but BEFORE close combat.
// Two simultaneous events are resolved in a single pass:
//
//   A) Bombard orders — directed indirect fire (Artillery, Battleship)
//      Fire against a specific target hex (units + infra).
//      Artillery: bombard_to_hit, bombard_pen, 1 die per unit vs units,
//                 1 die per unit vs infra. Stationary only (not in movedUnitIds).
//      Bombardment is indiscriminate — can hit any unit in target hex.
//
//   B) Auto ranged fire — no order required
//      All units with atk_range > 0 AND to_hit != null that:
//        • do NOT have a bombard or fortify order this turn, AND
//        • are NOT in the same hex as any enemy (those fight in close combat)
//      Fire at ALL detected enemy units within atk_range (distance > 0).
//      Proportional distribution: weight = unit_count / distance.
//
// Dice resolution (identical to combat.js):
//   Attack: 2d6 ≤ to_hit → hit
//   Save:   2d6 ≤ (defense + defense_bonus − penetration) → saved; else 1 casualty
//
// SIMULTANEITY: ALL dice are rolled before ANY casualties are applied.
// =============================================================

import { defenseBonus, distributeDice } from './combat.js';

// ---------------------------------------------------------------------------
// roll2d6
// ---------------------------------------------------------------------------
function roll2d6() {
  return Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
}

// ---------------------------------------------------------------------------
// hexDist — axial hex distance (same as Chebyshev in cube coords)
// ---------------------------------------------------------------------------
function hexDist(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

// ---------------------------------------------------------------------------
// rollAttackAndSave
//
// Roll one attack die and one optional save die. Returns { hit, saved, casualty }.
// Used for both bombard and auto ranged fire.
//
// toHit     : attack threshold (2d6 ≤ toHit → hit)
// defense   : base defense value of target unit
// bonus     : defense bonus from terrain/fortification
// pen       : penetration of attacker
// ---------------------------------------------------------------------------
function rollAttackAndSave(toHit, defense, bonus, pen) {
  const attackRoll = roll2d6();
  const hit = attackRoll <= toHit;
  if (!hit) return { hit: false, saved: false, casualty: false, attackRoll, saveRoll: null };

  const saveTarget = Math.max(0, defense + bonus - pen);
  const saveRoll = roll2d6();
  const saved = saveRoll <= saveTarget;
  return { hit: true, saved, casualty: !saved, attackRoll, saveRoll, saveTarget };
}

// ---------------------------------------------------------------------------
// executeRangedFireStep
//
// movedUnitIds : Set<string>  — unit IDs that moved this turn (cannot bombard)
//
// Returns:
// {
//   bombardTargets    : Array<{ firerFactionId, targetHex, hitsVsUnits, hitsVsInfra }>
//   rangedEngagements : Array<{ firerUnitId, firerFactionId, targetUnitId, hits, casualties }>
//   totalCasualties   : number
//   infraDamage       : Array<{ buildingId, hex_q, hex_r, type, damage }>
//   errors            : string[]
// }
// ---------------------------------------------------------------------------
export async function executeRangedFireStep(db, gameId, turn, movedUnitIds = new Set()) {
  const errors = [];
  const bombardTargets = [];
  const rangedEngagements = [];
  let totalCasualties = 0;

  // -------------------------------------------------------------------------
  // 1. Load all units for the game, joined with unit_type_config stats.
  // -------------------------------------------------------------------------
  const { data: allUnits, error: unitsError } = await db
    .from('units')
    .select(
      'id, faction_id, unit_type_id, hex_q, hex_r, quantity, hp, fortification_level'
    )
    .eq('game_id', gameId);

  if (unitsError) {
    return {
      bombardTargets: [],
      rangedEngagements: [],
      totalCasualties: 0,
      infraDamage: [],
      errors: [`Failed to load units: ${unitsError.message}`],
    };
  }

  if (!allUnits || allUnits.length === 0) {
    return { bombardTargets: [], rangedEngagements: [], totalCasualties: 0, infraDamage: [], errors: [] };
  }

  // -------------------------------------------------------------------------
  // 2. Load unit_type_config for all unit types in this game.
  // -------------------------------------------------------------------------
  const unitTypeIds = [...new Set(allUnits.map((u) => u.unit_type_id))];

  const { data: unitTypeRows, error: utcError } = await db
    .from('unit_type_config')
    .select(
      'id, name, tags, to_hit, defense, penetration, atk_range, ' +
      'bombard_range, bombard_to_hit, bombard_pen'
    )
    .eq('game_id', gameId)
    .in('id', unitTypeIds);

  if (utcError) {
    return {
      bombardTargets: [],
      rangedEngagements: [],
      totalCasualties: 0,
      infraDamage: [],
      errors: [`Failed to load unit_type_config: ${utcError.message}`],
    };
  }

  const unitTypeById = new Map();
  for (const cfg of unitTypeRows ?? []) {
    unitTypeById.set(cfg.id, cfg);
  }

  // -------------------------------------------------------------------------
  // 3. Load movement orders for this game+turn.
  // -------------------------------------------------------------------------
  const { data: orders, error: ordersError } = await db
    .from('movement_orders')
    .select('id, unit_id, order_type, target_hex_q, target_hex_r')
    .eq('game_id', gameId)
    .eq('turn', turn);

  if (ordersError) {
    return {
      bombardTargets: [],
      rangedEngagements: [],
      totalCasualties: 0,
      infraDamage: [],
      errors: [`Failed to load movement orders: ${ordersError.message}`],
    };
  }

  // Index orders by unit_id. A unit may have multiple order rows (e.g. multi-step move)
  // but for this step we only care about bombard and fortify.
  const ordersByUnit = new Map(); // unit_id → order[]
  for (const o of orders ?? []) {
    if (!ordersByUnit.has(o.unit_id)) ordersByUnit.set(o.unit_id, []);
    ordersByUnit.get(o.unit_id).push(o);
  }

  // Sets of unit_ids that have specific order types this turn.
  const bombardOrders = new Map(); // unit_id → { target_hex_q, target_hex_r }
  const fortifyOrderUnitIds = new Set();

  for (const [unitId, unitOrders] of ordersByUnit) {
    for (const o of unitOrders) {
      if (o.order_type === 'bombard') {
        // Last bombard order wins if somehow duplicated.
        bombardOrders.set(unitId, {
          target_hex_q: o.target_hex_q,
          target_hex_r: o.target_hex_r,
        });
      }
      if (o.order_type === 'fortify') {
        fortifyOrderUnitIds.add(unitId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Load hex data (vegetation, fortification context).
  // -------------------------------------------------------------------------
  const { data: hexRows, error: hexError } = await db
    .from('hexes')
    .select('hex_q, hex_r, has_light_vegetation, has_heavy_vegetation')
    .eq('game_id', gameId);

  if (hexError) {
    return {
      bombardTargets: [],
      rangedEngagements: [],
      totalCasualties: 0,
      infraDamage: [],
      errors: [`Failed to load hexes: ${hexError.message}`],
    };
  }

  const hexDataByKey = new Map();
  for (const h of hexRows ?? []) {
    hexDataByKey.set(`${h.hex_q},${h.hex_r}`, h);
  }

  // -------------------------------------------------------------------------
  // 5. Load buildings for infra damage resolution.
  // -------------------------------------------------------------------------
  const { data: buildingRows, error: buildingsError } = await db
    .from('buildings')
    .select('id, hex_q, hex_r, type, current_hp, max_hp, owner_faction_id')
    .eq('game_id', gameId);

  if (buildingsError) {
    errors.push(`Failed to load buildings: ${buildingsError.message}`);
  }

  // Group buildings by hex key for fast lookup.
  const buildingsByHex = new Map(); // hexKey → building[]
  for (const b of buildingRows ?? []) {
    const key = `${b.hex_q},${b.hex_r}`;
    if (!buildingsByHex.has(key)) buildingsByHex.set(key, []);
    buildingsByHex.get(key).push(b);
  }

  // -------------------------------------------------------------------------
  // 6. Build unit lookup structures.
  // -------------------------------------------------------------------------
  const unitById = new Map(allUnits.map((u) => [u.id, u]));

  // hexKey → Map<faction_id, unit[]>
  const hexFactionMap = new Map();
  for (const unit of allUnits) {
    const key = `${unit.hex_q},${unit.hex_r}`;
    if (!hexFactionMap.has(key)) hexFactionMap.set(key, new Map());
    const fm = hexFactionMap.get(key);
    if (!fm.has(unit.faction_id)) fm.set(unit.faction_id, []);
    fm.get(unit.faction_id).push(unit);
  }

  // Set of hexKeys that are contested (≥2 factions).
  const contestedHexKeys = new Set();
  for (const [key, fm] of hexFactionMap) {
    if (fm.size >= 2) contestedHexKeys.add(key);
  }

  // -------------------------------------------------------------------------
  // 7. Accumulate all dice rolls — phase A (bombard) and B (auto ranged fire).
  //    Do NOT apply casualties yet.
  //
  //    casualties : Map<unit_id, number>
  //    infraDamageAcc : Map<building_id, number>
  // -------------------------------------------------------------------------
  const casualties = new Map();         // unit_id → cumulative casualty count
  const infraDamageAcc = new Map();     // building_id → cumulative HP damage
  const combatLogInserts = [];

  // =========================================================================
  // Phase A — Bombard orders
  // =========================================================================
  for (const [unitId, bombardTarget] of bombardOrders) {
    const unit = unitById.get(unitId);
    if (!unit) continue;

    // Skip units that moved this turn (cannot bombard while moving).
    if (movedUnitIds.has(unitId)) continue;

    const cfg = unitTypeById.get(unit.unit_type_id);
    if (!cfg) continue;

    // Must be a bombardment-capable unit: has bombard_to_hit but NOT to_hit
    // (Artillery). Battleship has to_hit but also bombard_to_hit — the bombard
    // order means it fires indirect, skipping the auto ranged fire step.
    // We apply bombard stats regardless of whether to_hit is null or not.
    if (cfg.bombard_to_hit == null) continue;

    const tq = bombardTarget.target_hex_q;
    const tr = bombardTarget.target_hex_r;
    if (tq == null || tr == null) continue;

    const targetHexKey = `${tq},${tr}`;
    const targetHex = hexDataByKey.get(targetHexKey) ?? {
      has_light_vegetation: false,
      has_heavy_vegetation: false,
    };

    // Collect all units in target hex.
    const targetFactionMap = hexFactionMap.get(targetHexKey);
    const unitsInTargetHex = [];
    if (targetFactionMap) {
      for (const units of targetFactionMap.values()) {
        unitsInTargetHex.push(...units);
      }
    }

    // Total dice for this firer: quantity dice vs units + quantity dice vs infra.
    // Artillery fires 1 die per unit in the stack.
    const diceCount = unit.quantity;
    const toHit = cfg.bombard_to_hit;
    const pen = cfg.bombard_pen ?? 0;

    // --- Dice vs units (if any units in target hex) ---
    let hitsVsUnits = 0;
    const unitCasualtiesThisBombard = new Map();

    if (unitsInTargetHex.length > 0 && diceCount > 0) {
      // Distribute dice among target units proportionally by quantity.
      const targets = unitsInTargetHex.map((u) => ({ id: u.id, weight: u.quantity }));
      const dicePerTarget = distributeDice(diceCount, targets);

      for (const targetUnit of unitsInTargetHex) {
        const dice = dicePerTarget.get(targetUnit.id) ?? 0;
        if (dice === 0) continue;

        const targetCfg = unitTypeById.get(targetUnit.unit_type_id);
        if (!targetCfg) continue;

        const bonus = defenseBonus(targetUnit, targetHex);

        for (let d = 0; d < dice; d++) {
          const result = rollAttackAndSave(toHit, targetCfg.defense, bonus, pen);
          if (result.hit) hitsVsUnits++;
          if (result.casualty) {
            casualties.set(targetUnit.id, (casualties.get(targetUnit.id) ?? 0) + 1);
            unitCasualtiesThisBombard.set(
              targetUnit.id,
              (unitCasualtiesThisBombard.get(targetUnit.id) ?? 0) + 1
            );
          }
        }
      }
    }

    // --- Dice vs infra ---
    // Each artillery unit also fires 1 die vs infrastructure.
    // On a hit: pick a random eligible building in target hex and deal 1 HP.
    // Eligible infra: buildings (any type), bridge, urban tile (tracked as
    // buildings with type 'factory'/'airbase'/'harbor'/'airstrip'/'bridge'/'fortification').
    // Roads and canals are immune (they have no building row).
    let hitsVsInfra = 0;
    const buildingsInHex = buildingsByHex.get(targetHexKey) ?? [];

    for (let d = 0; d < diceCount; d++) {
      const infraRoll = roll2d6();
      const infraHit = infraRoll <= toHit;
      if (!infraHit) continue;

      hitsVsInfra++;

      // Pick a random building in the hex (roads/canals have no building row
      // so they're already excluded).
      if (buildingsInHex.length === 0) continue;

      const picked = buildingsInHex[Math.floor(Math.random() * buildingsInHex.length)];
      infraDamageAcc.set(picked.id, (infraDamageAcc.get(picked.id) ?? 0) + 1);
    }

    // Build casualties summary for log.
    const casualtiesSummary = {};
    for (const [uid, count] of unitCasualtiesThisBombard) {
      casualtiesSummary[uid] = count;
    }

    bombardTargets.push({
      firerFactionId: unit.faction_id,
      firerUnitId: unitId,
      targetHex: { q: tq, r: tr },
      hitsVsUnits,
      hitsVsInfra,
      casualties: casualtiesSummary,
    });

    combatLogInserts.push({
      game_id: gameId,
      turn,
      phase: 3,
      hex_q: tq,
      hex_r: tr,
      log_type: 'bombardment',
      faction_id: unit.faction_id,
      data: {
        firer_unit_id: unitId,
        firer_faction_id: unit.faction_id,
        firer_hex: { q: unit.hex_q, r: unit.hex_r },
        target_hex: { q: tq, r: tr },
        dice: diceCount,
        to_hit: toHit,
        pen,
        hits_vs_units: hitsVsUnits,
        hits_vs_infra: hitsVsInfra,
        casualties: casualtiesSummary,
      },
    });
  }

  // =========================================================================
  // Phase B — Auto ranged fire
  // =========================================================================
  // Eligible units: atk_range > 0, to_hit != null, no bombard/fortify order,
  // NOT in a contested hex (those fight in close combat, not ranged fire).
  for (const unit of allUnits) {
    const cfg = unitTypeById.get(unit.unit_type_id);
    if (!cfg) continue;

    // Must have direct-fire capability.
    if (cfg.atk_range == null || cfg.atk_range <= 0) continue;
    if (cfg.to_hit == null) continue;

    // Skip if it has a bombard or fortify order.
    if (bombardOrders.has(unit.id)) continue;
    if (fortifyOrderUnitIds.has(unit.id)) continue;

    // Skip if in a contested hex (fight in close combat instead).
    const ownHexKey = `${unit.hex_q},${unit.hex_r}`;
    if (contestedHexKeys.has(ownHexKey)) continue;

    // Find all enemy units within atk_range.
    const enemyTargets = allUnits.filter((target) => {
      if (target.faction_id === unit.faction_id) return false; // same faction
      const dist = hexDist(unit.hex_q, unit.hex_r, target.hex_q, target.hex_r);
      return dist > 0 && dist <= cfg.atk_range;
    });

    if (enemyTargets.length === 0) continue;

    // Proportional fire: weight = unit_count / distance.
    // Each firing unit contributes `quantity` dice total.
    const totalDice = unit.quantity;

    const weightedTargets = enemyTargets.map((target) => {
      const dist = hexDist(unit.hex_q, unit.hex_r, target.hex_q, target.hex_r);
      return {
        id: target.id,
        weight: target.quantity / dist,
      };
    });

    const dicePerTarget = distributeDice(totalDice, weightedTargets);

    const toHit = cfg.to_hit;
    const pen = cfg.penetration ?? 0;

    for (const target of enemyTargets) {
      const dice = dicePerTarget.get(target.id) ?? 0;
      if (dice === 0) continue;

      const targetCfg = unitTypeById.get(target.unit_type_id);
      if (!targetCfg) continue;

      const targetHexKey = `${target.hex_q},${target.hex_r}`;
      const targetHex = hexDataByKey.get(targetHexKey) ?? {
        has_light_vegetation: false,
        has_heavy_vegetation: false,
      };
      const bonus = defenseBonus(target, targetHex);

      let hits = 0;
      let casCount = 0;

      for (let d = 0; d < dice; d++) {
        const result = rollAttackAndSave(toHit, targetCfg.defense, bonus, pen);
        if (result.hit) hits++;
        if (result.casualty) {
          casualties.set(target.id, (casualties.get(target.id) ?? 0) + 1);
          casCount++;
        }
      }

      rangedEngagements.push({
        firerUnitId: unit.id,
        firerFactionId: unit.faction_id,
        targetUnitId: target.id,
        targetFactionId: target.faction_id,
        dice,
        hits,
        casualties: casCount,
      });

      if (hits > 0 || casCount > 0) {
        combatLogInserts.push({
          game_id: gameId,
          turn,
          phase: 3,
          hex_q: target.hex_q,
          hex_r: target.hex_r,
          log_type: 'ranged_fire',
          faction_id: unit.faction_id,
          data: {
            firer_unit_id: unit.id,
            firer_faction_id: unit.faction_id,
            firer_hex: { q: unit.hex_q, r: unit.hex_r },
            target_unit_id: target.id,
            target_faction_id: target.faction_id,
            target_hex: { q: target.hex_q, r: target.hex_r },
            atk_range: cfg.atk_range,
            dice,
            to_hit: toHit,
            pen,
            hits,
            casualties: casCount,
          },
        });
      }
    }
  }

  // =========================================================================
  // 8. Apply casualties (after ALL dice rolled).
  // =========================================================================
  for (const [unitId, count] of casualties) {
    const unit = unitById.get(unitId);
    if (!unit) continue;

    totalCasualties += count;

    if (unit.hp != null) {
      // HP-based unit (naval, bombers).
      const newHp = Math.max(0, unit.hp - count);
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
      const newQty = Math.max(0, unit.quantity - count);
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

  // =========================================================================
  // 9. Apply infra damage (after all dice rolled).
  // =========================================================================
  const infraDamageSummary = [];

  for (const [buildingId, damage] of infraDamageAcc) {
    // Find the building in our in-memory snapshot.
    let building = null;
    for (const buildings of buildingsByHex.values()) {
      building = buildings.find((b) => b.id === buildingId);
      if (building) break;
    }
    if (!building) continue;

    const newHp = Math.max(0, building.current_hp - damage);

    infraDamageSummary.push({
      buildingId,
      hex_q: building.hex_q,
      hex_r: building.hex_r,
      type: building.type,
      damage,
      newHp,
    });

    if (newHp <= 0) {
      const { error } = await db.from('buildings').delete().eq('id', buildingId);
      if (error) errors.push(`Failed to delete building ${buildingId}: ${error.message}`);
    } else {
      const { error } = await db
        .from('buildings')
        .update({ current_hp: newHp })
        .eq('id', buildingId);
      if (error) errors.push(`Failed to update building ${buildingId} hp: ${error.message}`);
    }
  }

  // =========================================================================
  // 10. Insert combat log rows.
  // =========================================================================
  if (combatLogInserts.length > 0) {
    const { error: logError } = await db.from('combat_log').insert(combatLogInserts);
    if (logError) {
      errors.push(`Failed to insert combat log: ${logError.message}`);
    }
  }

  // =========================================================================
  // 11. Return summary.
  // =========================================================================
  return {
    bombardTargets,
    rangedEngagements,
    totalCasualties,
    infraDamage: infraDamageSummary,
    errors,
  };
}
