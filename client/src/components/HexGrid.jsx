import { useState, useEffect, useRef, useCallback } from 'react';

// Terrain color palette
const TERRAIN_COLORS = {
  plains:    '#4a7c59',
  forest:    '#2d5a27',
  mountains: '#6b6b6b',
  coast:     '#5a8a6a',
  sea:       '#1a3a5c',
  urban:     '#7a6040',
  river:     '#2a5a7a',
};

const VISIBILITY_OVERLAY = {
  scouted: 'rgba(0,0,0,0.55)',
  dark:    'rgba(0,0,0,0.90)',
};

const DEVELOPMENT_MARKS = ['', '·', '··', '···'];

function hexToPixel(q, r, size) {
  return {
    x: size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r),
    y: size * (3 / 2 * r),
  };
}

function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

// Top 3 unit stacks to display on hex
function getTopUnits(units) {
  if (!units?.length) return [];
  const grouped = {};
  for (const u of units) {
    const k = `${u.factionId}-${u.type}`;
    if (!grouped[k]) grouped[k] = { ...u, quantity: 0 };
    grouped[k].quantity += u.quantity;
  }
  return Object.values(grouped).slice(0, 3);
}

export default function HexGrid({ hexes, onSelect, onDoubleClick, panZoom = false, selectedKey = null }) {
  const safeHexes = hexes ?? [];
  const SIZE = 36;
  const PAD = SIZE * 2;

  const pixels = safeHexes.map(h => ({ ...h, ...hexToPixel(h.hex_q, h.hex_r, SIZE) }));
  const xs = pixels.map(p => p.x);
  const ys = pixels.map(p => p.y);
  const minX = xs.length ? Math.min(...xs) - PAD : 0;
  const minY = ys.length ? Math.min(...ys) - PAD : 0;
  const natW = xs.length ? Math.max(...xs) - minX + PAD : 100;
  const natH = ys.length ? Math.max(...ys) - minY + PAD : 100;

  const [vb, setVb] = useState({ x: minX, y: minY, width: natW, height: natH });
  useEffect(() => setVb({ x: minX, y: minY, width: natW, height: natH }), [minX, minY, natW, natH]);

  const svgRef = useRef(null);
  const dragRef = useRef(null);

  const onWheel = useCallback((e) => {
    if (!panZoom) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = vb.x + (e.clientX - rect.left) / rect.width  * vb.width;
    const my = vb.y + (e.clientY - rect.top)  / rect.height * vb.height;
    const newW = Math.min(Math.max(vb.width * factor, natW * 0.2), natW * 5);
    const newH = Math.min(Math.max(vb.height * factor, natH * 0.2), natH * 5);
    setVb({ x: mx - (mx - vb.x) * (newW / vb.width), y: my - (my - vb.y) * (newH / vb.height), width: newW, height: newH });
  }, [panZoom, vb, natW, natH]);

  const onMouseDown = useCallback((e) => {
    if (!panZoom || e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, vb: { ...vb }, moved: false };
  }, [panZoom, vb]);

  const onMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (!dragRef.current.moved && Math.abs(dx) + Math.abs(dy) > 5) dragRef.current.moved = true;
    if (!dragRef.current.moved) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = dragRef.current.vb.width  / rect.width;
    const sy = dragRef.current.vb.height / rect.height;
    setVb({ ...dragRef.current.vb, x: dragRef.current.vb.x - dx * sx, y: dragRef.current.vb.y - dy * sy });
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  const handleHexClick = useCallback((h) => {
    if (dragRef.current?.moved) return;
    onSelect?.(h);
  }, [onSelect]);

  const handleHexDbl = useCallback((h, e) => {
    e.stopPropagation();
    onDoubleClick?.(h);
  }, [onDoubleClick]);

  if (safeHexes.length === 0) return <p style={{ color: '#94a3b8' }}>No hexes to display.</p>;

  const viewBox = `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      style={{ width: '100%', height: '100%', cursor: panZoom ? 'grab' : 'default', display: 'block' }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {pixels.map(h => {
        const cx = h.x - minX + PAD / 2;
        const cy = h.y - minY + PAD / 2;
        const vis = h.visibility ?? 'visible';
        const isDark = vis === 'dark';
        const isScouted = vis === 'scouted';
        const hexKey = `${h.hex_q},${h.hex_r}`;
        const isSelected = hexKey === selectedKey;
        const baseColor = isDark ? '#080d15' : (TERRAIN_COLORS[h.terrain] ?? '#334155');
        const topUnits = isDark || isScouted ? [] : getTopUnits(h.units);

        return (
          <g key={hexKey}
            onClick={() => handleHexClick(h)}
            onDoubleClick={(e) => handleHexDbl(h, e)}
            style={{ cursor: isDark ? 'default' : 'pointer' }}
          >
            {/* Hex fill */}
            <polygon
              points={hexCorners(cx, cy, SIZE - 1)}
              fill={baseColor}
              stroke={isSelected ? '#facc15' : '#0f172a'}
              strokeWidth={isSelected ? 2 : 0.8}
            />

            {/* Fog overlay */}
            {(isScouted || isDark) && (
              <polygon
                points={hexCorners(cx, cy, SIZE - 1)}
                fill={VISIBILITY_OVERLAY[vis]}
                stroke="none"
              />
            )}

            {/* Owner tint border */}
            {h.owner_faction_id && !isDark && (
              <polygon
                points={hexCorners(cx, cy, SIZE - 1)}
                fill="none"
                stroke={topUnits[0]?.factionColor ?? '#60a5fa'}
                strokeWidth={3}
                opacity={0.6}
              />
            )}

            {/* Terrain label (not on dark hexes) */}
            {!isDark && (
              <text x={cx} y={cy - SIZE * 0.35} textAnchor="middle" fontSize={10}
                fill={isScouted ? '#6b7280' : '#e2e8f0'} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {h.terrain}
              </text>
            )}

            {/* Development dots */}
            {!isDark && h.development > 0 && (
              <text x={cx} y={cy - SIZE * 0.35 + 11} textAnchor="middle" fontSize={9}
                fill={isScouted ? '#4b5563' : '#fbbf24'} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {DEVELOPMENT_MARKS[h.development]}
              </text>
            )}

            {/* Coordinates (small, for debugging) */}
            <text x={cx} y={cy + SIZE * 0.5 - 4} textAnchor="middle" fontSize={8}
              fill={isDark ? '#1f2937' : '#475569'} style={{ pointerEvents: 'none', userSelect: 'none' }}>
              {h.hex_q},{h.hex_r}
            </text>

            {/* Unit icons */}
            {topUnits.map((u, i) => {
              const ux = cx - (topUnits.length - 1) * 8 + i * 16;
              const uy = cy - 3;
              return (
                <g key={i}>
                  <circle cx={ux} cy={uy} r={9} fill="#0f172a" opacity={0.8} />
                  <text x={ux} y={uy + 4} textAnchor="middle" fontSize={9}
                    fill={u.factionColor ?? '#60a5fa'} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {u.type?.[0] ?? '?'}{u.quantity > 1 ? u.quantity : ''}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
