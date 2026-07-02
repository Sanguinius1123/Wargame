import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import HexMap from '../components/HexMap';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

const s = {
  page: { minHeight: '100vh', background: '#0a0f1a', padding: 20 },
  head: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 },
  h1:   { color: '#e2e8f0', fontSize: 20, fontWeight: 700 },
  back: { background: 'none', border: '1px solid #1e293b', color: '#94a3b8', padding: '5px 12px', borderRadius: 4, cursor: 'pointer' },
  btn:  { background: '#2563eb', border: 'none', borderRadius: 4, padding: '7px 16px', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  advBtn: { background: '#16a34a', border: 'none', borderRadius: 4, padding: '7px 16px', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  panel: { background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 16, marginBottom: 16 },
  h2:   { color: '#94a3b8', fontSize: 14, fontWeight: 600, marginBottom: 12 },
  label: { color: '#64748b', fontSize: 12, marginBottom: 3 },
  input: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, padding: '6px 8px', color: '#e2e8f0', fontSize: 13, width: '100%', boxSizing: 'border-box', marginBottom: 8 },
  factionRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  dot:  (color) => ({ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }),
};

export default function GMDashboard() {
  const { gameId } = useParams();
  const nav = useNavigate();
  const [game, setGame] = useState(null);
  const [factions, setFactions] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [addForm, setAddForm] = useState({ profileId: '', name: '', color: '#ef4444' });
  const [allProfiles, setAllProfiles] = useState([]);
  const [unitForm, setUnitForm] = useState({ factionId: '', type: 'Infantry', q: 0, r: 0, qty: 1 });
  const [turnStatus, setTurnStatus] = useState([]);
  const [autoResolve, setAutoResolve] = useState(true);
  const [msg, setMsg] = useState('');
  const [mapKey, setMapKey] = useState(0);
  const [combatLog, setCombatLog] = useState(null);
  const [logTurn, setLogTurn] = useState(null);
  const [bridgeMode, setBridgeMode] = useState(false);
  const [bridgePicks, setBridgePicks] = useState([]);
  const [maps, setMaps] = useState([]);
  const [mapSaveForm, setMapSaveForm] = useState({ name: '', description: '' });
  const [showMapList, setShowMapList] = useState(false);

  async function headers() {
    const { data: { session } } = await supabase.auth.getSession();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` };
  }

  async function load() {
    const h = await headers();
    const [gr, fr, pr, ts] = await Promise.all([
      fetch(`${SERVER}/api/games`, { headers: h }),
      fetch(`${SERVER}/api/games/${gameId}/factions`, { headers: h }),
      fetch(`${SERVER}/api/games/${gameId}/participants`, { headers: h }),
      fetch(`${SERVER}/api/games/${gameId}/turn-status`, { headers: h }),
    ]);
    if (gr.ok) { const gs = await gr.json(); const g = gs.find(g => g.id === gameId); setGame(g); if (g) setAutoResolve(g.auto_resolve ?? true); }
    if (fr.ok) setFactions(await fr.json());
    if (pr.ok) setParticipants(await pr.json());
    if (ts.ok) setTurnStatus(await ts.json());
  }

  useEffect(() => {
    load();
    supabase.from('profiles').select('id, username').then(({ data }) => setAllProfiles(data ?? []));
    loadMaps();

    // Reload map and sidebar when any client or the server advances the turn
    const channel = supabase
      .channel(`gm-turn-watch-${gameId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => { load(); setMapKey(k => k + 1); }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [gameId]);

  async function addFaction(e) {
    e.preventDefault();
    if (!addForm.profileId) return setMsg('Select a user.');
    const h = await headers();
    const r = await fetch(`${SERVER}/api/games/${gameId}/factions`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ profile_id: addForm.profileId, name: addForm.name, color: addForm.color }),
    });
    if (r.ok) { setMsg('Faction added.'); setAddForm(f => ({ ...f, profileId: '', name: '' })); load(); }
    else { const d = await r.json(); setMsg(d.error); }
  }

  async function placeUnit(e) {
    e.preventDefault();
    const h = await headers();
    const r = await fetch(`${SERVER}/api/gm/${gameId}/units`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ faction_id: unitForm.factionId, unit_type_name: unitForm.type, hex_q: Number(unitForm.q), hex_r: Number(unitForm.r), quantity: Number(unitForm.qty) }),
    });
    if (r.ok) { setMsg('Unit placed.'); setMapKey(k => k + 1); } else { const d = await r.json(); setMsg(d.error); }
  }

  async function advanceTurn() {
    const h = await headers();
    const r = await fetch(`${SERVER}/api/gm/${gameId}/advance-turn`, { method: 'POST', headers: h });
    if (r.ok) { setMsg('Turn advanced.'); load(); setMapKey(k => k + 1); } else setMsg('Error advancing turn.');
  }

  async function loadCombatLog(turn) {
    const h = await headers();
    const url = turn != null
      ? `${SERVER}/api/gm/${gameId}/combat-log?turn=${turn}`
      : `${SERVER}/api/gm/${gameId}/combat-log`;
    const r = await fetch(url, { headers: h });
    if (r.ok) {
      const d = await r.json();
      setCombatLog(d);
      setLogTurn(d.turn);
    }
  }

  async function loadMaps() {
    const h = await headers();
    const r = await fetch(`${SERVER}/api/maps`, { headers: h });
    if (r.ok) setMaps(await r.json());
  }

  async function saveAsMap(e) {
    e.preventDefault();
    if (!mapSaveForm.name.trim()) return setMsg('Map name required.');
    const h = await headers();
    const r = await fetch(`${SERVER}/api/gm/${gameId}/save-as-map`, {
      method: 'POST', headers: h,
      body: JSON.stringify(mapSaveForm),
    });
    const d = await r.json();
    if (r.ok) {
      setMsg(`Saved "${d.name}" (${d.hex_count} hexes).`);
      setMapSaveForm({ name: '', description: '' });
      loadMaps();
    } else {
      setMsg(d.error ?? 'Failed to save map.');
    }
  }

  async function loadMapIntoGame(mapId, mapName) {
    if (!confirm(`Load "${mapName}"? This will clear all hexes, units, and buildings in this game.`)) return;
    const h = await headers();
    const r = await fetch(`${SERVER}/api/gm/${gameId}/load-map/${mapId}`, { method: 'POST', headers: h });
    const d = await r.json();
    if (r.ok) {
      setMsg(`Loaded "${mapName}" (${d.loaded} hexes).`);
      setShowMapList(false);
      setMapKey(k => k + 1);
    } else {
      setMsg(d.error ?? 'Failed to load map.');
    }
  }

  async function deleteGame() {
    if (!confirm(`Permanently delete "${game?.name}"? This cannot be undone — all hexes, units, orders, and fog-of-war data will be erased.`)) return;
    const h = await headers();
    const r = await fetch(`${SERVER}/api/gm/${gameId}`, { method: 'DELETE', headers: h });
    if (r.ok) nav('/');
    else { const d = await r.json(); setMsg(d.error ?? 'Delete failed.'); }
  }

  async function toggleAutoResolve(val) {
    setAutoResolve(val);
    const h = await headers();
    await fetch(`${SERVER}/api/gm/${gameId}/settings`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ auto_resolve: val }),
    });
  }

  function handleHexSelect(h) {
    if (!bridgeMode) {
      setUnitForm(f => ({ ...f, q: h.hex_q, r: h.hex_r }));
      return;
    }
    const step = bridgePicks.length;
    if (step === 0) {
      if (h.terrain === 'water') { setMsg('Step 1: pick a land hex first.'); return; }
      setBridgePicks([h]);
      setMsg('Step 2/3 — click the water hex.');
    } else if (step === 1) {
      if (h.terrain !== 'water') { setMsg('Step 2: pick the water hex.'); return; }
      setBridgePicks(p => [...p, h]);
      setMsg('Step 3/3 — click the second land hex.');
    } else if (step === 2) {
      if (h.terrain === 'water') { setMsg('Step 3: pick a land hex.'); return; }
      if (h.hex_q === bridgePicks[0].hex_q && h.hex_r === bridgePicks[0].hex_r) {
        setMsg('Step 3: must be a different hex than the first.'); return;
      }
      placeBridge([bridgePicks[0], bridgePicks[1], h]);
    }
  }

  async function placeBridge(hexes) {
    const h = await headers();
    await Promise.all(hexes.map(hex =>
      fetch(`${SERVER}/api/map/${gameId}/hexes/${hex.hex_q}/${hex.hex_r}`, {
        method: 'PATCH', headers: h,
        body: JSON.stringify({
          has_road: true,
          ...(hex.terrain === 'water' ? { has_bridge: true } : {}),
        }),
      })
    ));
    setMsg('Bridge placed.');
    setBridgeMode(false);
    setBridgePicks([]);
    setMapKey(k => k + 1);
  }

  const unitTypes = [
    'Infantry','Armor','Artillery','AT Gun','AA Gun','Supply','Recon',
    'Fighter','Scout Plane','Bomber','Transport Plane',
    'Destroyer','Frigate','Cruiser','Battleship','Transport Ship','Carrier','Submarine',
  ];

  return (
    <div style={s.page}>
      <div style={s.head}>
        <button style={s.back} onClick={() => nav('/')}>← Games</button>
        <div style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700 }}>GM Dashboard — {game?.name ?? '…'}</div>
        <div style={{ color: '#64748b', fontSize: 14 }}>Turn {game?.current_turn ?? '—'}</div>
        <button style={s.advBtn} onClick={advanceTurn}>Advance Turn</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}
          title="When checked, the turn auto-advances once all players click Finish Turn. Uncheck to require GM to manually commit each turn.">
          <input type="checkbox" checked={autoResolve} onChange={e => toggleAutoResolve(e.target.checked)} />
          Auto-resolve when all ready
        </label>
        <button
          onClick={deleteGame}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid #7f1d1d', color: '#f87171', borderRadius: 4, padding: '5px 14px', cursor: 'pointer', fontSize: 13 }}
        >
          Delete Game
        </button>
      </div>

      {/* Win condition banner */}
      {game?.winner_faction_id && (() => {
        const wf = factions.find(f => f.id === game.winner_faction_id);
        return (
          <div style={{
            background: '#052e16', border: '2px solid #16a34a', borderRadius: 8,
            padding: '10px 18px', marginBottom: 16,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 18 }}>★</span>
            <span style={{ color: '#4ade80', fontSize: 15, fontWeight: 700 }}>
              {wf ? wf.name : 'A faction'} has won the game!
            </span>
          </div>
        );
      })()}

      {msg && <p style={{ color: '#fbbf24', marginBottom: 12, fontSize: 13 }}>{msg}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        <div>
          <HexMap gameId={gameId} isGM refreshKey={mapKey} onHexSelect={handleHexSelect} />
        </div>

        <div>
          {/* Turn Status */}
          {turnStatus.length > 0 && (
            <div style={s.panel}>
              <div style={s.h2}>Turn Status</div>
              {turnStatus.map(p => (
                <div key={p.username} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.ready ? '#22c55e' : '#ef4444', flexShrink: 0 }} />
                  <span style={{ color: '#e2e8f0', fontSize: 13 }}>{p.username}</span>
                  <span style={{ color: p.ready ? '#22c55e' : '#64748b', fontSize: 11, marginLeft: 'auto' }}>{p.ready ? 'Ready' : 'Ordering…'}</span>
                </div>
              ))}
            </div>
          )}

          {/* Factions */}
          <div style={s.panel}>
            <div style={s.h2}>Factions</div>
            {factions.map(f => (
              <div key={f.id} style={s.factionRow}>
                <div style={s.dot(f.color)} />
                <span style={{ color: '#e2e8f0', fontSize: 13 }}>{f.name}</span>
                <span style={{ color: '#64748b', fontSize: 11 }}>({f.profiles?.username})</span>
                <span style={{ color: '#fbbf24', fontSize: 11 }}>Mat:{f.materials} Man:{f.manpower}</span>
                <button
                  style={{ background: 'none', border: '1px solid #334155', borderRadius: 3, padding: '2px 7px', color: '#94a3b8', fontSize: 11, cursor: 'pointer', marginLeft: 'auto' }}
                  title={`View the game as ${f.name} — see their FOW, give orders on their behalf`}
                  onClick={() => nav(`/game/${gameId}?viewAs=${f.id}`)}
                >
                  View as
                </button>
              </div>
            ))}
            <form onSubmit={addFaction} style={{ marginTop: 12, borderTop: '1px solid #1e293b', paddingTop: 12 }}>
              <div style={s.label}>Add faction — select player</div>
              <select style={s.input} value={addForm.profileId} onChange={e => setAddForm(f => ({ ...f, profileId: e.target.value }))}>
                <option value="">— choose user —</option>
                {allProfiles.map(p => (
                  <option key={p.id} value={p.id}>{p.username}</option>
                ))}
              </select>
              <input style={s.input} placeholder="Faction name" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <label style={{ ...s.label, marginBottom: 0 }}>Color</label>
                <input type="color" value={addForm.color} onChange={e => setAddForm(f => ({ ...f, color: e.target.value }))} />
              </div>
              <button style={s.btn} type="submit">Add Faction</button>
            </form>
          </div>

          {/* Combat Log */}
          <div style={s.panel}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={s.h2}>Combat Log</div>
              <button
                style={{ ...s.btn, padding: '3px 10px', fontSize: 12, marginLeft: 'auto' }}
                onClick={() => loadCombatLog(null)}
              >
                {combatLog ? 'Reload' : 'Load'}
              </button>
            </div>
            {combatLog && (
              <CombatLogViewer
                log={combatLog}
                onPrev={() => logTurn > 0 && loadCombatLog(logTurn - 1)}
                onNext={() => logTurn < (combatLog.current_turn - 1) && loadCombatLog(logTurn + 1)}
              />
            )}
            {!combatLog && (
              <p style={{ color: '#64748b', fontSize: 12 }}>Click Load to view the last resolved turn's combat events.</p>
            )}
          </div>

          {/* Bridge Tool */}
          <div style={s.panel}>
            <div style={s.h2}>Bridge Tool</div>
            {!bridgeMode ? (
              <button style={s.btn} onClick={() => { setBridgeMode(true); setBridgePicks([]); setMsg('Step 1/3 — click the first land hex.'); }}>
                Place Bridge
              </button>
            ) : (
              <div>
                <div style={{ color: '#fbbf24', fontSize: 12, marginBottom: 8 }}>
                  {bridgePicks.length === 0 && 'Step 1/3 — click the first land hex'}
                  {bridgePicks.length === 1 && 'Step 2/3 — click the water hex'}
                  {bridgePicks.length === 2 && 'Step 3/3 — click the second land hex'}
                </div>
                {bridgePicks.map((p, i) => (
                  <div key={i} style={{ color: '#94a3b8', fontSize: 11, marginBottom: 3 }}>
                    {['Land start', 'Water', 'Land end'][i]}: ({p.hex_q}, {p.hex_r})
                  </div>
                ))}
                <button style={{ ...s.btn, background: '#374151', marginTop: 8 }}
                  onClick={() => { setBridgeMode(false); setBridgePicks([]); setMsg(''); }}>
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Map Library */}
          <div style={s.panel}>
            <div style={s.h2}>Map Library</div>
            <form onSubmit={saveAsMap} style={{ marginBottom: 10 }}>
              <div style={s.label}>Save current map as template</div>
              <input style={s.input} placeholder="Template name…" value={mapSaveForm.name} onChange={e => setMapSaveForm(f => ({ ...f, name: e.target.value }))} />
              <input style={s.input} placeholder="Description (optional)" value={mapSaveForm.description} onChange={e => setMapSaveForm(f => ({ ...f, description: e.target.value }))} />
              <button style={s.btn} type="submit">Save as Map</button>
            </form>
            <div style={{ borderTop: '1px solid #1e293b', paddingTop: 10 }}>
              <button
                style={{ ...s.btn, background: '#374151', width: '100%', marginBottom: 8 }}
                onClick={() => { setShowMapList(v => !v); if (!showMapList) loadMaps(); }}
              >
                {showMapList ? 'Hide' : `Load a Map (${maps.length} saved)`}
              </button>
              {showMapList && maps.length === 0 && (
                <p style={{ color: '#64748b', fontSize: 12 }}>No saved maps yet.</p>
              )}
              {showMapList && maps.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#e2e8f0', fontSize: 13 }}>{m.name}</div>
                    {m.description && <div style={{ color: '#64748b', fontSize: 11 }}>{m.description}</div>}
                    <div style={{ color: '#475569', fontSize: 11 }}>{m.hex_count} hexes</div>
                  </div>
                  <button
                    style={{ ...s.btn, background: '#7c3aed', padding: '4px 10px', fontSize: 12, flexShrink: 0 }}
                    onClick={() => loadMapIntoGame(m.id, m.name)}
                  >
                    Load
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Place unit */}
          <div style={s.panel}>
            <div style={s.h2}>Place Unit</div>
            <form onSubmit={placeUnit}>
              <div style={s.label}>Faction</div>
              <select style={{ ...s.input, cursor: 'pointer' }} value={unitForm.factionId} onChange={e => setUnitForm(f => ({ ...f, factionId: e.target.value }))}>
                <option value="">— select —</option>
                {factions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <div style={s.label}>Unit Type</div>
              <select style={{ ...s.input, cursor: 'pointer' }} value={unitForm.type} onChange={e => setUnitForm(f => ({ ...f, type: e.target.value }))}>
                {unitTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                <div>
                  <div style={s.label}>Q</div>
                  <input style={s.input} type="number" value={unitForm.q} onChange={e => setUnitForm(f => ({ ...f, q: e.target.value }))} />
                </div>
                <div>
                  <div style={s.label}>R</div>
                  <input style={s.input} type="number" value={unitForm.r} onChange={e => setUnitForm(f => ({ ...f, r: e.target.value }))} />
                </div>
                <div>
                  <div style={s.label}>Qty</div>
                  <input style={s.input} type="number" min="1" value={unitForm.qty} onChange={e => setUnitForm(f => ({ ...f, qty: e.target.value }))} />
                </div>
              </div>
              <button style={s.btn} type="submit">Place</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

const PHASE_NAMES = { 1: 'Phase 1 — Air', 2: 'Phase 2 — Naval', 3: 'Phase 3 — Ground', 4: 'Phase 4 — Resolution' };
const LOG_TYPE_COLOR = { combat: '#ef4444', bombardment: '#fb923c', retreat: '#60a5fa', pursuit_roll: '#a78bfa', auto_destroy: '#f87171' };

function CombatLogEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const d = entry.data ?? {};

  function summary() {
    if (d.event === 'auto_destroy') return `Auto-destroyed (no friendly combat unit)`;
    if (d.event === 'retreat') return `Retreated to (${d.to_hex?.q},${d.to_hex?.r})`;
    if (d.event === 'retreat_fire') return `Retreat fire: ${Object.values(d.casualties ?? {}).reduce((s, v) => s + v, 0)} casualties`;
    if (d.event === 'pursuit_roll') return `Pursuit ${d.success ? 'SUCCEEDED' : 'failed'} (rolled ${d.roll}/${d.roll_target})`;
    if (d.event === 'pursuit_auto_fail') return `Pursuit auto-failed (impassable terrain)`;
    if (d.event === 'pursuit_success') return `Pursuit success — pursuer holds hex`;
    if (d.log_type === 'bombardment' || entry.log_type === 'bombardment') {
      return `${d.dice ?? 1} dice → ${d.hits_vs_units ?? 0} unit hits, ${d.hits_vs_infra ?? 0} infra hits`;
    }
    const totalCas = Object.values(d.casualties ?? {}).reduce((s, v) => s + v, 0);
    if (totalCas > 0) return `${d.factions?.length ?? '?'} factions, ${totalCas} casualties`;
    return d.factions?.length ? `${d.factions.length} factions — no casualties` : JSON.stringify(d).slice(0, 60);
  }

  const typeColor = LOG_TYPE_COLOR[entry.log_type] ?? '#94a3b8';

  return (
    <div style={{ marginBottom: 6 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'flex-start' }}
      >
        <span style={{ color: typeColor, fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
          {entry.log_type?.toUpperCase() ?? '?'}
        </span>
        <span style={{ color: '#64748b', fontSize: 11, flexShrink: 0 }}>({entry.hex_q},{entry.hex_r})</span>
        <span style={{ color: '#94a3b8', fontSize: 11 }}>{summary()}</span>
        <span style={{ color: '#334155', fontSize: 10, marginLeft: 'auto' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <pre style={{ color: '#64748b', fontSize: 10, background: '#0f172a', borderRadius: 3, padding: 6, marginTop: 4, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {JSON.stringify(entry.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function CombatLogViewer({ log, onPrev, onNext }) {
  if (!log) return null;
  const entries = log.entries ?? [];

  const byPhase = {};
  for (const e of entries) {
    const ph = e.phase ?? 0;
    if (!byPhase[ph]) byPhase[ph] = [];
    byPhase[ph].push(e);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button onClick={onPrev} style={{ background: 'none', border: '1px solid #1e293b', color: '#64748b', padding: '2px 7px', borderRadius: 3, cursor: 'pointer', fontSize: 12 }}>‹</button>
        <span style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700 }}>Turn {log.turn}</span>
        <button onClick={onNext} style={{ background: 'none', border: '1px solid #1e293b', color: '#64748b', padding: '2px 7px', borderRadius: 3, cursor: 'pointer', fontSize: 12 }}>›</button>
        <span style={{ color: '#4b5563', fontSize: 11 }}>{entries.length} event{entries.length !== 1 ? 's' : ''}</span>
      </div>

      {entries.length === 0 && <p style={{ color: '#4b5563', fontSize: 12 }}>No combat events this turn.</p>}

      {Object.entries(byPhase).sort((a, b) => a[0] - b[0]).map(([phase, phEntries]) => (
        <div key={phase} style={{ marginBottom: 10 }}>
          <p style={{ color: '#475569', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
            {PHASE_NAMES[phase] ?? `Phase ${phase}`}
          </p>
          {phEntries.map(e => <CombatLogEntry key={e.id} entry={e} />)}
        </div>
      ))}
    </div>
  );
}
