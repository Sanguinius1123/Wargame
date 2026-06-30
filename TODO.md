# Wargame — TODO

---

## Bugs / Immediate Fixes

- [ ] **Player bridge build not applying road/bridge attributes** — `processBuildOrders` in `server/src/utils/phase4.js` creates the bridge building but does not set `has_road=true` on all 3 hexes or `has_bridge=true` on the water hex. Fix: after upserting the bridge building, PATCH truck hex + water hex + far land hex with `has_road=true`, and water hex with `has_bridge=true`. (`to_hex_q/r` = far land hex, `target_hex_q/r` = water hex, `unit.hex_q/r` = truck hex)

---

## Next Up (roughly priority order)

- [ ] **Map visual overhaul (player portal)**
  - Remove terrain text label from tiles — replace with collapsible legend (bottom corner, collapsed by default)
  - Remove grid coord labels (q,r) from tiles — only show in detail panel on selection
  - Terrain color rebalance: plains too lime-green → muted olive; light veg darker than plains; heavy veg darker still; keep hills/mountains as reference for saturation level; review water/desert/wetlands
  - Urban hexes get a distinct warm-gray/tan background color (`#9e8f7a` or similar) so built-up areas are instantly readable
  - Settlements: larger/more prominent icon (gold star or city silhouette) + settlement name label on hex. Unmistakable at a glance.
  - Changes isolated to player-facing `HexGrid.jsx` — GM view keeps labels/coords

- [ ] **Bombard order UI** — target hex selection for Artillery and Battleship units

- [ ] **Retreat / Pursue order UI** — buttons visible only when unit is locked in combat (enemy in same hex)

- [ ] **Combat log viewer** — GM panel showing what happened each turn (bombardments, casualties, bridge collapses, etc.)

- [ ] **Production queue UI** — player orders units from a factory hex; shows available unit types, slot cost, current queue

- [ ] **Verify naval unit LOS** — ships have `los` values in the seed but fog-of-war contribution has not been tested. Verify ships reveal hexes correctly. Decide whether land terrain (hills/mountains) blocks naval LOS.

- [ ] **Fog of war: last-known-state (scouted hex memory)**
  - Add `last_known_state JSONB` column to `scouted_hexes`
  - `markScouted` snapshots terrain + roads + buildings + urban flags at time of observation
  - Client renders 3 states: Visible (full color), Scouted (gray overlay, last-known data, no units), Dark (black)
  - Scouted state is strictly per-faction — never shared between players

---

## LOS System Fixes

- [ ] **Urban tiles block LOS** — add `h.has_urban` to the `blockingSet` filter in `visibility.js` alongside vegetation. All urban is fully blocking (no tiers).

- [ ] **Elevation-aware LOS for hills/mountains** — currently mountains always block (even mountain-to-mountain) and hills never block. Fix `isBlocked()` in `visibility.js` to compare observer elevation vs intermediate hex elevations: hills block from plains only; mountains block from plains and hills but not from other mountains.

- [ ] **Submarine sonar visibility** — subs have `los=0` so they see nothing. In `computeVisibility`, add a sonar pass for submarine units: water hexes within `sonar_range` (4) → added to `visible`; adjacent land hexes → added to `scouted` (terrain shown, units hidden). Bypasses normal LOS blocking (sonar ignores terrain).

---

## Major Systems (not yet started)

- [ ] **Phase 1 — Air system**: flight groups, mission types (Bombing Run / Attack Run / Scout / Sweep), AA overwatch, patrol intercept. See air phase rework notes in DESIGN.md before building.
- [ ] **Phase 2 — Naval system**: step-by-step naval movement, contact detection, naval ranged fire, close combat, sinking rules, carrier emergency scramble.

---

## Balance / Tuning (hold until after first test game)

- **LOS & Atk Range review** — current values may be too generous or about right; don't change without playtesting.
  - Ground LOS: all currently 3. Infantry/Armor/Artillery may feel too far; Recon fine.
  - Armor Atk Range: currently 2, consider 1.
  - Naval Atk Range: Destroyer/Frigate at 1, may want 2.
  - LOS over water: ground units might see farther across water (water hexes don't consume LOS range, cap at LOS×2).
  - Air vs ground detection: consider −3 detection penalty when air detects concealed ground units.

---

## Future Content

- **Railroads** — `has_railroad` stub exists. Fast ground movement, expensive to build.
- **Supply lines** — full supply radius + Supply unit starvation rules
- **Allied vision sharing** — share current visibility (not scouted memory) between allied factions
- **Victory condition tuning** — per player count, alternative win types
- **Flight group turn-around rules** — abort mission at X% casualties if movement allows
- **Emergency landing rules** — air units with no reachable airstrip
- **Skirmish orders** — Hold and Retreat sub-modes for standing orders
- **Subterranean / hover / orbital** locomotion tags (far future)
