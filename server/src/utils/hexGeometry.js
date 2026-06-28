// Hex geometry for even-q flat-top offset coordinates.
// All (q, r) values in the DB are stored in this system.
//
// even-q: even columns are "upper" (no vertical shift),
//         odd columns shift DOWN by half a hex height.
//
// Conversion to/from cube/axial for correct distance and range math:
//   axial_r = r - floor(q / 2)
//   offset_r = r + floor(q / 2)

export function offsetToAxial(q, r) {
  return { q, r: r - Math.floor(q / 2) };
}

export function axialToOffset(aq, ar) {
  return { q: aq, r: ar + Math.floor(aq / 2) };
}

// Hex distance between two offset coords.
export function hexDist(q1, r1, q2, r2) {
  const a1 = offsetToAxial(q1, r1);
  const a2 = offsetToAxial(q2, r2);
  const dq = a2.q - a1.q, dr = a2.r - a1.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

// True iff the two offset hexes are exactly 1 step apart.
export function isAdjacent(q1, r1, q2, r2) {
  return hexDist(q1, r1, q2, r2) === 1;
}

const AXIAL_DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];

// Returns the 6 offset-coord neighbors of (q, r).
export function offsetNeighbors(q, r) {
  const { q: aq, r: ar } = offsetToAxial(q, r);
  return AXIAL_DIRS.map(([dq, dr]) => axialToOffset(aq + dq, ar + dr));
}

// Returns a Set of "q,r" keys for all offset hexes within hex-distance `range`.
export function hexesInRange(q, r, range) {
  const { q: aq, r: ar } = offsetToAxial(q, r);
  const result = new Set();
  for (let dq = -range; dq <= range; dq++) {
    const drMin = Math.max(-range, -dq - range);
    const drMax = Math.min(range,  -dq + range);
    for (let dr = drMin; dr <= drMax; dr++) {
      const { q: oq, r: or_ } = axialToOffset(aq + dq, ar + dr);
      result.add(`${oq},${or_}`);
    }
  }
  return result;
}

// Cube-coordinate rounding (operates in axial space).
export function cubeRound(fq, fr) {
  const fs = -fq - fr;
  let rq = Math.round(fq), rr = Math.round(fr), rs = Math.round(fs);
  const dq = Math.abs(rq - fq), dr = Math.abs(rr - fr), ds = Math.abs(rs - fs);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}
