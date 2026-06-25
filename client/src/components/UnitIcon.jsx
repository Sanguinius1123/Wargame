const SHAPES = {
  Infantry:   ({ cx, cy, s, c }) => <polygon points={`${cx},${cy-s} ${cx+s},${cy+s} ${cx-s},${cy+s}`} fill={c} />,
  Armor:      ({ cx, cy, s, c }) => <rect x={cx-s} y={cy-s*0.7} width={s*2} height={s*1.4} rx={s*0.3} fill={c} />,
  Artillery:  ({ cx, cy, s, c }) => <polygon points={`${cx},${cy-s} ${cx+s},${cy+s} ${cx},${cy+s*0.5} ${cx-s},${cy+s}`} fill={c} />,
  Supply:     ({ cx, cy, s, c }) => <rect x={cx-s*0.6} y={cy-s*0.6} width={s*1.2} height={s*1.2} fill={c} opacity={0.7} />,
  Destroyer:  ({ cx, cy, s, c }) => <polygon points={`${cx-s},${cy} ${cx},${cy-s*0.5} ${cx+s},${cy} ${cx},${cy+s*0.5}`} fill={c} />,
  Battleship: ({ cx, cy, s, c }) => <polygon points={`${cx-s},${cy} ${cx-s*0.4},${cy-s*0.7} ${cx+s*0.4},${cy-s*0.7} ${cx+s},${cy} ${cx+s*0.4},${cy+s*0.7} ${cx-s*0.4},${cy+s*0.7}`} fill={c} />,
  Transport:  ({ cx, cy, s, c }) => <rect x={cx-s} y={cy-s*0.4} width={s*2} height={s*0.8} rx={s*0.4} fill={c} opacity={0.8} />,
  Fighter:    ({ cx, cy, s, c }) => <polygon points={`${cx},${cy-s} ${cx+s*0.3},${cy+s} ${cx},${cy+s*0.3} ${cx-s*0.3},${cy+s}`} fill={c} />,
  Bomber:     ({ cx, cy, s, c }) => <ellipse cx={cx} cy={cy} rx={s} ry={s*0.5} fill={c} />,
};

export default function UnitIcon({ type, color = '#ffffff', size = 14 }) {
  const Shape = SHAPES[type];
  if (!Shape) return null;
  const s = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <Shape cx={s} cy={s} s={s * 0.75} c={color} />
    </svg>
  );
}
