import { useEffect, useState, useCallback } from 'react';
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
  const [mapRefreshKey, setMapRefreshKey] = useState(0);
  const [combatLog, setCombatLog] = useState(null);
  const [logTurn, setLogTurn] = useState(null);
  const [showLog, setShowLog] = useState(false);

  async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' };
  }

  async function loadGameState() {
    const headers = await authHeaders();
    const [gr, fr] = await Promise.all([
      fetch(`${SERVER}/api/games`, { headers }),
      fetch(`${SERVER}/api/games/${gameId}/factions`, { headers }),
    ]);
    if (gr.ok) {
      const games = await gr.json();
      const current = games.find(g => g.id === gameId);
      setGame(current);
      // Restore turn_ready for regular player view
      if (current?.turn_ready != null && !viewAsFactionId) {
        setTurnReady(current.turn_ready);
      }
    }
    if (fr.ok) {
      const factions = await fr.json();
      if (viewAsFactionId) {
        const viewedFaction = factions.find(f => f.id === viewAsFactionId);
        setFaction(viewedFaction);
        // Load turn_ready for the viewed player's participant row
        if (viewedFaction?.profile_id) {
          const pr = await fetch(`${SERVER}/api/games/${gameId}/participants`, { headers });
          if (pr.ok) {
            const parts = await pr.json();
            const viewedPart = parts.find(p => p.profile_id === viewedFaction.profile_id);
            if (viewedPart != null) setTurnReady(viewedPart.turn_ready ?? false);
          }
        }
      } else {
        setFaction(factions.find(f => f.profiles?.id === profile?.id || f.profile_id === profile?.id));
      }
    }
  }

  useEffect(() => {
    loadGameState();

    // Reload everything when the turn advances (another player or GM triggered it)
    const channel = supabase
      .channel(`game-turn-watch-${gameId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => {
          loadGameState();
          setMapRefreshKey(k => k + 1);
          setTurnReady(false);
          setTurnMsg('');
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [gameId, profile]);

  const loadCombatLog = useCallback(async (turn) => {
    const headers = await authHeaders();
    const url = turn != null
      ? `${SERVER}/api/map/${gameId}/combat-log?turn=${turn}`
      : `${SERVER}/api/map/${gameId}/combat-log`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const d = await r.json();
      setCombatLog(d);
      setLogTurn(d.turn);
    }
  }, [gameId]);

  async function finishTurn() {
    const headers = await authHeaders();
    const body = viewAsFactionId && faction?.profile_id
      ? JSON.stringify({ view_as_profile_id: faction.profile_id })
      : undefined;
    const r = await fetch(`${SERVER}/api/games/${gameId}/finish-turn`, { method: 'POST', headers, body });
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
          {turnReady ? 'Orders Submitted ✓' : 'Finish Turn'}
        </button>
        {viewAsFactionId && faction && (
          <span style={{ color: '#d97706', fontSize: 12 }}>submitting as {faction.name}</span>
        )}
        {turnMsg && <span style={{ color: '#94a3b8', fontSize: 13 }}>{turnMsg}</span>}
      </div>

      <HexMap
        gameId={gameId}
        isGM={false}
        viewAsFactionId={viewAsFactionId}
        playerFactionId={faction?.id ?? null}
        faction={faction}
        refreshKey={mapRefreshKey}
      />

      {/* Combat Log */}
      <div style={{ marginTop: 16, background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: showLog ? 12 : 0 }}>
          <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 600 }}>Combat Log</span>
          <button
            style={{ background: 'none', border: '1px solid #1e293b', color: '#64748b', padding: '2px 10px', borderRadius: 3, fontSize: 12, cursor: 'pointer', marginLeft: 'auto' }}
            onClick={() => { setShowLog(v => !v); if (!showLog && !combatLog) loadCombatLog(null); }}
          >
            {showLog ? 'Hide' : 'Show'}
          </button>
        </div>
        {showLog && (
          <div>
            {combatLog ? (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: '#64748b', fontSize: 12 }}>Turn {combatLog.turn}</span>
                  <button
                    style={{ background: 'none', border: '1px solid #1e293b', color: '#94a3b8', padding: '1px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer' }}
                    disabled={logTurn <= 0}
                    onClick={() => logTurn > 0 && loadCombatLog(logTurn - 1)}
                  >
                    ← Earlier
                  </button>
                  <button
                    style={{ background: 'none', border: '1px solid #1e293b', color: '#94a3b8', padding: '1px 8px', borderRadius: 3, fontSize: 11, cursor: 'pointer' }}
                    disabled={logTurn >= (combatLog.current_turn - 1)}
                    onClick={() => logTurn < (combatLog.current_turn - 1) && loadCombatLog(logTurn + 1)}
                  >
                    Later →
                  </button>
                </div>
                {combatLog.entries.length === 0 && (
                  <p style={{ color: '#475569', fontSize: 12 }}>No events recorded for this turn.</p>
                )}
                {combatLog.entries.map(e => (
                  <PlayerLogEntry key={e.id} entry={e} />
                ))}
              </>
            ) : (
              <p style={{ color: '#475569', fontSize: 12 }}>Loading…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const LOG_TYPE_COLOR = { combat: '#ef4444', bombardment: '#fb923c', retreat: '#60a5fa', naval_combat: '#38bdf8' };

function PlayerLogEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const d = entry.data ?? {};
  const phase = entry.phase === 1 ? 'Air' : entry.phase === 2 ? 'Naval' : entry.phase === 3 ? 'Ground' : 'Phase 4';

  function summary() {
    if (d.event === 'retreat') return `Unit retreated to (${d.to_hex?.q},${d.to_hex?.r})`;
    if (d.event === 'retreat_fire') return `Retreat fire: ${Object.values(d.casualties ?? {}).reduce((s, v) => s + v, 0)} casualties`;
    if (d.event === 'pursuit_roll') return `Pursuit ${d.success ? 'succeeded' : 'failed'} (rolled ${d.roll}/${d.roll_target})`;
    if (entry.log_type === 'bombardment') return `Bombardment: ${d.hits_vs_units ?? 0} unit hits, ${d.hits_vs_infra ?? 0} infra hits`;
    const totalCas = Object.values(d.casualties ?? {}).reduce((s, v) => s + v, 0);
    if (totalCas > 0) return `Combat at (${entry.hex_q},${entry.hex_r}): ${totalCas} total casualties`;
    return `Event at (${entry.hex_q},${entry.hex_r})`;
  }

  const typeColor = LOG_TYPE_COLOR[entry.log_type] ?? '#64748b';

  return (
    <div style={{ marginBottom: 4, borderLeft: `2px solid ${typeColor}`, paddingLeft: 8 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <span style={{ color: typeColor, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{phase}</span>
        <span style={{ color: '#cbd5e1', fontSize: 12 }}>{summary()}</span>
        <span style={{ color: '#475569', fontSize: 11, marginLeft: 'auto' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <pre style={{ color: '#64748b', fontSize: 10, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {JSON.stringify(d, null, 2)}
        </pre>
      )}
    </div>
  );
}
