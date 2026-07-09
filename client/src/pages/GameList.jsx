import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import ConfigureGameModal from '../components/ConfigureGameModal';

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
  label: { color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' },
  field: { display: 'flex', flexDirection: 'column', marginRight: 8 },
  form:  { background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 20, marginBottom: 28 },
  row:   { display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 12 },
  settingDesc: { color: '#64748b', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
};

export default function GameList() {
  const { profile, signOut } = useAuth();
  const [games, setGames]       = useState([]);
  const [maps, setMaps]         = useState([]);
  const [settings, setSettings] = useState([]);
  const [newName, setNewName]   = useState('');
  const [selectedMapId, setSelectedMapId]         = useState('');
  const [selectedSettingId, setSelectedSettingId] = useState('');
  const [configuringGame, setConfiguringGame]     = useState(null);
  const nav = useNavigate();

  async function load() {
    const { data: { session: sess } } = await supabase.auth.getSession();
    const tok = sess?.access_token;
    const headers = { Authorization: `Bearer ${tok}` };
    const [gr, mr, sr] = await Promise.all([
      fetch(`${SERVER}/api/games`, { headers }),
      fetch(`${SERVER}/api/maps`, { headers }),
      fetch(`${SERVER}/api/settings`, { headers }),
    ]);
    if (gr.ok) setGames(await gr.json());
    if (mr.ok) setMaps(await mr.json());
    if (sr.ok) {
      const sData = await sr.json();
      setSettings(sData);
      if (sData.length > 0 && !selectedSettingId) setSelectedSettingId(sData[0].id);
    }
  }

  useEffect(() => { load(); }, []);

  const activeSetting = settings.find(s => s.id === selectedSettingId);

  async function createGame(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    if (!selectedSettingId) return;
    const { data: { session: sess } } = await supabase.auth.getSession();
    const body = { name: newName, setting_id: selectedSettingId };
    if (selectedMapId) body.map_id = selectedMapId;
    const r = await fetch(`${SERVER}/api/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.access_token}` },
      body: JSON.stringify(body),
    });
    if (r.ok) { setNewName(''); setSelectedMapId(''); load(); }
    else {
      const err = await r.json().catch(() => ({}));
      alert(err.error ?? 'Failed to create game');
    }
  }

  return (
    <div style={s.page}>
      <div style={s.head}>
        <h1 style={s.h1}>Wargame — {profile?.username ?? '…'}</h1>
        <button style={s.sign} onClick={signOut}>Sign Out</button>
      </div>

      {profile?.global_role === 'gm' && (
        <form onSubmit={createGame} style={s.form}>
          <div style={{ color: '#94a3b8', fontWeight: 600, marginBottom: 12 }}>New Game</div>
          <div style={s.row}>
            <div style={s.field}>
              <label style={s.label}>Game name</label>
              <input
                style={{ ...s.input, marginRight: 0 }}
                placeholder="e.g. Campaign 1940"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>

            <div style={s.field}>
              <label style={s.label}>Setting</label>
              <select
                style={{ ...s.input, marginRight: 0, minWidth: 160 }}
                value={selectedSettingId}
                onChange={e => setSelectedSettingId(e.target.value)}
                required
              >
                <option value="">— choose setting —</option>
                {settings.map(st => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
            </div>

            <div style={s.field}>
              <label style={s.label}>Map (optional)</label>
              <select
                style={{ ...s.input, marginRight: 0, minWidth: 160 }}
                value={selectedMapId}
                onChange={e => setSelectedMapId(e.target.value)}
              >
                <option value="">— blank map —</option>
                {maps.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.hex_count} hexes)</option>
                ))}
              </select>
            </div>

            <button style={s.newBtn} type="submit" disabled={!newName.trim() || !selectedSettingId}>
              Create Game
            </button>
          </div>
          {activeSetting?.description && (
            <div style={s.settingDesc}>{activeSetting.description}</div>
          )}
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
            {(profile?.global_role !== 'gm' || g.player_faction_id) && (
              <button style={s.btn} onClick={() => {
                const url = profile?.global_role === 'gm' && g.player_faction_id
                  ? `/game/${g.id}?viewAs=${g.player_faction_id}`
                  : `/game/${g.id}`;
                nav(url);
              }}>Play</button>
            )}
            {profile?.global_role === 'gm' && (
              <>
                <button style={{ ...s.btn, background: '#7c3aed' }} onClick={() => nav(`/game/${g.id}/gm`)}>GM</button>
                <button style={{ ...s.btn, background: '#0f766e' }} onClick={() => setConfiguringGame(g)}>Configure</button>
              </>
            )}
          </div>
        </div>
      ))}

      {configuringGame && (
        <ConfigureGameModal
          game={configuringGame}
          onClose={() => setConfiguringGame(null)}
          onSaved={() => { load(); setConfiguringGame(null); }}
        />
      )}
    </div>
  );
}
