// =============================================================
// airPhase.js — Phase 1: Air resolution
//
// Resolution order (per DESIGN.md):
//   1. Load all pending flight groups for this turn.
//   2. AA Overwatch fires at detected groups passing within range.
//      Casualties applied immediately before patrol intercepts.
//   3. Patrol intercepts — sequential per group, per patrol zone
//      in path order. Both sides fire simultaneously; casualties
//      applied after each battle before the next zone.
//   4. Scout groups: reveal path hexes to scouted_hexes.
//   5. Return surviving bomber groups for use in Phase 2/3.
//
// Detection formula (roll-under 2d6):
//   score = 7 + effective_detection − effective_stealth − distance
//   score > 12 = auto-detect, score < 2 = impossible
//
// AA hits distributed proportionally among units in the group
// (by quantity for fighters; by ceil(hp/3) for bombers).
// Intercept: all fighters + bombers on both sides fire simultaneously.
// =============================================================

import { hexDist, hexesInRange } from './hexGeometry.js';
import { distributeDice } from './combat.js';

function roll2d6() {
  return Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
}

function detectionCheck(detectionRating, stealthRating, distance) {
  const score = 7 + detectionRating - stealthRating - distance;
  if (score > 12) return true;
  if (score < 2) return false;
  return roll2d6() <= score;
}

// Effective unit count for a unit: fighters use quantity, bombers use ceil(hp/3).
function unitCount(unit, cfg) {
  if (cfg?.tags?.includes('heavy') && unit.hp != null) return Math.ceil(unit.hp / 3);
  return unit.quantity ?? 1;
}

// Roll attack + save for one die. Returns true if it caused a casualty.
function rollCasualty(toHit, defense, pen) {
  const atk = roll2d6();
  if (atk > toHit) return false;
  const saveTarget = Math.max(0, defense - pen);
  return roll2d6() > saveTarget;
}

// Apply a casualty count to a unit (quantity or HP based).
// Returns the actual damage applied (may be capped by remaining hp/qty).
function applyCasualties(unit, cfg, count) {
  if (count <= 0) return 0;
  if (cfg?.tags?.includes('heavy') && unit.hp != null) {
    const damage = Math.min(count, unit.hp);
    unit.hp = Math.max(0, unit.hp - damage);
    return damage;
  }
  const damage = Math.min(count, unit.quantity);
  unit.quantity = Math.max(0, unit.quantity - damage);
  return damage;
}

// ---------------------------------------------------------------------------
// executePhase1
// ---------------------------------------------------------------------------
export async function executePhase1(db, gameId, turn) {
  const errors = [];
  const aaLog = [];
  const interceptLog = [];
  const combatLogInserts = [];

  // ------------------------------------------------------------------
  // 1. Load flight groups for this turn
  // ------------------------------------------------------------------
  const { data: groups, error: groupsErr } = await db
    .from('flight_groups')
    .select('id, faction_id, mission_type, path, target_hex_q, target_hex_r, status, turn')
    .eq('game_id', gameId)
    .eq('turn', turn)
    .eq('status', 'pending');

  if (groupsErr) {
    return { aaLog: [], interceptLog: [], errors: [`Failed to load flight groups: ${groupsErr.message}`], survivingBombers: [] };
  }
  if (!groups?.length) {
    return { aaLog: [], interceptLog: [], errors: [], survivingBombers: [] };
  }

  // ------------------------------------------------------------------
  // 2. Load units assigned to each flight group
  // ------------------------------------------------------------------
  const groupIds = groups.map(g => g.id);
  const { data: fgUnitRows, error: fguErr } = await db
    .from('flight_group_units')
    .select('flight_group_id, unit_id')
    .in('flight_group_id', groupIds);

  if (fguErr) errors.push(`Failed to load flight_group_units: ${fguErr.message}`);

  const unitIds = [...new Set((fgUnitRows ?? []).map(r => r.unit_id))];

  const { data: unitRows, error: unitErr } = await db
    .from('units')
    .select('id, faction_id, hex_q, hex_r, quantity, hp, unit_type_id')
    .in('id', unitIds.length ? unitIds : ['00000000-0000-0000-0000-000000000000']);

  if (unitErr) errors.push(`Failed to load flight group units: ${unitErr.message}`);

  // Load unit_type_config for all relevant unit types
  const typeIds = [...new Set((unitRows ?? []).map(u => u.unit_type_id))];
  const { data: cfgRows } = await db
    .from('unit_type_config')
    .select('id, name, tags, to_hit, defense, penetration, stealth_rating, detection_rating, move, hp, overwatch_to_hit, overwatch_pen, overwatch_range')
    .eq('game_id', gameId)
    .in('id', typeIds.length ? typeIds : ['00000000-0000-0000-0000-000000000000']);

  const cfgById = new Map((cfgRows ?? []).map(c => [c.id, c]));
  const unitById = new Map((unitRows ?? []).map(u => [u.id, { ...u, cfg: cfgById.get(u.unit_type_id) }]));

  // Build group → units map (mutable copies for casualty tracking)
  const groupUnitsMap = new Map(); // groupId → unit[]
  for (const row of fgUnitRows ?? []) {
    const unit = unitById.get(row.unit_id);
    if (!unit) continue;
    if (!groupUnitsMap.has(row.flight_group_id)) groupUnitsMap.set(row.flight_group_id, []);
    // Deep copy so we can mutate quantity/hp during resolution
    groupUnitsMap.get(row.flight_group_id).push({ ...unit, cfg: unit.cfg });
  }

  // ------------------------------------------------------------------
  // 3. Load AA units (overwatch_to_hit not null) — all factions
  // ------------------------------------------------------------------
  const { data: allUnits, error: allUnitsErr } = await db
    .from('units')
    .select('id, faction_id, hex_q, hex_r, quantity, hp, unit_type_id, standing_order')
    .eq('game_id', gameId);

  if (allUnitsErr) errors.push(`Failed to load all units: ${allUnitsErr.message}`);

  const allTypeIds = [...new Set((allUnits ?? []).map(u => u.unit_type_id))];
  const { data: allCfgRows } = await db
    .from('unit_type_config')
    .select('id, name, tags, to_hit, defense, penetration, stealth_rating, detection_rating, move, hp, overwatch_to_hit, overwatch_pen, overwatch_range')
    .eq('game_id', gameId)
    .in('id', allTypeIds.length ? allTypeIds : ['00000000-0000-0000-0000-000000000000']);

  const allCfgById = new Map((allCfgRows ?? []).map(c => [c.id, c]));

  const aaUnits = (allUnits ?? []).filter(u => {
    const cfg = allCfgById.get(u.unit_type_id);
    return cfg?.overwatch_to_hit != null;
  }).map(u => ({ ...u, cfg: allCfgById.get(u.unit_type_id) }));

  // ------------------------------------------------------------------
  // 4. Load patrol air units (air tag + standing_order='patrol')
  // ------------------------------------------------------------------
  const patrolUnits = (allUnits ?? []).filter(u => {
    const cfg = allCfgById.get(u.unit_type_id);
    return cfg?.tags?.includes('air') && u.standing_order === 'patrol';
  }).map(u => ({ ...u, cfg: allCfgById.get(u.unit_type_id) }));

  // Note: No hex terrain data loaded for stealth — air units are in the air; terrain stealth does not apply.

  // Group stealth = max stealth among its units (weakest link if we used min,
  // but a group is only as hidden as its least stealthy member — use min).
  function groupStealth(groupId) {
    const units = groupUnitsMap.get(groupId) ?? [];
    if (!units.length) return 0;
    return Math.min(...units.map(u => (u.cfg?.stealth_rating ?? 0)));
  }

  // Is this group alive (has any units with quantity/hp > 0)?
  function groupAlive(groupId) {
    const units = groupUnitsMap.get(groupId) ?? [];
    return units.some(u => {
      if (u.cfg?.tags?.includes('heavy') && u.hp != null) return u.hp > 0;
      return (u.quantity ?? 0) > 0;
    });
  }

  // Total effective count of a group (for proportional distribution)
  function groupCount(groupId) {
    return (groupUnitsMap.get(groupId) ?? []).reduce((s, u) => s + unitCount(u, u.cfg), 0);
  }

  // ------------------------------------------------------------------
  // 6. AA Overwatch — fire at each detected enemy group
  // ------------------------------------------------------------------
  for (const group of groups) {
    if (!groupAlive(group.id)) continue;

    const path = (group.path ?? []);
    if (!path.length) continue;

    const gStealth = groupStealth(group.id);

    for (const aa of aaUnits) {
      // AA only fires at enemy flight groups
      if (aa.faction_id === group.faction_id) continue;

      const aaCount = aa.quantity ?? 1;
      if (aaCount <= 0) continue;

      const cfg = aa.cfg;
      const range = cfg.overwatch_range ?? 2;
      const toHit = cfg.overwatch_to_hit;
      const pen = cfg.overwatch_pen ?? 0;
      const detRating = cfg.detection_rating ?? 2;

      // Check if any hex in the group's path falls within AA overwatch range
      const hexesInAaRange = hexesInRange(aa.hex_q, aa.hex_r, range);
      const pathHexesInRange = path.filter(p => hexesInAaRange.has(`${p.q},${p.r}`));
      if (!pathHexesInRange.length) continue;

      // Detection check — use closest path hex in range
      const closestDist = Math.min(...pathHexesInRange.map(p => hexDist(aa.hex_q, aa.hex_r, p.q, p.r)));
      // Air units fly; terrain stealth does not apply to flight groups in the air.
      const effectiveStealth = gStealth;
      const detected = detectionCheck(detRating, effectiveStealth, closestDist);
      if (!detected) continue;

      // Fire: AA unit fires `aaCount` dice at the flight group.
      // Distribute among group units proportionally by count.
      const groupUnits = groupUnitsMap.get(group.id) ?? [];
      const aliveGroupUnits = groupUnits.filter(u => unitCount(u, u.cfg) > 0);
      if (!aliveGroupUnits.length) continue;

      const targets = aliveGroupUnits.map(u => ({ id: u.id, weight: unitCount(u, u.cfg) }));
      const dicePerTarget = distributeDice(aaCount, targets);

      let totalHits = 0;
      const casualties = new Map();

      for (const target of aliveGroupUnits) {
        const dice = dicePerTarget.get(target.id) ?? 0;
        for (let d = 0; d < dice; d++) {
          if (rollCasualty(toHit, target.cfg?.defense ?? 6, pen)) {
            casualties.set(target.id, (casualties.get(target.id) ?? 0) + 1);
            totalHits++;
          }
        }
      }

      // Apply casualties immediately (AA fires before patrol)
      for (const [uid, count] of casualties) {
        const u = groupUnits.find(u => u.id === uid);
        if (u) applyCasualties(u, u.cfg, count);
      }

      aaLog.push({
        aa_unit_id: aa.id,
        aa_faction_id: aa.faction_id,
        group_id: group.id,
        group_faction_id: group.faction_id,
        dice: aaCount,
        to_hit: toHit,
        pen,
        hits: totalHits,
        casualties: Object.fromEntries(casualties),
      });

      combatLogInserts.push({
        game_id: gameId, turn, phase: 1,
        hex_q: aa.hex_q, hex_r: aa.hex_r,
        log_type: 'aa_overwatch',
        faction_id: aa.faction_id,
        data: aaLog[aaLog.length - 1],
      });
    }
  }

  // ------------------------------------------------------------------
  // 7. Patrol intercepts — sequential, in path order per group
  // ------------------------------------------------------------------
  // Build patrol zones: each patrol unit covers hexes within patrol radius.
  // Patrol radius = floor((move - 2 * 0) / 6) since patrol center = unit's hex.
  // (Distance to patrol center is 0 when patrolling from own position.)
  const patrolZones = patrolUnits.map(p => {
    const radius = Math.floor((p.cfg?.move ?? 0) / 6);
    const zone = hexesInRange(p.hex_q, p.hex_r, radius);
    return { unit: p, zone, radius };
  });

  // Track which patrol units have already used their one intercept this turn.
  const usedPatrolIds = new Set();

  for (const group of groups) {
    if (!groupAlive(group.id)) continue;

    const path = (group.path ?? []);
    if (!path.length) continue;

    const gStealth = groupStealth(group.id);

    // For each hex in path order, check if any patrol zone covers it
    for (const pathHex of path) {
      const hexKey = `${pathHex.q},${pathHex.r}`;

      for (const pz of patrolZones) {
        if (!pz.zone.has(hexKey)) continue;
        // Patrol must be from a different faction
        if (pz.unit.faction_id === group.faction_id) continue;
        // Each patrol unit intercepts at most once per turn
        if (usedPatrolIds.has(pz.unit.id)) continue;
        // Patrol fighter must still be alive (may have been destroyed in a previous intercept)
        if ((pz.unit.quantity ?? 0) <= 0) continue;

        // Detection check for the patrol unit spotting the group
        const dist = hexDist(pz.unit.hex_q, pz.unit.hex_r, pathHex.q, pathHex.r);
        const effectiveStealth = gStealth;
        const detRating = pz.unit.cfg?.detection_rating ?? 2;
        const detected = detectionCheck(detRating, effectiveStealth, dist);
        if (!detected) continue;

        // Intercept combat: simultaneous fire from both sides.
        // Patrol side: all fighters/bombers in the patrol unit.
        // Group side: all fighters/bombers in the flight group.
        const groupUnits = (groupUnitsMap.get(group.id) ?? []).filter(u => unitCount(u, u.cfg) > 0);
        if (!groupUnits.length) break;

        // Attacker (patrol) fires at group
        const patrolCount = pz.unit.quantity ?? 1;
        const patrolCfg = pz.unit.cfg;
        const patrolToHit = patrolCfg?.to_hit ?? 7;
        const patrolPen = patrolCfg?.penetration ?? 0;

        // Defender (group) fires at patrol
        const groupFighters = groupUnits.filter(u => u.cfg?.to_hit != null);

        // Roll patrol → group
        const patrolTargets = groupUnits.map(u => ({ id: u.id, weight: unitCount(u, u.cfg) }));
        const diceForGroup = distributeDice(patrolCount, patrolTargets);

        const pendingGroupCas = new Map();
        for (const target of groupUnits) {
          const dice = diceForGroup.get(target.id) ?? 0;
          for (let d = 0; d < dice; d++) {
            if (rollCasualty(patrolToHit, target.cfg?.defense ?? 6, patrolPen)) {
              pendingGroupCas.set(target.id, (pendingGroupCas.get(target.id) ?? 0) + 1);
            }
          }
        }

        // Roll group → patrol (only fighters can fire in intercept)
        let pendingPatrolCas = 0;
        for (const fighter of groupFighters) {
          const fCount = unitCount(fighter, fighter.cfg);
          const fToHit = fighter.cfg?.to_hit ?? 7;
          const fPen = fighter.cfg?.penetration ?? 0;
          for (let d = 0; d < fCount; d++) {
            if (rollCasualty(fToHit, patrolCfg?.defense ?? 6, fPen)) {
              pendingPatrolCas++;
            }
          }
        }

        // Apply casualties simultaneously
        for (const [uid, count] of pendingGroupCas) {
          const u = groupUnits.find(u => u.id === uid);
          if (u) applyCasualties(u, u.cfg, count);
        }
        const actualPatrolCas = Math.min(pendingPatrolCas, pz.unit.quantity ?? 0);
        pz.unit.quantity = Math.max(0, (pz.unit.quantity ?? 0) - actualPatrolCas);

        const entry = {
          patrol_unit_id: pz.unit.id,
          patrol_faction_id: pz.unit.faction_id,
          group_id: group.id,
          group_faction_id: group.faction_id,
          intercept_hex: pathHex,
          patrol_dice: patrolCount,
          patrol_casualties_on_group: Object.fromEntries(pendingGroupCas),
          group_casualties_on_patrol: pendingPatrolCas,
          patrol_remaining: pz.unit.quantity,
        };
        interceptLog.push(entry);

        combatLogInserts.push({
          game_id: gameId, turn, phase: 1,
          hex_q: pathHex.q, hex_r: pathHex.r,
          log_type: 'air_intercept',
          faction_id: pz.unit.faction_id,
          data: entry,
        });

        // Mark as used — patrol fights at most once per turn.
        usedPatrolIds.add(pz.unit.id);
        break;
      }

      if (!groupAlive(group.id)) break;
    }
  }

  // ------------------------------------------------------------------
  // 8. Write casualty updates back to DB
  // ------------------------------------------------------------------
  // Update patrol unit quantities (mutations live on patrolZones[*].unit, not patrolUnits)
  for (const pz of patrolZones) {
    const u = pz.unit;
    const orig = allUnits?.find(o => o.id === u.id);
    if (!orig) continue;
    const newQty = u.quantity ?? 0;
    if (newQty !== (orig.quantity ?? 0)) {
      if (newQty <= 0) {
        await db.from('units').delete().eq('id', u.id);
      } else {
        await db.from('units').update({ quantity: newQty }).eq('id', u.id);
      }
    }
  }

  // Update flight group unit quantities/HP
  for (const [groupId, units] of groupUnitsMap) {
    for (const u of units) {
      const orig = unitById.get(u.id);
      if (!orig) continue;
      const cfg = u.cfg;
      const isHpBased = cfg?.tags?.includes('heavy') && u.hp != null;

      if (isHpBased) {
        if (u.hp !== orig.hp) {
          if (u.hp <= 0) {
            await db.from('units').delete().eq('id', u.id);
          } else {
            await db.from('units').update({ hp: u.hp }).eq('id', u.id);
          }
        }
      } else {
        if (u.quantity !== orig.quantity) {
          if ((u.quantity ?? 0) <= 0) {
            await db.from('units').delete().eq('id', u.id);
          } else {
            await db.from('units').update({ quantity: u.quantity }).eq('id', u.id);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // 9. Scout missions: add all path hexes to scouted_hexes
  // ------------------------------------------------------------------
  const scoutGroups = groups.filter(g => g.mission_type === 'scout');
  for (const sg of scoutGroups) {
    const path = sg.path ?? [];
    if (!path.length) continue;
    if (!groupAlive(sg.id)) continue;

    const rows = path.map(p => ({
      faction_id: sg.faction_id,
      game_id: gameId,
      hex_q: p.q,
      hex_r: p.r,
      last_scouted_turn: turn,
    }));
    await db.from('scouted_hexes').upsert(rows, { onConflict: 'faction_id,hex_q,hex_r' });
  }

  // ------------------------------------------------------------------
  // 10. Mark surviving bomber groups for Phase 2/3
  // ------------------------------------------------------------------
  const survivingBombers = [];
  for (const group of groups) {
    if (!['bombing_run', 'attack_run'].includes(group.mission_type)) continue;
    if (!groupAlive(group.id)) continue;

    // Check if group has surviving bombers
    const units = groupUnitsMap.get(group.id) ?? [];
    const hasBombers = units.some(u => {
      const isBomber = u.cfg?.tags?.includes('heavy');
      return isBomber && unitCount(u, u.cfg) > 0;
    });
    if (!hasBombers) continue;

    survivingBombers.push({
      groupId: group.id,
      factionId: group.faction_id,
      missionType: group.mission_type,
      targetHexQ: group.target_hex_q,
      targetHexR: group.target_hex_r,
      path: group.path ?? [],
      units: units.filter(u => u.cfg?.tags?.includes('heavy') && unitCount(u, u.cfg) > 0),
    });
  }

  // ------------------------------------------------------------------
  // 11. Update flight group statuses
  // ------------------------------------------------------------------
  for (const group of groups) {
    const alive = groupAlive(group.id);
    await db.from('flight_groups')
      .update({ status: alive ? 'in_flight' : 'destroyed' })
      .eq('id', group.id);
  }

  // ------------------------------------------------------------------
  // 12. Insert combat log
  // ------------------------------------------------------------------
  if (combatLogInserts.length > 0) {
    const { error: logErr } = await db.from('combat_log').insert(combatLogInserts);
    if (logErr) errors.push(`Failed to insert Phase 1 combat log: ${logErr.message}`);
  }

  return { aaLog, interceptLog, errors, survivingBombers };
}
