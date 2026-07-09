import { useState, useEffect, useCallback, useRef } from 'react';
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

// Hex distance for even-q flat-top offset coordinates (via cube coords).
function hexDist(q1, r1, q2, r2) {
  const x1 = q1, z1 = r1 - (q1 - (q1 & 1)) / 2, y1 = -x1 - z1;
  const x2 = q2, z2 = r2 - (q2 - (q2 & 1)) / 2, y2 = -x2 - z2;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
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
  move:    'Moving',
  fortify: 'Fortifying',
  bombard: 'Firing',
  retreat: 'Retreating',
  pursue_if_retreat: 'Pursue if Retreat',
  repair:  'Repairing',
  build:   'Building',
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
  const pendingSplitUnitIdRef = useRef(null);

  // Bombard-order state
  const [bombardMode, setBombardMode] = useState(false);
  const [bombardTarget, setBombardTarget] = useState(null);
  const [bombardRangeKeys, setBombardRangeKeys] = useState(new Set());

  // Retreat-order state
  const [retreatMode, setRetreatMode] = useState(false);
  const [retreatTarget, setRetreatTarget] = useState(null);

  // Build-order state (Supply truck)
  const [buildMode, setBuildMode] = useState(false);
  const [buildTarget, setBuildTarget] = useState(null);
  const [buildStructureType, setBuildStructureType] = useState('');

  // Current queued orders for the selected unit
  const [currentOrders, setCurrentOrders] = useState([]);

  // Hexes where combat occurred last turn (shown as starburst markers)
  const [combatHexKeys, setCombatHexKeys] = useState(new Set());

  // Ordered-units tracking: unit IDs that already have orders this turn
  const [orderedUnitIds, setOrderedUnitIds] = useState(new Set());
  // Which hex the map should pan to (changed each time "Next Unit" is clicked)
  const [centerOn, setCenterOn] = useState(null);
  // Cycling index for "Next Unit" button
  const nextUnitIdxRef = useRef(0);

  // Drag-and-drop move state
  const [dragUnit, setDragUnit] = useState(null);
  const [dragOriginHex, setDragOriginHex] = useState(null);
  const [reachableKeys, setReachableKeys] = useState(new Set());
  const [dragOverKey, setDragOverKey] = useState(null);

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

  const loadOrderedUnits = useCallback(async () => {
    if (isGM && !viewAsFactionId) return;
    const headers = await authHeader();
    const r = await fetch(`${SERVER}/api/map/${gameId}/ordered-units`, { headers });
    if (r.ok) {
      const d = await r.json();
      setOrderedUnitIds(new Set(d.unit_ids ?? []));
    }
  }, [gameId, isGM, viewAsFactionId]);

  const load = useCallback(async () => {
    const headers = await authHeader();
    const url = viewAsFactionId
      ? `${SERVER}/api/map/${gameId}/hexes?viewAs=${viewAsFactionId}`
      : `${SERVER}/api/map/${gameId}/hexes`;
    const [r, cr] = await Promise.all([
      fetch(url, { headers }),
      fetch(`${SERVER}/api/map/${gameId}/combat-hexes`, { headers }),
    ]);
    if (r.ok) setHexes(await r.json());
    if (cr.ok) {
      const entries = await cr.json();
      setCombatHexKeys(new Set(entries.map(e => `${e.hex_q},${e.hex_r}`)));
    }
    setLoading(false);
    loadOrderedUnits();
  }, [gameId, viewAsFactionId, refreshKey, loadOrderedUnits]);

  // When the turn advances (refreshKey bumped by GameView), clear all stale order UI.
  useEffect(() => {
    if (refreshKey === 0) return; // skip initial mount
    setSelectedUnit(null);
    setMoveMode(false);
    setMovePath([]);
    setBombardMode(false);
    setBombardTarget(null);
    setBombardRangeKeys(new Set());
    setBuildMode(false);
    setBuildTarget(null);
    setSplitMode(false);
    setRetreatMode(false);
    setCurrentOrders([]);
    setOrderedUnitIds(new Set());
  }, [refreshKey]);

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

  // Keep detail panel in sync when hexes refresh (e.g. after GM +/- unit or turn advance)
  useEffect(() => {
    if (!selected) return;
    const updated = hexes.find(h => h.hex_q === selected.hex_q && h.hex_r === selected.hex_r);
    if (!updated) return;
    setSelected(updated);
    // After a Split Here, auto-select the newly created unit so the player can give it orders
    if (pendingSplitUnitIdRef.current) {
      const splitUnit = updated.units?.find(u => u.id === pendingSplitUnitIdRef.current);
      pendingSplitUnitIdRef.current = null;
      if (splitUnit) { setSelectedUnit(splitUnit); return; }
    }
    if (selectedUnit) {
      const refreshed = updated.units?.find(u => u.id === selectedUnit.id);
      if (refreshed) setSelectedUnit(refreshed);
    }
  }, [hexes]);

  const selectedKey = selected ? `${selected.hex_q},${selected.hex_r}` : null;

  // Fetch orders for a given unit id; clears if null.
  // If `unitHex` is provided, reconstructs movePath from any saved move orders.
  const fetchOrders = useCallback(async (unitId, unitHex) => {
    if (!unitId) { setCurrentOrders([]); setMovePath([]); return; }
    const headers = await authHeader();
    const r = await fetch(`${SERVER}/api/map/${gameId}/orders/${unitId}`, { headers });
    if (r.ok) {
      const d = await r.json();
      const orders = d.orders ?? [];
      setCurrentOrders(orders);
      // Rebuild the move path arrow from saved move orders
      const moveSteps = orders
        .filter(o => o.order_type === 'move')
        .sort((a, b) => a.sequence - b.sequence);
      if (moveSteps.length > 0 && unitHex) {
        setMovePath([
          { q: unitHex.hex_q, r: unitHex.hex_r },
          ...moveSteps.map(o => ({ q: o.to_hex_q, r: o.to_hex_r })),
        ]);
      } else if (!unitHex) {
        // No hex provided — don't touch movePath (called mid-flow like after bombard confirm)
      } else {
        setMovePath([]);
      }
    } else {
      setCurrentOrders([]);
      setMovePath([]);
    }
  }, [gameId]);

  const jumpToNextUnit = useCallback(() => {
    const ownFactionId = viewAsFactionId ?? playerFactionId;
    if (!ownFactionId) return;
    const unordered = [];
    for (const hex of hexes) {
      const unit = hex.units?.find(u =>
        u.factionId === ownFactionId &&
        !orderedUnitIds.has(u.id) &&
        u.fortification_level !== 1
      );
      if (unit) unordered.push({ hex, unit });
    }
    if (unordered.length === 0) return;
    const idx = nextUnitIdxRef.current % unordered.length;
    nextUnitIdxRef.current = idx + 1;
    const { hex, unit } = unordered[idx];
    setSelected(hex);
    setSelectedUnit(unit);
    setMoveMode(false);
    setMovePath([]);
    setBombardMode(false);
    setBombardTarget(null);
    setBuildMode(false);
    setBuildTarget(null);
    setBuildStructureType('');
    setCurrentOrders([]);
    fetchOrders(unit.id, hex);
    setCenterOn({ q: hex.hex_q, r: hex.hex_r });
  }, [hexes, orderedUnitIds, viewAsFactionId, playerFactionId, fetchOrders]);

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
      setFlightGroupMode(false);
      setFlightGroupPath([]);
      setFlightGroupTargetQ(null);
      setFlightGroupTargetR(null);
      setCurrentOrders([]);
      fetchOrders(unit?.id ?? null, hex);
    }
  }, [isGM, viewAsFactionId, fetchOrders, onHexSelect]);

  // Called when the player clicks directly on a unit badge on the map
  const handleUnitClick = useCallback((unit, hex) => {
    setSelected(hex);
    if (onHexSelect) onHexSelect(hex);
    setSelectedUnit(unit);
    setMoveMode(false);
    setMovePath([]);
    setBombardMode(false);
    setBombardTarget(null);
    setBuildMode(false);
    setBuildTarget(null);
    setBuildStructureType('');
    setFlightGroupMode(false);
    setFlightGroupPath([]);
    setSplitMode(false);
    setCurrentOrders([]);
    fetchOrders(unit.id, hex);
  }, [fetchOrders, onHexSelect]);

  // Called when a hex is clicked during move, bombard, build, or flight group mode
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
    } else if (retreatMode && selected) {
      // Only accept hexes adjacent to the unit's current position with no enemy units
      const adjKeys = new Set(offsetNeighbors(selected.hex_q, selected.hex_r).map(n => `${n.q},${n.r}`));
      if (!adjKeys.has(`${hex.hex_q},${hex.hex_r}`)) return;
      const ownFId = viewAsFactionId ?? playerFactionId;
      const hasEnemy = (hex.units ?? []).some(u => u.factionId !== ownFId);
      if (hasEnemy) return;
      setRetreatTarget({ q: hex.hex_q, r: hex.hex_r });
    } else if (moveMode) {
      setMovePath(prev => [...prev, { q: hex.hex_q, r: hex.hex_r }]);
    } else if (bombardMode) {
      setBombardTarget({ q: hex.hex_q, r: hex.hex_r });
    } else if (buildMode) {
      setBuildTarget({ q: hex.hex_q, r: hex.hex_r });
    }
  }, [flightGroupMode, flightGroupMission, flightGroupTargetQ, moveMode, bombardMode, buildMode, retreatMode, selected, hexes, viewAsFactionId, playerFactionId]);

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
    fetchOrders(selectedUnit?.id ?? null, selected);
  }, [selectedUnit, selected, fetchOrders]);

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
    setSplitMode(false);
    setSplitQty(1);
    setOrderedUnitIds(prev => new Set([...prev, selectedUnit.id]));
    // Keep the unit selected and re-fetch its orders — this reconstructs the
    // confirmed path arrow via fetchOrders so it stays visible after confirmation.
    await fetchOrders(selectedUnit.id, selected);
    load();
    loadOrderedUnits();
  }, [selectedUnit, movePath, splitMode, splitQty, gameId, viewAsFactionId, load, fetchOrders, selected, loadOrderedUnits]);

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

  const confirmSplitHere = useCallback(async () => {
    if (!selectedUnit || splitQty < 1) return;
    const headers = await authHeader();
    const resp = await fetch(`${SERVER}/api/map/${gameId}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: selectedUnit.id,
        split_quantity: splitQty,
        ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
      }),
    });
    if (!resp.ok) return;
    const { split_unit_id } = await resp.json();
    // Store the new unit's ID so the useEffect can auto-select it after hexes reload
    if (split_unit_id) pendingSplitUnitIdRef.current = split_unit_id;
    setSplitMode(false);
    setSplitQty(1);
    await load();
  }, [selectedUnit, splitQty, gameId, viewAsFactionId, load]);

  const enterBombardMode = useCallback(() => {
    if (!selectedUnit) return;
    const range = selectedUnit.bombard_range ?? 0;
    const rk = new Set();
    if (range > 0 && selected) {
      for (const h of hexes) {
        const d = hexDist(selected.hex_q, selected.hex_r, h.hex_q, h.hex_r);
        if (d > 0 && d <= range) rk.add(`${h.hex_q},${h.hex_r}`);
      }
    }
    setBombardRangeKeys(rk);
    setBombardMode(true);
    setBombardTarget(null);
    setCurrentOrders([]);
  }, [selectedUnit, selected, hexes]);

  const cancelBombard = useCallback(() => {
    setBombardMode(false);
    setBombardTarget(null);
    setBombardRangeKeys(new Set());
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
    setBombardRangeKeys(new Set());
    setOrderedUnitIds(prev => new Set([...prev, selectedUnit.id]));
    await fetchOrders(selectedUnit.id);
    loadOrderedUnits();
  }, [selectedUnit, bombardTarget, gameId, viewAsFactionId, fetchOrders, loadOrderedUnits]);

  // "Continue Bombardment": places the one-time order AND persists the target on the unit.
  const confirmContinuousBombard = useCallback(async () => {
    if (!selectedUnit || !bombardTarget) return;
    const headers = await authHeader();
    await Promise.all([
      // One-time order for this turn
      fetch(`${SERVER}/api/map/${gameId}/orders`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: selectedUnit.id,
          order_type: 'bombard',
          target_hex_q: bombardTarget.q,
          target_hex_r: bombardTarget.r,
          ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
        }),
      }),
      // Persistent standing target
      fetch(`${SERVER}/api/map/${gameId}/units/${selectedUnit.id}/continuous-bombard`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_hex_q: bombardTarget.q, target_hex_r: bombardTarget.r }),
      }),
    ]);
    // Update local unit state so the UI reflects continuous mode immediately
    setSelectedUnit(prev => prev ? { ...prev, continuous_bombard_q: bombardTarget.q, continuous_bombard_r: bombardTarget.r } : prev);
    setBombardMode(false);
    setBombardTarget(null);
    setBombardRangeKeys(new Set());
    setOrderedUnitIds(prev => new Set([...prev, selectedUnit.id]));
    await fetchOrders(selectedUnit.id);
    loadOrderedUnits();
  }, [selectedUnit, bombardTarget, gameId, viewAsFactionId, fetchOrders, loadOrderedUnits]);

  // Stop continuous bombardment
  const stopContinuousBombard = useCallback(async () => {
    if (!selectedUnit) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/units/${selectedUnit.id}/continuous-bombard`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_hex_q: null, target_hex_r: null }),
    });
    setSelectedUnit(prev => prev ? { ...prev, continuous_bombard_q: null, continuous_bombard_r: null } : prev);
  }, [selectedUnit, gameId]);

  const enterRetreatMode = useCallback(() => {
    if (!selectedUnit) return;
    setRetreatMode(true);
    setRetreatTarget(null);
    setCurrentOrders([]);
  }, [selectedUnit]);

  const cancelRetreat = useCallback(() => {
    setRetreatMode(false);
    setRetreatTarget(null);
    fetchOrders(selectedUnit?.id ?? null, selected);
  }, [selectedUnit, selected, fetchOrders]);

  const confirmRetreat = useCallback(async () => {
    if (!selectedUnit || !retreatTarget) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: selectedUnit.id,
        order_type: 'retreat',
        to_hex_q: retreatTarget.q,
        to_hex_r: retreatTarget.r,
        ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
      }),
    });
    setRetreatMode(false);
    setRetreatTarget(null);
    setOrderedUnitIds(prev => new Set([...prev, selectedUnit.id]));
    await fetchOrders(selectedUnit.id, selected);
    loadOrderedUnits();
  }, [selectedUnit, retreatTarget, gameId, viewAsFactionId, selected, fetchOrders, loadOrderedUnits]);

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
    loadOrderedUnits();
  }, [selectedUnit, gameId, load, loadOrderedUnits]);

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
    setOrderedUnitIds(prev => new Set([...prev, selectedUnit.id]));
    await fetchOrders(selectedUnit.id);
    loadOrderedUnits();
  }, [selectedUnit, gameId, viewAsFactionId, fetchOrders, loadOrderedUnits]);

  const setPatrolOrder = useCallback(async (patrolValue) => {
    if (!selectedUnit) return;
    const headers = await authHeader();
    const resp = await fetch(`${SERVER}/api/map/${gameId}/units/${selectedUnit.id}/standing-order`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ standing_order: patrolValue ?? null }),
    });
    if (!resp.ok) {
      console.error('standing-order PATCH failed:', await resp.text());
      return;
    }
    // Optimistic update so the button flips immediately.
    setSelectedUnit(prev => prev ? { ...prev, standing_order: patrolValue ?? null } : prev);
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

  // Terrain movement costs matching terrain_type_config in DB (server/movement.js uses these directly).
  const FOOT_COST  = { plains:1, hills:1, mountains:1, desert:1, wetlands:1, water:Infinity };
  const MECH_COST  = { plains:1, hills:2, mountains:Infinity, desert:1, wetlands:Infinity, water:Infinity };
  const NAVAL_COST = { plains:Infinity, hills:Infinity, mountains:Infinity, desert:Infinity, wetlands:Infinity, water:1 };

  const computeReachable = useCallback((unit, originHex, ownFactionId) => {
    const budget = unit.move ?? 1;
    const isNaval = unit.tags?.includes('naval');
    const isMech  = unit.tags?.includes('mechanized');
    const costMap = isNaval ? NAVAL_COST : (isMech ? MECH_COST : FOOT_COST);
    const hexByKey = new Map(hexes.map(h => [`${h.hex_q},${h.hex_r}`, h]));
    const visited = new Map([[`${originHex.hex_q},${originHex.hex_r}`, budget]]);
    const queue = [{ q: originHex.hex_q, r: originHex.hex_r, remaining: budget }];
    while (queue.length > 0) {
      const { q, r, remaining } = queue.shift();
      for (const { q: nq, r: nr } of offsetNeighbors(q, r)) {
        const key = `${nq},${nr}`;
        const hex = hexByKey.get(key);
        if (!hex) continue;
        let cost = costMap[hex.terrain] ?? Infinity;
        if (!isNaval && isMech && hex.has_heavy_vegetation) cost = Infinity;
        if (cost === Infinity) continue;
        const newRemaining = remaining - cost;
        if (newRemaining < 0) continue;
        const existing = visited.get(key);
        if (existing !== undefined && existing >= newRemaining) continue;
        visited.set(key, newRemaining);
        queue.push({ q: nq, r: nr, remaining: newRemaining });
      }
    }
    const result = new Set(visited.keys());
    result.delete(`${originHex.hex_q},${originHex.hex_r}`);

    // Server single-step override: any passable adjacent hex is always reachable
    // regardless of budget, matching validatePath() in movement.js.
    for (const { q: nq, r: nr } of offsetNeighbors(originHex.hex_q, originHex.hex_r)) {
      const key = `${nq},${nr}`;
      if (result.has(key)) continue;
      const hex = hexByKey.get(key);
      if (!hex) continue;
      let cost = costMap[hex.terrain] ?? Infinity;
      if (!isNaval && isMech && hex.has_heavy_vegetation) cost = Infinity;
      if (cost !== Infinity) result.add(key);
    }

    // Ground units: highlight adjacent water hexes that contain a friendly Transport
    // so the player can drag-to-load onto a docked transport.
    if (!isNaval && ownFactionId) {
      for (const { q: nq, r: nr } of offsetNeighbors(originHex.hex_q, originHex.hex_r)) {
        const nbKey = `${nq},${nr}`;
        if (result.has(nbKey)) continue;
        const nbHex = hexByKey.get(nbKey);
        if (!nbHex || nbHex.terrain !== 'water') continue;
        const hasTransport = nbHex.units?.some(
          u => u.factionId === ownFactionId && u.tags?.includes('naval') && u.type === 'Transport'
        );
        if (hasTransport) result.add(nbKey);
      }
    }

    return result;
  }, [hexes]);

  // BFS (Dijkstra) pathfinder: returns the cheapest-cost path from originHex to destHex
  // through passable terrain, not routing through enemy-occupied intermediate hexes.
  // Returns null if no path exists.
  const buildMovePath = useCallback((unit, originHex, destHex) => {
    const isNaval = unit.tags?.includes('naval');
    const isMech  = unit.tags?.includes('mechanized');
    const costMap = isNaval ? NAVAL_COST : (isMech ? MECH_COST : FOOT_COST);
    const hexByKey = new Map(hexes.map(h => [`${h.hex_q},${h.hex_r}`, h]));
    const ownFId = viewAsFactionId ?? playerFactionId;
    const startKey = `${originHex.hex_q},${originHex.hex_r}`;
    const destKey  = `${destHex.hex_q},${destHex.hex_r}`;

    const dist = new Map([[startKey, 0]]);
    const prev = new Map([[startKey, null]]);
    const pq = [{ key: startKey, cost: 0 }];

    while (pq.length) {
      pq.sort((a, b) => a.cost - b.cost);
      const { key, cost } = pq.shift();
      if (key === destKey) break;
      const [q, r] = key.split(',').map(Number);
      for (const { q: nq, r: nr } of offsetNeighbors(q, r)) {
        const nKey = `${nq},${nr}`;
        const hex = hexByKey.get(nKey);
        if (!hex) continue;
        let stepCost = costMap[hex.terrain] ?? Infinity;
        if (!isNaval && isMech && hex.has_heavy_vegetation) stepCost = Infinity;
        if (stepCost === Infinity) continue;
        // Intermediate hexes with visible enemy units block passage (units stop on contact).
        if (nKey !== destKey && ownFId && (hex.units ?? []).some(u => u.factionId !== ownFId)) continue;
        const newCost = cost + stepCost;
        if (!dist.has(nKey) || newCost < dist.get(nKey)) {
          dist.set(nKey, newCost);
          prev.set(nKey, key);
          pq.push({ key: nKey, cost: newCost });
        }
      }
    }

    if (!prev.has(destKey)) return null;

    const path = [];
    let cur = destKey;
    while (cur !== null) {
      const [q, r] = cur.split(',').map(Number);
      path.unshift({ q, r });
      cur = prev.get(cur) ?? null;
    }
    return path;
  }, [hexes, viewAsFactionId, playerFactionId]);

  const handleUnitDragStart = useCallback((unit, hex) => {
    const keys = computeReachable(unit, hex, viewAsFactionId ?? playerFactionId);
    setDragUnit(unit);
    setDragOriginHex(hex);
    setReachableKeys(keys);
    setDragOverKey(null);
  }, [computeReachable, viewAsFactionId, playerFactionId]);

  const handleDragMove = useCallback((hexKey) => {
    setDragOverKey(hexKey ?? null);
  }, []);

  const handleDragEnd = useCallback(async (hex) => {
    const unit = dragUnit;
    const originHex = dragOriginHex;
    const keys = reachableKeys;
    setDragUnit(null);
    setDragOriginHex(null);
    setReachableKeys(new Set());
    setDragOverKey(null);
    if (!unit || !originHex || !hex) return;
    const destKey = `${hex.hex_q},${hex.hex_r}`;
    if (!keys.has(destKey)) return;
    const factionId = viewAsFactionId ?? playerFactionId;
    const isGroundUnit = !unit.tags?.includes('naval') && !unit.tags?.includes('air');
    const destHex = hexes.find(h => h.hex_q === hex.hex_q && h.hex_r === hex.hex_r);
    const hasTransport = isGroundUnit && destHex?.terrain === 'water' && destHex?.units?.some(
      u => u.factionId === factionId && u.tags?.includes('naval') && u.type === 'Transport'
    );
    const orderType = hasTransport ? 'load' : 'move';
    // Build the full step-by-step path (handles 2+ step moves like Armor).
    // Falls back to direct 2-waypoint path if pathfinding fails (e.g. load order to water).
    const path = buildMovePath(unit, originHex, destHex ?? hex)
      ?? [{ q: originHex.hex_q, r: originHex.hex_r }, { q: hex.hex_q, r: hex.hex_r }];
    const headers = await authHeader();
    const resp = await fetch(`${SERVER}/api/map/${gameId}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: unit.id,
        order_type: orderType,
        path,
        ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
      }),
    });
    if (!resp.ok) return;
    setOrderedUnitIds(prev => new Set([...prev, unit.id]));
    // Select the unit so the move arrow shows up in the panel
    setSelected(originHex);
    setSelectedUnit(unit);
    await fetchOrders(unit.id, originHex);
    load();
    loadOrderedUnits();
  }, [dragUnit, dragOriginHex, reachableKeys, hexes, gameId, viewAsFactionId, playerFactionId, fetchOrders, load, loadOrderedUnits, buildMovePath]);

  const ownFactionId = viewAsFactionId ?? playerFactionId;
  const isPlayerMode = !isGM || !!viewAsFactionId;
  const unorderedCount = isPlayerMode && ownFactionId
    ? hexes.reduce((n, hex) => {
        const unit = hex.units?.find(u =>
          u.factionId === ownFactionId &&
          !orderedUnitIds.has(u.id) &&
          u.fortification_level !== 1
        );
        return unit ? n + 1 : n;
      }, 0)
    : 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12, height: '100%' }}>
      {/* Map */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Next Unit toolbar */}
        {isPlayerMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={jumpToNextUnit}
              disabled={unorderedCount === 0}
              style={{
                background: unorderedCount > 0 ? '#1d4ed8' : '#1e293b',
                border: 'none', borderRadius: 4, padding: '6px 14px',
                color: unorderedCount > 0 ? '#e2e8f0' : '#475569',
                fontWeight: 600, fontSize: 12,
                cursor: unorderedCount > 0 ? 'pointer' : 'default',
              }}
            >
              Next Unit {unorderedCount > 0 ? `(${unorderedCount} need orders)` : '(all ordered)'}
            </button>
          </div>
        )}
        <div style={{ background: '#080d15', borderRadius: 8, overflow: 'hidden', height: 'calc(100vh - 155px)', minHeight: 480, position: 'relative' }}>
          {loading
            ? <p style={{ color: '#64748b', padding: 24 }}>Loading map…</p>
            : (() => {
                const committedBombardOrder = !bombardMode && currentOrders.find(o => o.order_type === 'bombard');
                const hasContinuousBombard = !bombardMode && selectedUnit?.continuous_bombard_q != null;
                const committedBombardTargetKey = committedBombardOrder
                  ? `${committedBombardOrder.target_hex_q},${committedBombardOrder.target_hex_r}`
                  : hasContinuousBombard
                    ? `${selectedUnit.continuous_bombard_q},${selectedUnit.continuous_bombard_r}`
                    : null;
                const effectiveBombardRangeKeys = bombardMode ? bombardRangeKeys : null;
                return <HexGrid
                hexes={hexes}
                onSelect={handleSelect}
                panZoom
                selectedKey={selectedKey}
                moveMode={moveMode}
                movePath={movePath}
                bombardMode={bombardMode}
                bombardTargetKey={bombardMode ? (bombardTarget ? `${bombardTarget.q},${bombardTarget.r}` : null) : committedBombardTargetKey}
                bombardRangeKeys={effectiveBombardRangeKeys}
                buildMode={buildMode || flightGroupMode || retreatMode}
                buildTargetKey={
                  buildTarget ? `${buildTarget.q},${buildTarget.r}` :
                  (flightGroupTargetQ !== null ? `${flightGroupTargetQ},${flightGroupTargetR}` : null)
                }
                onPathClick={handleModeClick}
                centerOn={centerOn}
                playerFactionId={isPlayerMode ? ownFactionId : null}
                reachableKeys={reachableKeys}
                dragOverKey={dragOverKey}
                onUnitDragStart={handleUnitDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
                onUnitClick={handleUnitClick}
                showCoords={isGM}
                dragUnitId={dragUnit?.id}
                combatHexKeys={combatHexKeys}
              />;
              })()
          }
        </div>
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
              onEnterMoveMode={enterMoveMode}
              onConfirmMove={confirmMove}
              onCancelMove={cancelMove}
              onEnterBombardMode={enterBombardMode}
              onConfirmBombard={confirmBombard}
              onConfirmContinuousBombard={confirmContinuousBombard}
              onStopContinuousBombard={stopContinuousBombard}
              onCancelBombard={cancelBombard}
              onEnterBuildMode={enterBuildMode}
              onConfirmBuild={confirmBuild}
              onCancelBuild={cancelBuild}
              onClearOrders={clearOrders}
              onFortify={fortifyUnit}
              onEnterRetreat={enterRetreatMode}
              onConfirmRetreat={confirmRetreat}
              onCancelRetreat={cancelRetreat}
              retreatMode={retreatMode}
              retreatTarget={retreatTarget}
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
              onSelectUnit={(unit) => {
                setSelectedUnit(unit);
                setMoveMode(false);
                setMovePath([]);
                setBombardMode(false);
                setBombardTarget(null);
                setCurrentOrders([]);
                fetchOrders(unit.id, selected);
              }}
              splitMode={splitMode}
              splitQty={splitQty}
              onEnterSplitMode={enterSplitMode}
              onCancelSplit={cancelSplit}
              onSplitQtyChange={setSplitQty}
              onConfirmSplitHere={confirmSplitHere}
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
  onEnterMoveMode,
  onConfirmMove,
  onCancelMove,
  onEnterBombardMode,
  onConfirmBombard,
  onCancelBombard,
  onEnterBuildMode,
  onConfirmBuild,
  onCancelBuild,
  onClearOrders,
  onFortify,
  onEnterRetreat,
  onConfirmRetreat,
  onCancelRetreat,
  retreatMode = false,
  retreatTarget = null,
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
  onSelectUnit,
  splitMode = false,
  splitQty = 1,
  onEnterSplitMode,
  onCancelSplit,
  onSplitQtyChange,
  onConfirmSplitHere,
  onConfirmContinuousBombard,
  onStopContinuousBombard,
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
          {(hex.has_settlement || hex.has_urban || hex.has_light_vegetation || hex.has_heavy_vegetation || hex.has_airstrip || hex.has_railroad || hex.resource_tile) && (
            <div style={{ marginBottom: 10 }}>
              <p style={STAT_LABEL}>Attributes</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {hex.has_settlement && <Tag label={`Settlement: ${hex.settlement_name ?? '—'} (pop ${hex.settlement_size ?? 0})`} color="#fbbf24" />}
                {hex.has_urban && <Tag label="Urban" color="#94a3b8" />}
                {hex.has_heavy_vegetation && <Tag label={`Dense Forest (${hex.vegetation_hp ?? '?'} HP)`} color="#22c55e" />}
                {hex.has_light_vegetation && !hex.has_heavy_vegetation && <Tag label={`Light Forest (${hex.vegetation_hp ?? '?'} HP)`} color="#86efac" />}
                {hex.has_airstrip && <Tag label="Airstrip" color="#7dd3fc" />}
                {hex.has_railroad && <Tag label="Railroad" color="#b0bec5" />}
                {hex.resource_tile && <Tag label={`Resource: ${hex.resource_tile.tile_type}`} color="#f59e0b" />}
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
              {units.map((u, i) => {
                const isOwn = u.factionId === playerFactionId;
                const isSelected = selectedUnit?.id === u.id;
                if (isGM) return <GMUnitRow key={u.id ?? i} unit={u} gameId={gameId} onRefresh={onRefresh} />;
                if (isOwn && onSelectUnit) {
                  return (
                    <button
                      key={u.id ?? i}
                      onClick={() => onSelectUnit(u)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        background: isSelected ? '#1e3a5f' : 'none',
                        border: isSelected ? '1px solid #3b82f6' : '1px solid transparent',
                        borderRadius: 4, padding: '3px 6px', marginBottom: 2,
                        color: '#e2e8f0', fontSize: 13, cursor: 'pointer',
                      }}
                    >
                      {u.type}{u.hp != null ? ` ${u.hp}HP` : ` ×${u.quantity}`}
                      {u.fortification_level === 1 && <span style={{ color: '#f59e0b', fontSize: 11, marginLeft: 4 }}>⛏</span>}
                    </button>
                  );
                }
                return (
                  <p key={u.id ?? i} style={{ color: '#e2e8f0', fontSize: 13 }}>
                    {u.type}{u.hp != null ? ` ${u.hp}HP` : ` ×${u.quantity}`}
                  </p>
                );
              })}
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
              onEnterMoveMode={onEnterMoveMode}
              onConfirmMove={onConfirmMove}
              onCancelMove={onCancelMove}
              onEnterBombardMode={onEnterBombardMode}
              onConfirmBombard={onConfirmBombard}
              onConfirmContinuousBombard={onConfirmContinuousBombard}
              onStopContinuousBombard={onStopContinuousBombard}
              onCancelBombard={onCancelBombard}
              onEnterBuildMode={onEnterBuildMode}
              onConfirmBuild={onConfirmBuild}
              onCancelBuild={onCancelBuild}
              onClearOrders={onClearOrders}
              onFortify={onFortify}
              onEnterRetreat={onEnterRetreat}
              onConfirmRetreat={onConfirmRetreat}
              onCancelRetreat={onCancelRetreat}
              retreatMode={retreatMode}
              retreatTarget={retreatTarget}
              onPursue={onPursue}
              onRepair={onRepair}
              currentOrders={currentOrders}
              isContested={isContested}
              hasRepairFacility={hasRepairFacility}
              onSetPatrol={onSetPatrol}
              splitMode={splitMode}
              splitQty={splitQty}
              onEnterSplitMode={onEnterSplitMode}
              onCancelSplit={onCancelSplit}
              onSplitQtyChange={onSplitQtyChange}
              onConfirmSplitHere={onConfirmSplitHere}
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

function resolveVegHp(hex) {
  const hp = hex.vegetation_hp;
  if (hp > 0) return hp;
  if (hex.has_heavy_vegetation) return 11 + Math.floor(Math.random() * 10); // 11-20
  if (hex.has_light_vegetation) return 1  + Math.floor(Math.random() * 10); // 1-10
  return 0;
}

function GMHexEditor({ hex, gameId, onRefresh }) {
  const [form, setForm] = useState({
    terrain:         hex.terrain ?? 'plains',
    has_settlement:  hex.has_settlement ?? false,
    settlement_size: hex.settlement_size ?? 0,
    vegetation_hp:   resolveVegHp(hex),
    has_railroad:    hex.has_railroad ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Reset form when selected hex changes
  useEffect(() => {
    setForm({
      terrain:         hex.terrain ?? 'plains',
      has_settlement:  hex.has_settlement ?? false,
      settlement_size: hex.settlement_size ?? 0,
      vegetation_hp:   resolveVegHp(hex),
      has_railroad:    hex.has_railroad ?? false,
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
        ['has_settlement', 'Settlement'],
        ['has_railroad',   'Railroad'],
      ].map(([key, label]) => (
        <div key={key} style={rowStyle}>
          <input type="checkbox" checked={form[key]} onChange={chk(key)} id={key} />
          <label htmlFor={key} style={lbl}>{label}</label>
        </div>
      ))}

      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
          <span style={lbl}>Vegetation HP</span>
          <span style={{ fontSize: 11, color: form.vegetation_hp >= 11 ? '#22c55e' : form.vegetation_hp >= 1 ? '#86efac' : '#475569' }}>
            {form.vegetation_hp >= 11 ? 'Heavy' : form.vegetation_hp >= 1 ? 'Light' : 'None'}
          </span>
        </div>
        <input type="number" min={0} max={25} style={iStyle} value={form.vegetation_hp} onChange={inp('vegetation_hp')} />
        <div style={{ color: '#475569', fontSize: 10, marginTop: 2 }}>0 = none · 1–10 = light · 11+ = heavy</div>
      </div>

      {form.has_settlement && (
        <div style={{ marginBottom: 8 }}>
          <div style={lbl}>Settlement Size (manpower yield)</div>
          <input type="number" min={0} style={iStyle} value={form.settlement_size} onChange={inp('settlement_size')} />
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
  onEnterMoveMode,
  onConfirmMove,
  onCancelMove,
  onEnterBombardMode,
  onConfirmBombard,
  onCancelBombard,
  onEnterBuildMode,
  onConfirmBuild,
  onCancelBuild,
  onClearOrders,
  onFortify,
  onEnterRetreat,
  onConfirmRetreat,
  onCancelRetreat,
  retreatMode = false,
  retreatTarget = null,
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
  onConfirmSplitHere,
  onConfirmContinuousBombard,
  onStopContinuousBombard,
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
    orderSummary.push(`Moving (${moveSteps} step${moveSteps !== 1 ? 's' : ''})`);
  }
  const nonMoveTypes = [...new Set(
    currentOrders.filter(o => o.order_type !== 'move').map(o => o.order_type)
  )];
  for (const t of nonMoveTypes) {
    orderSummary.push(ORDER_TYPE_LABELS[t] ?? t);
  }

  const inAnyMode = moveMode || bombardMode || buildMode || splitMode || retreatMode;

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
        {unit.standing_order && unit.standing_order !== 'hold_position' && (
          <Tag label={unit.standing_order === 'patrol' ? 'Patrol' : unit.standing_order === 'safety' ? 'Safety' : unit.standing_order} color="#6366f1" />
        )}
        {unit.fortification_level === 1 && <Tag label="Fortified +1 def" color="#f59e0b" />}
        {unit.continuous_bombard_q != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <Tag label={`Continuous fire → (${unit.continuous_bombard_q},${unit.continuous_bombard_r})`} color="#f97316" />
            <button
              style={{ background: 'none', border: '1px solid #7f1d1d', color: '#f87171', fontSize: 10, padding: '1px 6px', borderRadius: 3, cursor: 'pointer' }}
              onClick={onStopContinuousBombard}
              title="Stop continuous bombardment"
            >Stop</button>
          </div>
        )}
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

      {/* Split mode — choose how many units to split off */}
      {splitMode && !moveMode && (
        <div>
          <p style={{ color: '#fbbf24', fontSize: 11, marginBottom: 8 }}>
            Split off how many units?
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button style={{ ...BTN.base, ...BTN.confirm }} onClick={onConfirmSplitHere}
              title="Create a new idle stack in this hex — command each group separately">
              Split Here
            </button>
            <button style={{ ...BTN.base, ...BTN.move }} onClick={onEnterMoveMode}
              title="Split off the group and immediately plot a move path for them">
              Split &amp; Move…
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
            <button
              style={{ ...BTN.base, background: '#7c2d12', color: '#fed7aa', opacity: bombardTarget ? 1 : 0.5 }}
              disabled={!bombardTarget}
              onClick={onConfirmContinuousBombard}
              title="Continue Bombardment: Fires this turn and every turn until stopped."
            >
              Continue Bombardment
            </button>
            <button style={{ ...BTN.base, ...BTN.cancel }} onClick={onCancelBombard}>Cancel</button>
          </div>
        </div>
      )}

      {/* Retreat mode */}
      {retreatMode && (
        <div>
          <p style={{ color: '#fca5a5', fontSize: 11, marginBottom: 8 }}>
            Click an adjacent non-enemy hex to retreat to.
            {retreatTarget ? ` → (${retreatTarget.q}, ${retreatTarget.r})` : ''}
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{ ...BTN.base, background: '#7f1d1d', color: '#fca5a5', opacity: retreatTarget ? 1 : 0.5 }}
              disabled={!retreatTarget}
              onClick={onConfirmRetreat}
            >
              Confirm Retreat
            </button>
            <button style={{ ...BTN.base, ...BTN.cancel }} onClick={onCancelRetreat}>Cancel</button>
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

      {/* Normal buttons (not in any mode) */}
      {!inAnyMode && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {/* Contested-only: Retreat + Pursue */}
          {isContested && (
            <>
              <button
                style={{ ...BTN.base, background: '#7f1d1d', color: '#fca5a5' }}
                onClick={onEnterRetreat}
                title="Retreat: Click an adjacent non-enemy hex to set your retreat destination."
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
              {/* Patrol button hidden — not yet functional (TODO: implement patrol intercept logic) */}
              {(unit.stealth_rating ?? 0) > 0 && (
                <button
                  style={{
                    ...BTN.base,
                    background: unit.standing_order === 'safety' ? '#064e3b' : '#1e293b',
                    color: unit.standing_order === 'safety' ? '#6ee7b7' : '#94a3b8',
                    border: unit.standing_order === 'safety' ? '1px solid #10b981' : '1px solid #374151',
                  }}
                  title="Safety: Unit will not fire on undetected enemies and will not reveal its position. Only fires back if the enemy detects it first. Persists until cancelled."
                  onClick={() => onSetPatrol(unit.standing_order === 'safety' ? null : 'safety')}
                >
                  {unit.standing_order === 'safety' ? 'Safety ON ✓' : 'Safety'}
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

const BUILDING_TYPES = ['factory', 'airbase', 'harbor', 'airstrip', 'fortification', 'control_point'];
const BUILDING_MAX_HP_CLIENT = { factory: 20, airbase: 10, harbor: 10, airstrip: 4, fortification: 4, control_point: 4 };

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
