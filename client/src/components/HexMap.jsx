import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import HexGrid from './HexGrid';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

// Even-q flat-top offset neighbors (mirrors server hexGeometry.js)
function offsetNeighbors(q, r) {
  const p = ((q % 2) + 2) % 2;
  return p === 0
    ? [{q:q-1,r:r-1},{q:q-1,r},{q,r:r-1},{q,r:r+1},{q:q+1,r:r-1},{q:q+1,r}]
    : [{q:q-1,r},{q:q-1,r:r+1},{q,r:r-1},{q,r:r+1},{q:q+1,r},{q:q+1,r:r+1}];
}

// Returns true if a supply truck at `hex` has at least one legal bridge placement:
//   an adjacent water hex that itself has an adjacent land hex that is NOT
//   adjacent to the truck's hex (i.e. the bridge would actually span water).
function checkCanBuildBridge(unit, hex, hexes) {
  if (!unit?.tags?.includes('supply')) return false;
  if (hex.terrain === 'water') return false;
  const hexByKey = new Map(hexes.map(h => [`${h.hex_q},${h.hex_r}`, h]));
  const truckNeighborKeys = new Set(
    offsetNeighbors(hex.hex_q, hex.hex_r).map(n => `${n.q},${n.r}`)
  );
  for (const { q: wq, r: wr } of offsetNeighbors(hex.hex_q, hex.hex_r)) {
    const wh = hexByKey.get(`${wq},${wr}`);
    if (!wh || wh.terrain !== 'water') continue;
    for (const { q: fq, r: fr } of offsetNeighbors(wq, wr)) {
      if (fq === hex.hex_q && fr === hex.hex_r) continue;
      if (truckNeighborKeys.has(`${fq},${fr}`)) continue; // must not be adj to truck
      const fh = hexByKey.get(`${fq},${fr}`);
      if (!fh || fh.terrain === 'water') continue;
      return true;
    }
  }
  return false;
}

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token}` };
}

const PANEL_STYLE = {
  background: '#111827',
  border: '1px solid #1e293b',
  borderRadius: 8,
  padding: 16,
  overflowY: 'auto',
};

const STAT_LABEL = { color: '#64748b', fontSize: 12, marginBottom: 2 };
const STAT_VALUE = { color: '#e2e8f0', fontWeight: 600, marginBottom: 10 };

const BTN = {
  base: {
    border: 'none',
    borderRadius: 4,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  move:    { background: '#1d4ed8', color: '#e2e8f0' },
  confirm: { background: '#15803d', color: '#e2e8f0' },
  cancel:  { background: '#374151', color: '#9ca3af' },
  clear:   { background: '#7f1d1d', color: '#fca5a5' },
};

const ORDER_TYPE_LABELS = {
  move:    'Move',
  fortify: 'Fortify',
  bombard: 'Bombard',
  retreat: 'Retreat',
  pursue_if_retreat: 'Pursue if Retreat',
  repair:  'Repair',
  build:   'Build',
};

export default function HexMap({ gameId, isGM = false, viewAsFactionId = null, playerFactionId = null, faction = null, refreshKey = 0, onHexSelect = null }) {
  const [hexes, setHexes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  // Move-order state (player only)
  const [moveMode, setMoveMode] = useState(false);
  const [movePath, setMovePath] = useState([]);
  const [selectedUnit, setSelectedUnit] = useState(null);

  // Split-order state: when splitting, include split_quantity with the move order
  const [splitMode, setSplitMode] = useState(false);
  const [splitQty, setSplitQty] = useState(1);

  // Bombard-order state
  const [bombardMode, setBombardMode] = useState(false);
  const [bombardTarget, setBombardTarget] = useState(null);

  // Build-order state (Supply truck)
  const [buildMode, setBuildMode] = useState(false);
  const [buildTarget, setBuildTarget] = useState(null);
  const [buildStructureType, setBuildStructureType] = useState('');

  // Bridge-build state (Supply truck, 2-step: water hex → far land hex)
  const [bridgeBuildMode, setBridgeBuildMode] = useState(false);
  const [bridgeBuildPicks, setBridgeBuildPicks] = useState([]); // [{q,r}] len 0..2

  // Current queued orders for the selected unit
  const [currentOrders, setCurrentOrders] = useState([]);

  // Production state (player only)
  const [unitTypes, setUnitTypes] = useState([]);
  const [productionQueue, setProductionQueue] = useState([]);
  const [prodMsg, setProdMsg] = useState('');

  // Flight group state (air missions, player only)
  const [flightGroups, setFlightGroups] = useState([]);
  const [flightGroupMode, setFlightGroupMode] = useState(false);
  const [flightGroupMission, setFlightGroupMission] = useState('sweep');
  const [flightGroupPath, setFlightGroupPath] = useState([]);
  const [flightGroupTargetQ, setFlightGroupTargetQ] = useState(null);
  const [flightGroupTargetR, setFlightGroupTargetR] = useState(null);
  const [flightGroupMsg, setFlightGroupMsg] = useState('');

  const load = useCallback(async () => {
    const headers = await authHeader();
    const url = viewAsFactionId
      ? `${SERVER}/api/map/${gameId}/hexes?viewAs=${viewAsFactionId}`
      : `${SERVER}/api/map/${gameId}/hexes`;
    const r = await fetch(url, { headers });
    if (r.ok) setHexes(await r.json());
    setLoading(false);
  }, [gameId, viewAsFactionId, refreshKey]);

  const loadProduction = useCallback(async () => {
    if (isGM) return;
    const headers = await authHeader();
    const r = await fetch(`${SERVER}/api/map/${gameId}/production`, { headers });
    if (r.ok) {
      const d = await r.json();
      setUnitTypes(d.unit_types ?? []);
      setProductionQueue(d.queue ?? []);
    }
  }, [gameId, isGM, viewAsFactionId]);

  const loadFlightGroups = useCallback(async () => {
    if (isGM) return;
    const headers = await authHeader();
    const r = await fetch(`${SERVER}/api/map/${gameId}/flight-groups`, { headers });
    if (r.ok) setFlightGroups(await r.json());
  }, [gameId, isGM]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadProduction(); }, [loadProduction]);
  useEffect(() => { loadFlightGroups(); }, [loadFlightGroups]);

  // Keep detail panel in sync when hexes refresh (e.g. after GM +/- unit)
  useEffect(() => {
    if (!selected) return;
    const updated = hexes.find(h => h.hex_q === selected.hex_q && h.hex_r === selected.hex_r);
    if (updated) setSelected(updated);
  }, [hexes]);

  const selectedKey = selected ? `${selected.hex_q},${selected.hex_r}` : null;

  // Fetch orders for a given unit id; clears if null
  const fetchOrders = useCallback(async (unitId) => {
    if (!unitId) { setCurrentOrders([]); return; }
    const headers = await authHeader();
    const r = await fetch(`${SERVER}/api/map/${gameId}/orders/${unitId}`, { headers });
    if (r.ok) {
      const d = await r.json();
      setCurrentOrders(d.orders ?? []);
    } else {
      setCurrentOrders([]);
    }
  }, [gameId]);

  // Called when player clicks a hex in normal mode
  const handleSelect = useCallback((hex) => {
    setSelected(hex);
    if (onHexSelect) onHexSelect(hex);
    const isPlayerMode = !isGM || viewAsFactionId;
    if (isPlayerMode) {
      // Only auto-select units belonging to this player's faction.
      // viewAsFactionId takes precedence (GM acting as a player).
      // playerFactionId is the real player's own faction.
      // Without either, fall back to first unit (shouldn't happen in practice).
      const ownFactionId = viewAsFactionId ?? playerFactionId;
      let unit = null;
      if (ownFactionId) {
        unit = hex.units?.find(u => u.factionId === ownFactionId) ?? null;
      } else {
        unit = hex.units?.[0] ?? null;
      }
      setSelectedUnit(unit);
      setMoveMode(false);
      setMovePath([]);
      setBombardMode(false);
      setBombardTarget(null);
      setBuildMode(false);
      setBuildTarget(null);
      setBuildStructureType('');
      setBridgeBuildMode(false);
      setBridgeBuildPicks([]);
      setFlightGroupMode(false);
      setFlightGroupPath([]);
      setFlightGroupTargetQ(null);
      setFlightGroupTargetR(null);
      setCurrentOrders([]);
      fetchOrders(unit?.id ?? null);
    }
  }, [isGM, viewAsFactionId, fetchOrders, onHexSelect]);

  // Called when a hex is clicked during move, bombard, build, or bridgeBuild mode
  const handleModeClick = useCallback((hex) => {
    if (flightGroupMode) {
      const needsTarget = ['bombing_run', 'attack_run'].includes(flightGroupMission);
      // First click sets target (if needed), subsequent clicks build the path
      if (needsTarget && flightGroupTargetQ === null) {
        setFlightGroupTargetQ(hex.hex_q);
        setFlightGroupTargetR(hex.hex_r);
      } else {
        setFlightGroupPath(prev => [...prev, { q: hex.hex_q, r: hex.hex_r }]);
      }
    } else if (moveMode) {
      setMovePath(prev => [...prev, { q: hex.hex_q, r: hex.hex_r }]);
    } else if (bombardMode) {
      setBombardTarget({ q: hex.hex_q, r: hex.hex_r });
    } else if (buildMode) {
      setBuildTarget({ q: hex.hex_q, r: hex.hex_r });
    } else if (bridgeBuildMode && selected) {
      const truckQ = selected.hex_q, truckR = selected.hex_r;
      const hexByKey = new Map(hexes.map(h => [`${h.hex_q},${h.hex_r}`, h]));
      const clicked = hexByKey.get(`${hex.hex_q},${hex.hex_r}`);
      if (!clicked) return;

      if (bridgeBuildPicks.length === 0) {
        // Step 1: must be a water hex adjacent to the truck
        if (clicked.terrain !== 'water') return;
        const adjKeys = new Set(offsetNeighbors(truckQ, truckR).map(n => `${n.q},${n.r}`));
        if (!adjKeys.has(`${hex.hex_q},${hex.hex_r}`)) return;
        setBridgeBuildPicks([{ q: hex.hex_q, r: hex.hex_r }]);
      } else if (bridgeBuildPicks.length === 1) {
        // Step 2: must be a non-water hex adjacent to the water pick but NOT adjacent to truck
        if (clicked.terrain === 'water') return;
        const waterPick = bridgeBuildPicks[0];
        const waterAdjKeys = new Set(offsetNeighbors(waterPick.q, waterPick.r).map(n => `${n.q},${n.r}`));
        if (!waterAdjKeys.has(`${hex.hex_q},${hex.hex_r}`)) return;
        const truckAdjKeys = new Set(offsetNeighbors(truckQ, truckR).map(n => `${n.q},${n.r}`));
        if (truckAdjKeys.has(`${hex.hex_q},${hex.hex_r}`)) return; // adjacent to truck — invalid
        if (hex.hex_q === truckQ && hex.hex_r === truckR) return;
        setBridgeBuildPicks([waterPick, { q: hex.hex_q, r: hex.hex_r }]);
      }
    }
  }, [flightGroupMode, flightGroupMission, flightGroupTargetQ, moveMode, bombardMode, buildMode, bridgeBuildMode, bridgeBuildPicks, selected, hexes]);

  const enterMoveMode = useCallback(() => {
    if (!selectedUnit) return;
    // Seed path with unit's current hex
    const startHex = selected;
    if (startHex) {
      setMovePath([{ q: startHex.hex_q, r: startHex.hex_r }]);
    } else {
      setMovePath([]);
    }
    setCurrentOrders([]);
    setMoveMode(true);
  }, [selectedUnit, selected]);

  const cancelMove = useCallback(() => {
    setMoveMode(false);
    setMovePath([]);
    fetchOrders(selectedUnit?.id ?? null);
  }, [selectedUnit, fetchOrders]);

  const confirmMove = useCallback(async () => {
    if (!selectedUnit || movePath.length < 2) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: selectedUnit.id,
        path: movePath,
        ...(splitMode && splitQty > 0 ? { split_quantity: splitQty } : {}),
        ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
      }),
    });
    setMoveMode(false);
    setMovePath([]);
    setSplitMode(false);
    setSplitQty(1);
    setCurrentOrders([]);
    setSelectedUnit(null);
    setSelected(null);
    load();
  }, [selectedUnit, movePath, splitMode, splitQty, gameId, viewAsFactionId, load]);

  const enterSplitMode = useCallback(() => {
    if (!selectedUnit || !selectedUnit.quantity || selectedUnit.quantity <= 1) return;
    setSplitMode(true);
    setSplitQty(1);
  }, [selectedUnit]);

  const cancelSplit = useCallback(() => {
    setSplitMode(false);
    setSplitQty(1);
    setMoveMode(false);
    setMovePath([]);
  }, []);

  const enterBombardMode = useCallback(() => {
    if (!selectedUnit) return;
    setBombardMode(true);
    setBombardTarget(null);
    setCurrentOrders([]);
  }, [selectedUnit]);

  const cancelBombard = useCallback(() => {
    setBombardMode(false);
    setBombardTarget(null);
    fetchOrders(selectedUnit?.id ?? null);
  }, [selectedUnit, fetchOrders]);

  const confirmBombard = useCallback(async () => {
    if (!selectedUnit || !bombardTarget) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: selectedUnit.id,
        order_type: 'bombard',
        target_hex_q: bombardTarget.q,
        target_hex_r: bombardTarget.r,
        ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
      }),
    });
    setBombardMode(false);
    setBombardTarget(null);
    await fetchOrders(selectedUnit.id);
  }, [selectedUnit, bombardTarget, gameId, viewAsFactionId, fetchOrders]);

  const retreatUnit = useCallback(async () => {
    if (!selectedUnit) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: selectedUnit.id,
        order_type: 'retreat',
        ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
      }),
    });
    await fetchOrders(selectedUnit.id);
  }, [selectedUnit, gameId, viewAsFactionId, fetchOrders]);

  const pursueUnit = useCallback(async () => {
    if (!selectedUnit) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: selectedUnit.id,
        order_type: 'pursue_if_retreat',
        ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
      }),
    });
    await fetchOrders(selectedUnit.id);
  }, [selectedUnit, gameId, viewAsFactionId, fetchOrders]);

  const clearOrders = useCallback(async () => {
    if (!selectedUnit) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/orders/${selectedUnit.id}`, {
      method: 'DELETE',
      headers,
    });
    setMoveMode(false);
    setMovePath([]);
    setCurrentOrders([]);
    load();
  }, [selectedUnit, gameId, load]);

  const fortifyUnit = useCallback(async () => {
    if (!selectedUnit) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: selectedUnit.id,
        order_type: 'fortify',
        ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
      }),
    });
    await fetchOrders(selectedUnit.id);
  }, [selectedUnit, gameId, viewAsFactionId, fetchOrders]);

  const setPatrolOrder = useCallback(async (patrolValue) => {
    if (!selectedUnit) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/units/${selectedUnit.id}/standing-order`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ standing_order: patrolValue }),
    });
    await load();
  }, [selectedUnit, gameId, load]);

  const repairUnit = useCallback(async () => {
    if (!selectedUnit) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: selectedUnit.id,
        order_type: 'repair',
        ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
      }),
    });
    await fetchOrders(selectedUnit.id);
  }, [selectedUnit, gameId, viewAsFactionId, fetchOrders]);

  const enterBuildMode = useCallback((structureType) => {
    if (!selectedUnit || !structureType) return;
    setBuildStructureType(structureType);
    setBuildTarget(null);
    setBuildMode(true);
    setCurrentOrders([]);
  }, [selectedUnit]);

  const cancelBuild = useCallback(() => {
    setBuildMode(false);
    setBuildTarget(null);
    setBuildStructureType('');
    fetchOrders(selectedUnit?.id ?? null);
  }, [selectedUnit, fetchOrders]);

  const confirmBuild = useCallback(async () => {
    if (!selectedUnit || !buildStructureType || !buildTarget) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: selectedUnit.id,
        order_type: 'build',
        target_hex_q: buildTarget.q,
        target_hex_r: buildTarget.r,
        structure_type: buildStructureType,
        ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
      }),
    });
    setBuildMode(false);
    setBuildTarget(null);
    setBuildStructureType('');
    await fetchOrders(selectedUnit.id);
  }, [selectedUnit, buildStructureType, buildTarget, gameId, viewAsFactionId, fetchOrders]);

  const enterBridgeBuildMode = useCallback(() => {
    if (!selectedUnit) return;
    setBridgeBuildMode(true);
    setBridgeBuildPicks([]);
    setCurrentOrders([]);
  }, [selectedUnit]);

  const cancelBridgeBuild = useCallback(() => {
    setBridgeBuildMode(false);
    setBridgeBuildPicks([]);
    fetchOrders(selectedUnit?.id ?? null);
  }, [selectedUnit, fetchOrders]);

  const confirmBridgeBuild = useCallback(async () => {
    if (!selectedUnit || bridgeBuildPicks.length !== 2) return;
    const [waterPick, farPick] = bridgeBuildPicks;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: selectedUnit.id,
        order_type: 'build',
        structure_type: 'bridge',
        target_hex_q: waterPick.q,
        target_hex_r: waterPick.r,
        to_hex_q: farPick.q,
        to_hex_r: farPick.r,
        ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
      }),
    });
    setBridgeBuildMode(false);
    setBridgeBuildPicks([]);
    await fetchOrders(selectedUnit.id);
  }, [selectedUnit, bridgeBuildPicks, gameId, viewAsFactionId, fetchOrders]);

  const enterFlightGroupMode = useCallback((missionType) => {
    if (!selectedUnit) return;
    setFlightGroupMission(missionType);
    setFlightGroupPath([]);
    setFlightGroupTargetQ(null);
    setFlightGroupTargetR(null);
    setFlightGroupMsg('');
    setFlightGroupMode(true);
  }, [selectedUnit]);

  const cancelFlightGroup = useCallback(() => {
    setFlightGroupMode(false);
    setFlightGroupPath([]);
    setFlightGroupTargetQ(null);
    setFlightGroupTargetR(null);
    setFlightGroupMsg('');
  }, []);

  const confirmFlightGroup = useCallback(async () => {
    if (!selectedUnit) return;
    const needsTarget = ['bombing_run', 'attack_run'].includes(flightGroupMission);
    if (needsTarget && (flightGroupTargetQ === null)) {
      setFlightGroupMsg('Pick a target hex first.');
      return;
    }
    if (!flightGroupPath.length) {
      setFlightGroupMsg('Draw a flight path on the map first.');
      return;
    }
    const headers = await authHeader();
    const body = {
      mission_type: flightGroupMission,
      path: flightGroupPath,
      unit_ids: [selectedUnit.id],
      ...(needsTarget ? { target_hex_q: flightGroupTargetQ, target_hex_r: flightGroupTargetR } : {}),
    };
    const r = await fetch(`${SERVER}/api/map/${gameId}/flight-groups`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      setFlightGroupMode(false);
      setFlightGroupPath([]);
      setFlightGroupTargetQ(null);
      setFlightGroupTargetR(null);
      setFlightGroupMsg('Mission planned.');
      await loadFlightGroups();
    } else {
      const d = await r.json();
      setFlightGroupMsg(d.error ?? 'Failed to create flight group.');
    }
  }, [selectedUnit, flightGroupMission, flightGroupPath, flightGroupTargetQ, flightGroupTargetR, gameId, loadFlightGroups]);

  const cancelFlightGroupById = useCallback(async (groupId) => {
    const headers = await authHeader();
    const r = await fetch(`${SERVER}/api/map/${gameId}/flight-groups/${groupId}`, { method: 'DELETE', headers });
    if (r.ok) await loadFlightGroups();
  }, [gameId, loadFlightGroups]);

  const orderProduction = useCallback(async (unitTypeName, qty, factoryQ, factoryR) => {
    setProdMsg('');
    const headers = await authHeader();
    const r = await fetch(`${SERVER}/api/map/${gameId}/production`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit_type_name: unitTypeName, factory_hex_q: factoryQ, factory_hex_r: factoryR, quantity: qty }),
    });
    if (r.ok) {
      setProdMsg(`Ordered ${qty}× ${unitTypeName}.`);
      await loadProduction();
    } else {
      const d = await r.json();
      setProdMsg(d.error ?? 'Order failed.');
    }
  }, [gameId, loadProduction]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12, height: '100%' }}>
      {/* Map */}
      <div style={{ background: '#080d15', borderRadius: 8, overflow: 'hidden', height: 'calc(100vh - 180px)', minHeight: 500, position: 'relative' }}>
        {loading
          ? <p style={{ color: '#64748b', padding: 24 }}>Loading map…</p>
          : <HexGrid
              hexes={hexes}
              onSelect={handleSelect}
              panZoom
              selectedKey={selectedKey}
              moveMode={moveMode}
              movePath={movePath}
              bombardMode={bombardMode}
              bombardTargetKey={bombardTarget ? `${bombardTarget.q},${bombardTarget.r}` : null}
              buildMode={buildMode || bridgeBuildMode || flightGroupMode}
              buildTargetKey={
                buildTarget ? `${buildTarget.q},${buildTarget.r}` :
                (flightGroupTargetQ !== null ? `${flightGroupTargetQ},${flightGroupTargetR}` : null)
              }
              onPathClick={handleModeClick}
            />
        }
      </div>

      {/* Detail panel */}
      <div style={PANEL_STYLE}>
        {selected
          ? <HexDetail
              hex={selected}
              hexes={hexes}
              isGM={isGM && !viewAsFactionId}
              viewingAsFaction={!!viewAsFactionId}
              gameId={gameId}
              onRefresh={load}
              selectedUnit={selectedUnit}
              moveMode={moveMode}
              movePath={movePath}
              bombardMode={bombardMode}
              bombardTarget={bombardTarget}
              buildMode={buildMode}
              buildTarget={buildTarget}
              buildStructureType={buildStructureType}
              bridgeBuildMode={bridgeBuildMode}
              bridgeBuildPicks={bridgeBuildPicks}
              onEnterMoveMode={enterMoveMode}
              onConfirmMove={confirmMove}
              onCancelMove={cancelMove}
              onEnterBombardMode={enterBombardMode}
              onConfirmBombard={confirmBombard}
              onCancelBombard={cancelBombard}
              onEnterBuildMode={enterBuildMode}
              onConfirmBuild={confirmBuild}
              onCancelBuild={cancelBuild}
              onEnterBridgeBuildMode={enterBridgeBuildMode}
              onConfirmBridgeBuild={confirmBridgeBuild}
              onCancelBridgeBuild={cancelBridgeBuild}
              onClearOrders={clearOrders}
              onFortify={fortifyUnit}
              onRetreat={retreatUnit}
              onPursue={pursueUnit}
              onRepair={repairUnit}
              currentOrders={currentOrders}
              playerFactionId={viewAsFactionId ?? playerFactionId}
              faction={faction}
              unitTypes={unitTypes}
              productionQueue={productionQueue}
              prodMsg={prodMsg}
              onOrderProduction={orderProduction}
              flightGroups={flightGroups}
              flightGroupMode={flightGroupMode}
              flightGroupMission={flightGroupMission}
              flightGroupPath={flightGroupPath}
              flightGroupTargetQ={flightGroupTargetQ}
              flightGroupTargetR={flightGroupTargetR}
              flightGroupMsg={flightGroupMsg}
              onEnterFlightGroupMode={enterFlightGroupMode}
              onConfirmFlightGroup={confirmFlightGroup}
              onCancelFlightGroup={cancelFlightGroup}
              onCancelFlightGroupById={cancelFlightGroupById}
              onSetPatrol={setPatrolOrder}
            />
          : <p style={{ color: '#64748b', fontSize: 13 }}>Click a hex to inspect it.</p>}
      </div>
    </div>
  );
}

function Tag({ label, color }) {
  return (
    <span style={{ background: '#1e293b', border: `1px solid ${color}`, borderRadius: 4, padding: '2px 6px', fontSize: 11, color }}>
      {label}
    </span>
  );
}

function HexDetail({
  hex,
  hexes = [],
  isGM,
  viewingAsFaction,
  gameId,
  onRefresh,
  selectedUnit,
  moveMode,
  movePath,
  bombardMode,
  bombardTarget,
  buildMode,
  buildTarget,
  buildStructureType,
  bridgeBuildMode,
  bridgeBuildPicks,
  onEnterMoveMode,
  onConfirmMove,
  onCancelMove,
  onEnterBombardMode,
  onConfirmBombard,
  onCancelBombard,
  onEnterBuildMode,
  onConfirmBuild,
  onCancelBuild,
  onEnterBridgeBuildMode,
  onConfirmBridgeBuild,
  onCancelBridgeBuild,
  onClearOrders,
  onFortify,
  onRetreat,
  onPursue,
  onRepair,
  currentOrders,
  playerFactionId = null,
  faction = null,
  unitTypes = [],
  productionQueue = [],
  prodMsg = '',
  onOrderProduction,
  flightGroups = [],
  flightGroupMode = false,
  flightGroupMission = 'sweep',
  flightGroupPath = [],
  flightGroupTargetQ = null,
  flightGroupTargetR = null,
  flightGroupMsg = '',
  onEnterFlightGroupMode,
  onConfirmFlightGroup,
  onCancelFlightGroup,
  onCancelFlightGroupById,
  onSetPatrol,
}) {
  const vis = hex.visibility ?? 'visible';

  if (vis === 'dark') {
    return <p style={{ color: '#64748b', fontSize: 13 }}>Unexplored territory.</p>;
  }

  const unitsByFaction = {};
  for (const u of hex.units ?? []) {
    const k = u.factionName ?? 'Unknown';
    if (!unitsByFaction[k]) unitsByFaction[k] = { color: u.factionColor, units: [] };
    unitsByFaction[k].units.push(u);
  }

  // Determine if hex is contested (units from 2+ factions)
  const factionIds = [...new Set((hex.units ?? []).map(u => u.factionId))];
  const isContested = factionIds.length >= 2;

  // Repair eligibility: does this hex have the right facility for the selected unit?
  const hasHarbor = hex.buildings?.some(b => b.type === 'harbor' && b.current_hp >= 1);
  const hasAirbase = hex.buildings?.some(b => b.type === 'airbase' && b.current_hp >= 1);
  const unitTags = selectedUnit?.tags ?? [];
  const hasRepairFacility = (unitTags.includes('naval') && hasHarbor) || (unitTags.includes('air') && hasAirbase);

  const canBuildBridge = checkCanBuildBridge(selectedUnit, hex, hexes);

  return (
    <div>
      <p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 8 }}>
        Hex ({hex.hex_q}, {hex.hex_r}) · {vis === 'scouted' ? 'scouted' : 'visible'}
      </p>

      {/* Locked in combat banner */}
      {isContested && (
        <div style={{
          background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 4,
          padding: '4px 8px', marginBottom: 8, color: '#fca5a5', fontSize: 12, fontWeight: 700,
        }}>
          ⚠ LOCKED IN COMBAT — only Retreat or Pursue orders valid
        </div>
      )}

      <p style={STAT_LABEL}>Terrain</p>
      <p style={STAT_VALUE}>{hex.terrain ?? '—'}</p>

      {vis === 'visible' && (
        <>
          {/* Hex attributes */}
          {(hex.has_settlement || hex.has_urban || hex.has_light_vegetation || hex.has_heavy_vegetation || hex.has_road || hex.has_canal || hex.resource_tile) && (
            <div style={{ marginBottom: 10 }}>
              <p style={STAT_LABEL}>Attributes</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {hex.has_settlement && <Tag label="Settlement" color="#fbbf24" />}
                {hex.has_urban && <Tag label={`Urban HP ${hex.urban_hp ?? 4}/4`} color="#a78bfa" />}
                {hex.has_heavy_vegetation && <Tag label="Dense Forest" color="#22c55e" />}
                {hex.has_light_vegetation && !hex.has_heavy_vegetation && <Tag label="Light Forest" color="#86efac" />}
                {hex.has_road && <Tag label="Road" color="#94a3b8" />}
                {hex.has_canal && <Tag label="Canal" color="#38bdf8" />}
                {hex.resource_tile && <Tag label={`Resource (${hex.resource_tile.tile_type})`} color="#f59e0b" />}
              </div>
            </div>
          )}

          {/* Buildings */}
          {hex.buildings?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <p style={STAT_LABEL}>Buildings</p>
              {hex.buildings.map((b, i) => {
                const pct = b.current_hp / b.max_hp;
                const color = pct >= 1 ? '#22c55e' : pct >= 0.5 ? '#f59e0b' : '#ef4444';
                return (
                  <p key={i} style={{ color, fontSize: 12, marginBottom: 2 }}>
                    {b.type.charAt(0).toUpperCase() + b.type.slice(1)} {b.current_hp}/{b.max_hp} HP
                  </p>
                );
              })}
            </div>
          )}

          {/* Production panel — player's own operational factory (not in viewAs mode) */}
          {!isGM && !viewingAsFaction && playerFactionId && (() => {
            const factory = hex.buildings?.find(
              b => b.type === 'factory' && b.owner_faction_id === playerFactionId && b.current_hp === b.max_hp
            );
            if (!factory) return null;
            return (
              <ProductionPanel
                factoryQ={hex.hex_q}
                factoryR={hex.hex_r}
                factory={factory}
                unitTypes={unitTypes}
                queue={productionQueue.filter(q => q.factory_hex_q === hex.hex_q && q.factory_hex_r === hex.hex_r)}
                faction={faction}
                msg={prodMsg}
                onOrder={onOrderProduction}
              />
            );
          })()}

          {/* Units by faction */}
          {Object.entries(unitsByFaction).map(([fname, { color, units }]) => (
            <div key={fname} style={{ marginBottom: 10 }}>
              <p style={{ ...STAT_LABEL, color: color ?? '#60a5fa' }}>{fname}</p>
              {units.map((u, i) => (
                isGM
                  ? <GMUnitRow key={u.id ?? i} unit={u} gameId={gameId} onRefresh={onRefresh} />
                  : <p key={u.id ?? i} style={{ color: '#e2e8f0', fontSize: 13 }}>
                      {u.type}{u.hp != null ? ` ${u.hp}HP` : ` ×${u.quantity}`}
                    </p>
              ))}
            </div>
          ))}

          {Object.keys(unitsByFaction).length === 0 && (
            <p style={{ color: '#4b5563', fontSize: 13 }}>No units</p>
          )}

          {/* Order panel — players and GM-acting-as-player, when a unit is selected */}
          {(!isGM || viewingAsFaction) && selectedUnit && (
            <OrderPanel
              unit={selectedUnit}
              moveMode={moveMode}
              movePath={movePath}
              bombardMode={bombardMode}
              bombardTarget={bombardTarget}
              buildMode={buildMode}
              buildTarget={buildTarget}
              buildStructureType={buildStructureType}
              bridgeBuildMode={bridgeBuildMode}
              bridgeBuildPicks={bridgeBuildPicks}
              canBuildBridge={canBuildBridge}
              onEnterMoveMode={onEnterMoveMode}
              onConfirmMove={onConfirmMove}
              onCancelMove={onCancelMove}
              onEnterBombardMode={onEnterBombardMode}
              onConfirmBombard={onConfirmBombard}
              onCancelBombard={onCancelBombard}
              onEnterBuildMode={onEnterBuildMode}
              onConfirmBuild={onConfirmBuild}
              onCancelBuild={onCancelBuild}
              onEnterBridgeBuildMode={onEnterBridgeBuildMode}
              onConfirmBridgeBuild={onConfirmBridgeBuild}
              onCancelBridgeBuild={onCancelBridgeBuild}
              onClearOrders={onClearOrders}
              onFortify={onFortify}
              onRetreat={onRetreat}
              onPursue={onPursue}
              onRepair={onRepair}
              currentOrders={currentOrders}
              isContested={isContested}
              hasRepairFacility={hasRepairFacility}
              onSetPatrol={onSetPatrol}
              splitMode={splitMode}
              splitQty={splitQty}
              onEnterSplitMode={enterSplitMode}
              onCancelSplit={cancelSplit}
              onSplitQtyChange={setSplitQty}
            />
          )}

          {/* Flight group panel (players only, air units) */}
          {(!isGM || viewingAsFaction) && (
            <FlightGroupPanel
              selectedUnit={selectedUnit}
              flightGroups={flightGroups}
              flightGroupMode={flightGroupMode}
              flightGroupMission={flightGroupMission}
              flightGroupPath={flightGroupPath}
              flightGroupTargetQ={flightGroupTargetQ}
              flightGroupTargetR={flightGroupTargetR}
              flightGroupMsg={flightGroupMsg}
              onEnterFlightGroupMode={onEnterFlightGroupMode}
              onConfirmFlightGroup={onConfirmFlightGroup}
              onCancelFlightGroup={onCancelFlightGroup}
              onCancelFlightGroupById={onCancelFlightGroupById}
            />
          )}

          {/* GM hex editor (terrain/attributes) + building editor */}
          {isGM && (
            <>
              <GMHexEditor hex={hex} gameId={gameId} onRefresh={onRefresh} />
              <GMBuildingEditor hex={hex} gameId={gameId} onRefresh={onRefresh} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// GM unit row: shows unit with quantity controls (+/−/remove)
function GMUnitRow({ unit, gameId, onRefresh }) {
  const [busy, setBusy] = useState(false);

  async function adjust(delta) {
    setBusy(true);
    const headers = await authHeader();
    await fetch(`${SERVER}/api/gm/${gameId}/units/${unit.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity_delta: delta }),
    });
    setBusy(false);
    onRefresh();
  }

  async function remove() {
    setBusy(true);
    const headers = await authHeader();
    await fetch(`${SERVER}/api/gm/${gameId}/units/${unit.id}`, { method: 'DELETE', headers });
    setBusy(false);
    onRefresh();
  }

  const qtyDisplay = unit.hp != null ? `${unit.hp}HP` : `×${unit.quantity}`;
  const btnS = { border: 'none', borderRadius: 3, padding: '2px 7px', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
      <span style={{ color: '#e2e8f0', fontSize: 13, flex: 1 }}>{unit.type} {qtyDisplay}</span>
      {unit.hp == null && <>
        <button style={{ ...btnS, background: '#1e3a5f', color: '#93c5fd' }} disabled={busy} onClick={() => adjust(1)} title="Add 1">+</button>
        <button style={{ ...btnS, background: '#1e293b', color: '#94a3b8' }} disabled={busy} onClick={() => adjust(-1)} title="Remove 1">−</button>
      </>}
      <button style={{ ...btnS, background: '#7f1d1d', color: '#fca5a5' }} disabled={busy} onClick={remove} title="Remove all">✕</button>
    </div>
  );
}

const TERRAINS = ['plains', 'hills', 'mountains', 'desert', 'wetlands', 'water'];

function GMHexEditor({ hex, gameId, onRefresh }) {
  const [form, setForm] = useState({
    terrain:              hex.terrain ?? 'plains',
    has_settlement:       hex.has_settlement ?? false,
    has_urban:            hex.has_urban ?? false,
    urban_hp:             hex.urban_hp ?? 4,
    has_light_vegetation: hex.has_light_vegetation ?? false,
    has_heavy_vegetation: hex.has_heavy_vegetation ?? false,
    has_road:             hex.has_road ?? false,
    has_canal:            hex.has_canal ?? false,
    has_railroad:         hex.has_railroad ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Reset form when selected hex changes
  useEffect(() => {
    setForm({
      terrain:              hex.terrain ?? 'plains',
      has_settlement:       hex.has_settlement ?? false,
      has_urban:            hex.has_urban ?? false,
      urban_hp:             hex.urban_hp ?? 4,
      has_light_vegetation: hex.has_light_vegetation ?? false,
      has_heavy_vegetation: hex.has_heavy_vegetation ?? false,
      has_road:             hex.has_road ?? false,
      has_canal:            hex.has_canal ?? false,
      has_railroad:         hex.has_railroad ?? false,
    });
    setMsg('');
  }, [hex.hex_q, hex.hex_r]);

  async function save() {
    setSaving(true);
    const headers = await authHeader();
    const r = await fetch(`${SERVER}/api/map/${gameId}/hexes/${hex.hex_q}/${hex.hex_r}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (r.ok) { setMsg('Saved.'); onRefresh(); } else { const d = await r.json(); setMsg(d.error ?? 'Error'); }
  }

  const chk = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.checked }));
  const inp  = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const iStyle = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 3, padding: '4px 6px', color: '#e2e8f0', fontSize: 12, width: '100%', boxSizing: 'border-box' };
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 };
  const lbl = { color: '#94a3b8', fontSize: 12 };

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #1e293b', paddingTop: 12 }}>
      <p style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>GM — Edit Hex</p>

      <div style={{ marginBottom: 8 }}>
        <div style={lbl}>Terrain</div>
        <select style={iStyle} value={form.terrain} onChange={inp('terrain')}>
          {TERRAINS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {[
        ['has_settlement',       'Settlement'],
        ['has_urban',            'Urban tile'],
        ['has_light_vegetation', 'Light vegetation'],
        ['has_heavy_vegetation', 'Heavy vegetation'],
        ['has_road',             'Road'],
        ['has_canal',            'Canal'],
        ['has_railroad',         'Railroad'],
      ].map(([key, label]) => (
        <div key={key} style={rowStyle}>
          <input type="checkbox" checked={form[key]} onChange={chk(key)} id={key} />
          <label htmlFor={key} style={lbl}>{label}</label>
        </div>
      ))}

      {form.has_urban && (
        <div style={{ marginBottom: 8 }}>
          <div style={lbl}>Urban HP (0–4)</div>
          <input type="number" min={0} max={4} style={iStyle} value={form.urban_hp} onChange={inp('urban_hp')} />
        </div>
      )}

      <button
        onClick={save}
        disabled={saving}
        style={{ background: '#2563eb', border: 'none', borderRadius: 4, padding: '5px 14px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: saving ? 'default' : 'pointer', marginTop: 4 }}
      >
        {saving ? 'Saving…' : 'Save Hex'}
      </button>
      {msg && <p style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>{msg}</p>}
    </div>
  );
}

const BUILD_STRUCTURES = [
  { value: 'fortification', label: 'Fortification (+1 def, 4 HP)' },
  { value: 'airstrip',      label: 'Airstrip (4 HP)' },
  { value: 'road',          label: 'Road segment' },
  { value: 'canal',         label: 'Canal (10 manpower)' },
];

function OrderPanel({
  unit,
  moveMode,
  movePath,
  bombardMode,
  bombardTarget,
  buildMode,
  buildTarget,
  buildStructureType,
  bridgeBuildMode,
  bridgeBuildPicks,
  canBuildBridge,
  onEnterMoveMode,
  onConfirmMove,
  onCancelMove,
  onEnterBombardMode,
  onConfirmBombard,
  onCancelBombard,
  onEnterBuildMode,
  onConfirmBuild,
  onCancelBuild,
  onEnterBridgeBuildMode,
  onConfirmBridgeBuild,
  onCancelBridgeBuild,
  onClearOrders,
  onFortify,
  onRetreat,
  onPursue,
  onRepair,
  currentOrders,
  isContested,
  hasRepairFacility = false,
  onSetPatrol,
  splitMode = false,
  splitQty = 1,
  onEnterSplitMode,
  onCancelSplit,
  onSplitQtyChange,
}) {
  const [pendingBuildType, setPendingBuildType] = useState('');

  const hasPath = movePath.length >= 2;
  const moveSteps = currentOrders.filter(o => o.order_type === 'move').length;
  const canBombard = unit.bombard_to_hit != null || unit.bombard_range != null;
  const isSupply = unit.tags?.includes('supply');
  const hasHp = unit.hp != null;

  // Build a summary list of queued order types (deduplicated for non-move orders)
  const orderSummary = [];
  if (moveSteps > 0) {
    orderSummary.push(`Move (${moveSteps} step${moveSteps !== 1 ? 's' : ''})`);
  }
  const nonMoveTypes = [...new Set(
    currentOrders.filter(o => o.order_type !== 'move').map(o => o.order_type)
  )];
  for (const t of nonMoveTypes) {
    orderSummary.push(ORDER_TYPE_LABELS[t] ?? t);
  }

  const inAnyMode = moveMode || bombardMode || buildMode || bridgeBuildMode || splitMode;

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #1e293b', paddingTop: 12 }}>
      {/* Selected unit info */}
      <div style={{ marginBottom: 10 }}>
        <p style={STAT_LABEL}>Selected Unit</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: unit.factionColor ?? '#60a5fa',
            display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{unit.type}</span>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>
            {hasHp ? `${unit.hp} HP` : `×${unit.quantity}`}
          </span>
        </div>
        {unit.standing_order && <Tag label={unit.standing_order} color="#6366f1" />}
      </div>

      {/* Queued orders display */}
      {!inAnyMode && orderSummary.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <p style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>Queued orders:</p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {orderSummary.map((label, i) => (
              <li key={i} style={{ color: '#94a3b8', fontSize: 12, marginBottom: 2 }}>• {label}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Contested notice */}
      {isContested && !inAnyMode && (
        <p style={{ color: '#fca5a5', fontSize: 11, marginBottom: 8 }}>
          Locked in combat — use Retreat or Pursue if Retreat.
        </p>
      )}

      {/* Split mode — choose how many units to split off, then enter move mode */}
      {splitMode && !moveMode && (
        <div>
          <p style={{ color: '#fbbf24', fontSize: 11, marginBottom: 8 }}>
            Split off units: enter count, then plot their move path.
          </p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Units to split:</span>
            <input
              type="number" min={1} max={unit.quantity - 1}
              value={splitQty}
              onChange={e => onSplitQtyChange(Math.min(Math.max(1, parseInt(e.target.value) || 1), unit.quantity - 1))}
              style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 3, padding: '3px 6px', color: '#e2e8f0', fontSize: 12, width: 52 }}
            />
            <span style={{ color: '#64748b', fontSize: 11 }}>of {unit.quantity}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...BTN.base, ...BTN.move }} onClick={onEnterMoveMode} title="Plot the move path for the split-off group">
              Move Split Group…
            </button>
            <button style={{ ...BTN.base, ...BTN.cancel }} onClick={onCancelSplit}>Cancel</button>
          </div>
        </div>
      )}

      {/* Move mode */}
      {moveMode && (
        <div>
          <p style={{ color: '#fbbf24', fontSize: 11, marginBottom: 8 }}>
            {splitMode
              ? `Splitting ${splitQty} of ${unit.quantity} — click hexes to plot path.`
              : `Click hexes to add waypoints — ${movePath.length - 1} step${movePath.length !== 2 ? 's' : ''} plotted.`}
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...BTN.base, ...BTN.confirm, opacity: hasPath ? 1 : 0.5 }} disabled={!hasPath} onClick={onConfirmMove}>
              {splitMode ? 'Confirm Split' : 'Confirm Move'}
            </button>
            <button style={{ ...BTN.base, ...BTN.cancel }} onClick={splitMode ? onCancelSplit : onCancelMove}>Cancel</button>
          </div>
        </div>
      )}

      {/* Bombard mode */}
      {bombardMode && (
        <div>
          <p style={{ color: '#fb923c', fontSize: 11, marginBottom: 8 }}>
            Click the target hex to bombard.{bombardTarget ? ` Target: (${bombardTarget.q}, ${bombardTarget.r})` : ''}
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{ ...BTN.base, background: '#c2410c', color: '#fff', opacity: bombardTarget ? 1 : 0.5 }}
              disabled={!bombardTarget}
              onClick={onConfirmBombard}
              title="Confirm Bombard: Unit will remain stationary and fire indirect bombardment at the target hex this turn."
            >
              Confirm Bombard
            </button>
            <button style={{ ...BTN.base, ...BTN.cancel }} onClick={onCancelBombard}>Cancel</button>
          </div>
        </div>
      )}

      {/* Build mode (Supply truck) */}
      {buildMode && (
        <div>
          <p style={{ color: '#34d399', fontSize: 11, marginBottom: 8 }}>
            Building: <strong style={{ color: '#e2e8f0' }}>{buildStructureType}</strong>.
            Click target hex on the map.{buildTarget ? ` → (${buildTarget.q}, ${buildTarget.r})` : ''}
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{ ...BTN.base, background: '#065f46', color: '#6ee7b7', opacity: buildTarget ? 1 : 0.5 }}
              disabled={!buildTarget}
              onClick={onConfirmBuild}
            >
              Confirm Build
            </button>
            <button style={{ ...BTN.base, ...BTN.cancel }} onClick={onCancelBuild}>Cancel</button>
          </div>
        </div>
      )}

      {/* Bridge build mode */}
      {bridgeBuildMode && (
        <div>
          <p style={{ color: '#34d399', fontSize: 11, marginBottom: 6 }}>
            {bridgeBuildPicks.length === 0 && 'Step 1/2 — click the water hex to cross.'}
            {bridgeBuildPicks.length === 1 && `Step 2/2 — click the far land hex. Water: (${bridgeBuildPicks[0].q},${bridgeBuildPicks[0].r})`}
            {bridgeBuildPicks.length === 2 && `Ready: (${bridgeBuildPicks[0].q},${bridgeBuildPicks[0].r}) → (${bridgeBuildPicks[1].q},${bridgeBuildPicks[1].r})`}
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{ ...BTN.base, background: '#065f46', color: '#6ee7b7', opacity: bridgeBuildPicks.length === 2 ? 1 : 0.4 }}
              disabled={bridgeBuildPicks.length !== 2}
              onClick={onConfirmBridgeBuild}
            >
              Confirm Bridge
            </button>
            <button style={{ ...BTN.base, ...BTN.cancel }} onClick={onCancelBridgeBuild}>Cancel</button>
          </div>
        </div>
      )}

      {/* Normal buttons (not in any mode) */}
      {!inAnyMode && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {/* Contested-only: Retreat + Pursue */}
          {isContested && (
            <>
              <button
                style={{ ...BTN.base, background: '#7f1d1d', color: '#fca5a5' }}
                onClick={onRetreat}
                title="Retreat: Move to an adjacent non-enemy hex. You will take parting fire as you leave, but do not fight back. Invalid if surrounded."
              >
                Retreat
              </button>
              <button
                style={{ ...BTN.base, background: '#92400e', color: '#fde68a' }}
                onClick={onPursue}
                title="Pursue if Retreat: If the enemy retreats this turn, roll to pursue. 2d6 ≤ (5 + your speed − their speed). Natural 2 always succeeds; natural 12 always fails."
              >
                Pursue if Retreat
              </button>
            </>
          )}

          {/* Non-contested: standard orders */}
          {!isContested && (
            <>
              <button
                style={{ ...BTN.base, ...BTN.move }}
                title="Move: Click hexes on the map to plot a movement path."
                onClick={onEnterMoveMode}
              >
                Move
              </button>
              {!hasHp && unit.quantity > 1 && (
                <button
                  style={{ ...BTN.base, background: '#1e3a5f', color: '#93c5fd', border: '1px solid #1d4ed8' }}
                  title={`Split: Detach some units from this stack and give them separate orders. Stack has ${unit.quantity} units.`}
                  onClick={onEnterSplitMode}
                >
                  Split
                </button>
              )}
              <button
                style={{ ...BTN.base, background: '#7c3aed', color: '#e2e8f0' }}
                title="Fortify: Dig in for +1 defense. Bonus persists until you move. Cancelled if enemies enter before completion."
                onClick={onFortify}
              >
                Fortify
              </button>
              {canBombard && (
                <button
                  style={{ ...BTN.base, background: '#c2410c', color: '#fed7aa' }}
                  title="Bombard: Click a target hex on the map to direct indirect fire. Unit must stay stationary. Artillery fires 1 die vs units + 1 vs infrastructure per piece."
                  onClick={onEnterBombardMode}
                >
                  Bombard
                </button>
              )}
              {!isSupply && (
                <button
                  style={{
                    ...BTN.base,
                    background: unit.standing_order === 'patrol' ? '#312e81' : '#1e293b',
                    color: unit.standing_order === 'patrol' ? '#a5b4fc' : '#94a3b8',
                    border: unit.standing_order === 'patrol' ? '1px solid #6366f1' : '1px solid #374151',
                  }}
                  title="Patrol: Unit intercepts enemies entering its zone each turn. Radius 1 (foot) or 2 (mechanized). Air units use flight group patrol. Persists until cancelled."
                  onClick={() => onSetPatrol(unit.standing_order === 'patrol' ? null : 'patrol')}
                >
                  {unit.standing_order === 'patrol' ? 'Patrolling ✓' : 'Patrol'}
                </button>
              )}

              {/* Supply truck: Build order */}
              {isSupply && (
                <div style={{ width: '100%', marginTop: 6 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select
                      style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 3, padding: '4px 6px', color: '#e2e8f0', fontSize: 12, flex: 1 }}
                      value={pendingBuildType}
                      onChange={e => setPendingBuildType(e.target.value)}
                    >
                      <option value="">— Build structure —</option>
                      {BUILD_STRUCTURES.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                    <button
                      style={{ ...BTN.base, background: pendingBuildType ? '#065f46' : '#1e293b', color: pendingBuildType ? '#6ee7b7' : '#475569' }}
                      disabled={!pendingBuildType}
                      onClick={() => onEnterBuildMode(pendingBuildType)}
                      title="Supply truck constructs the selected structure. Truck is consumed (except road/canal). Completes at end of Phase 4."
                    >
                      Build…
                    </button>
                  </div>
                  {canBuildBridge && (
                    <button
                      style={{ ...BTN.base, background: '#5c1f00', color: '#fed7aa', marginTop: 6, width: '100%' }}
                      onClick={onEnterBridgeBuildMode}
                      title="Build Bridge: Select a water hex then the far land hex. Truck must be adjacent to the water hex. Truck is consumed; bridge completes Phase 4."
                    >
                      Build Bridge…
                    </button>
                  )}
                </div>
              )}

              {/* Repair order (naval at Harbor, air at Airbase) */}
              {hasHp && hasRepairFacility && (
                <button
                  style={{ ...BTN.base, background: '#1e4d2b', color: '#86efac' }}
                  onClick={onRepair}
                  title="Repair: Spend resources to restore 1 HP. Requires a Harbor (naval) or Airbase (air) in this hex."
                >
                  Repair
                </button>
              )}
            </>
          )}

          <button
            style={{ ...BTN.base, ...BTN.clear }}
            title="Clear Orders: Remove all queued orders for this unit this turn."
            onClick={onClearOrders}
          >
            Clear Orders
          </button>
        </div>
      )}
    </div>
  );
}

const BUILDING_TYPES = ['factory', 'airbase', 'harbor', 'airstrip', 'bridge', 'fortification', 'control_point'];
const BUILDING_MAX_HP_CLIENT = { factory: 20, airbase: 10, harbor: 10, airstrip: 4, bridge: 4, fortification: 4, control_point: 4 };

function GMBuildingEditor({ hex, gameId, onRefresh }) {
  const [factions, setFactions] = useState([]);
  const [newType, setNewType] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [newHp, setNewHp] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    authHeader().then(h =>
      fetch(`${SERVER}/api/games/${gameId}/factions`, { headers: h })
        .then(r => r.ok ? r.json() : [])
        .then(d => setFactions(Array.isArray(d) ? d : (d.factions ?? [])))
    );
  }, [gameId]);

  async function addBuilding() {
    if (!newType) return;
    const headers = await authHeader();
    const r = await fetch(`${SERVER}/api/gm/${gameId}/buildings`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hex_q: hex.hex_q, hex_r: hex.hex_r,
        type: newType,
        owner_faction_id: newOwner || null,
        current_hp: newHp !== '' ? Number(newHp) : undefined,
      }),
    });
    if (r.ok) { setMsg('Added.'); setNewType(''); setNewOwner(''); setNewHp(''); onRefresh(); }
    else { const d = await r.json(); setMsg(d.error ?? 'Error'); }
  }

  async function removeBuilding(id) {
    const headers = await authHeader();
    await fetch(`${SERVER}/api/gm/${gameId}/buildings/${id}`, { method: 'DELETE', headers });
    onRefresh();
  }

  async function setHp(id, hp) {
    const headers = await authHeader();
    await fetch(`${SERVER}/api/gm/${gameId}/buildings/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_hp: Number(hp) }),
    });
    onRefresh();
  }

  async function setOwner(id, ownerId) {
    const headers = await authHeader();
    await fetch(`${SERVER}/api/gm/${gameId}/buildings/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_faction_id: ownerId || null }),
    });
    onRefresh();
  }

  const iS = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 3, padding: '3px 5px', color: '#e2e8f0', fontSize: 11 };

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid #1e293b', paddingTop: 10 }}>
      <p style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>GM — Buildings</p>

      {/* Existing buildings */}
      {(hex.buildings ?? []).map(b => {
        const maxHp = BUILDING_MAX_HP_CLIENT[b.type] ?? b.max_hp;
        return (
          <div key={b.id} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' }}>
            <span style={{ color: '#e2e8f0', fontSize: 12, minWidth: 80 }}>{b.type}</span>
            <input
              type="number" min={0} max={maxHp}
              defaultValue={b.current_hp}
              onBlur={e => setHp(b.id, e.target.value)}
              style={{ ...iS, width: 44 }}
              title="Current HP"
            />
            <span style={{ color: '#64748b', fontSize: 11 }}>/{maxHp}</span>
            <select
              defaultValue={b.owner_faction_id ?? ''}
              onChange={e => setOwner(b.id, e.target.value)}
              style={{ ...iS, flex: 1, minWidth: 80 }}
            >
              <option value="">— no owner —</option>
              {factions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button
              onClick={() => removeBuilding(b.id)}
              style={{ border: 'none', borderRadius: 3, background: '#7f1d1d', color: '#fca5a5', fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}
            >✕</button>
          </div>
        );
      })}

      {/* Add new building */}
      <div style={{ marginTop: 8 }}>
        <div style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>Add building</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <select style={{ ...iS, flex: 1 }} value={newType} onChange={e => { setNewType(e.target.value); setNewHp(''); }}>
            <option value="">— type —</option>
            {BUILDING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select style={{ ...iS, flex: 1 }} value={newOwner} onChange={e => setNewOwner(e.target.value)}>
            <option value="">— owner —</option>
            {factions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {newType && (
            <input
              type="number" min={0} max={BUILDING_MAX_HP_CLIENT[newType] ?? 20}
              placeholder={`HP (default max ${BUILDING_MAX_HP_CLIENT[newType] ?? '?'})`}
              style={{ ...iS, width: 70 }}
              value={newHp}
              onChange={e => setNewHp(e.target.value)}
            />
          )}
          <button
            onClick={addBuilding}
            disabled={!newType}
            style={{ border: 'none', borderRadius: 3, background: newType ? '#1d4ed8' : '#1e293b', color: newType ? '#e2e8f0' : '#475569', fontSize: 11, padding: '3px 8px', cursor: newType ? 'pointer' : 'default' }}
          >
            Add
          </button>
        </div>
      </div>

      {/* Resource tile management */}
      <div style={{ marginTop: 12 }}>
        <div style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>Resource tile</div>
        {hex.resource_tile
          ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: '#f59e0b', fontSize: 12 }}>{hex.resource_tile.tile_type}</span>
              <button
                onClick={async () => {
                  const headers = await authHeader();
                  await fetch(`${SERVER}/api/gm/${gameId}/resource-tiles/${hex.resource_tile.id}`, { method: 'DELETE', headers });
                  onRefresh();
                }}
                style={{ border: 'none', borderRadius: 3, background: '#7f1d1d', color: '#fca5a5', fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}
              >Remove</button>
            </div>
          )
          : (
            <button
              onClick={async () => {
                const headers = await authHeader();
                await fetch(`${SERVER}/api/gm/${gameId}/resource-tiles`, {
                  method: 'POST',
                  headers: { ...headers, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ hex_q: hex.hex_q, hex_r: hex.hex_r }),
                });
                onRefresh();
              }}
              style={{ border: 'none', borderRadius: 3, background: '#78350f', color: '#fde68a', fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}
            >Place Resource Tile</button>
          )
        }
      </div>

      {msg && <p style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>{msg}</p>}
    </div>
  );
}

const MISSION_LABELS = {
  sweep:       'Sweep (fighters only — air superiority)',
  scout:       'Scout (Scout Plane + optional escort)',
  bombing_run: 'Bombing Run (bombers — land/naval targets)',
  attack_run:  'Attack Run (bombers — naval target)',
};

const MISSION_COLORS = {
  sweep:       '#6366f1',
  scout:       '#0ea5e9',
  bombing_run: '#c2410c',
  attack_run:  '#b45309',
};

function FlightGroupPanel({
  selectedUnit,
  flightGroups,
  flightGroupMode,
  flightGroupMission,
  flightGroupPath,
  flightGroupTargetQ,
  flightGroupTargetR,
  flightGroupMsg,
  onEnterFlightGroupMode,
  onConfirmFlightGroup,
  onCancelFlightGroup,
  onCancelFlightGroupById,
}) {
  const [newMission, setNewMission] = useState('sweep');
  const isAirUnit = selectedUnit?.tags?.includes('air');
  const isBomber = selectedUnit?.tags?.includes('heavy');
  const hasMissions = flightGroups.length > 0;
  const needsTarget = ['bombing_run', 'attack_run'].includes(flightGroupMission);

  if (!isAirUnit && !hasMissions) return null;

  const iS = {
    background: '#0f172a', border: '1px solid #1e293b', borderRadius: 3,
    padding: '4px 6px', color: '#e2e8f0', fontSize: 12, width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #1e293b', paddingTop: 12 }}>
      <p style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>Air Missions (this turn)</p>

      {/* Existing flight groups */}
      {hasMissions && (
        <div style={{ marginBottom: 10 }}>
          {flightGroups.map(g => (
            <div key={g.id} style={{
              background: '#0f172a', border: `1px solid ${MISSION_COLORS[g.mission_type] ?? '#374151'}`,
              borderRadius: 4, padding: '6px 8px', marginBottom: 6,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <div style={{ flex: 1 }}>
                <span style={{ color: MISSION_COLORS[g.mission_type] ?? '#94a3b8', fontSize: 12, fontWeight: 700 }}>
                  {g.mission_type.replace(/_/g, ' ').toUpperCase()}
                </span>
                {(g.target_hex_q != null) && (
                  <span style={{ color: '#64748b', fontSize: 11 }}> → ({g.target_hex_q},{g.target_hex_r})</span>
                )}
                <span style={{ color: '#475569', fontSize: 11, marginLeft: 6 }}>
                  {g.unit_ids?.length ?? 0} unit{(g.unit_ids?.length ?? 0) !== 1 ? 's' : ''}
                </span>
                <span style={{
                  marginLeft: 6, padding: '1px 5px', borderRadius: 3, fontSize: 10,
                  background: g.status === 'pending' ? '#1e3a5f' : g.status === 'destroyed' ? '#7f1d1d' : '#1a2e1a',
                  color: g.status === 'pending' ? '#93c5fd' : g.status === 'destroyed' ? '#fca5a5' : '#6ee7b7',
                }}>
                  {g.status}
                </span>
              </div>
              {g.status === 'pending' && (
                <button
                  onClick={() => onCancelFlightGroupById?.(g.id)}
                  style={{ border: 'none', borderRadius: 3, background: '#7f1d1d', color: '#fca5a5', fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}
                >✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Plan a new mission (air units only) */}
      {isAirUnit && !flightGroupMode && (
        <div>
          <div style={{ marginBottom: 6 }}>
            <select style={iS} value={newMission} onChange={e => setNewMission(e.target.value)}>
              {Object.entries(MISSION_LABELS)
                .filter(([m]) => {
                  if (isBomber && m === 'sweep') return false; // Sweep is fighters only
                  if (!isBomber && ['bombing_run', 'attack_run'].includes(m)) return false;
                  return true;
                })
                .map(([m, label]) => (
                  <option key={m} value={m}>{label}</option>
                ))
              }
            </select>
          </div>
          <button
            style={{
              border: 'none', borderRadius: 4, padding: '5px 12px',
              background: MISSION_COLORS[newMission] ?? '#6366f1',
              color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
            onClick={() => onEnterFlightGroupMode?.(newMission)}
          >
            Plan Mission…
          </button>
        </div>
      )}

      {/* Flight group path planning mode */}
      {flightGroupMode && (
        <div>
          <div style={{
            background: '#0c1a2e', border: `1px solid ${MISSION_COLORS[flightGroupMission] ?? '#6366f1'}`,
            borderRadius: 4, padding: 8, marginBottom: 8,
          }}>
            <p style={{ color: MISSION_COLORS[flightGroupMission] ?? '#6366f1', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              {flightGroupMission.replace(/_/g, ' ').toUpperCase()}
            </p>
            {needsTarget && flightGroupTargetQ === null && (
              <p style={{ color: '#fbbf24', fontSize: 11 }}>Step 1: Click the target hex on the map.</p>
            )}
            {needsTarget && flightGroupTargetQ !== null && (
              <p style={{ color: '#86efac', fontSize: 11 }}>Target: ({flightGroupTargetQ},{flightGroupTargetR}). Now click hexes to draw flight path.</p>
            )}
            {!needsTarget && (
              <p style={{ color: '#fbbf24', fontSize: 11 }}>Click hexes on the map to draw the flight path. {flightGroupPath.length} hex{flightGroupPath.length !== 1 ? 'es' : ''} plotted.</p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{
                border: 'none', borderRadius: 4, padding: '5px 12px',
                background: flightGroupPath.length > 0 ? '#15803d' : '#1e293b',
                color: flightGroupPath.length > 0 ? '#fff' : '#475569',
                fontSize: 12, fontWeight: 600,
                cursor: flightGroupPath.length > 0 ? 'pointer' : 'default',
              }}
              disabled={!flightGroupPath.length}
              onClick={onConfirmFlightGroup}
            >
              Confirm Mission
            </button>
            <button
              style={{ border: 'none', borderRadius: 4, padding: '5px 12px', background: '#374151', color: '#9ca3af', fontSize: 12, cursor: 'pointer' }}
              onClick={onCancelFlightGroup}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {flightGroupMsg && (
        <p style={{ color: flightGroupMsg.startsWith('Mission') ? '#22c55e' : '#ef4444', fontSize: 11, marginTop: 6 }}>
          {flightGroupMsg}
        </p>
      )}
    </div>
  );
}

function ProductionPanel({ factoryQ, factoryR, factory, unitTypes, queue, faction, msg, onOrder }) {
  const [selectedType, setSelectedType] = useState('');
  const [qty, setQty] = useState(1);

  const totalSlots = Math.floor(factory.max_hp / 2);
  const usedSlots = queue.reduce((s, q) => s + (q.slots ?? 1) * q.quantity, 0);
  const freeSlots = totalSlots - usedSlots;

  const chosen = unitTypes.find(t => t.name === selectedType);
  const totalMat = chosen ? chosen.mat_cost * qty : 0;
  const totalMan = chosen ? chosen.man_cost * qty : 0;
  const slotsNeeded = chosen ? (chosen.slots ?? 1) * qty : 0;
  const canAfford = faction
    ? (faction.materials ?? 0) >= totalMat && (faction.manpower ?? 0) >= totalMan
    : false;
  const canFit = slotsNeeded <= freeSlots;

  function submit(e) {
    e.preventDefault();
    if (!selectedType || !onOrder) return;
    onOrder(selectedType, qty, factoryQ, factoryR);
  }

  const iS = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 3, padding: '4px 6px', color: '#e2e8f0', fontSize: 12, width: '100%', boxSizing: 'border-box', marginBottom: 6 };

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid #1e293b', paddingTop: 12 }}>
      <p style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
        Factory — {freeSlots}/{totalSlots} slots free
      </p>

      {queue.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <p style={{ color: '#64748b', fontSize: 11, marginBottom: 3 }}>Pending:</p>
          {queue.map((q, i) => (
            <p key={i} style={{ color: '#94a3b8', fontSize: 12, marginBottom: 2 }}>
              • {q.quantity}× {q.unit_type_name} ({q.slots ?? 1} slot{q.quantity > 1 || (q.slots ?? 1) > 1 ? 's' : ''} each) — delivers next turn
            </p>
          ))}
        </div>
      )}

      {freeSlots > 0 && unitTypes.length > 0 && (
        <form onSubmit={submit}>
          <select style={iS} value={selectedType} onChange={e => { setSelectedType(e.target.value); setQty(1); }}>
            <option value="">— select unit type —</option>
            {unitTypes.map(t => (
              <option key={t.id} value={t.name}>
                {t.name} ({t.mat_cost}mat / {t.man_cost}man / {t.slots ?? 1} slot)
              </option>
            ))}
          </select>

          {chosen && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <div>
                <div style={{ color: '#64748b', fontSize: 11 }}>Qty</div>
                <input type="number" min={1} style={{ ...iS, marginBottom: 0 }} value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value)))} />
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: 11 }}>Cost</div>
                <div style={{ color: canAfford ? '#e2e8f0' : '#ef4444', fontSize: 12, marginTop: 2 }}>
                  {totalMat}mat / {totalMan}man
                </div>
                <div style={{ color: canFit ? '#e2e8f0' : '#ef4444', fontSize: 11 }}>
                  {slotsNeeded} slot{slotsNeeded !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={!selectedType || !canAfford || !canFit}
            style={{
              background: (!selectedType || !canAfford || !canFit) ? '#1e293b' : '#15803d',
              border: 'none', borderRadius: 4, padding: '5px 12px',
              color: (!selectedType || !canAfford || !canFit) ? '#475569' : '#fff',
              fontSize: 12, fontWeight: 700,
              cursor: (!selectedType || !canAfford || !canFit) ? 'default' : 'pointer',
            }}
            title="Queue production. Unit will be built during this turn's resolution and arrive next turn adjacent to the factory."
          >
            Order
          </button>
        </form>
      )}

      {freeSlots === 0 && <p style={{ color: '#64748b', fontSize: 12 }}>Factory at capacity.</p>}
      {msg && <p style={{ color: msg.startsWith('Ordered') ? '#22c55e' : '#ef4444', fontSize: 12, marginTop: 6 }}>{msg}</p>}
    </div>
  );
}
