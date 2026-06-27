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

export default function HexMap({ gameId, isGM = false }) {
  const [hexes, setHexes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  // Move-order state (player only)
  const [moveMode, setMoveMode] = useState(false);
  const [movePath, setMovePath] = useState([]);
  const [selectedUnit, setSelectedUnit] = useState(null);

  const load = useCallback(async () => {
    const headers = await authHeader();
    const r = await fetch(`${SERVER}/api/map/${gameId}/hexes`, { headers });
    if (r.ok) setHexes(await r.json());
    setLoading(false);
  }, [gameId]);

  useEffect(() => { load(); }, [load]);

  const selectedKey = selected ? `${selected.hex_q},${selected.hex_r}` : null;

  // Called when player clicks a hex in normal mode
  const handleSelect = useCallback((hex) => {
    setSelected(hex);
    if (!isGM) {
      const unit = hex.units?.[0] ?? null;
      setSelectedUnit(unit);
      // Exit move mode if they click a new hex without confirming
      setMoveMode(false);
      setMovePath([]);
    }
  }, [isGM]);

  // Called when player clicks a hex while in move mode
  const handlePathClick = useCallback((hex) => {
    const wp = { q: hex.hex_q, r: hex.hex_r };
    setMovePath(prev => [...prev, wp]);
  }, []);

  const enterMoveMode = useCallback(() => {
    if (!selectedUnit) return;
    // Seed path with unit's current hex
    const startHex = selected;
    if (startHex) {
      setMovePath([{ q: startHex.hex_q, r: startHex.hex_r }]);
    } else {
      setMovePath([]);
    }
    setMoveMode(true);
  }, [selectedUnit, selected]);

  const cancelMove = useCallback(() => {
    setMoveMode(false);
    setMovePath([]);
  }, []);

  const confirmMove = useCallback(async () => {
    if (!selectedUnit || movePath.length < 2) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/orders`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: selectedUnit.id,
        path: movePath,
      }),
    });
    setMoveMode(false);
    setMovePath([]);
    setSelectedUnit(null);
    setSelected(null);
    load();
  }, [selectedUnit, movePath, gameId, load]);

  const clearOrders = useCallback(async () => {
    if (!selectedUnit) return;
    const headers = await authHeader();
    await fetch(`${SERVER}/api/map/${gameId}/orders/${selectedUnit.id}`, {
      method: 'DELETE',
      headers,
    });
    setMoveMode(false);
    setMovePath([]);
    load();
  }, [selectedUnit, gameId, load]);

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
              onPathClick={handlePathClick}
            />
        }
      </div>

      {/* Detail panel */}
      <div style={PANEL_STYLE}>
        {selected
          ? <HexDetail
              hex={selected}
              isGM={isGM}
              gameId={gameId}
              onRefresh={load}
              selectedUnit={selectedUnit}
              moveMode={moveMode}
              movePath={movePath}
              onEnterMoveMode={enterMoveMode}
              onConfirmMove={confirmMove}
              onCancelMove={cancelMove}
              onClearOrders={clearOrders}
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
  gameId,
  onRefresh,
  selectedUnit,
  moveMode,
  movePath,
  onEnterMoveMode,
  onConfirmMove,
  onCancelMove,
  onClearOrders,
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

  return (
    <div>
      <p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 8 }}>
        Hex ({hex.hex_q}, {hex.hex_r}) · {vis === 'scouted' ? 'scouted' : 'visible'}
      </p>

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

          {/* Units by faction */}
          {Object.entries(unitsByFaction).map(([fname, { color, units }]) => (
            <div key={fname} style={{ marginBottom: 10 }}>
              <p style={{ ...STAT_LABEL, color: color ?? '#60a5fa' }}>{fname}</p>
              {units.map((u, i) => (
                <p key={i} style={{ color: '#e2e8f0', fontSize: 13 }}>
                  {u.type}{u.hp != null ? ` ${u.hp}HP` : ` ×${u.quantity}`}
                </p>
              ))}
            </div>
          ))}

          {Object.keys(unitsByFaction).length === 0 && (
            <p style={{ color: '#4b5563', fontSize: 13 }}>No units</p>
          )}

          {/* Order panel — players only, when a unit is selected */}
          {!isGM && selectedUnit && (
            <OrderPanel
              unit={selectedUnit}
              moveMode={moveMode}
              movePath={movePath}
              onEnterMoveMode={onEnterMoveMode}
              onConfirmMove={onConfirmMove}
              onCancelMove={onCancelMove}
              onClearOrders={onClearOrders}
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

function OrderPanel({ unit, moveMode, movePath, onEnterMoveMode, onConfirmMove, onCancelMove, onClearOrders }) {
  const hasPath = movePath.length >= 2;

  return (
    <div style={{
      marginTop: 16,
      borderTop: '1px solid #1e293b',
      paddingTop: 12,
    }}>
      {/* Selected unit info */}
      <div style={{ marginBottom: 10 }}>
        <p style={STAT_LABEL}>Selected Unit</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: unit.factionColor ?? '#60a5fa',
            display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>
            {unit.type}
          </span>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>
            {unit.hp != null ? `${unit.hp} HP` : `×${unit.quantity}`}
          </span>
        </div>
        {unit.standing_order && (
          <Tag label={unit.standing_order} color="#6366f1" />
        )}
      </div>

      {/* Move mode state */}
      {moveMode ? (
        <div>
          <p style={{ color: '#fbbf24', fontSize: 11, marginBottom: 8 }}>
            Click destination hexes to add waypoints ({movePath.length - 1} step{movePath.length !== 2 ? 's' : ''} planned).
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{ ...BTN.base, ...BTN.confirm, opacity: hasPath ? 1 : 0.5 }}
              disabled={!hasPath}
              onClick={onConfirmMove}
            >
              Confirm Move
            </button>
            <button style={{ ...BTN.base, ...BTN.cancel }} onClick={onCancelMove}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button style={{ ...BTN.base, ...BTN.move }} onClick={onEnterMoveMode}>
            Move
          </button>
          <button style={{ ...BTN.base, ...BTN.clear }} onClick={onClearOrders}>
            Clear Orders
          </button>
        </div>
      )}
    </div>
  );
}
