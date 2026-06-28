// Compute which hexes a faction can currently see based on unit LOS ranges.
// Returns { visible: Set<"q,r">, scouted: Set<"q,r"> }
// "visible" = currently in LOS. "scouted" = ever seen (from DB), excluding currently visible.

import { hexesInRange, offsetToAxial, axialToOffset, cubeRound } from './hexGeometry.js';

function key(q, r) { return `${q},${r}`; }

export async function computeVisibility(db, factionId, gameId) {
  const [unitsRes, terrainRes, scoutedRes] = await Promise.all([
    db.from('units')
      .select('hex_q, hex_r, unit_type_config(los)')
      .eq('game_id', gameId)
      .eq('faction_id', factionId),
    db.from('hexes')
      .select('hex_q, hex_r, terrain, has_light_vegetation, has_heavy_vegetation, terrain_type_config(blocks_los)')
      .eq('game_id', gameId),
    db.from('scouted_hexes')
      .select('hex_q, hex_r')
      .eq('faction_id', factionId),
  ]);

  // Mountains block LOS; vegetation blocks LOS into-but-not-through (handled by isBlocked)
  const blockingSet = new Set(
    (terrainRes.data ?? [])
      .filter(h => h.terrain_type_config?.blocks_los || h.has_light_vegetation || h.has_heavy_vegetation)
      .map(h => key(h.hex_q, h.hex_r))
  );

  const visible = new Set();

  for (const unit of unitsRes.data ?? []) {
    const range = unit.unit_type_config?.los ?? 2;
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

// LOS check: interpolate in axial space so intermediate hexes map correctly
// to offset coords (offset interpolation produces wrong intermediate hexes).
function isBlocked(fromQ, fromR, toKey, blockingSet) {
  const [toQ, toR] = toKey.split(',').map(Number);
  if (fromQ === toQ && fromR === toR) return false;

  const fa = offsetToAxial(fromQ, fromR);
  const ta = offsetToAxial(toQ, toR);
  const dq = ta.q - fa.q, dr = ta.r - fa.r;
  const steps = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const { q: iq, r: ir } = cubeRound(fa.q + dq * t, fa.r + dr * t);
    const { q: oq, r: or_ } = axialToOffset(iq, ir);
    if (blockingSet.has(key(oq, or_))) return true;
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
