import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

const s = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#111827', border: '1px solid #1e293b', borderRadius: 10,
    padding: 28, width: 520, maxHeight: '85vh', overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 20,
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title:  { color: '#e2e8f0', fontSize: 18, fontWeight: 700 },
  closeBtn: { background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer', lineHeight: 1 },
  section: { display: 'flex', flexDirection: 'column', gap: 10 },
  sectionTitle: { color: '#94a3b8', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' },
  row:    { display: 'flex', gap: 8, alignItems: 'center' },
  input:  { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, padding: '7px 10px', color: '#e2e8f0', fontSize: 14, flex: 1 },
  btn:    { background: '#2563eb', border: 'none', borderRadius: 4, padding: '7px 14px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' },
  dangerBtn: { background: '#7f1d1d', border: '1px solid #991b1b', borderRadius: 4, padding: '7px 14px', color: '#fca5a5', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  factionCard: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: 12 },
  factionName: { color: '#e2e8f0', fontWeight: 600, fontSize: 14, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 },
  colorDot: (c) => ({ width: 12, height: 12, borderRadius: '50%', background: c, flexShrink: 0 }),
  select: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, padding: '6px 8px', color: '#e2e8f0', fontSize: 13, flex: 1 },
  unassigned: { color: '#64748b', fontSize: 13, fontStyle: 'italic' },
  msg: { color: '#4ade80', fontSize: 13 },
  err: { color: '#f87171', fontSize: 13 },
  divider: { borderColor: '#1e293b' },
};

export default function ConfigureGameModal({ game, onClose, onSaved }) {
  const [gameName, setGameName]   = useState(game.name);
  const [factions, setFactions]   = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` };
  }

  async function load() {
    const h = await authHeaders();
    const [fr, pr] = await Promise.all([
      fetch(`${SERVER}/api/games/${game.id}/factions`, { headers: h }),
      fetch(`${SERVER}/api/gm/players`, { headers: h }),
    ]);
    if (fr.ok) setFactions(await fr.json());
    if (pr.ok) setAllPlayers(await pr.json());
  }

  useEffect(() => { load(); }, [game.id]);

  async function saveName(e) {
    e.preventDefault();
    setMsg(''); setErr('');
    const h = await authHeaders();
    const r = await fetch(`${SERVER}/api/games/${game.id}`, {
      method: 'PATCH', headers: h, body: JSON.stringify({ name: gameName }),
    });
    if (r.ok) { setMsg('Name saved.'); onSaved?.(); }
    else { const d = await r.json(); setErr(d.error ?? 'Failed to save'); }
  }

  async function assignPlayer(factionId, profileId) {
    setMsg(''); setErr('');
    const h = await authHeaders();
    const r = await fetch(`${SERVER}/api/gm/${game.id}/factions/${factionId}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ profile_id: profileId || null }),
    });
    if (r.ok) { load(); setMsg('Assignment saved.'); onSaved?.(); }
    else { const d = await r.json(); setErr(d.error ?? 'Failed to assign'); }
  }

  async function deleteGame() {
    if (!confirm(`Delete game "${game.name}" and all its data? This cannot be undone.`)) return;
    const h = await authHeaders();
    const r = await fetch(`${SERVER}/api/gm/${game.id}`, { method: 'DELETE', headers: h });
    if (r.ok) { onClose(); onSaved?.(); }
    else { const d = await r.json(); setErr(d.error ?? 'Failed to delete game'); }
  }

  const availablePlayers = allPlayers;

  return (
    <div style={s.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        <div style={s.header}>
          <span style={s.title}>Configure: {game.name}</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {msg && <p style={s.msg}>{msg}</p>}
        {err && <p style={s.err}>{err}</p>}

        {/* ── Rename ── */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Game Name</div>
          <form onSubmit={saveName} style={s.row}>
            <input style={s.input} value={gameName} onChange={e => setGameName(e.target.value)} required />
            <button style={s.btn} type="submit">Save</button>
          </form>
        </div>

        <hr style={s.divider} />

        {/* ── Player Assignment ── */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Faction → Player Assignment</div>
          {factions.length === 0 && (
            <p style={s.unassigned}>No factions yet. Load a map with faction slots to populate this list.</p>
          )}
          {factions.map(f => (
            <div key={f.id} style={s.factionCard}>
              <div style={s.factionName}>
                <span style={s.colorDot(f.color)} />
                {f.name}
              </div>
              <div style={s.row}>
                <select
                  style={s.select}
                  value={f.profile_id ?? ''}
                  onChange={e => assignPlayer(f.id, e.target.value)}
                >
                  <option value="">— unassigned —</option>
                  {availablePlayers.map(p => (
                    <option key={p.id} value={p.id}>{p.username}</option>
                  ))}
                </select>
                {f.profile_id && (
                  <button style={{ ...s.btn, background: '#374151' }} onClick={() => assignPlayer(f.id, '')}>
                    Unassign
                  </button>
                )}
              </div>
            </div>
          ))}
          {factions.length > 0 && availablePlayers.length === 0 && (
            <p style={s.unassigned}>No registered players yet. Players register via the login page.</p>
          )}
        </div>

        <hr style={s.divider} />

        {/* ── Danger Zone ── */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Danger Zone</div>
          <button style={s.dangerBtn} onClick={deleteGame}>Delete This Game</button>
        </div>
      </div>
    </div>
  );
}
