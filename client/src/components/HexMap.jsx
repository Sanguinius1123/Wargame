import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import HexGrid from './HexGrid';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

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
};

export default function HexMap({ gameId, isGM = false, viewAsFactionId = null, playerFactionId = null }) {
  const [hexes, setHexes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  // Move-order state (player only)
  const [moveMode, setMoveMode] = useState(false);
  const [movePath, setMovePath] = useState([]);
  const [selectedUnit, setSelectedUnit] = useState(null);

  // Bombard-order state
  const [bombardMode, setBombardMode] = useState(false);
  const [bombardTarget, setBombardTarget] = useState(null);

  // Current queued orders for the selected unit
  const [currentOrders, setCurrentOrders] = useState([]);

  const load = useCallback(async () => {
    const headers = await authHeader();
    const url = viewAsFactionId
      ? `${SERVER}/api/map/${gameId}/hexes?viewAs=${viewAsFactionId}`
      : `${SERVER}/api/map/${gameId}/hexes`;
    const r = await fetch(url, { headers });
    if (r.ok) setHexes(await r.json());
    setLoading(false);
  }, [gameId, viewAsFactionId]);

  useEffect(() => { load(); }, [load]);

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
      setCurrentOrders([]);
      fetchOrders(unit?.id ?? null);
    }
  }, [isGM, viewAsFactionId, fetchOrders]);

  // Called when a hex is clicked during move or bombard mode
  const handleModeClick = useCallback((hex) => {
    if (moveMode) {
      setMovePath(prev => [...prev, { q: hex.hex_q, r: hex.hex_r }]);
    } else if (bombardMode) {
      setBombardTarget({ q: hex.hex_q, r: hex.hex_r });
    }
  }, [moveMode, bombardMode]);

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
        ...(viewAsFactionId ? { asFactionId: viewAsFactionId } : {}),
      }),
    });
    setMoveMode(false);
    setMovePath([]);
    setCurrentOrders([]);
    setSelectedUnit(null);
    setSelected(null);
    load();
  }, [selectedUnit, movePath, gameId, viewAsFactionId, load]);

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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12, height: '100%' }}>
      {/* Map */}
      <div style={{ background: '#080d15', borderRadius: 8, overflow: 'hidden', height: 600, position: 'relative' }}>
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
              onPathClick={handleModeClick}
            />
        }
      </div>

      {/* Detail panel */}
      <div style={PANEL_STYLE}>
        {selected
          ? <HexDetail
              hex={selected}
              isGM={isGM && !viewAsFactionId}
              viewingAsFaction={!!viewAsFactionId}
              gameId={gameId}
              onRefresh={load}
              selectedUnit={selectedUnit}
              moveMode={moveMode}
              movePath={movePath}
              bombardMode={bombardMode}
              bombardTarget={bombardTarget}
              onEnterMoveMode={enterMoveMode}
              onConfirmMove={confirmMove}
              onCancelMove={cancelMove}
              onEnterBombardMode={enterBombardMode}
              onConfirmBombard={confirmBombard}
              onCancelBombard={cancelBombard}
              onClearOrders={clearOrders}
              onFortify={fortifyUnit}
              onRetreat={retreatUnit}
              onPursue={pursueUnit}
              currentOrders={currentOrders}
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
  isGM,
  viewingAsFaction,
  gameId,
  onRefresh,
  selectedUnit,
  moveMode,
  movePath,
  bombardMode,
  bombardTarget,
  onEnterMoveMode,
  onConfirmMove,
  onCancelMove,
  onEnterBombardMode,
  onConfirmBombard,
  onCancelBombard,
  onClearOrders,
  onFortify,
  onRetreat,
  onPursue,
  currentOrders,
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
          {(hex.has_settlement || hex.has_urban || hex.has_light_vegetation || hex.has_heavy_vegetation || hex.has_road || hex.has_canal) && (
            <div style={{ marginBottom: 10 }}>
              <p style={STAT_LABEL}>Attributes</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {hex.has_settlement && <Tag label="Settlement" color="#fbbf24" />}
                {hex.has_urban && <Tag label={`Urban HP ${hex.urban_hp ?? 4}/4`} color="#a78bfa" />}
                {hex.has_heavy_vegetation && <Tag label="Dense Forest" color="#22c55e" />}
                {hex.has_light_vegetation && !hex.has_heavy_vegetation && <Tag label="Light Forest" color="#86efac" />}
                {hex.has_road && <Tag label="Road" color="#94a3b8" />}
                {hex.has_canal && <Tag label="Canal" color="#38bdf8" />}
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
              onEnterMoveMode={onEnterMoveMode}
              onConfirmMove={onConfirmMove}
              onCancelMove={onCancelMove}
              onEnterBombardMode={onEnterBombardMode}
              onConfirmBombard={onConfirmBombard}
              onCancelBombard={onCancelBombard}
              onClearOrders={onClearOrders}
              onFortify={onFortify}
              onRetreat={onRetreat}
              onPursue={onPursue}
              currentOrders={currentOrders}
              isContested={isContested}
            />
          )}

          {/* GM hex editor */}
          {isGM && (
            <GMHexEditor hex={hex} gameId={gameId} onRefresh={onRefresh} />
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

function OrderPanel({
  unit,
  moveMode,
  movePath,
  bombardMode,
  bombardTarget,
  onEnterMoveMode,
  onConfirmMove,
  onCancelMove,
  onEnterBombardMode,
  onConfirmBombard,
  onCancelBombard,
  onClearOrders,
  onFortify,
  onRetreat,
  onPursue,
  currentOrders,
  isContested,
}) {
  const hasPath = movePath.length >= 2;
  const moveSteps = currentOrders.filter(o => o.order_type === 'move').length;
  const canBombard = unit.bombard_to_hit != null || unit.bombard_range != null;

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

  const inAnyMode = moveMode || bombardMode;

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
            {unit.hp != null ? `${unit.hp} HP` : `×${unit.quantity}`}
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

      {/* Move mode */}
      {moveMode && (
        <div>
          <p style={{ color: '#fbbf24', fontSize: 11, marginBottom: 8 }}>
            Click hexes to add waypoints — {movePath.length - 1} step{movePath.length !== 2 ? 's' : ''} plotted.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...BTN.base, ...BTN.confirm, opacity: hasPath ? 1 : 0.5 }} disabled={!hasPath} onClick={onConfirmMove}>
              Confirm Move
            </button>
            <button style={{ ...BTN.base, ...BTN.cancel }} onClick={onCancelMove}>Cancel</button>
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
