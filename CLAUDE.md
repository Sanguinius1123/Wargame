# Wargame — Claude Context

Setting-agnostic hex-based operational wargame. Fork of ScifiRNR simplified to core map mechanics first.

## Goal

Build a playable wargame with: hex map + terrain, territory control, two resources (Production + Manpower), unit types, combat resolution, fog of war. Get this fun and balanced before adding politics/diplomacy/intrigue from the parent project.

## Tech Stack

Same as ScifiRNR:
- **Database:** PostgreSQL via Supabase (auth + RLS)
- **Backend:** Node.js + Express (`server/`)
- **Frontend:** React + Vite (`client/`)

## Design

Full game design: `DESIGN.md`

## Key Decisions (do not re-litigate)

- **Hexes, not regions:** Flat `hexes` table (game_id, hex_q, hex_r, terrain, development, owner_faction_id). No settlement/system hierarchy.
- **Two resources only:** Production + Manpower. Both collected from owned hexes at end of turn. Development level (0–3) multiplies output.
- **Factions, not realms:** Simpler. One faction per player per game.
- **Unit stacks:** One `units` row per (faction, unit_type, hex). Quantity tracked in that row.
- **Movement orders:** Queued in `movement_orders` with `turn` + `sequence` fields. Multi-turn paths supported. Executed at turn advance in sequence order.
- **Fog of war (computed):** Server computes visibility at query time using `computeVisibility()` in `server/src/utils/visibility.js`. Three states: visible / scouted / dark. Scouted hexes persisted in `scouted_hexes`.
- **Allied vision:** Table exists (`allied_vision`), always disabled. Stub only.
- **Air units:** Fighter + Bomber implemented as flight groups (not individual unit orders). `is_stub=TRUE` in unit_type_config until air system is built.
- **Registration:** REGISTRATION_CODE env var required for all signups. gm_whitelist only controls role assignment (same pattern as ScifiRNR).
- **Vegetation is two hex attributes:** `has_light_vegetation` (no move penalty for foot, +2 for mechanized) and `has_heavy_vegetation` (+2 for foot, impassable for mechanized). Both block LOS into-but-not-through.
- **Urban is a hex attribute:** `has_urban BOOLEAN`, not a terrain type. Overlays any terrain. Grants production/manpower + defense bonus.
- **Airstrip is a hex attribute:** `has_airstrip BOOLEAN`. Any terrain can have an airstrip.
- **No coast or river terrain types:** "Coastal" is implicit from adjacency to Water. Rivers are Water hexes going inland.
- **Locomotion types replace categories:** Units have a `locomotion` field (foot / mechanized / naval / air / hover / orbital / space / subterranean). Movement engine keys all costs to locomotion type, not unit name.
- **unit_type_config is per game:** Each game defines its own unit roster. Not global.
- **No stack limits:** Map design handles concentration strategy, not hard limits.
- **Supply system:** Stubbed. No supply penalty currently applied. Future: radius-based from urban hubs + Supply unit coverage.
- **Combat:** 2d6 bell curve per stack, simultaneous volleys, save rolls per hit, penetration stat on units. See DESIGN.md.
- **Terrain movement costs:** Derived from locomotion type + terrain base cost + attribute overlays. No separate lookup table — two extra columns on terrain_type_config (armor_extra_cost, etc.) are sufficient.
- **Turn advance order:** Phase 1 Air → Phase 2 Naval → Phase 3 Ground (+ naval bombardment + air-to-ground) → Phase 4 Collect.
- **Finish turn:** Player-driven. All players ready → auto-advance. GM can force.
- **Flight group system:** Air actions use flight groups (X fighters + Y bombers). Player designates path; system validates round-trip range. AA fires before patrol intercepts in Phase 1.
- **AA Gun:** Fires at ground (attack 2, pen 1, range 1) AND at air via Overwatch Skies ability (attack 4, pen 0, range 2, max 3 flight groups per turn).

## Schema

```
supabase/migrations/
  001_config.sql              — terrain_type_config, unit_type_config
  002_auth.sql                — gm_whitelist, profiles, games, game_participants
  003_map.sql                 — hexes, is_gm_in_game() helper, RLS
  004_factions_and_units.sql  — factions, units, movement_orders, RLS
  005_fog.sql                 — scouted_hexes, allied_vision (stub), player hex RLS
  006_seed.sql                — 10×10 dev map with mixed terrain
  007_additions.sql           — (NOT YET WRITTEN) combat_log, production_queue,
                                faction_relationships, flight_groups, unit penetration +
                                def_attack + locomotion, terrain combat_modifier + elevation +
                                armor_extra_cost, hex has_light_vegetation + has_heavy_vegetation +
                                has_urban + has_airstrip + has_bridge, movement_orders
                                sequence + order_type, game_participants turn_ready,
                                units standing_order, terrain types updated (remove coast/river/
                                forest/urban, add hills/desert/wetlands, rename sea→water)
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
- [ ] Migration 007 written and applied (terrain_movement_costs, combat additions, etc.)
- [ ] Combat resolution implemented (server/src/utils/combat.js)
- [ ] Movement validation implemented (server/src/utils/movement.js)
- [ ] advance-turn rewritten with full combat + production pipeline
- [ ] finish-turn + turn-status endpoints
- [ ] Production queue endpoint
- [ ] Movement order UI (click unit → click destination → SVG arrows)
- [ ] Left panel (unit order list + facility list)
- [ ] Finish Turn button (player portal)
- [ ] GM turn status panel
- [ ] Win condition
