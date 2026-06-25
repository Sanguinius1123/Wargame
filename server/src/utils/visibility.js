// Compute which hexes a faction can currently see based on unit LOS ranges.
// Returns { visible: Set<"q,r">, scouted: Set<"q,r"> }
// "visible" = currently in LOS. "scouted" = ever seen (from DB), excluding currently visible.

const NEIGHBORS = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];

function key(q, r) { return `${q},${r}`; }

function hexesInRange(q, r, range) {
  const result = new Set();
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      if (Math.abs(dq + dr) <= range) result.add(key(q + dq, r + dr));
    }
  }
  return result;
}

export async function computeVisibility(db, factionId, gameId) {
  const [unitsRes, terrainRes, scoutedRes] = await Promise.all([
    db.from('units')
      .select('hex_q, hex_r, unit_type_config(los_range)')
      .eq('faction_id', factionId),
    db.from('hexes')
      .select('hex_q, hex_r, terrain, terrain_type_config(blocks_los)')
      .eq('game_id', gameId),
    db.from('scouted_hexes')
      .select('hex_q, hex_r')
      .eq('faction_id', factionId),
  ]);

  const blockingSet = new Set(
    (terrainRes.data ?? [])
      .filter(h => h.terrain_type_config?.blocks_los)
      .map(h => key(h.hex_q, h.hex_r))
  );

  const visible = new Set();

  for (const unit of unitsRes.data ?? []) {
    const range = unit.unit_type_config?.los_range ?? 2;
    const candidates = hexesInRange(unit.hex_q, unit.hex_r, range);
    for (const k of candidates) {
      if (!isBlocked(unit.hex_q, unit.hex_r, k, blockingSet)) {
        visible.add(k);
      }
    }
  }

  const scouted = new Set(
    (scoutedRes.data ?? [])
      .map(h => key(h.hex_q, h.hex_r))
      .filter(k => !visible.has(k))
  );

  return { visible, scouted };
}

// Simple LOS check: block if any intermediate hex blocks LOS.
// Uses a naive step-along-line approach — good enough for hex ranges ≤ 6.
function isBlocked(fromQ, fromR, toKey, blockingSet) {
  const [toQ, toR] = toKey.split(',').map(Number);
  if (fromQ === toQ && fromR === toR) return false;

  const steps = Math.max(Math.abs(toQ - fromQ), Math.abs(toR - fromR), Math.abs((toQ + toR) - (fromQ + fromR)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const iq = Math.round(fromQ + (toQ - fromQ) * t);
    const ir = Math.round(fromR + (toR - fromR) * t);
    if (blockingSet.has(key(iq, ir))) return true;
  }
  return false;
}

export async function markScouted(db, factionId, gameId, visibleKeys, currentTurn) {
  if (!visibleKeys.size) return;
  const rows = [...visibleKeys].map(k => {
    const [q, r] = k.split(',').map(Number);
    return { faction_id: factionId, game_id: gameId, hex_q: q, hex_r: r, last_scouted_turn: currentTurn };
  });
  await db.from('scouted_hexes').upsert(rows, { onConflict: 'faction_id,hex_q,hex_r' });
}
