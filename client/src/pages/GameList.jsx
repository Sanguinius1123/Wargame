import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

const s = {
  page:  { minHeight: '100vh', background: '#0a0f1a', padding: 32 },
  head:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 },
  h1:    { color: '#e2e8f0', fontSize: 24, fontWeight: 700 },
  sign:  { background: 'none', border: '1px solid #1e293b', color: '#94a3b8', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' },
  card:  { background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 20, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#e2e8f0', fontWeight: 600 },
  sub:   { color: '#64748b', fontSize: 13, marginTop: 2 },
  btn:   { background: '#2563eb', border: 'none', borderRadius: 4, padding: '6px 16px', color: '#fff', cursor: 'pointer' },
  newBtn:{ background: '#16a34a', border: 'none', borderRadius: 4, padding: '8px 18px', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  input: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, padding: '8px 10px', color: '#e2e8f0', fontSize: 14, marginRight: 8 },
};

export default function GameList() {
  const { profile, session, signOut } = useAuth();
  const [games, setGames] = useState([]);
  const [maps, setMaps] = useState([]);
  const [newName, setNewName] = useState('');
  const [selectedMapId, setSelectedMapId] = useState('');
  const nav = useNavigate();

  async function load() {
    const { data: { session: s } } = await supabase.auth.getSession();
    const [gr, mr] = await Promise.all([
      fetch(`${SERVER}/api/games`, { headers: { Authorization: `Bearer ${s?.access_token}` } }),
      fetch(`${SERVER}/api/maps`, { headers: { Authorization: `Bearer ${s?.access_token}` } }),
    ]);
    if (gr.ok) setGames(await gr.json());
    if (mr.ok) setMaps(await mr.json());
  }

  useEffect(() => { load(); }, []);

  async function createGame(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    const { data: { session: s } } = await supabase.auth.getSession();
    const body = { name: newName };
    if (selectedMapId) body.map_id = selectedMapId;
    const r = await fetch(`${SERVER}/api/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token}` },
      body: JSON.stringify(body),
    });
    if (r.ok) { setNewName(''); setSelectedMapId(''); load(); }
  }

  return (
    <div style={s.page}>
      <div style={s.head}>
        <h1 style={s.h1}>Wargame — {profile?.username ?? '…'}</h1>
        <button style={s.sign} onClick={signOut}>Sign Out</button>
      </div>

      {profile?.global_role === 'gm' && (
        <form onSubmit={createGame} style={{ marginBottom: 28, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input style={s.input} placeholder="New game name…" value={newName} onChange={e => setNewName(e.target.value)} />
          <select
            style={{ ...s.input, marginRight: 0, minWidth: 160 }}
            value={selectedMapId}
            onChange={e => setSelectedMapId(e.target.value)}
          >
            <option value="">— no map —</option>
            {maps.map(m => (
              <option key={m.id} value={m.id}>{m.name} ({m.hex_count} hexes)</option>
            ))}
          </select>
          <button style={s.newBtn} type="submit">Create Game</button>
        </form>
      )}

      {games.length === 0 && <p style={{ color: '#64748b' }}>No games yet.</p>}

      {games.map(g => (
        <div key={g.id} style={s.card}>
          <div>
            <div style={s.title}>{g.name}</div>
            <div style={s.sub}>Turn {g.current_turn} · {g.current_phase}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.btn} onClick={() => nav(`/game/${g.id}`)}>Play</button>
            {profile?.global_role === 'gm' && (
              <button style={{ ...s.btn, background: '#7c3aed' }} onClick={() => nav(`/game/${g.id}/gm`)}>GM</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
