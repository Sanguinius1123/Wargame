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

export default function HexMap({ gameId, isGM = false }) {
  const [hexes, setHexes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const headers = await authHeader();
    const r = await fetch(`${SERVER}/api/map/${gameId}/hexes`, { headers });
    if (r.ok) setHexes(await r.json());
    setLoading(false);
  }, [gameId]);

  useEffect(() => { load(); }, [load]);

  const selectedKey = selected ? `${selected.hex_q},${selected.hex_r}` : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 12, height: '100%' }}>
      {/* Map */}
      <div style={{ background: '#080d15', borderRadius: 8, overflow: 'hidden', height: 600, position: 'relative' }}>
        {loading
          ? <p style={{ color: '#64748b', padding: 24 }}>Loading map…</p>
          : <HexGrid hexes={hexes} onSelect={setSelected} panZoom selectedKey={selectedKey} />
        }
      </div>

      {/* Detail panel */}
      <div style={PANEL_STYLE}>
        {selected ? <HexDetail hex={selected} isGM={isGM} gameId={gameId} onRefresh={load} />
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

function HexDetail({ hex, isGM, gameId, onRefresh }) {
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
        </>
      )}
    </div>
  );
}
