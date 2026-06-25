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
- **Air units:** Schema stub only. `is_stub=TRUE` in unit_type_config. Not implemented. Will require `has_airstrip` hex attribute when built.
- **Registration:** REGISTRATION_CODE env var required for all signups. gm_whitelist only controls role assignment (same pattern as ScifiRNR).
- **Forest is a hex attribute:** `has_forest BOOLEAN` on hexes, not a terrain type. Forested hills/mountains are valid. Forest blocks LOS and adds move cost penalty.
- **Airstrip is a hex attribute:** `has_airstrip BOOLEAN` on hexes. Any terrain can have an airstrip.
- **No stack limits:** Map design handles concentration strategy, not hard limits.
- **Supply system:** Stubbed. No supply penalty currently applied. Future: radius-based from urban hubs + Supply unit coverage.
- **Combat:** 2d6 bell curve per stack, simultaneous volleys, save rolls per hit, penetration stat on units. See DESIGN.md.
- **Terrain movement costs:** Per-unit-type costs in `terrain_movement_costs` table. Formula: `max(1, floor(unit.movement / terrain_cost))`.
- **Turn advance order:** movement → combat → production → resource collection → reset turn_ready.
- **Finish turn:** Player-driven. All players ready → auto-advance. GM can force.

## Schema

```
supabase/migrations/
  001_config.sql              — terrain_type_config, unit_type_config
  002_auth.sql                — gm_whitelist, profiles, games, game_participants
  003_map.sql                 — hexes, is_gm_in_game() helper, RLS
  004_factions_and_units.sql  — factions, units, movement_orders, RLS
  005_fog.sql                 — scouted_hexes, allied_vision (stub), player hex RLS
  006_seed.sql                — 10×10 dev map with mixed terrain
  007_additions.sql           — (NOT YET WRITTEN) terrain_movement_costs, combat_log,
                                production_queue, faction_relationships, unit penetration,
                                terrain combat_modifier + elevation, hex has_forest +
                                has_airstrip, movement_orders sequence + order_type,
                                game_participants turn_ready, units standing_order
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
