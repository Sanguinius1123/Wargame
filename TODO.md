# Wargame — TODO

---

## Bugs / Immediate Fixes

- [ ] **Naval path-crossing detection misses B-C crossing when A-B fires first** — In `navalPhase.js` step loop, once a unit is added to `processed` after crossing with unit A, it won't be checked for a second crossing with unit C in the same step. Very rare edge case (3 ships crossing in the same step). Lower priority.
- [ ] **Repair slot cap not enforced** — `phase4.js` advances repair orders without checking whether the airbase/harbor has available slots (floor(current_hp/2)). Multiple units can be repaired simultaneously beyond capacity.
- [ ] **AA overwatch fires at undetected aircraft** — `rangedFire.js` AA pass doesn't check detection before firing. AA should only fire at detected flight groups (effective_stealth = 0 = auto-detected; stealth > 0 = detection roll required).

---

## Cleanup (ready now)

- [ ] **Delete `supabase/migrations_archive/`** — 29 old migrations archived after consolidation; new 7-file schema verified working. Safe to delete.

---

## Next Up (roughly priority order)

- [ ] **Map visual overhaul (player portal)**
  - Remove terrain text label from tiles — replace with collapsible legend (bottom corner, collapsed by default)
  - Remove grid coord labels (q,r) from tiles — only show in detail panel on selection
  - Terrain color rebalance: plains too lime-green → muted olive; light veg darker than plains; heavy veg darker still; keep hills/mountains as reference for saturation level; review water/desert/wetlands
  - Urban hexes get a distinct warm-gray/tan background color (`#9e8f7a` or similar) so built-up areas are instantly readable
  - Settlements: larger/more prominent icon (gold star or city silhouette) + settlement name label on hex. Unmistakable at a glance.
  - Changes isolated to player-facing `HexGrid.jsx` — GM view keeps labels/coords

- [x] **Bombard order UI** — target hex selection for Artillery and Battleship units

- [x] **Retreat / Pursue order UI** — buttons visible only when unit is locked in combat (enemy in same hex)

- [ ] **Patrol order** — button is hidden in the UI. Implement ground patrol intercept logic (radius 1 foot / 2 mechanized; unit moves to intercept hex, fights there, stays on win) then re-expose the button in `HexMap.jsx` (search for "Patrol button hidden").

- [ ] **Patrol / AA standing order hex highlight** — when a unit has patrol or AA standing order set, highlight its patrol/overwatch radius on the map (green for patrol, amber for AA) so players can see coverage zones. Wire in alongside patrol implementation.

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
- **Control point win condition** — hold-N-control-points mode; `control_point` building type already added; wire into win condition check as an alternative to settlement majority
- **VP accumulation mode** — continuous scoring by holding objectives; alternative win condition for timed scenarios
- **Unit veterancy** — surviving units earn XP from combat, unlock stat bonuses; trains players to care about their units (e.g. after N kills: +1 to_hit or +1 defense; stored as `veteran_level` column on units; 3 tiers)
- **Large-map performance overhaul** — canvas renderer to replace SVG (10k+ hexes); server-side viewport filtering on GET /hexes (only send visible+scouted hexes in current viewport); local cache of revealed/scouted hex terrain that persists across map loads (only re-fetch changed hexes or newly visible ones); 40×40 works fine for now, this is needed for 100×100+
- **Politics / diplomacy / alliances** — faction relationships, stance system, intrigue; tracked in `faction_relationships` table; see parent ScifiRNR project for design reference
- **Weather events** — random or GM-triggered weather zones that affect LOS/movement/combat; snowstorm = -2 LOS, mud = 1.5× terrain cost, clear = normal; implemented as a per-hex or per-region modifier for the turn
- **Flight group turn-around rules** — abort mission at X% casualties if movement allows
- **Emergency landing rules** — air units with no reachable airstrip
- **Skirmish orders** — Hold and Retreat sub-modes for standing orders
- **Subterranean / hover / orbital** locomotion tags (far future)
