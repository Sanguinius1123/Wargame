// Compute which hexes a faction can currently see.
//
// Visibility rules (strategic scale):
//   - Every unit sees its own hex + all 6 adjacent hexes (distance ≤ 1).
//   - Naval units (tags includes 'naval') see water hexes at distance ≤ 2.
//   - Shoreline units (on a non-water hex adjacent to at least one water hex)
//     also see water hexes at distance ≤ 2.
//
// Returns { visible: Set<"q,r">, scouted: Set<"q,r"> }

import { hexesInRange, offsetNeighbors, hexDist } from './hexGeometry.js';
import { fetchAll } from '../db.js';

function key(q, r) { return `${q},${r}`; }

export async function computeVisibility(db, factionId, gameId) {
  const [unitRows, hexRows, scoutedRows] = await Promise.all([
    fetchAll(() => db.from('units')
      .select('hex_q, hex_r, unit_type_config(tags, los, sonar_range)')
      .eq('game_id', gameId)
      .eq('faction_id', factionId)),
    fetchAll(() => db.from('hexes')
      .select('hex_q, hex_r, terrain')
      .eq('game_id', gameId)),
    fetchAll(() => db.from('scouted_hexes')
      .select('hex_q, hex_r')
      .eq('faction_id', factionId)),
  ]);

  const hexTerrain = new Map();
  for (const h of hexRows) hexTerrain.set(key(h.hex_q, h.hex_r), h.terrain);

  const visible = new Set();

  for (const unit of unitRows) {
    const q = unit.hex_q;
    const r = unit.hex_r;
    const tags = unit.unit_type_config?.tags ?? [];
    const isNaval = tags.includes('naval');
    const ownTerrain = hexTerrain.get(key(q, r));
    const los = unit.unit_type_config?.los ?? 1;
    const sonarRange = unit.unit_type_config?.sonar_range ?? 0;

    // Elevation bonus: +1 LOS on hills or mountains.
    const elevBonus = (ownTerrain === 'hills' || ownTerrain === 'mountains') ? 1 : 0;
    const effectiveLos = los + elevBonus;

    // All units: see hexes within LOS range.
    for (const k of hexesInRange(q, r, effectiveLos)) visible.add(k);

    // Extended water vision: naval units see water at max(los, 2, sonar_range).
    // Sonar extends submarine water-hex detection to sonar_range (default 4).
    // Shoreline ground units also see adjacent water at distance 2.
    const waterRange = Math.max(los, isNaval ? 2 : 0, sonarRange);
    const isShoreline = !isNaval
      && ownTerrain !== 'water'
      && offsetNeighbors(q, r).some(nb => hexTerrain.get(key(nb.q, nb.r)) === 'water');

    if (isNaval || isShoreline) {
      for (const k of hexesInRange(q, r, waterRange)) {
        if (hexTerrain.get(k) === 'water') visible.add(k);
      }
    }
  }

  const scouted = new Set(
    scoutedRows
      .map(h => key(h.hex_q, h.hex_r))
      .filter(k => !visible.has(k))
  );

  return { visible, scouted };
}

// Roll detection for every enemy unit with stealth > 0 that sits inside a friendly unit's LOS.
// Logs results to combat_log (log_type = 'detection', phase = 4) — GM-only read via RLS.
// Does not currently affect gameplay visibility (informational only for now).
export async function computeDetectionEvents(db, gameId, currentTurn) {
  const { data: factions } = await db.from('factions').select('id, name').eq('game_id', gameId);
  const [allUnits, hexRows] = await Promise.all([
    fetchAll(() => db.from('units')
      .select('id, hex_q, hex_r, faction_id, quantity, unit_type_config(name, tags, los, stealth_rating, detection_rating)')
      .eq('game_id', gameId)),
    fetchAll(() => db.from('hexes')
      .select('hex_q, hex_r, terrain, has_light_vegetation, has_heavy_vegetation')
      .eq('game_id', gameId)),
  ]);

  if (!factions?.length || !allUnits?.length) return [];

  const hexMap = new Map((hexRows ?? []).map(h => [`${h.hex_q},${h.hex_r}`, h]));
  const factionName = new Map((factions ?? []).map(f => [f.id, f.name]));

  const unitsByFaction = {};
  for (const u of allUnits) {
    if (!unitsByFaction[u.faction_id]) unitsByFaction[u.faction_id] = [];
    unitsByFaction[u.faction_id].push(u);
  }

  // Reset detected_quantities for all units in this game before re-rolling
  await db.from('units').update({ detected_quantities: {} }).eq('game_id', gameId);

  const logRows = [];
  // Map: unit.id → { faction_id: detectedCount }
  const detectedBy = new Map();

  for (const observer of factions) {
    const obsUnits = unitsByFaction[observer.id] ?? [];
    for (const enemy of factions) {
      if (enemy.id === observer.id) continue;
      const tgtUnits = unitsByFaction[enemy.id] ?? [];

      for (const obs of obsUnits) {
        const cfg = obs.unit_type_config ?? {};
        const baseLos = cfg.los ?? 1;
        const obsHex = hexMap.get(`${obs.hex_q},${obs.hex_r}`);
        const elevBonus = (obsHex?.terrain === 'hills' || obsHex?.terrain === 'mountains') ? 1 : 0;
        const effectiveLos = baseLos + elevBonus;
        const obsDetection = cfg.detection_rating ?? 2;

        for (const tgt of tgtUnits) {
          const dist = hexDist(obs.hex_q, obs.hex_r, tgt.hex_q, tgt.hex_r);
          if (dist > effectiveLos) continue;

          const tgtCfg = tgt.unit_type_config ?? {};
          const baseStealth = tgtCfg.stealth_rating ?? 0;
          if (baseStealth === 0) continue; // auto-detected, no roll needed

          const tgtHex = hexMap.get(`${tgt.hex_q},${tgt.hex_r}`);
          const terrainBonus = tgtHex?.has_heavy_vegetation ? 2 : tgtHex?.has_light_vegetation ? 1 : 0;
          // Stack size stealth modifier: solo unit +1, 4-6 units -1, 7-9 -2, etc.
          const tgtQty = tgt.quantity ?? 1;
          const stackStealthMod = tgtQty === 1 ? 1 : -Math.floor((tgtQty - 1) / 3);
          const effectiveStealth = baseStealth + terrainBonus + stackStealthMod;

          // Stack size detection modifier: 1-5 units +0, 6-10 +1, 11-15 +2, etc.
          const obsQty = obs.quantity ?? 1;
          const stackDetectionMod = Math.floor((obsQty - 1) / 5);
          const effectiveDetection = obsDetection + stackDetectionMod;

          const detectionScore = 7 + effectiveDetection - effectiveStealth - dist;
          const autoDetect = detectionScore >= 12;
          const impossible  = detectionScore < 2;

          // Roll once per individual unit in the stack
          const stackSize = tgt.quantity ?? 1;
          const rolls = [];
          let detectedCount = 0;

          for (let i = 0; i < stackSize; i++) {
            if (autoDetect) {
              detectedCount++;
              rolls.push({ result: 'auto', detected: true });
            } else if (impossible) {
              rolls.push({ result: 'impossible', detected: false });
            } else {
              const dice = [Math.ceil(Math.random() * 6), Math.ceil(Math.random() * 6)];
              const total = dice[0] + dice[1];
              const hit = total <= detectionScore;
              if (hit) detectedCount++;
              rolls.push({ dice, total, detected: hit });
            }
          }

          if (detectedCount > 0) {
            if (!detectedBy.has(tgt.id)) detectedBy.set(tgt.id, {});
            detectedBy.get(tgt.id)[observer.id] = detectedCount;
          }

          logRows.push({
            game_id: gameId,
            turn: currentTurn,
            phase: 4,
            hex_q: tgt.hex_q,
            hex_r: tgt.hex_r,
            log_type: 'detection',
            faction_id: observer.id,
            data: {
              event: 'detection_roll',
              observer_faction: factionName.get(observer.id),
              target_faction: factionName.get(enemy.id),
              observer_pos: { q: obs.hex_q, r: obs.hex_r },
              observer_unit: cfg.name ?? 'Unknown',
              target_unit: tgtCfg.name ?? 'Unknown',
              stack_size: stackSize,
              base_stealth: baseStealth,
              terrain_bonus: terrainBonus,
              stack_stealth_mod: stackStealthMod,
              effective_stealth: effectiveStealth,
              obs_stack_size: obsQty,
              stack_detection_mod: stackDetectionMod,
              effective_detection: effectiveDetection,
              distance: dist,
              detection_score: detectionScore,
              auto_detect: autoDetect,
              impossible,
              rolls,
              detected_count: detectedCount,
            },
          });
        }
      }
    }
  }

  // Persist detected counts per faction for each stealthy unit
  for (const [unitId, factionCounts] of detectedBy) {
    await db.from('units').update({ detected_quantities: factionCounts }).eq('id', unitId);
  }

  if (logRows.length) {
    await db.from('combat_log').insert(logRows);
  }
  return logRows;
}

export async function markScouted(db, factionId, gameId, visibleKeys, currentTurn) {
  if (!visibleKeys.size) return;
  const rows = [...visibleKeys].map(k => {
    const [q, r] = k.split(',').map(Number);
    return { faction_id: factionId, game_id: gameId, hex_q: q, hex_r: r, last_scouted_turn: currentTurn };
  });
  await db.from('scouted_hexes').upsert(rows, { onConflict: 'faction_id,hex_q,hex_r' });
}
