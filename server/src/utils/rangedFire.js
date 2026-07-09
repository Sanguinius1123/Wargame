// =============================================================
// rangedFire.js — Phase 3 ranged fire step
//
// Runs AFTER all ground movement completes but BEFORE close combat.
// Resolves bombard orders only (Artillery, Battleship).
// Auto ranged fire is not used in the strategic design — combat is close-only.
//
// Bombard orders — directed indirect fire:
//   Fire against a specific target hex (units + infra).
//   Artillery: bombard_to_hit, bombard_pen, 1 die per unit vs units+infra.
//   Stationary only (not in movedUnitIds). Indiscriminate.
//
// Dice resolution:
//   Attack: 2d6 ≤ to_hit → hit
//   Save:   2d6 ≤ (defense + defense_bonus − penetration) → saved; else 1 casualty
//
// SIMULTANEITY: ALL dice are rolled before ANY casualties are applied.
// =============================================================

import { defenseBonus, distributeDice } from './combat.js';
import { fetchAll } from '../db.js';

// ---------------------------------------------------------------------------
// roll2d6
// ---------------------------------------------------------------------------
function roll2d6() {
  return Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
}

// Effective combat count for a unit (pass unit_type_config as cfg).
// Bombers (heavy tag): ceil(hp/3) — each 3 HP = 1 aircraft with 1 die.
// Naval/other HP units: quantity (ships count as 1 each regardless of HP).
// Ground/Fighters: quantity.
function effectiveCount(unit, cfg) {
  if (unit.hp != null && cfg?.tags?.includes('heavy')) return Math.ceil(unit.hp / 3);
  return (unit.quantity ?? 1);
}

import { hexDist } from './hexGeometry.js';

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
  let allUnits;
  try {
    allUnits = await fetchAll(() => db.from('units')
      .select('id, faction_id, unit_type_id, hex_q, hex_r, quantity, hp, fortification_level, continuous_bombard_q, continuous_bombard_r')
      .eq('game_id', gameId));
  } catch (e) {
    return {
      bombardTargets: [],
      rangedEngagements: [],
      totalCasualties: 0,
      infraDamage: [],
      errors: [`Failed to load units: ${e.message}`],
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

  // Auto-inject continuous bombard orders for units that have one set,
  // haven't moved this turn, and have no explicit bombard order.
  for (const unit of allUnits) {
    if (
      unit.continuous_bombard_q != null &&
      !bombardOrders.has(unit.id) &&
      !movedUnitIds.has(unit.id)
    ) {
      bombardOrders.set(unit.id, {
        target_hex_q: unit.continuous_bombard_q,
        target_hex_r: unit.continuous_bombard_r,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Load hex data (vegetation, fortification context).
  // -------------------------------------------------------------------------
  let hexRows;
  try {
    hexRows = await fetchAll(() => db.from('hexes')
      .select('hex_q, hex_r, terrain, vegetation_hp, has_light_vegetation, has_heavy_vegetation, terrain_type_config(defense_bonus)')
      .eq('game_id', gameId));
  } catch (e) {
    return {
      bombardTargets: [],
      rangedEngagements: [],
      totalCasualties: 0,
      infraDamage: [],
      errors: [`Failed to load hexes: ${e.message}`],
    };
  }

  const hexDataByKey = new Map();
  for (const h of hexRows) {
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


  // -------------------------------------------------------------------------
  // 7. Accumulate all dice rolls — phase A (bombard) and B (auto ranged fire).
  //    Do NOT apply casualties yet.
  //
  //    casualties : Map<unit_id, number>
  //    infraDamageAcc : Map<building_id, number>
  // -------------------------------------------------------------------------
  const casualties = new Map();         // unit_id → cumulative casualty count
  const infraDamageAcc = new Map();     // building_id → cumulative HP damage
  const vegHpDamageAcc = new Map();     // hexKey → { tq, tr, damage }
  const currentVegHpBySalvo = new Map(); // hexKey → current veg HP this turn (tracks mid-salvo state)
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

    // Range check — skip if target is out of bombard range.
    if (cfg.bombard_range != null) {
      const dist = hexDist(unit.hex_q, unit.hex_r, tq, tr);
      if (dist > cfg.bombard_range) {
        errors.push(
          `Bombard: unit ${unitId} (${cfg.name}) target (${tq},${tr}) out of range ` +
          `(dist ${dist} > bombard_range ${cfg.bombard_range}) — skipped.`
        );
        continue;
      }
    }

    // Cannot bombard if enemies are in own hex (locked in close combat).
    const ownHexFactions = hexFactionMap.get(`${unit.hex_q},${unit.hex_r}`);
    if (ownHexFactions && [...ownHexFactions.keys()].some(fid => fid !== unit.faction_id)) continue;

    const targetHexKey = `${tq},${tr}`;
    const targetHex = hexDataByKey.get(targetHexKey) ?? {
      has_light_vegetation: false,
      has_heavy_vegetation: false,
      terrain_type_config: { defense_bonus: 0 },
    };

    // Collect all units in target hex.
    const targetFactionMap = hexFactionMap.get(targetHexKey);
    const unitsInTargetHex = [];
    if (targetFactionMap) {
      for (const units of targetFactionMap.values()) {
        unitsInTargetHex.push(...units);
      }
    }

    // Total dice: 1 die per effective unit in the stack.
    // Artillery: 1 die per gun. Bombers: ceil(hp/3). Naval: quantity.
    const diceCount = effectiveCount(unit, cfg);
    const toHit = cfg.bombard_to_hit;
    const pen = cfg.bombard_pen ?? 0;

    // --- Dice vs units (if any units in target hex) ---
    let hitsVsUnits = 0;
    const unitCasualtiesThisBombard = new Map();
    const unitRollLog = []; // per-unit roll detail for combat log

    if (unitsInTargetHex.length > 0 && diceCount > 0) {
      // Distribute dice among target units proportionally by effective count.
      const targets = unitsInTargetHex.map((u) => ({ id: u.id, weight: effectiveCount(u, unitTypeById.get(u.unit_type_id)) }));
      const dicePerTarget = distributeDice(diceCount, targets);

      for (const targetUnit of unitsInTargetHex) {
        const dice = dicePerTarget.get(targetUnit.id) ?? 0;
        if (dice === 0) continue;

        const targetCfg = unitTypeById.get(targetUnit.unit_type_id);
        if (!targetCfg) continue;

        const hasFortBuilding = (buildingsByHex.get(targetHexKey) ?? []).some(
          b => b.type === 'fortification' && b.current_hp > 0 && b.owner_faction_id === targetUnit.faction_id
        );
        const bonus = defenseBonus(targetUnit, targetHex, hasFortBuilding);
        const rolls = [];

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
          rolls.push({
            atk: result.attackRoll,
            hit: result.hit,
            save: result.saveRoll ?? null,
            save_target: result.saveTarget ?? null,
            casualty: result.casualty,
          });
        }

        unitRollLog.push({
          unit_type: targetCfg.name,
          quantity: targetUnit.quantity,
          faction_id: targetUnit.faction_id,
          defense: targetCfg.defense,
          bonus,
          rolls,
        });
      }
    }

    // --- Dice vs infra ---
    // Eligible infra pool: buildings + vegetation pseudo-entries.
    // Roads and canals immune (no building row). Vegetation: 1d6 4+ to degrade.
    let hitsVsInfra = 0;
    const buildingsInHex = buildingsByHex.get(targetHexKey) ?? [];
    const infraPool = [...buildingsInHex.map(b => ({ kind: 'building', b }))];
    // Use mid-salvo HP if this hex was already bombarded earlier this turn
    const vegHpNow = currentVegHpBySalvo.has(targetHexKey)
      ? currentVegHpBySalvo.get(targetHexKey)
      : (targetHex.vegetation_hp ?? 0);
    if (vegHpNow >= 11) infraPool.push({ kind: 'veg', level: 'heavy' });
    else if (vegHpNow >= 1) infraPool.push({ kind: 'veg', level: 'light' });

    for (let d = 0; d < diceCount; d++) {
      const infraRoll = roll2d6();
      if (infraRoll > toHit) continue;
      if (infraPool.length === 0) continue;  // nothing to hit

      hitsVsInfra++;
      const picked = infraPool[Math.floor(Math.random() * infraPool.length)];

      if (picked.kind === 'building') {
        infraDamageAcc.set(picked.b.id, (infraDamageAcc.get(picked.b.id) ?? 0) + 1);
      } else {
        // Vegetation: each hit reduces HP by 1; no secondary roll needed.
        if (!currentVegHpBySalvo.has(targetHexKey)) {
          currentVegHpBySalvo.set(targetHexKey, targetHex.vegetation_hp ?? 0);
        }
        const prevHp = currentVegHpBySalvo.get(targetHexKey);
        if (prevHp <= 0) { infraPool.splice(infraPool.indexOf(picked), 1); }
        else {
          const newHp = prevHp - 1;
          currentVegHpBySalvo.set(targetHexKey, newHp);
          if (!vegHpDamageAcc.has(targetHexKey)) vegHpDamageAcc.set(targetHexKey, { tq, tr, damage: 0 });
          vegHpDamageAcc.get(targetHexKey).damage += 1;
          // Update pool if threshold crossed this hit
          const idx = infraPool.indexOf(picked);
          if (newHp <= 0) {
            infraPool.splice(idx, 1);
          } else if (newHp <= 10 && picked.level === 'heavy') {
            infraPool.splice(idx, 1, { kind: 'veg', level: 'light' });
          }
        }
      }
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
        firer_type: cfg.name,
        firer_count: diceCount,
        firer_hex: { q: unit.hex_q, r: unit.hex_r },
        target_hex: { q: tq, r: tr },
        dice: diceCount,
        to_hit: toHit,
        pen,
        hits_vs_units: hitsVsUnits,
        hits_vs_infra: hitsVsInfra,
        casualties: casualtiesSummary,
        unit_rolls: unitRollLog,
      },
    });
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
  // 9b. Apply vegetation HP damage and sync boolean flags.
  // =========================================================================
  for (const [hexKey, { tq, tr, damage }] of vegHpDamageAcc) {
    const hexRow = hexDataByKey.get(hexKey);
    if (!hexRow) continue;
    const newHp = Math.max(0, (hexRow.vegetation_hp ?? 0) - damage);
    const { error } = await db.from('hexes')
      .update({
        vegetation_hp:        newHp,
        has_heavy_vegetation: newHp >= 11,
        has_light_vegetation: newHp >= 1 && newHp <= 10,
      })
      .eq('game_id', gameId)
      .eq('hex_q', tq)
      .eq('hex_r', tr);
    if (error) errors.push(`Failed to update vegetation at (${tq},${tr}): ${error.message}`);
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
