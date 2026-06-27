import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  const [addForm, setAddForm] = useState({ username: '', name: '', color: '#ef4444' });
  const [unitForm, setUnitForm] = useState({ factionId: '', type: 'Infantry', q: 0, r: 0, qty: 1 });
  const [turnStatus, setTurnStatus] = useState([]);
  const [msg, setMsg] = useState('');

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
    if (gr.ok) { const gs = await gr.json(); setGame(gs.find(g => g.id === gameId)); }
    if (fr.ok) setFactions(await fr.json());
    if (pr.ok) setParticipants(await pr.json());
    if (ts.ok) setTurnStatus(await ts.json());
  }

  useEffect(() => { load(); }, [gameId]);

  async function addFaction(e) {
    e.preventDefault();
    const h = await headers();
    const participant = participants.find(p => p.profiles?.username === addForm.username);
    if (!participant) return setMsg(`User "${addForm.username}" not found in this game.`);
    const r = await fetch(`${SERVER}/api/games/${gameId}/factions`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ profile_id: participant.profiles.id, name: addForm.name, color: addForm.color }),
    });
    if (r.ok) { setMsg('Faction added.'); load(); } else { const d = await r.json(); setMsg(d.error); }
  }

  async function placeUnit(e) {
    e.preventDefault();
    const h = await headers();
    const r = await fetch(`${SERVER}/api/gm/${gameId}/units`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ faction_id: unitForm.factionId, unit_type_name: unitForm.type, hex_q: Number(unitForm.q), hex_r: Number(unitForm.r), quantity: Number(unitForm.qty) }),
    });
    if (r.ok) setMsg('Unit placed.'); else { const d = await r.json(); setMsg(d.error); }
  }

  async function advanceTurn() {
    const h = await headers();
    const r = await fetch(`${SERVER}/api/gm/${gameId}/advance-turn`, { method: 'POST', headers: h });
    if (r.ok) { setMsg('Turn advanced.'); load(); } else setMsg('Error advancing turn.');
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
      </div>

      {msg && <p style={{ color: '#fbbf24', marginBottom: 12, fontSize: 13 }}>{msg}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        <div>
          <HexMap gameId={gameId} isGM />
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
                <span style={{ color: '#fbbf24', fontSize: 11, marginLeft: 'auto' }}>Mat:{f.materials} Man:{f.manpower}</span>
              </div>
            ))}
            <form onSubmit={addFaction} style={{ marginTop: 12, borderTop: '1px solid #1e293b', paddingTop: 12 }}>
              <div style={s.label}>Add faction by username</div>
              <input style={s.input} placeholder="username" value={addForm.username} onChange={e => setAddForm(f => ({ ...f, username: e.target.value }))} />
              <input style={s.input} placeholder="Faction name" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <label style={{ ...s.label, marginBottom: 0 }}>Color</label>
                <input type="color" value={addForm.color} onChange={e => setAddForm(f => ({ ...f, color: e.target.value }))} />
              </div>
              <button style={s.btn} type="submit">Add Faction</button>
            </form>
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
