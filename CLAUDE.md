# Wargame — Claude Context

Setting-agnostic hex-based operational wargame. Fork of ScifiRNR simplified to core map mechanics first.

## Goal

Build a playable wargame with: hex map + terrain, territory control, two resources (Materials + Manpower), unit types, combat resolution, fog of war. Get this fun and balanced before adding politics/diplomacy/intrigue from the parent project.

## Session Protocol

- **Pull before working:** Always run `git pull origin main` at the start of every session before making changes. Kyle switches between two PCs and git is the sync mechanism.
- **Push when done:** When Kyle signals end of day ("done for the day", "signing off", "clean up", etc.) — commit everything and `git push origin main`. Don't wait to be asked.
- **Use agents proactively:** When a task is well-defined and parallelizable, spawn agents rather than doing everything inline. Agents finish faster and Kyle can continue the conversation here while they work. Good candidates: writing a migration, implementing a utility file, wiring a server route, building a UI component.
- **Memory files are PC-local:** `C:\Users\kyle\.claude\...` memory files don't sync between machines. DESIGN.md and CLAUDE.md are the authoritative cross-machine source of truth — read these first.
- **Supabase:** Project URL: `https://wdfsoyqnjxwmlmnvvkbz.supabase.co`. Registration code: `wargame`. GM email: `macarthur1123@gmail.com`.

## Tech Stack

Same as ScifiRNR:
- **Database:** PostgreSQL via Supabase (auth + RLS)
- **Backend:** Node.js + Express (`server/`)
- **Frontend:** React + Vite (`client/`)

## Design

Full game design: `DESIGN.md`

## Key Decisions (do not re-litigate)

### Map & Terrain
- **Hexes, not regions:** Flat `hexes` table (game_id, hex_q, hex_r, terrain, owner_faction_id). No settlement/system hierarchy.
- **Terrain types:** Plains, Hills, Mountains, Desert, Wetlands, Water. Mountains foot cost=4, mech=impassable without road. Hills foot/mech=2.
- **No coast or river terrain types:** Coastal = adjacency to Water. Rivers = Water hexes going inland.
- **Hex ownership only for objectives:** owner_faction_id only tracked for hexes with settlements, urban tiles, resource tiles, or buildings. Plain terrain (hills, plains, etc.) has no owner.
- **Vegetation is two hex attributes:** `has_light_vegetation` and `has_heavy_vegetation`. Both block LOS into-but-not-through. Stealth bonus +1/+3.
- **Urban is a hex attribute:** `has_urban`. Settlements (`has_settlement`) are major cities that count toward win condition and start with a Factory.

### Resources
- **Two resources:** Materials (saveable, from GM-placed resource tiles, 1 per tile per turn) and Manpower (not saveable, flood-fill from urban tiles per settlement).
- **Manpower timing:** Collected in Phase 4. Spent at the start of the NEXT turn during the ordering phase. Cannot be saved across turns.
- **Manpower source:** Sum of contiguous `has_urban` tiles connected to each controlled `has_settlement` hex. Damaged urban tile produces nothing.

### Settlement Control & Win Condition
- **Settlement control threshold:** A settlement is controlled only if one faction owns ≥ 3/4 of its assigned urban tiles. Contested = no one meets threshold → no manpower, no victory credit.
- **Urban tile assignment:** Each tile assigned to nearest settlement hex (hex distance). Tie-break: tile goes to settlement owned by same faction as tile owner.
- **Win condition:** Hold 2/3 of all `has_settlement` hexes in a **controlled** state at end of Phase 4. Tunable per player count.

### Units
- **Unit stacks:** One `units` row per (faction, unit_type, hex). Quantity tracked in that row. Ground units auto-merge in same hex. Split by giving different movement orders.
- **Naval units use HP not quantity stacks.** Repaired at Harbors.
- **Bombers use HP (3 per aircraft).** `quantity = ceil(current_hp / 3)`. Repaired at Airbase. Air-to-air stats: To-Hit 5, Pen 0, fires ceil(current_hp/3) dice in intercept. Bombing mission stats (Bombing Run / Attack Run only, flight group special ability): To-Hit 7, Pen 1 vs ground/naval.
- **Fighters use quantity stacks** (same as ground units). Each failed save = 1 fighter lost.
- **unit_type_config is per game:** Each game defines its own unit roster. Not global.
- **No stack limits:** Map design handles concentration strategy, not hard limits.
- **Unit roster:** Infantry, Armor, Artillery, AT Gun, AA Gun, Supply, Recon (ground); Fighter, Scout Plane, Bomber, Transport Plane (air); Destroyer, Frigate, Cruiser, Battleship, Transport (ship), Carrier, Submarine (naval).

### Movement
- **Movement engine:** Internal ×3 scale (all movement stats and terrain costs stored ×3). Formula: `max(1, ceil(movement / cost))`. Both ground and naval movement are **step-by-step and simultaneous**. Contact triggers on: (1) **same hex** → hex collision, both stop, close combat; (2) **path crossing** (A→B while B→A same step) → border battle, both stop, simultaneous fire, loser retreats, winner continues. Mere adjacency does NOT stop movement. Ranged fire step covers firing at nearby enemies after movement ends.
- **`mechanized` tag** (Armor, Supply) determines mechanized terrain costs. `mobile` alone does not mean mechanized (cavalry, eagle riders = mobile but foot costs). Mountains impassable for mechanized without road; `has_heavy_vegetation` impassable for mechanized. Foot units can always enter any ground terrain.
- **Road movement:** 2/3 terrain cost (road cost = terrain_cost × 2 in ×3 scale).
- **Supply truck:** One action per turn — moves OR builds, not both. Road: up to 3 segments/turn in adjacent hexes (not consumed). Airstrip/Bridge/Fortification/Canal: truck consumed, completes in Phase 4. If truck destroyed in Phase 3 before Phase 4 completes, construction fails and resources are lost.
- **Canals:** `has_canal` allows naval through Wetlands. 10 manpower, supply truck present (not consumed).
- **Air movement:** Ignore terrain. Fighter move=30, Scout=35, Bomber=40, Transport Plane=25.

### Combat
- **Combat formula:** Roll-under. Attack: 2d6 ≤ To-Hit → 1 hit. Save: 2d6 ≤ (Defense + defense_bonus − Penetration) → saved; else 1 casualty or 1 HP. Both sides fire simultaneously, casualties removed after.
- **Proportional fire (inverse-distance weighted):** `weight = unit_count / distance`. Shots distributed proportionally to weight, largest-remainder rounding. Close combat (same hex): weight = unit_count (distance cancels). Ranged fire: closer stacks get more shots per unit (range 1 stack is 2× priority vs range 2 stack). Naval: each ship = unit_count 1. Applies to air intercept (all equidistant, so pure proportional-by-count).
- **Defense bonuses (stack):** Elevation +1 (ground vs ground, attacker lower, defender stationary); light veg +1 / heavy veg +2 (all attacks incl bombardment, stationary); Fortify order +1 (personal, lost on move); Fortification building +1 (all friendly in hex, full bonus until HP=0).
- **Artillery:** No direct fire whatsoever (no To-Hit, no Atk Range). Bombard only (Bombard Range 8, 1 hex, To-Hit 6, Pen 1, 1 die vs units + 1 die vs infra). Stationary to bombard. Cannot bombard if enemies in own hex. No attack dice in close combat — auto-destroyed if alone vs enemies. Cost: 2 mat / 1 man / 1 slot.
- **AT Gun:** Direct fire anti-armor. To-Hit 7, Def 6, Pen 2, Move 2, LOS 3, Atk Range 2. Cost: 2 mat / 1 man / 1 slot. Same gun stats as Armor but slower and less armored. Patrol-eligible.
- **Bombardment:** Two rolls per hex (vs units, vs infra). Indiscriminate. Artillery (1 hex, To-Hit 6, Pen 1, 1 die/artillery, Bombard Range 8; +1/+2 range from Hills/Mountains). Battleship (3-hex triangle, To-Hit 6, Pen 2, 3 dice/hex, Bombard Range 8, Atk Range 3; can target **any hex** — land or water — resolves Phase 3). Bombers (3-hex line or Attack Run, To-Hit 7, Pen 1, 1 die **per bomber** per hex — bombers have eyes on target). Blind fire = no report. Infra hit (attack roll ≤ To-Hit): randomly select eligible infra (buildings, bridge, urban tile, vegetation — **roads and canals immune**). HP infra (buildings, bridge, urban): loses 1 HP, no defense roll. Vegetation: 1d6 4+ → heavy→light or light→cleared; 1-3 = no change.
- **Ranged fire step:** Phase 2 (naval) and Phase 3 (ground) each have an automatic ranged fire step before close combat. All units fire at detected enemies within Atk Range — no order required. Simultaneous volleys. Units on Bombard orders skip this step. Artillery has no Atk Range and skips this step entirely.
- **Overwatch Skies (AA only):** AA Gun, Frigate, Battleship passively fire at detected aircraft in Phase 1. No order required. See Detection & Fog of War section.
- **Artillery in direct combat:** No attack dice at all. Destroyed automatically if left alone vs enemies.
- **Locked combat & retreat:** Units sharing a hex with an enemy are locked — may only issue Retreat or Pursue if Retreat orders. Retreat: move to adjacent non-enemy hex, skip close combat, take range-1 ranged fire while leaving. Pursue if Retreat: conditional order; activates only if enemy retreats. Roll 2d6 ≤ (5 + avg pursuer Move − avg retreater Move). Equal speed = 28%, fast vs slow = 58%, slow vs fast = 8%. Auto-fails if retreat destination impassable to pursuer.

### Detection & Fog of War
- **Auto-detection rule:** effective_stealth = unit.stealth_rating + terrain_stealth_modifier. If effective_stealth = 0 → auto-detected within LOS (no roll). If effective_stealth > 0 → detection roll required.
- **Detection formula (roll-under):** detection_score = 7 + effective_detection − effective_stealth − distance. Roll 2d6 ≤ detection_score → detected. Score > 12 = auto-detect, < 2 = impossible.
- **Fog of war:** Two display states only — Visible / Dark. "Scouted" is internal DB concept (scouted_hexes table) for showing terrain on Dark hexes. Not a display state.
- **Cannot target undetected units:** No AA fire, no intercept, no bombardment against undetected units.
- **Submarine one-sided combat:** Undetected sub can attack surface ships; target cannot fire back. Post-attack: target gets +2 bonus detection roll. If it succeeds, sub position revealed for next turn (no additional combat this turn).

### Air System
- **Flight group system:** Air actions use flight groups (not individual orders). Fighters (escort) + Bombers (strike) + Scout Planes (LOS). Mission types: Bombing Run, Attack Run, Scout (Scout Plane + optional escort; LOS only reported on return home), Sweep (Fighters only). AA fires before patrol intercepts.
- **Intercept combat:** One combined simultaneous battle — all fighters and bombers on both sides roll at once. No sequential escort-first-then-bombers.
- **Bomber routing:** Attack Run → Phase 2 (naval hex target) or Phase 3 (ground hex target). Bombing Run spanning both water and land → Phase 2 for water hexes, Phase 3 for land hexes; same group participates in both, Phase 2 casualties reduce count before Phase 3.
- **Patrol radius (air):** `floor((movement − 2 × distance_to_patrol_center) / 6)`. Fighter at home airbase = radius 5.
- **Naval AA (Overwatch Skies):** Frigate (To-Hit 7, Pen 1, Range 3). Battleship (To-Hit 6, Pen 0, Range 1 — point defense only). Land AA Gun (To-Hit 7, Pen 0, Range 2). AA hits in flight groups distributed proportionally by unit type count.

### Buildings
- **HP = material cost:** 1 mat + 1 man = +1 HP construction progress. Not operational until max HP.
- **Buildings:** Factory (20 HP), Airbase (10 HP), Harbor (10 HP), Airstrip (4 HP, supply consumed), Bridge (4 HP, supply consumed), Fortification (4 HP, supply consumed, +1 defense to all ground units in hex until destroyed). Urban tiles: 4 HP (tracked as `urban_hp` on hex); at 1–2 HP produces no manpower; repaired 1 mat + 1 man/HP.
- **Production capacity:** Slots = floor(current_hp / 2). Unit slot cost = ceil(mat_cost / 2). Full Factory (20 HP) = 10 slots. Factory needs Airbase within 5 hexes to produce air; Harbor within 5 hexes to produce naval.
- **Spawn rules:** Ground → Factory hex or adjacent (1 hex). Air → any Airbase/Airstrip/Carrier within 5 hexes of Factory. Naval → any Harbor within 5 hexes of Factory.
- **Airbase/Harbor placement:** Airbase anywhere; Harbor must be on/adjacent to Water. Both enable production at any Factory within 5 hexes (no adjacency requirement to Factory).
- **Parked air at captured Airbase:** If Airbase hex is captured in Phase 3, parked air units (no orders) make emergency scramble roll (1d6, ≥4 → fly to nearest friendly landing site within movement range; fail → destroyed).
- **Repair capacity:** Harbor and Airbase each have floor(current_hp / 2) repair slots. Repair cost = ceil(mat_cost/4) mat + ceil(man_cost/4) man. Requires explicit Repair order; only available when damaged at facility.
- **Fortification:** Full +1 defense bonus at any HP > 0. Only destroyed (HP=0) removes bonus. Applies to all friendly ground units in hex, all attack types including bombardment.

### Turn Structure
- **Two meta-phases:** Player Turn Phase (review, production, orders) then Resolution Phase (Phases 1–4 auto-execute).
- **Manpower spent in ordering phase** (not Phase 4). Players spend the manpower collected last Phase 4.
- **Phase 1 Air → Phase 2 Naval → Phase 3 Ground → Phase 4 Return & Collect.**
- **Finish turn:** Player-driven. All players ready → auto-advance. GM can force.
- **Phase 4 order:** Air return → Materials collected → Production queue advances → Settlement control evaluated → Manpower calculated → Win condition check → Reset.

### Patrol
- **Ground patrol:** Foot radius 1, mechanized radius 2 (radius uses `mechanized` tag). LOS required. One intercept per turn. Patrol unit moves to the hex the enemy tried to enter and fights there. If patrol wins → enemy pushed back, patrol stays in intercepted hex. If enemy wins → enemy continues movement. If both survive → enemy retreats, patrol stays.
- **Naval patrol:** Radius 2. Same intercept logic as ground patrol. One intercept per turn. Submarines patrol via sonar (not LOS); detection roll required before intercept.
- **Air patrol:** Formula-based radius. Each detected enemy flight group triggers a separate sequential intercept. Multiple groups = multiple battles; casualties applied between each.

### Orders
- **Fortify:** Any ground unit. One uninterrupted turn → +1 defense bonus. Cancelled if engaged before completion. Bonus persists until unit moves. Stacks with terrain and Fortification building bonus.
- **Repair:** Naval at Harbor, air at Airbase. Only when damaged. Uses 1 repair slot.
- **Bombard:** Artillery or Battleship. Directed indirect fire at a specific hex. Artillery skips the Phase 3 ranged fire step (it has no direct fire anyway). Battleship skips Phase 2 ranged fire step if given Bombard order; cancelled only by hex collision or path crossing in Phase 2.
- **Retreat:** Only for units locked in combat (sharing hex with enemy). Move to adjacent non-enemy hex. Invalid if surrounded.
- **Pursue if Retreat:** Conditional — only fires if enemy retreats that turn. Roll 2d6 ≤ (5 + avg pursuer Move − avg retreater Move).
- **Naval landing:** Offloading consumes ground units' entire movement for the turn. They land and cannot move in Phase 3 (but can be attacked).
- **Production queue:** Lost entirely if the production facility is captured in Phase 3. No refund.
- **Sonar ranges:** Submarine sonar range 4 hexes; Destroyer sonar range 3 hexes (hard caps; detection formula applies within range).

## Schema

```
supabase/migrations/
  001_config.sql              — terrain_type_config, unit_type_config (OUTDATED — needs 007)
  002_auth.sql                — gm_whitelist, profiles, games, game_participants
  003_map.sql                 — hexes, is_gm_in_game() helper, RLS
  004_factions_and_units.sql  — factions, units, movement_orders, RLS
  005_fog.sql                 — scouted_hexes, allied_vision (stub), player hex RLS
  006_seed.sql                — 10×10 dev map with mixed terrain
  007_additions.sql           — (NOT YET WRITTEN) needs:
                                - terrain_type_config: update terrain list, add foot_cost,
                                  mech_cost (×3 scale), road_segments_per_turn,
                                  road_manpower_per_segment, combat_modifier, blocks_los, elevation
                                - unit_type_config: overhaul all stats — tags, to_hit, defense,
                                  penetration, def_to_hit, hp (naval + bombers), stealth_rating,
                                  detection_rating, sonar_range, overwatch_to_hit, overwatch_pen,
                                  overwatch_range, move, los, atk_range, mat_cost, man_cost,
                                  slots, carrier_slots
                                - hexes: add has_light_vegetation, has_heavy_vegetation, has_urban,
                                  has_settlement, has_road, has_railroad(stub), has_airstrip,
                                  has_airbase, has_harbor, has_bridge, has_canal
                                - hexes: owner_faction_id only meaningful for objective hexes
                                - combat_log table
                                - production_queue table
                                - flight_groups table
                                - resource_tiles table
                                - faction_relationships table
                                - movement_orders: add sequence, order_type columns
                                - game_participants: add turn_ready column
                                - units: add standing_order, hp, fortification_level columns
                                - buildings table (game_id, hex_q, hex_r, type, current_hp,
                                  max_hp, status, owner_faction_id)
                                  types: manufacturing_facility, airbase, harbor, airstrip,
                                  bridge, fortification
```

## Key Server Routes

```
POST /api/auth/register
GET  /api/games
POST /api/games
POST /api/games/:gameId/factions
GET  /api/games/:gameId/factions
GET  /api/games/:gameId/participants
POST /api/games/:gameId/finish-turn  — player marks ready; auto-advances when all ready
GET  /api/games/:gameId/turn-status  — GM: list of players + turn_ready status
GET  /api/map/:gameId/hexes          — fog-of-war filtered for players; full for GM
GET  /api/map/:gameId/hexes/:q/:r    — single hex detail
PATCH /api/map/:gameId/hexes/:q/:r  — GM edits terrain/attributes/owner
POST /api/map/:gameId/orders         — player queues movement/bombard/fortify/repair/flight group/patrol order
DELETE /api/map/:gameId/orders/:unitId — clear all orders for a unit
POST /api/map/:gameId/production     — queue unit production at a facility hex
POST /api/gm/:gameId/units           — GM places unit
DELETE /api/gm/:gameId/units/:id
PATCH /api/gm/:gameId/factions/:id/resources
POST /api/gm/:gameId/advance-turn    — GM force-advance turn
```

## Key Frontend Components

```
client/src/
  components/
    HexGrid.jsx    — SVG hex renderer. Props: hexes, onSelect, onDoubleClick, panZoom, selectedKey
                     Handles pan (drag) + zoom (wheel). Fog states affect color/overlay.
    HexMap.jsx     — Loads hexes from server, renders HexGrid + detail panel.
    UnitIcon.jsx   — Per-unit-type inline SVG icon.
    ProtectedRoute.jsx
  pages/
    Login.jsx
    GameList.jsx
    GameView.jsx     — Player map view with resource bar
    GMDashboard.jsx  — Full GM view: map + faction manager + unit placer + advance turn
```

## Current Status

- [x] Schema designed and migrations written (001–006)
- [x] Server scaffold (all routes)
- [x] Client scaffold (all pages + components)
- [x] Supabase project created
- [x] .env files configured (REGISTRATION_CODE=wargame)
- [x] DESIGN.md complete — all mechanics fully designed and reviewed
- [ ] Migration 007 written and applied
- [ ] Combat resolution implemented (server/src/utils/combat.js)
- [ ] Movement validation implemented (server/src/utils/movement.js)
- [ ] advance-turn rewritten with full 4-phase pipeline
- [ ] finish-turn + turn-status endpoints
- [ ] Production queue endpoint
- [ ] Movement order UI (click unit → click destination → SVG arrows)
- [ ] Left panel (unit order list + facility list)
- [ ] Finish Turn button (player portal)
- [ ] GM turn status panel
- [ ] Win condition check
