import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import HexMap from '../components/HexMap';

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

const s = {
  page: { minHeight: '100vh', background: '#0a0f1a', padding: 20 },
  head: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 },
  h1:   { color: '#e2e8f0', fontSize: 20, fontWeight: 700 },
  sub:  { color: '#64748b', fontSize: 14 },
  back: { background: 'none', border: '1px solid #1e293b', color: '#94a3b8', padding: '5px 12px', borderRadius: 4, cursor: 'pointer' },
  resources: { display: 'flex', gap: 16, marginBottom: 20 },
  res:  { background: '#111827', border: '1px solid #1e293b', borderRadius: 6, padding: '8px 16px' },
  rl:   { color: '#64748b', fontSize: 11 },
  rv:   { color: '#fbbf24', fontWeight: 700, fontSize: 16 },
};

export default function GameView() {
  const { gameId } = useParams();
  const { profile } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  // GM can pass ?viewAs=factionId to impersonate a player's view
  const viewAsFactionId = searchParams.get('viewAs') ?? null;

  const [game, setGame] = useState(null);
  const [faction, setFaction] = useState(null);
  const [turnReady, setTurnReady] = useState(false);
  const [turnMsg, setTurnMsg] = useState('');

  async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' };
  }

  useEffect(() => {
    (async () => {
      const headers = await authHeaders();

      const [gr, fr] = await Promise.all([
        fetch(`${SERVER}/api/games`, { headers }),
        fetch(`${SERVER}/api/games/${gameId}/factions`, { headers }),
      ]);

      if (gr.ok) {
        const games = await gr.json();
        setGame(games.find(g => g.id === gameId));
      }
      if (fr.ok) {
        const factions = await fr.json();
        // If GM viewing as a faction, show that faction's resources
        if (viewAsFactionId) {
          setFaction(factions.find(f => f.id === viewAsFactionId));
        } else {
          setFaction(factions.find(f => f.profiles?.id === profile?.id || f.profile_id === profile?.id));
        }
      }
    })();
  }, [gameId, profile]);

  async function finishTurn() {
    const headers = await authHeaders();
    const r = await fetch(`${SERVER}/api/games/${gameId}/finish-turn`, { method: 'POST', headers });
    if (r.ok) {
      const d = await r.json();
      setTurnReady(true);
      setTurnMsg(d.advanced ? `Turn ${d.current_turn} started!` : `Waiting on ${d.waiting_on} other player(s)…`);
      if (d.advanced) setGame(g => ({ ...g, current_turn: d.current_turn }));
    } else {
      setTurnMsg('Error submitting turn.');
    }
  }

  return (
    <div style={s.page}>
      <div style={s.head}>
        {viewAsFactionId
          ? <button style={s.back} onClick={() => nav(`/gm/${gameId}`)}>← GM Dashboard</button>
          : <button style={s.back} onClick={() => nav('/')}>← Games</button>
        }
        <div>
          <div style={s.h1}>{game?.name ?? '…'}</div>
          <div style={s.sub}>Turn {game?.current_turn ?? '—'} · {game?.current_phase ?? '—'}</div>
        </div>
      </div>

      {/* Win condition banner */}
      {game?.winner_faction_id && (
        <div style={{
          background: '#052e16', border: '2px solid #16a34a', borderRadius: 8,
          padding: '10px 18px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>★</span>
          <span style={{ color: '#4ade80', fontSize: 15, fontWeight: 700 }}>
            {game.winner_faction_id === faction?.id ? 'Victory!' : 'Defeat'} — Game over.
          </span>
        </div>
      )}

      {/* GM viewing as player banner */}
      {viewAsFactionId && faction && (
        <div style={{
          background: '#1c1917', border: '1px solid #d97706', borderRadius: 6,
          padding: '6px 14px', marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 14 }}>👁</span>
          <span style={{ color: '#fbbf24', fontSize: 13, fontWeight: 700 }}>
            GM — Viewing as {faction.name}
          </span>
          <span style={{ color: '#78716c', fontSize: 12 }}>
            Orders placed here will be submitted on their behalf.
          </span>
        </div>
      )}

      {faction && (
        <div style={s.resources}>
          <div style={s.res}>
            <div style={s.rl}>Materials</div>
            <div style={s.rv}>{faction.materials ?? 0}</div>
          </div>
          <div style={s.res}>
            <div style={s.rl}>Manpower</div>
            <div style={s.rv}>{faction.manpower ?? 0}</div>
          </div>
          <div style={{ ...s.res, borderColor: '#7c3aed' }}>
            <div style={s.rl}>Faction</div>
            <div style={{ ...s.rv, color: faction.color ?? '#60a5fa' }}>{faction.name}</div>
          </div>
        </div>
      )}

      {/* Finish Turn */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button
          onClick={finishTurn}
          disabled={turnReady}
          style={{
            background: turnReady ? '#1e293b' : '#16a34a',
            border: 'none', borderRadius: 4, padding: '8px 20px',
            color: turnReady ? '#475569' : '#fff', fontWeight: 700, cursor: turnReady ? 'default' : 'pointer',
          }}
        >
          {turnReady ? 'Orders Submitted' : 'Finish Turn'}
        </button>
        {turnMsg && <span style={{ color: '#94a3b8', fontSize: 13 }}>{turnMsg}</span>}
      </div>

      <HexMap
        gameId={gameId}
        isGM={false}
        viewAsFactionId={viewAsFactionId}
        playerFactionId={faction?.id ?? null}
        faction={faction}
      />
    </div>
  );
}
