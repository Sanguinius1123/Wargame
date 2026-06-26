# Wargame — Claude Context

Setting-agnostic hex-based operational wargame. Fork of ScifiRNR simplified to core map mechanics first.

## Goal

Build a playable wargame with: hex map + terrain, territory control, two resources (Materials + Manpower), unit types, combat resolution, fog of war. Get this fun and balanced before adding politics/diplomacy/intrigue from the parent project.

## Tech Stack

Same as ScifiRNR:
- **Database:** PostgreSQL via Supabase (auth + RLS)
- **Backend:** Node.js + Express (`server/`)
- **Frontend:** React + Vite (`client/`)

## Design

Full game design: `DESIGN.md`

## Key Decisions (do not re-litigate)

- **Hexes, not regions:** Flat `hexes` table (game_id, hex_q, hex_r, terrain, owner_faction_id). No settlement/system hierarchy.
- **Two resources:** Materials (saveable, from GM-placed resource tiles, 1 per tile per turn) and Manpower (not saveable, from contiguous urban tiles per settlement via flood-fill). No development multiplier.
- **Factions, not realms:** Simpler. One faction per player per game.
- **Unit stacks:** One `units` row per (faction, unit_type, hex). Quantity tracked in that row. Naval units and bombers use HP instead of quantity.
- **Movement orders:** Queued in `movement_orders` with `turn` + `sequence` fields. Multi-turn paths supported. Executed at turn advance in sequence order.
- **Movement engine:** Internal ×3 scale (all movement stats and terrain costs stored ×3). Formula: `max(1, ceil(movement / cost))` — fractional remainder always allows one more hex, also handles minimum-1 guarantee.
- **Mountains impassable for mechanized** without a road. Foot can always enter any ground terrain.
- **Road movement:** 2/3 terrain cost (road cost = terrain_cost × 2 in ×3 scale). Supply trucks build roads in adjacent hexes without entering them. Rate varies: plains/desert 3 segments at 1 man each, hills 2 at 2 man each, mountains 1 at 3 man, wetlands 1 at 2 man.
- **Fog of war (computed):** Server computes visibility at query time using `computeVisibility()` in `server/src/utils/visibility.js`. Three states: visible / scouted / dark. Scouted hexes persisted in `scouted_hexes`.
- **Allied vision:** Table exists (`allied_vision`), always disabled. Stub only.
- **Air units:** Flight group system (not individual orders). `is_stub=TRUE` in unit_type_config until air system is built.
- **Registration:** REGISTRATION_CODE env var required for all signups. gm_whitelist only controls role assignment (same pattern as ScifiRNR).
- **Vegetation is two hex attributes:** `has_light_vegetation` and `has_heavy_vegetation`. Both block LOS into-but-not-through. Give stealth bonus (+1/+3) to all units in hex.
- **Urban is a hex attribute:** `has_urban`. Settlements (`has_settlement`) are major cities that count toward win condition and start with a Manufacturing Facility.
- **Buildings have HP = material cost:** 1 material + 1 manpower adds 1 HP of construction per turn. Player allocates resources in installments — not operational until max HP. Airstrip (4 HP), Airbase (10 HP / 10 mat), Harbor (10 HP / 10 mat), Manufacturing Facility (20 HP / 20 mat), Bridge (3 HP). Supply truck builds Airstrip/Bridge by consuming the truck + manpower.
- **No coast or river terrain types:** Coastal = adjacency to Water. Rivers = Water hexes going inland.
- **Terrain types:** Plains, Hills, Mountains, Desert, Wetlands, Water. Mountains foot cost=4, mech=impassable without road. Hills foot/mech=2.
- **Tag system:** Units have multiple tags (ground/mobile/armored/heavy/naval/air/stealth + stubs). Tags are player-facing descriptors + cost indicators + drive engine rules. More tags = higher cost.
- **Naval units use HP not quantity stacks.** Fewer, tankier individual ships. Repaired at Harbors.
- **Bombers use HP (3 per aircraft)** not quantity stacks. Repaired at Airbase.
- **Production chain:** Manufacturing Facility produces all units. Adjacent Airbase required for air units. Adjacent Harbor required for naval units. Produced units spawn at the adjacent building (or nearby Carrier for air).
- **Resources from specific tiles:** Fixed resource tiles placed by GM (mines, lumbermills, quarries, etc.). Each produces 1 material per turn when owned. Terrain type does not produce resources.
- **Manpower:** = sum of contiguous `has_urban` tiles connected to each owned `has_settlement` hex (flood-fill). Not saveable. Damaged urban tile produces nothing. Destroyed = 0 and must be rebuilt.
- **unit_type_config is per game:** Each game defines its own unit roster. Not global.
- **No stack limits:** Map design handles concentration strategy, not hard limits.
- **Canals:** `has_canal` allows naval through Wetlands. Costs 10 manpower, supply truck present (not consumed). No effect on land movement.
- **Combat formula:** Per-unit dice pool. Both rolls use same direction (roll ≥ to succeed). Attack: 2d6 ≥ To-Hit → 1 hit. Save: 2d6 ≥ (14 − defense + penetration) → saved; else 1 casualty or 1 HP. Both sides fire simultaneously, casualties removed after. See DESIGN.md for unit stats.
- **Proportional fire:** Attacking unit types spread shots across defending unit types by count. Largest-remainder rounding to ensure totals add up.
- **Terrain movement costs:** Derived from locomotion type + terrain base cost + attribute overlays. ×3 internal scale. No separate lookup table.
- **Turn advance order:** Phase 1 Air → Phase 2 Naval → Phase 3 Ground → Phase 4 Collect.
- **Finish turn:** Player-driven. All players ready → auto-advance. GM can force.
- **Flight group system:** Air actions use flight groups. AA fires before patrol intercepts. Stealth groups require detection roll before AA/intercept can engage.
- **Stealth and detection:** Universal system. Units in open = auto-detected. Units in cover get terrain stealth bonus. Stealth-tagged units always need detection roll. Formula: threshold = 7 + distance + effective_stealth − effective_detection. Roll 2d6 ≥ threshold. Cannot target undetected units.
- **Win condition:** Hold 2/3 of `has_settlement` hexes at end of turn. Tunable per player count.
- **Bombardment mechanics:** Two rolls per hex (vs units, vs infra). Units get normal defense save with bombarder's pen. No save for infrastructure — random selection, HP infra loses 1 HP, no-HP infra set damaged/destroyed. Artillery: 1 hex, range 4–6, stationary, 1 die per hex (To-Hit 6, Pen 2). Battleship: 3-hex triangle, 3 attack dice per hex, can move+bombard (To-Hit 6, Pen 2). Bombers: 3-hex line, 1 die per hex, player designates infra target (70% hit chance) (To-Hit 7, Pen 1). Blind fire = no report. Empty hex = wasted.

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
                                - terrain_type_config: update terrain list (remove coast/river/
                                  forest/urban, add hills/desert/wetlands, rename sea→water),
                                  add foot_cost, mech_cost (×3 scale), road_segments_per_turn,
                                  road_manpower_per_segment, combat_modifier, blocks_los, elevation
                                - unit_type_config: overhaul all stats — locomotion tag replaces
                                  category, add to_hit, defense, penetration, def_to_hit,
                                  hp (for naval + bombers), stealth_rating, detection_rating
                                - hex attributes: has_light_vegetation, has_heavy_vegetation,
                                  has_urban, has_settlement, has_airstrip, has_airbase, has_harbor,
                                  has_bridge, has_road, has_canal, has_railroad (stub),
                                  is_damaged, is_destroyed
                                - combat_log table
                                - production_queue table
                                - flight_groups table
                                - movement_orders: add sequence, order_type columns
                                - game_participants: add turn_ready column
                                - units: add standing_order, hp columns
                                - buildings table (hex, type, current_hp, max_hp, status)
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
PATCH /api/map/:gameId/hexes/:q/:r  — GM edits terrain/development/owner
POST /api/map/:gameId/orders         — player queues movement/bombard/defend/wait order
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
- [x] DESIGN.md fully written — terrain, movement, combat, buildings, fog, resources, units
- [x] **Bombardment mechanics designed**
- [ ] Migration 007 written and applied
- [ ] Combat resolution implemented (server/src/utils/combat.js)
- [ ] Movement validation implemented (server/src/utils/movement.js)
- [ ] advance-turn rewritten with full combat + production pipeline
- [ ] finish-turn + turn-status endpoints
- [ ] Production queue endpoint
- [ ] Movement order UI (click unit → click destination → SVG arrows)
- [ ] Left panel (unit order list + facility list)
- [ ] Finish Turn button (player portal)
- [ ] GM turn status panel
- [ ] Win condition check
