import { useState, useEffect, useRef, useCallback } from 'react';

// Terrain color palette
const TERRAIN_COLORS = {
  plains:   '#7ec87a',
  hills:    '#b8a84a',
  mountains:'#8a8a8a',
  desert:   '#d4b55a',
  wetlands: '#4a8a78',
  water:    '#1e4d8c',
};

const VISIBILITY_OVERLAY = {
  scouted: 'rgba(0,0,0,0.55)',
  dark:    'rgba(0,0,0,0.90)',
};


// Flat-top hex layout, even-q offset coordinates.
// q=col, r=row; odd columns shift down by half a hex height.
function hexToPixel(q, r, size) {
  return {
    x: size * (3 / 2) * q,
    y: size * Math.sqrt(3) * (r + (q % 2) * 0.5),
  };
}

// Returns the 6 offset neighbors of (q, r) in flat-top even-q layout.
function offsetNeighbors(q, r) {
  const p = ((q % 2) + 2) % 2;
  return p === 0
    ? [{q:q-1,r:r-1},{q:q-1,r},{q,r:r-1},{q,r:r+1},{q:q+1,r:r-1},{q:q+1,r}]
    : [{q:q-1,r},{q:q-1,r:r+1},{q,r:r-1},{q,r:r+1},{q:q+1,r},{q:q+1,r:r+1}];
}

function hexCorners(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

const UNIT_ABBR = {
  'Infantry':        'IN',
  'Armor':           'AR',
  'Artillery':       'RT',
  'AT Gun':          'AT',
  'AA Gun':          'AA',
  'Recon':           'RC',
  'Supply':          'SU',
  'Fighter':         'FT',
  'Scout Plane':     'SC',
  'Bomber':          'BM',
  'Transport Plane': 'TP',
  'Destroyer':       'DD',
  'Frigate':         'FF',
  'Cruiser':         'CA',
  'Battleship':      'BB',
  'Transport':       'TS',
  'Carrier':         'CV',
  'Submarine':       'SS',
};

// Shape badge rendered behind the unit abbreviation text.
// Each ground type gets a distinct shape; naval/air fall back to circle.
// grabbed=true adds a bright yellow stroke; fortified=true adds an amber outer ring.
function renderUnitBadge(type, cx, cy, grabbed = false, fortified = false) {
  const fill = '#0f172a';
  const op   = 0.85;
  const hl   = grabbed ? { stroke: '#facc15', strokeWidth: 2 } : {};
  const badge = (() => {
    switch (type) {
      case 'Armor':
        return <ellipse cx={cx} cy={cy} rx={12} ry={7} fill={fill} opacity={op} {...hl} />;
      case 'Artillery': {
        const pts = `${cx},${cy - 11} ${cx - 10},${cy + 6} ${cx + 10},${cy + 6}`;
        return <polygon points={pts} fill={fill} opacity={op} {...hl} />;
      }
      case 'AT Gun':
        return <rect x={cx - 8} y={cy - 8} width={16} height={16} fill={fill} opacity={op} rx={1} {...hl} />;
      case 'AA Gun': {
        const pts = [0,1,2,3,4,5].map(i => {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          return `${(cx + 9 * Math.cos(a)).toFixed(1)},${(cy + 9 * Math.sin(a)).toFixed(1)}`;
        }).join(' ');
        return <polygon points={pts} fill={fill} opacity={op} {...hl} />;
      }
      case 'Recon':
        return (
          <g>
            <circle cx={cx} cy={cy} r={9} fill={fill} opacity={op} {...hl} />
            <line x1={cx - 6} y1={cy + 6} x2={cx + 6} y2={cy - 6}
              stroke="#475569" strokeWidth={2} strokeLinecap="round" style={{ pointerEvents: 'none' }} />
          </g>
        );
      default: // Infantry + all others
        return <circle cx={cx} cy={cy} r={9} fill={fill} opacity={op} {...hl} />;
    }
  })();
  if (!fortified) return badge;
  return (
    <g>
      <circle cx={cx} cy={cy} r={12} fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.8} />
      {badge}
    </g>
  );
}

// Render all units on a hex, grouped by faction into rows.
// Each faction gets its own horizontal row; badges scale down if a row has many units.
function renderHexUnits(h, cx, cy, playerFactionId, dragUnitId, onUnitClick, onUnitDragStart, unitDragActiveRef) {
  const units = h.units;
  if (!units?.length) return null;

  const factionMap = new Map();
  for (const u of units) {
    if (!factionMap.has(u.factionId)) factionMap.set(u.factionId, []);
    factionMap.get(u.factionId).push(u);
  }

  const factions = [...factionMap.keys()];
  const numRows = factions.length;
  const ROW_PITCH = numRows <= 2 ? 13 : 11;
  const refY = cy - 2; // shift unit block slightly above center
  const startRowY = refY - ((numRows - 1) / 2) * ROW_PITCH;

  return factions.map((fid, rowIdx) => {
    const rowUnits = factionMap.get(fid);
    const N = rowUnits.length;
    const rowY = startRowY + rowIdx * ROW_PITCH;

    const MAX_W = 46;
    const NAT_PITCH = 16;
    const pitch = N <= 1 ? 0 : Math.min(NAT_PITCH, MAX_W / (N - 1));
    const scale = N <= 1 ? 1 : Math.max(0.45, pitch / NAT_PITCH);
    const totalWidth = (N - 1) * pitch;

    return (
      <g key={fid}>
        {rowUnits.map((u, i) => {
          const ux = cx - totalWidth / 2 + i * pitch;
          const uy = rowY;
          const isDraggable = playerFactionId && u.factionId === playerFactionId && !u.tags?.includes('air');
          return (
            <g key={u.id}
              style={{ cursor: isDraggable ? 'grab' : 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onUnitClick?.(u, h); }}
              onMouseDown={isDraggable ? (e) => {
                e.stopPropagation(); e.preventDefault();
                unitDragActiveRef.current = true;
                onUnitDragStart?.(u, h);
              } : undefined}
            >
              {/* Transparent hit area so the outer <g> receives pointer events even when children are pointerEvents:none */}
              <circle cx={ux} cy={uy} r={11} fill="transparent" />
              <g transform={scale < 1 ? `translate(${ux},${uy}) scale(${scale}) translate(${-ux},${-uy})` : undefined}
                style={{ pointerEvents: 'none' }}>
                {renderUnitBadge(u.type, ux, uy, u.id === dragUnitId, u.fortification_level === 1)}
              </g>
              <text x={ux} y={u.quantity > 1 ? uy + 1 * scale : uy + 3 * scale}
                textAnchor="middle" fontSize={Math.max(5, Math.round(7 * scale))}
                fill={u.factionColor ?? '#60a5fa'} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {UNIT_ABBR[u.type] ?? u.type?.slice(0, 2) ?? '?'}
              </text>
              {u.quantity > 1 && (
                <text x={ux} y={uy + 8 * scale} textAnchor="middle"
                  fontSize={Math.max(4, Math.round(6 * scale))}
                  fill={u.factionColor ?? '#60a5fa'} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {u.quantity}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  });
}

function arrowPath(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return null;
  const nx = dx / len, ny = dy / len;
  // shorten line slightly so arrowhead sits at hex center
  const mx = x2 - nx * 8, my = y2 - ny * 8;
  const px = -ny, py = nx; // perpendicular
  return {
    line: `M${x1},${y1} L${mx},${my}`,
    arrow: `M${x2},${y2} L${mx + px * 5},${my + py * 5} L${mx - px * 5},${my - py * 5} Z`,
  };
}

// --- Terrain feature renderers ---

function renderMountains(cx, cy) {
  // Left and right smaller peaks first (behind), tall center peak last (front)
  const peaks = [
    { ox: -11, baseY: cy + 7, h: 12, hw: 6 },
    { ox:  11, baseY: cy + 7, h: 12, hw: 6 },
    { ox:   0, baseY: cy + 9, h: 18, hw: 9 },
  ];
  return peaks.map((p, i) => {
    const bx = cx + p.ox;
    const lx = bx - p.hw, rx = bx + p.hw, ty = p.baseY - p.h;
    const snowY  = p.baseY - p.h * 0.65;
    const snowHW = p.hw * 0.35;
    return (
      <g key={i} style={{ pointerEvents: 'none' }}>
        <polygon points={`${lx},${p.baseY} ${rx},${p.baseY} ${bx},${ty}`}
          fill="#606470" stroke="#2d3748" strokeWidth={0.8} />
        <polygon points={`${bx - snowHW},${snowY} ${bx + snowHW},${snowY} ${bx},${ty}`}
          fill="#dde6ed" stroke="none" />
      </g>
    );
  });
}

function renderHills(cx, cy) {
  const bumps = [
    { x: cx - 10, y: cy + 7, rx: 10, ry: 6   },
    { x: cx +  9, y: cy + 7, rx:  9, ry: 5.5  },
    { x: cx,      y: cy,     rx:  8, ry: 5    },
  ];
  return bumps.map((b, i) => (
    <path key={i}
      d={`M ${b.x - b.rx},${b.y} A ${b.rx},${b.ry} 0 0 1 ${b.x + b.rx},${b.y} Z`}
      fill="#cdb85a" stroke="#7a6a20" strokeWidth={0.7}
      style={{ pointerEvents: 'none' }}
    />
  ));
}

function renderVegetation(cx, cy, heavy) {
  const trunk = '#4a2e0e';
  if (heavy) {
    // Dense forest: three pine trees of varying heights
    const trees = [
      { x: cx - 9,  by: cy + 10, h: 11, hw: 5 },
      { x: cx + 1,  by: cy + 8,  h: 14, hw: 6 },
      { x: cx + 10, by: cy + 10, h: 10, hw: 4 },
    ];
    return (
      <g style={{ pointerEvents: 'none' }}>
        {trees.map((t, i) => (
          <g key={i}>
            <rect x={t.x - 1} y={t.by - t.h * 0.38} width={2} height={t.h * 0.38} fill={trunk} />
            <polygon
              points={`${t.x},${t.by - t.h} ${t.x - t.hw},${t.by - t.h * 0.38} ${t.x + t.hw},${t.by - t.h * 0.38}`}
              fill="#1a5c12" stroke="#0d3508" strokeWidth={0.6}
            />
          </g>
        ))}
      </g>
    );
  }
  // Light vegetation: one small tree + two grass tufts
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={cx - 9} y={cy + 6} width={2} height={4} fill={trunk} />
      <polygon
        points={`${cx - 8},${cy - 1} ${cx - 14},${cy + 6} ${cx - 2},${cy + 6}`}
        fill="#2d7a1c" stroke="#1a5010" strokeWidth={0.5}
      />
      {[cx + 4, cx + 9].map((gx, gi) => (
        <g key={gi}>
          <line x1={gx - 2} y1={cy + 10} x2={gx - 3} y2={cy + 5} stroke="#3d9225" strokeWidth={1.3} strokeLinecap="round" />
          <line x1={gx}     y1={cy + 10} x2={gx}     y2={cy + 4} stroke="#4aac2e" strokeWidth={1.3} strokeLinecap="round" />
          <line x1={gx + 2} y1={cy + 10} x2={gx + 3} y2={cy + 5} stroke="#3d9225" strokeWidth={1.3} strokeLinecap="round" />
        </g>
      ))}
    </g>
  );
}

// Small castle icon for fortification buildings. cx, cy = hex center.
function renderFortification(cx, cy) {
  const bx = cx + 12, by = cy + 12; // bottom-right corner of hex
  const w = 11, h = 8, mw = 2, mg = 2; // wall width/height, merlon width/gap
  const lx = bx - w / 2;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* Wall base */}
      <rect x={lx} y={by - h} width={w} height={h} fill="#94a3b8" stroke="#1e293b" strokeWidth={0.8} rx={0.5} />
      {/* Three merlons (crenellations) */}
      {[0, 1, 2].map(i => (
        <rect key={i} x={lx + i * (mw + mg)} y={by - h - 4} width={mw} height={4}
          fill="#94a3b8" stroke="#1e293b" strokeWidth={0.8} />
      ))}
      {/* Gate arch */}
      <rect x={cx + 12 - 2} y={by - 5} width={4} height={5} fill="#0f172a" />
    </g>
  );
}

// Single building shape. x, y = bottom-center of the body.
function Bldg({ x, y, bw, bh, rh = 0, bodyFill = '#7a8ea8', roofFill = '#8b2500' }) {
  const lx = x - bw / 2, rx = x + bw / 2, topY = y - bh;
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={lx} y={topY} width={bw} height={bh} fill={bodyFill} stroke="#1e2533" strokeWidth={0.6} />
      {rh > 0 && (
        <polygon points={`${lx},${topY} ${x},${topY - rh} ${rx},${topY}`}
          fill={roofFill} stroke="#1e2533" strokeWidth={0.6} />
      )}
    </g>
  );
}

function renderSettlement(cx, cy, size) {
  if (size >= 9) {
    // City: dense skyline of rectangular blocks
    return [
      <Bldg key="a" x={cx - 12} y={cy + 9} bw={7} bh={6}  bodyFill="#4a5568" />,
      <Bldg key="b" x={cx - 4}  y={cy + 9} bw={6} bh={11} bodyFill="#3d4a5c" />,
      <Bldg key="c" x={cx + 4}  y={cy + 9} bw={7} bh={7}  bodyFill="#4a5568" />,
      <Bldg key="d" x={cx + 12} y={cy + 9} bw={6} bh={5}  bodyFill="#56677a" />,
      <Bldg key="e" x={cx}      y={cy + 2} bw={5} bh={14} bodyFill="#2d3748" />,
    ];
  }
  if (size >= 5) {
    // Town: houses + one taller structure
    return [
      <Bldg key="a" x={cx - 11} y={cy + 9} bw={6} bh={5} rh={3} />,
      <Bldg key="b" x={cx - 3}  y={cy + 9} bw={6} bh={5} rh={3} />,
      <Bldg key="c" x={cx + 5}  y={cy + 9} bw={6} bh={5} rh={3} />,
      <Bldg key="d" x={cx - 7}  y={cy + 2} bw={6} bh={5} rh={3} />,
      <Bldg key="e" x={cx + 3}  y={cy + 2} bw={8} bh={9} bodyFill="#5a6e85" />,
    ];
  }
  // Village: 3 small houses
  return [
    <Bldg key="a" x={cx - 9} y={cy + 9} bw={7} bh={5} rh={4} />,
    <Bldg key="b" x={cx + 1} y={cy + 9} bw={7} bh={5} rh={4} />,
    <Bldg key="c" x={cx - 4} y={cy + 2} bw={7} bh={5} rh={4} />,
  ];
}

export default function HexGrid({
  hexes,
  onSelect,
  onDoubleClick,
  panZoom = false,
  selectedKey = null,
  moveMode = false,
  movePath = [],
  bombardMode = false,
  bombardTargetKey = null,
  bombardRangeKeys = null,
  buildMode = false,
  onPathClick,
  centerOn = null,
  // Drag-and-drop
  playerFactionId = null,
  reachableKeys = null,
  dragOverKey = null,
  onUnitDragStart = null,
  onDragMove = null,
  onDragEnd = null,
  showCoords = false,
  dragUnitId = null,
  onUnitClick = null,
  combatHexKeys = null,
}) {
  const safeHexes = hexes ?? [];
  const SIZE = 36;
  const PAD = SIZE * 2;

  const pixels = safeHexes.map(h => ({ ...h, ...hexToPixel(h.hex_q, h.hex_r, SIZE) }));

  // Pre-compute railroad edges between adjacent railroad hexes (undirected, drawn once).
  const _railHexByKey = new Map(pixels.map(h => [`${h.hex_q},${h.hex_r}`, h]));
  const _railEdgeSet = new Set();
  const railEdges = [];
  for (const h of pixels) {
    if (!h.has_railroad) continue;
    for (const { q: nq, r: nr } of offsetNeighbors(h.hex_q, h.hex_r)) {
      const nh = _railHexByKey.get(`${nq},${nr}`);
      if (!nh?.has_railroad) continue;
      const ek = [`${h.hex_q},${h.hex_r}`, `${nq},${nr}`].sort().join('|');
      if (_railEdgeSet.has(ek)) continue;
      _railEdgeSet.add(ek);
      railEdges.push({ x1: h.x, y1: h.y, x2: nh.x, y2: nh.y });
    }
  }

  const xs = pixels.map(p => p.x);
  const ys = pixels.map(p => p.y);
  const minX = xs.length ? Math.min(...xs) - PAD : 0;
  const minY = ys.length ? Math.min(...ys) - PAD : 0;
  const natW = xs.length ? Math.max(...xs) - minX + PAD : 100;
  const natH = ys.length ? Math.max(...ys) - minY + PAD : 100;

  const [vb, setVb] = useState({ x: minX, y: minY, width: natW, height: natH });
  useEffect(() => setVb({ x: minX, y: minY, width: natW, height: natH }), [minX, minY, natW, natH]);

  // Pan to a specific hex when centerOn changes
  useEffect(() => {
    if (!centerOn) return;
    const p = pixels.find(h => h.hex_q === centerOn.q && h.hex_r === centerOn.r);
    if (!p) return;
    const cx = p.x - minX + PAD / 2;
    const cy = p.y - minY + PAD / 2;
    setVb(prev => ({ ...prev, x: cx - prev.width / 2, y: cy - prev.height / 2 }));
  }, [centerOn]);

  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const didDragRef = useRef(false);
  const unitDragActiveRef = useRef(false);
  const pixelsRef = useRef([]);
  pixelsRef.current = pixels;

  // Attach a non-passive wheel listener so preventDefault actually suppresses page scroll
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !panZoom) return;
    const handler = (e) => e.preventDefault();
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [panZoom]);

  const onWheel = useCallback((e) => {
    if (!panZoom) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const { x: mx, y: my } = pt.matrixTransform(svg.getScreenCTM().inverse());
    const newW = Math.min(Math.max(vb.width * factor, natW * 0.2), natW * 5);
    const newH = Math.min(Math.max(vb.height * factor, natH * 0.2), natH * 5);
    setVb({ x: mx - (mx - vb.x) * (newW / vb.width), y: my - (my - vb.y) * (newH / vb.height), width: newW, height: newH });
  }, [panZoom, vb, natW, natH]);

  // Convert client (screen) coordinates to the nearest hex key.
  // Uses getScreenCTM so the transform correctly accounts for the SVG viewBox,
  // preserveAspectRatio letterboxing, and any CSS transforms on parent elements.
  const clientToHexKey = useCallback((clientX, clientY) => {
    const pts = pixelsRef.current;
    const svg = svgRef.current;
    if (!svg || !pts.length) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const { x: svgX, y: svgY } = pt.matrixTransform(svg.getScreenCTM().inverse());
    let liveMinX = pts[0].x, liveMinY = pts[0].y;
    for (const h of pts) {
      if (h.x < liveMinX) liveMinX = h.x;
      if (h.y < liveMinY) liveMinY = h.y;
    }
    liveMinX -= PAD;
    liveMinY -= PAD;
    let best = null, bestD = Infinity;
    for (const h of pts) {
      const cx = h.x - liveMinX + PAD / 2;
      const cy = h.y - liveMinY + PAD / 2;
      const d = (svgX - cx) ** 2 + (svgY - cy) ** 2;
      if (d < bestD) { bestD = d; best = `${h.hex_q},${h.hex_r}`; }
    }
    return best;
  }, [PAD]);

  const onMouseDown = useCallback((e) => {
    if (!panZoom || e.button !== 0) return;
    didDragRef.current = false;
    dragRef.current = { startX: e.clientX, startY: e.clientY, vb: { ...vb } };
  }, [panZoom, vb]);

  const onMouseMove = useCallback((e) => {
    if (unitDragActiveRef.current) {
      onDragMove?.(clientToHexKey(e.clientX, e.clientY));
      return;
    }
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) didDragRef.current = true;
    if (!didDragRef.current) return;
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return;
    setVb({ ...dragRef.current.vb, x: dragRef.current.vb.x - dx / ctm.a, y: dragRef.current.vb.y - dy / ctm.d });
  }, [clientToHexKey, onDragMove]);

  const onMouseUp = useCallback((e) => {
    if (unitDragActiveRef.current) {
      unitDragActiveRef.current = false;
      const key = clientToHexKey(e.clientX, e.clientY);
      const hex = key ? pixelsRef.current.find(h => `${h.hex_q},${h.hex_r}` === key) : null;
      onDragEnd?.(hex ?? null);
      return;
    }
    dragRef.current = null;
  }, [clientToHexKey, onDragEnd]);

  const handleHexClick = useCallback((h) => {
    if (didDragRef.current) return;
    if (moveMode || bombardMode || buildMode) {
      onPathClick?.(h);
    } else {
      onSelect?.(h);
    }
  }, [onSelect, moveMode, bombardMode, buildMode, onPathClick]);

  const handleHexDbl = useCallback((h, e) => {
    e.stopPropagation();
    onDoubleClick?.(h);
  }, [onDoubleClick]);

  if (safeHexes.length === 0) return <p style={{ color: '#94a3b8' }}>No hexes to display.</p>;

  const viewBox = `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;

  // Build a lookup from "q,r" → pixel center for arrow rendering
  const pixelByKey = {};
  for (const h of pixels) {
    pixelByKey[`${h.hex_q},${h.hex_r}`] = {
      cx: h.x - minX + PAD / 2,
      cy: h.y - minY + PAD / 2,
    };
  }

  // Build set of movePath hex keys for highlight
  const movePathKeys = new Set(movePath.map(p => `${p.q},${p.r}`));

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      style={{ width: '100%', height: '100%', cursor: reachableKeys?.size > 0 ? 'grabbing' : (moveMode || bombardMode) ? 'crosshair' : (panZoom ? 'grab' : 'default'), display: 'block', userSelect: 'none' }}
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
        const isInPath = movePathKeys.has(hexKey);
        const isBombardTarget = hexKey === bombardTargetKey;
        const baseColor = isDark ? '#080d15' : (TERRAIN_COLORS[h.terrain] ?? '#334155');
        const showUnits = !isDark && !isScouted;

        return (
          <g key={hexKey}
            onClick={() => handleHexClick(h)}
            onDoubleClick={(e) => handleHexDbl(h, e)}
            style={{ cursor: isDark ? 'default' : ((moveMode || bombardMode) ? 'crosshair' : 'pointer') }}
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

            {/* Move path highlight overlay */}
            {isInPath && (
              <polygon
                points={hexCorners(cx, cy, SIZE - 1)}
                fill="rgba(250,204,21,0.25)"
                stroke="none"
                style={{ pointerEvents: 'none' }}
              />
            )}

            {/* Bombard range highlight */}
            {bombardRangeKeys?.has(hexKey) && !isBombardTarget && (
              <polygon
                points={hexCorners(cx, cy, SIZE - 1)}
                fill="rgba(239,68,68,0.12)"
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="3,2"
                style={{ pointerEvents: 'none' }}
              />
            )}

            {/* Bombard target highlight */}
            {isBombardTarget && (
              <polygon
                points={hexCorners(cx, cy, SIZE - 1)}
                fill="rgba(239,68,68,0.30)"
                stroke="#ef4444"
                strokeWidth={2}
                style={{ pointerEvents: 'none' }}
              />
            )}

            {/* Combat-occurred-last-turn marker */}
            {combatHexKeys?.has(hexKey) && !isDark && (
              <g transform={`translate(${cx - SIZE * 0.42},${cy - SIZE * 0.38})`}
                 style={{ pointerEvents: 'none' }}>
                {[0, 45, 90, 135].map(deg => {
                  const a = deg * Math.PI / 180;
                  const r = 4.5;
                  return (
                    <line key={deg}
                      x1={-Math.cos(a) * r} y1={-Math.sin(a) * r}
                      x2={ Math.cos(a) * r} y2={ Math.sin(a) * r}
                      stroke="#f97316" strokeWidth={1.8} strokeLinecap="round"
                    />
                  );
                })}
                <circle r={2} fill="#fef08a" stroke="#f97316" strokeWidth={0.8} />
              </g>
            )}

            {/* Drag reachable range highlight */}
            {reachableKeys?.has(hexKey) && (
              <polygon
                points={hexCorners(cx, cy, SIZE - 1)}
                fill={hexKey === dragOverKey ? 'rgba(34,197,94,0.45)' : 'rgba(34,197,94,0.18)'}
                stroke="#22c55e"
                strokeWidth={hexKey === dragOverKey ? 2.5 : 1.2}
                style={{ pointerEvents: 'none' }}
              />
            )}

            {/* Owner tint border */}
            {h.owner_faction_id && !isDark && (
              <polygon
                points={hexCorners(cx, cy, SIZE - 1)}
                fill="none"
                stroke={h.units?.[0]?.factionColor ?? '#60a5fa'}
                strokeWidth={3}
                opacity={0.6}
              />
            )}

            {/* Vegetation overlay */}
            {!isDark && h.has_heavy_vegetation && (
              <polygon points={hexCorners(cx, cy, SIZE - 1)} fill="rgba(20,80,30,0.72)" stroke="none" style={{ pointerEvents: 'none' }} />
            )}
            {!isDark && h.has_light_vegetation && !h.has_heavy_vegetation && (
              <polygon points={hexCorners(cx, cy, SIZE - 1)} fill="rgba(30,130,50,0.40)" stroke="none" style={{ pointerEvents: 'none' }} />
            )}

            {/* Terrain features — mountains and hills */}
            {!isDark && h.terrain === 'mountains' && renderMountains(cx, cy)}
            {!isDark && h.terrain === 'hills' && renderHills(cx, cy)}

            {/* Vegetation icons on top of terrain */}
            {!isDark && h.has_heavy_vegetation && renderVegetation(cx, cy, true)}
            {!isDark && h.has_light_vegetation && !h.has_heavy_vegetation && renderVegetation(cx, cy, false)}

            {/* Settlement buildings — tier based on settlement_size */}
            {!isDark && h.has_settlement && renderSettlement(cx, cy, h.settlement_size ?? 1)}

            {/* Settlement name label */}
            {!isDark && h.has_settlement && h.settlement_name && (
              <>
                <rect
                  x={cx - SIZE * 0.9} y={cy - SIZE * 0.55}
                  width={SIZE * 1.8} height={14}
                  fill="#0f172a" rx={2} opacity={0.75}
                  style={{ pointerEvents: 'none' }}
                />
                <text x={cx} y={cy - SIZE * 0.55 + 10} textAnchor="middle" fontSize={9} fontWeight="700"
                  fill="#fef3c7" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {h.settlement_name}
                </text>
              </>
            )}

            {/* Fortification castle icon */}
            {!isDark && h.buildings?.some(b => b.type === 'fortification' && b.current_hp > 0) && renderFortification(cx, cy)}

            {/* Coordinates — GM only */}
            {showCoords && (
              <text x={cx} y={cy + SIZE * 0.5 - 4} textAnchor="middle" fontSize={8}
                fill={isDark ? '#1f2937' : '#475569'} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {h.hex_q},{h.hex_r}
              </text>
            )}

            {/* Unit icons — all units, per-faction rows, scaled to fit */}
            {showUnits && renderHexUnits(h, cx, cy, playerFactionId, dragUnitId, onUnitClick, onUnitDragStart, unitDragActiveRef)}
          </g>
        );
      })}

      {/* Railroad layer — rendered after hex fills, before units/arrows */}
      {railEdges.map((e, i) => {
        const ox = -minX + PAD / 2, oy = -minY + PAD / 2;
        const x1 = e.x1 + ox, y1 = e.y1 + oy;
        const x2 = e.x2 + ox, y2 = e.y2 + oy;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return null;
        // Unit perpendicular vector for crossties
        const px = -dy / len, py = dx / len;
        // Draw 5 evenly-spaced crossties along the edge
        const ties = [0.2, 0.35, 0.5, 0.65, 0.8];
        return (
          <g key={`rail${i}`} style={{ pointerEvents: 'none' }}>
            {/* Main rail line */}
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="#b0bec5" strokeWidth={2} strokeLinecap="round" />
            {/* Crossties */}
            {ties.map((t, j) => {
              const cx2 = x1 + dx * t, cy2 = y1 + dy * t;
              return (
                <line key={j}
                  x1={cx2 - px * 5} y1={cy2 - py * 5}
                  x2={cx2 + px * 5} y2={cy2 + py * 5}
                  stroke="#78909c" strokeWidth={2.5} strokeLinecap="round" />
              );
            })}
          </g>
        );
      })}

      {/* Arrow layer — rendered on top of all hexes */}
      {movePath.length > 1 && movePath.slice(0, -1).map((wp, i) => {
        const from = pixelByKey[`${wp.q},${wp.r}`];
        const to   = pixelByKey[`${movePath[i + 1].q},${movePath[i + 1].r}`];
        if (!from || !to) return null;
        const ap = arrowPath(from.cx, from.cy, to.cx, to.cy);
        if (!ap) return null;
        return (
          <g key={i} style={{ pointerEvents: 'none' }}>
            <path d={ap.line}  stroke="#facc15" strokeWidth={2} fill="none" />
            <path d={ap.arrow} stroke="#facc15" strokeWidth={1} fill="#facc15" />
          </g>
        );
      })}
    </svg>
  );
}
