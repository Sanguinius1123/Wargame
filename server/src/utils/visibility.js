// Compute which hexes a faction can currently see.
//
// Visibility rules (strategic scale):
//   - Every unit sees its own hex + all 6 adjacent hexes (distance ≤ 1).
//   - Naval units (tags includes 'naval') see water hexes at distance ≤ 2.
//   - Shoreline units (on a non-water hex adjacent to at least one water hex)
//     also see water hexes at distance ≤ 2.
//
// Returns { visible: Set<"q,r">, scouted: Set<"q,r"> }

import { hexesInRange, offsetNeighbors } from './hexGeometry.js';
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

export async function markScouted(db, factionId, gameId, visibleKeys, currentTurn) {
  if (!visibleKeys.size) return;
  const rows = [...visibleKeys].map(k => {
    const [q, r] = k.split(',').map(Number);
    return { faction_id: factionId, game_id: gameId, hex_q: q, hex_r: r, last_scouted_turn: currentTurn };
  });
  await db.from('scouted_hexes').upsert(rows, { onConflict: 'faction_id,hex_q,hex_r' });
}
