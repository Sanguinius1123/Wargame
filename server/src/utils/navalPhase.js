// =============================================================
// navalPhase.js — Phase 2: Naval resolution
//
// Per DESIGN.md, naval movement is step-by-step and simultaneous.
// Contact triggers on:
//   (1) Same hex (hex collision): both stop, simultaneous close combat
//   (2) Path crossing (A→B while B→A same step): border battle —
//       both stop, simultaneous ranged fire, loser retreats,
//       winner may continue
//
// Also handles:
//   - Surviving bomber Attack Run missions targeting water hexes
//     (passed in from Phase 1 result)
//   - Battleship Bombard orders that target land hexes resolve in
//     Phase 3, but naval hex targets resolve here
// =============================================================

import { hexDist } from './hexGeometry.js';
import { distributeDice } from './combat.js';

function roll2d6() {
  return Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
}

// Effective combat count: ships use quantity (1 per ship), subs use 1.
function effectiveCount(unit) {
  return unit.quantity ?? 1;
}

// Roll one attack die and one save. Returns {casualty: bool, attackRoll, saveRoll}.
function rollHit(toHit, defense, pen) {
  const atk = roll2d6();
  if (atk > toHit) return { casualty: false, attackRoll: atk, saveRoll: null };
  const saveTarget = Math.max(0, defense - pen);
  const save = roll2d6();
  return { casualty: save > saveTarget, attackRoll: atk, saveRoll: save };
}

// Apply one casualty to a ship unit.
function applyCasualty(unit) {
  if (unit.hp != null) {
    unit.hp = Math.max(0, unit.hp - 1);
    return unit.hp === 0;
  }
  unit.quantity = Math.max(0, (unit.quantity ?? 1) - 1);
  return unit.quantity === 0;
}

function isAlive(unit) {
  if (unit.hp != null) return unit.hp > 0;
  return (unit.quantity ?? 0) > 0;
}

// Roll-under detection check (DESIGN.md formula).
// Returns true = detected, false = undetected.
function detectionCheck(detRating, stealthRating, distance) {
  const score = 7 + detRating - stealthRating - distance;
  if (score > 12) return true;
  if (score < 2) return false;
  return roll2d6() <= score;
}

// ---------------------------------------------------------------------------
// executePhase2
// ---------------------------------------------------------------------------
export async function executePhase2(db, gameId, turn, survivingBombers = []) {
  const errors = [];
  const engagements = [];
  const combatLogInserts = [];

  // ------------------------------------------------------------------
  // 1. Load all naval movement orders for this turn
  // ------------------------------------------------------------------
  const { data: rawOrders, error: ordersErr } = await db
    .from('movement_orders')
    .select('unit_id, sequence, to_hex_q, to_hex_r, order_type, target_hex_q, target_hex_r')
    .eq('game_id', gameId)
    .eq('turn', turn)
    .order('sequence', { ascending: true });

  if (ordersErr) {
    return { engagements: [], bomberStrikes: [], errors: [`Failed to load naval orders: ${ordersErr.message}`] };
  }

  // ------------------------------------------------------------------
  // 2. Load all naval units
  // ------------------------------------------------------------------
  const { data: allUnitsRaw, error: unitsErr } = await db
    .from('units')
    .select('id, faction_id, hex_q, hex_r, quantity, hp, unit_type_id, standing_order')
    .eq('game_id', gameId);

  if (unitsErr) {
    return { engagements: [], bomberStrikes: [], errors: [`Failed to load units: ${unitsErr.message}`] };
  }

  // Load unit type configs
  const typeIds = [...new Set((allUnitsRaw ?? []).map(u => u.unit_type_id))];
  const { data: cfgRows } = await db
    .from('unit_type_config')
    .select('id, name, tags, to_hit, defense, penetration, move, los, atk_range, sonar_range, detection_rating, stealth_rating, bombard_to_hit, bombard_pen, bombard_range, hp')
    .eq('game_id', gameId)
    .in('id', typeIds.length ? typeIds : ['00000000-0000-0000-0000-000000000000']);

  const cfgById = new Map((cfgRows ?? []).map(c => [c.id, c]));

  // Separate naval from ground/air
  const navalUnits = (allUnitsRaw ?? []).filter(u => {
    const cfg = cfgById.get(u.unit_type_id);
    return cfg?.tags?.includes('naval');
  }).map(u => ({ ...u, cfg: cfgById.get(u.unit_type_id) }));


  if (!navalUnits.length) {
    // No naval units — still process bomber strikes if any
    const bomberStrikes = await resolveBomberStrikes(db, gameId, turn, survivingBombers, cfgById, combatLogInserts, errors, allUnitsRaw ?? []);
    if (combatLogInserts.length) await db.from('combat_log').insert(combatLogInserts);
    return { engagements: [], bomberStrikes, errors };
  }

  const unitById = new Map(navalUnits.map(u => [u.id, u]));

  // ------------------------------------------------------------------
  // 3. Build naval movement paths
  // ------------------------------------------------------------------
  const navalUnitIds = new Set(navalUnits.map(u => u.id));
  const ordersByUnit = new Map();
  for (const o of rawOrders ?? []) {
    if (!navalUnitIds.has(o.unit_id)) continue;
    if (o.order_type !== 'move') continue;
    if (!ordersByUnit.has(o.unit_id)) ordersByUnit.set(o.unit_id, []);
    ordersByUnit.get(o.unit_id).push(o);
  }

  // Build full paths per unit: [[step0, step1, ...], ...]
  // Path starts at current position and includes each movement waypoint
  const paths = new Map(); // unit_id → [{q, r}] (full path from current pos)
  for (const [uid, orders] of ordersByUnit) {
    const unit = unitById.get(uid);
    if (!unit || !isAlive(unit)) continue;
    const sorted = [...orders].sort((a, b) => a.sequence - b.sequence);
    const path = [{ q: unit.hex_q, r: unit.hex_r }];
    let pathValid = true;
    for (const o of sorted) {
      if (o.to_hex_q != null && o.to_hex_r != null) {
        const prev = path[path.length - 1];
        const next = { q: o.to_hex_q, r: o.to_hex_r };
        const d = hexDist(prev.q, prev.r, next.q, next.r);
        if (d === 0) continue; // sequence 0 stores the start hex — skip duplicate
        if (d !== 1) {
          errors.push(`Naval unit ${uid}: non-adjacent waypoint (${next.q},${next.r}) — path truncated`);
          pathValid = false;
          break;
        }
        path.push(next);
      }
    }
    if (pathValid && path.length > 1) paths.set(uid, path);
  }

  // ------------------------------------------------------------------
  // 4. Step index tracking (unit position tracked via unit.hex_q/r)
  // ------------------------------------------------------------------
  const stepIdx = new Map(); // unit_id → current path step index (0 = at origin)
  for (const [uid] of paths) stepIdx.set(uid, 0);

  const stopped = new Set(); // unit_ids that can no longer move this phase

  // ------------------------------------------------------------------
  // 5. Execute step-by-step movement
  // ------------------------------------------------------------------
  // Maximum steps = longest path
  const maxSteps = Math.max(...[...paths.values()].map(p => p.length - 1), 0);

  // Handle pre-existing contested hexes before movement begins (units already co-located).
  {
    const preHexFactions = new Map();
    for (const u of navalUnits) {
      if (!isAlive(u)) continue;
      const k = `${u.hex_q},${u.hex_r}`;
      if (!preHexFactions.has(k)) preHexFactions.set(k, new Set());
      preHexFactions.get(k).add(u.faction_id);
    }
    for (const [hexKey, fSet] of preHexFactions) {
      if (fSet.size < 2) continue;
      const byFaction = new Map();
      for (const u of navalUnits) {
        if (!isAlive(u)) continue;
        if (`${u.hex_q},${u.hex_r}` !== hexKey) continue;
        if (!byFaction.has(u.faction_id)) byFaction.set(u.faction_id, []);
        byFaction.get(u.faction_id).push(u);
        stopped.add(u.id);
      }
      const factions = [...byFaction.entries()];
      const [hq, hr] = hexKey.split(',').map(Number);
      for (let i = 0; i < factions.length; i++) {
        for (let j = i + 1; j < factions.length; j++) {
          const [, side1] = factions[i];
          const [, side2] = factions[j];
          const result = navalCombat(side1, side2, hexKey, false);
          engagements.push(result);
          combatLogInserts.push({ game_id: gameId, turn, phase: 2, hex_q: hq, hex_r: hr, log_type: 'naval_combat', faction_id: null, data: result });
        }
      }
    }
  }

  for (let step = 1; step <= maxSteps; step++) {
    // Collect moves for this step: unit_id → {from, to}
    const movesThisStep = new Map();

    for (const [uid, path] of paths) {
      if (stopped.has(uid)) continue;
      const idx = stepIdx.get(uid) ?? 0;
      if (idx + 1 >= path.length) continue; // already at destination

      const from = path[idx];
      const to = path[idx + 1];
      movesThisStep.set(uid, { from, to });
    }

    if (movesThisStep.size === 0) break;

    // Check for path crossings (A→B while B→A same step)
    const processed = new Set();
    for (const [uid, { from: f1, to: t1 }] of movesThisStep) {
      if (processed.has(uid)) continue;

      // Look for any other unit crossing paths
      for (const [uid2, { from: f2, to: t2 }] of movesThisStep) {
        if (uid2 === uid || processed.has(uid2)) continue;
        if (f1.q === t2.q && f1.r === t2.r && f2.q === t1.q && f2.r === t1.r) {
          // Path crossing — border battle at boundary
          const u1 = unitById.get(uid);
          const u2 = unitById.get(uid2);
          if (!u1 || !u2 || u1.faction_id === u2.faction_id) continue;

          // Both stop at midpoint — neither completes this step
          stopped.add(uid);
          stopped.add(uid2);
          processed.add(uid);
          processed.add(uid2);

          // Border battle: simultaneous ranged fire
          const result = navalCombat([u1], [u2], `path_crossing:${f1.q},${f1.r}→${t1.q},${t1.r}`, true);
          engagements.push(result);
          combatLogInserts.push({
            game_id: gameId, turn, phase: 2,
            hex_q: t1.q, hex_r: t1.r,
            log_type: 'naval_combat',
            faction_id: null,
            data: result,
          });
        }
      }
    }

    // Move non-stopped units to their next step; track which hexes they entered.
    const hexesMoved = new Set();
    for (const [uid, { to }] of movesThisStep) {
      if (stopped.has(uid)) continue;
      stepIdx.set(uid, (stepIdx.get(uid) ?? 0) + 1);

      const unit = unitById.get(uid);
      if (unit) { unit.hex_q = to.q; unit.hex_r = to.r; }
      hexesMoved.add(`${to.q},${to.r}`);
    }

    // Check for hex collisions — only in hexes a unit just moved into this step.
    // Pre-existing contested hexes were handled above, before the loop.
    const hexFactions = new Map(); // "q,r" → Set<faction_id> of units present
    for (const u of navalUnits) {
      if (!isAlive(u)) continue;
      const k = `${u.hex_q},${u.hex_r}`;
      if (!hexFactions.has(k)) hexFactions.set(k, new Set());
      hexFactions.get(k).add(u.faction_id);
    }

    for (const [hexKey, factionSet] of hexFactions) {
      if (factionSet.size < 2) continue;
      if (!hexesMoved.has(hexKey)) continue; // Only newly contested hexes trigger combat

      // Contested hex — group units by faction
      const byFaction = new Map();
      for (const u of navalUnits) {
        if (!isAlive(u)) continue;
        const k = `${u.hex_q},${u.hex_r}`;
        if (k !== hexKey) continue;
        if (!byFaction.has(u.faction_id)) byFaction.set(u.faction_id, []);
        byFaction.get(u.faction_id).push(u);
        stopped.add(u.id);
      }

      // Close combat between all factions (two-faction only for now)
      const factions = [...byFaction.entries()];
      for (let i = 0; i < factions.length; i++) {
        for (let j = i + 1; j < factions.length; j++) {
          const [, side1] = factions[i];
          const [, side2] = factions[j];
          const [hq, hr] = hexKey.split(',').map(Number);
          const result = navalCombat(side1, side2, hexKey, false);
          engagements.push(result);
          combatLogInserts.push({
            game_id: gameId, turn, phase: 2,
            hex_q: hq, hex_r: hr,
            log_type: 'naval_combat',
            faction_id: null,
            data: result,
          });
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // 6. Auto ranged fire — two passes for detection-aware submarine rules
  // ------------------------------------------------------------------
  // Group all naval units by hex
  const unitsByHex = new Map();
  for (const u of navalUnits) {
    if (!isAlive(u)) continue;
    const k = `${u.hex_q},${u.hex_r}`;
    if (!unitsByHex.has(k)) unitsByHex.set(k, []);
    unitsByHex.get(k).push(u);
  }

  // Pass 1: surface ships fire normally. When targeting a stealthy unit, run a
  // detection check first — undetected units cannot be targeted.
  for (const u of navalUnits) {
    if (!isAlive(u)) continue;
    const cfg = u.cfg;
    if (!cfg?.atk_range || !cfg?.to_hit) continue;
    // Submarines are handled in Pass 2
    if ((cfg.stealth_rating ?? 0) > 0) continue;

    const ownKey = `${u.hex_q},${u.hex_r}`;
    const ownHexUnits = unitsByHex.get(ownKey) ?? [];
    const ownFactions = new Set(ownHexUnits.map(x => x.faction_id));
    if (ownFactions.size > 1) continue; // close combat takes priority

    // Only fire at detected enemies
    const targets = navalUnits.filter(t => {
      if (!isAlive(t)) return false;
      if (t.faction_id === u.faction_id) return false;
      const d = hexDist(u.hex_q, u.hex_r, t.hex_q, t.hex_r);
      if (d <= 0 || d > cfg.atk_range) return false;
      const tStealth = t.cfg?.stealth_rating ?? 0;
      if (tStealth > 0) {
        // Sonar-based detection check before firing at a stealthy target
        return detectionCheck(cfg.detection_rating ?? 0, tStealth, d);
      }
      return true; // non-stealthy targets are auto-detected within LOS
    });

    if (!targets.length) continue;

    const weighted = targets.map(t => ({
      id: t.id,
      weight: effectiveCount(t) / hexDist(u.hex_q, u.hex_r, t.hex_q, t.hex_r),
    }));
    const diceAlloc = distributeDice(effectiveCount(u), weighted);

    const rangeCasualties = new Map();
    for (const t of targets) {
      const dice = diceAlloc.get(t.id) ?? 0;
      for (let d = 0; d < dice; d++) {
        const { casualty } = rollHit(cfg.to_hit, t.cfg?.defense ?? 6, cfg.penetration ?? 0);
        if (casualty) rangeCasualties.set(t.id, (rangeCasualties.get(t.id) ?? 0) + 1);
      }
    }

    for (const [tid, count] of rangeCasualties) {
      const t = unitById.get(tid);
      if (!t) continue;
      for (let i = 0; i < count; i++) applyCasualty(t);
    }

    if (rangeCasualties.size > 0) {
      combatLogInserts.push({
        game_id: gameId, turn, phase: 2,
        hex_q: u.hex_q, hex_r: u.hex_r,
        log_type: 'naval_ranged',
        faction_id: u.faction_id,
        data: { firer: u.id, casualties: Object.fromEntries(rangeCasualties) },
      });
    }
  }

  // Pass 2: submarine ranged fire — one-sided combat when undetected.
  // Each target ship independently checks whether it can detect the sub.
  // Undetected: sub fires, target cannot fire back. After the sub fires,
  // the struck target gets a +2 bonus detection roll; success reveals the
  // sub's hex in scouted_hexes for all nearby enemy factions.
  for (const sub of navalUnits) {
    if (!isAlive(sub)) continue;
    const cfg = sub.cfg;
    if (!cfg?.atk_range || !cfg?.to_hit) continue;
    if ((cfg.stealth_rating ?? 0) === 0) continue; // only actual subs here

    const ownKey = `${sub.hex_q},${sub.hex_r}`;
    const ownHexUnits = unitsByHex.get(ownKey) ?? [];
    const ownFactions = new Set(ownHexUnits.map(x => x.faction_id));
    if (ownFactions.size > 1) continue;

    // For each enemy in range, determine whether it detects the sub.
    // Sub fires at ALL in-range enemies regardless; detection only affects
    // whether the target can fire back.
    const inRange = navalUnits.filter(t => {
      if (!isAlive(t)) return false;
      if (t.faction_id === sub.faction_id) return false;
      const d = hexDist(sub.hex_q, sub.hex_r, t.hex_q, t.hex_r);
      return d > 0 && d <= cfg.atk_range;
    });

    if (!inRange.length) continue;

    const detectedBySomeTarget = new Set(); // target ids that detect the sub
    for (const t of inRange) {
      const d = hexDist(sub.hex_q, sub.hex_r, t.hex_q, t.hex_r);
      if (detectionCheck(t.cfg?.detection_rating ?? 0, cfg.stealth_rating, d)) {
        detectedBySomeTarget.add(t.id);
      }
    }

    // Sub fires proportionally at all in-range targets
    const weighted = inRange.map(t => ({
      id: t.id,
      weight: effectiveCount(t) / hexDist(sub.hex_q, sub.hex_r, t.hex_q, t.hex_r),
    }));
    const diceAlloc = distributeDice(effectiveCount(sub), weighted);

    const subCasualties = new Map();
    for (const t of inRange) {
      const dice = diceAlloc.get(t.id) ?? 0;
      for (let d = 0; d < dice; d++) {
        const { casualty } = rollHit(cfg.to_hit, t.cfg?.defense ?? 6, cfg.penetration ?? 0);
        if (casualty) subCasualties.set(t.id, (subCasualties.get(t.id) ?? 0) + 1);
      }
    }

    for (const [tid, count] of subCasualties) {
      const t = unitById.get(tid);
      if (!t) continue;
      for (let i = 0; i < count; i++) applyCasualty(t);
    }

    // Detected targets fire back at the sub
    const returnCasualties = new Map();
    for (const t of inRange) {
      if (!detectedBySomeTarget.has(t.id)) continue;
      if (!isAlive(t)) continue;
      const tCfg = t.cfg;
      if (!tCfg?.to_hit || !tCfg?.atk_range) continue;
      const d = hexDist(sub.hex_q, sub.hex_r, t.hex_q, t.hex_r);
      if (d > tCfg.atk_range) continue;

      const { casualty } = rollHit(tCfg.to_hit, cfg.defense ?? 6, tCfg.penetration ?? 0);
      if (casualty) returnCasualties.set(sub.id, (returnCasualties.get(sub.id) ?? 0) + 1);
    }

    for (const [, count] of returnCasualties) {
      for (let i = 0; i < count; i++) applyCasualty(sub);
    }

    if (subCasualties.size > 0 || returnCasualties.size > 0) {
      combatLogInserts.push({
        game_id: gameId, turn, phase: 2,
        hex_q: sub.hex_q, hex_r: sub.hex_r,
        log_type: 'submarine_ranged',
        faction_id: sub.faction_id,
        data: {
          sub: sub.id,
          casualties_inflicted: Object.fromEntries(subCasualties),
          return_fire: Object.fromEntries(returnCasualties),
          detected_by: [...detectedBySomeTarget],
        },
      });
    }

    // Post-attack bonus detection roll (+2) for each undetected attack.
    // A single success from any struck target reveals the sub's hex.
    const struckAndUndetected = inRange.filter(t =>
      !detectedBySomeTarget.has(t.id) && subCasualties.has(t.id)
    );

    let subRevealed = false;
    for (const t of struckAndUndetected) {
      if (subRevealed) break;
      const d = hexDist(sub.hex_q, sub.hex_r, t.hex_q, t.hex_r);
      const bonusScore = 7 + (t.cfg?.detection_rating ?? 0) - cfg.stealth_rating - d + 2;
      const revealed = bonusScore > 12 || (bonusScore >= 2 && roll2d6() <= bonusScore);
      if (revealed) subRevealed = true;
    }

    if (subRevealed) {
      // Write sub hex to scouted_hexes for all enemy factions with nearby naval units
      const nearbyEnemyFactions = [...new Set(
        navalUnits
          .filter(t =>
            t.faction_id !== sub.faction_id
            && hexDist(sub.hex_q, sub.hex_r, t.hex_q, t.hex_r) <= (cfg.sonar_range ?? 4)
          )
          .map(t => t.faction_id)
      )];

      for (const fid of nearbyEnemyFactions) {
        await db.from('scouted_hexes').upsert({
          faction_id: fid,
          game_id: gameId,
          hex_q: sub.hex_q,
          hex_r: sub.hex_r,
          last_scouted_turn: turn,
        }, { onConflict: 'faction_id,hex_q,hex_r' });
      }
    }
  }

  // ------------------------------------------------------------------
  // 7. Bomber Attack Run — water hex targets
  // ------------------------------------------------------------------
  // Use the mutable unitById snapshot (updated by step-by-step combat) so bomber strikes
  // see post-combat HP, not the stale pre-phase values from allUnitsRaw.
  const bomberStrikes = await resolveBomberStrikes(db, gameId, turn, survivingBombers, cfgById, combatLogInserts, errors, [...unitById.values()]);

  // ------------------------------------------------------------------
  // 8. Write naval unit positions and casualty updates to DB
  // ------------------------------------------------------------------
  for (const u of navalUnits) {
    const orig = allUnitsRaw?.find(o => o.id === u.id);
    if (!orig) continue;

    const posChanged = u.hex_q !== orig.hex_q || u.hex_r !== orig.hex_r;
    const hpChanged = u.hp != null && u.hp !== orig.hp;
    const qtyChanged = u.quantity != null && u.quantity !== orig.quantity;

    if (!posChanged && !hpChanged && !qtyChanged) continue;

    if ((u.hp != null && u.hp <= 0) || (u.quantity != null && u.quantity <= 0)) {
      await db.from('units').delete().eq('id', u.id);
    } else {
      const update = { hex_q: u.hex_q, hex_r: u.hex_r };
      if (u.hp != null) update.hp = u.hp;
      if (u.quantity != null) update.quantity = u.quantity;
      await db.from('units').update(update).eq('id', u.id);
    }
  }

  // ------------------------------------------------------------------
  // 9. Insert combat log
  // ------------------------------------------------------------------
  if (combatLogInserts.length > 0) {
    const { error: logErr } = await db.from('combat_log').insert(combatLogInserts);
    if (logErr) errors.push(`Failed to insert Phase 2 combat log: ${logErr.message}`);
  }

  return { engagements, bomberStrikes, errors };
}

// ---------------------------------------------------------------------------
// navalCombat — simultaneous fire between two groups of naval units
//
// isBorderBattle: true = path crossing (both can retreat after), false = hex collision
// Returns a log-friendly result object.
// ---------------------------------------------------------------------------
function navalCombat(side1, side2, locationKey, isBorderBattle) {
  const pendingCas1 = new Map(); // casualties on side1 keyed by unit id
  const pendingCas2 = new Map();

  // side2 fires at side1
  for (const attacker of side2) {
    if (!isAlive(attacker)) continue;
    const cfg = attacker.cfg;
    if (!cfg?.to_hit) continue;

    const targets = side1.filter(isAlive).map(t => ({ id: t.id, weight: effectiveCount(t) }));
    if (!targets.length) continue;
    const diceAlloc = distributeDice(effectiveCount(attacker), targets);

    for (const t of side1) {
      const dice = diceAlloc.get(t.id) ?? 0;
      for (let d = 0; d < dice; d++) {
        const { casualty } = rollHit(cfg.to_hit, t.cfg?.defense ?? 6, cfg.penetration ?? 0);
        if (casualty) pendingCas1.set(t.id, (pendingCas1.get(t.id) ?? 0) + 1);
      }
    }
  }

  // side1 fires at side2 simultaneously
  for (const attacker of side1) {
    if (!isAlive(attacker)) continue;
    const cfg = attacker.cfg;
    if (!cfg?.to_hit) continue;

    const targets = side2.filter(isAlive).map(t => ({ id: t.id, weight: effectiveCount(t) }));
    if (!targets.length) continue;
    const diceAlloc = distributeDice(effectiveCount(attacker), targets);

    for (const t of side2) {
      const dice = diceAlloc.get(t.id) ?? 0;
      for (let d = 0; d < dice; d++) {
        const { casualty } = rollHit(cfg.to_hit, t.cfg?.defense ?? 6, cfg.penetration ?? 0);
        if (casualty) pendingCas2.set(t.id, (pendingCas2.get(t.id) ?? 0) + 1);
      }
    }
  }

  // Apply simultaneously
  for (const [uid, count] of pendingCas1) {
    const u = side1.find(x => x.id === uid);
    if (u) for (let i = 0; i < count; i++) applyCasualty(u);
  }
  for (const [uid, count] of pendingCas2) {
    const u = side2.find(x => x.id === uid);
    if (u) for (let i = 0; i < count; i++) applyCasualty(u);
  }

  return {
    location: locationKey,
    type: isBorderBattle ? 'border_battle' : 'close_combat',
    side1_losses: Object.fromEntries(pendingCas1),
    side2_losses: Object.fromEntries(pendingCas2),
  };
}

// ---------------------------------------------------------------------------
// resolveBomberStrikes — handles bomber Attack Run on water hexes
//
// Per DESIGN.md: Attack Run → Phase 2 (naval hex target).
// Bombing Run spanning both water and land → Phase 2 for water hexes.
// Same group participates in both; Phase 2 casualties reduce count before Phase 3.
//
// Bombers fire 1 die per bomber (ceil(hp/3)) at each target hex.
// To-Hit 7, Pen 1 vs naval units; also vs infrastructure (1 die per bomber per hex).
// ---------------------------------------------------------------------------
async function resolveBomberStrikes(db, gameId, turn, survivingBombers, cfgById, combatLogInserts, errors, allUnits) {
  const results = [];
  if (!survivingBombers?.length) return results;

  // Load building data for infra strikes
  const { data: buildings } = await db
    .from('buildings')
    .select('id, hex_q, hex_r, type, current_hp, max_hp, owner_faction_id')
    .eq('game_id', gameId);

  const buildingsByHex = new Map();
  for (const b of buildings ?? []) {
    const k = `${b.hex_q},${b.hex_r}`;
    if (!buildingsByHex.has(k)) buildingsByHex.set(k, []);
    buildingsByHex.get(k).push(b);
  }

  // Load hexes to identify water hexes
  const { data: hexRows } = await db
    .from('hexes')
    .select('hex_q, hex_r, terrain')
    .eq('game_id', gameId);
  const hexByKey = new Map((hexRows ?? []).map(h => [`${h.hex_q},${h.hex_r}`, h]));

  for (const group of survivingBombers) {
    // For Attack Run: target is the declared target hex
    // For Bombing Run: target all path hexes that are water
    const targetHexes = [];

    if (group.missionType === 'attack_run') {
      if (group.targetHexQ != null) {
        const tHex = hexByKey.get(`${group.targetHexQ},${group.targetHexR}`);
        if (tHex?.terrain === 'water') {
          targetHexes.push({ q: group.targetHexQ, r: group.targetHexR });
        }
      }
    } else if (group.missionType === 'bombing_run') {
      for (const p of group.path ?? []) {
        const h = hexByKey.get(`${p.q},${p.r}`);
        if (h?.terrain === 'water') targetHexes.push(p);
      }
    }

    if (!targetHexes.length) continue;

    const bomberCount = group.units.reduce((s, u) => {
      const cfg = cfgById.get(u.unit_type_id);
      if (cfg?.tags?.includes('heavy') && u.hp != null) return s + Math.ceil(u.hp / 3);
      return s + (u.quantity ?? 1);
    }, 0);

    if (bomberCount <= 0) continue;

    for (const targetHex of targetHexes) {
      const hexKey = `${targetHex.q},${targetHex.r}`;
      const unitsInHex = allUnits.filter(u => {
        const cfg = cfgById.get(u.unit_type_id);
        return u.hex_q === targetHex.q && u.hex_r === targetHex.r
          && cfg?.tags?.includes('naval')
          && u.faction_id !== group.factionId;
      });

      // Distribute all bomber dice proportionally across ALL targets in the hex.
      const casualties = new Map();
      if (unitsInHex.length > 0) {
        const allTargets = unitsInHex.map(t => ({ id: t.id, weight: t.quantity ?? 1 }));
        const diceAlloc = distributeDice(bomberCount, allTargets);
        for (const target of unitsInHex) {
          const tCfg = cfgById.get(target.unit_type_id);
          const dice = diceAlloc.get(target.id) ?? 0;
          for (let d = 0; d < dice; d++) {
            const { casualty } = rollHit(7, tCfg?.defense ?? 6, 1);
            if (casualty) casualties.set(target.id, (casualties.get(target.id) ?? 0) + 1);
          }
        }
      }

      // Apply casualties
      for (const [tid, count] of casualties) {
        const t = allUnits.find(u => u.id === tid);
        if (!t) continue;
        if (t.hp != null) {
          t.hp = Math.max(0, t.hp - count);
          if (t.hp <= 0) await db.from('units').delete().eq('id', tid);
          else await db.from('units').update({ hp: t.hp }).eq('id', tid);
        } else {
          t.quantity = Math.max(0, (t.quantity ?? 1) - count);
          if (t.quantity <= 0) await db.from('units').delete().eq('id', tid);
          else await db.from('units').update({ quantity: t.quantity }).eq('id', tid);
        }
      }

      // Infra strike (1 die per bomber)
      let infraHits = 0;
      const infraDamage = [];
      const bldgsInHex = buildingsByHex.get(hexKey) ?? [];
      for (let d = 0; d < bomberCount; d++) {
        const { casualty: hit } = rollHit(7, 0, 0); // To-Hit 7, no save roll needed — infra has no defense
        if (hit && bldgsInHex.length > 0) {
          infraHits++;
          const picked = bldgsInHex[Math.floor(Math.random() * bldgsInHex.length)];
          const newHp = Math.max(0, picked.current_hp - 1);
          await db.from('buildings').update({ current_hp: newHp }).eq('id', picked.id);
          infraDamage.push({ building_id: picked.id, type: picked.type, new_hp: newHp });
          picked.current_hp = newHp;
        }
      }

      results.push({
        groupId: group.groupId,
        factionId: group.factionId,
        targetHex,
        bomberCount,
        casualties: Object.fromEntries(casualties),
        infraHits,
        infraDamage,
      });

      combatLogInserts.push({
        game_id: gameId, turn, phase: 2,
        hex_q: targetHex.q, hex_r: targetHex.r,
        log_type: 'bomber_strike',
        faction_id: group.factionId,
        data: results[results.length - 1],
      });
    }

    // Update surviving bomber HP/quantity after Phase 2 casualties
    // (Phase 1 already wrote casualty updates; no new casualties here unless bombers were
    //  lost to AA during attack run, which was handled in Phase 1. Phase 2 just does the
    //  bombing — bombers themselves are not attacked during Phase 2.)
  }

  return results;
}
