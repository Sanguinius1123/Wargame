# Wargame — Design Document

Setting-agnostic hex-based operational wargame. Planet-scale map, ground + naval warfare, fog of war, async multiplayer via web portal.

---

## Core Loop

1. **Orders** — players queue movement, combat, production, and standing orders
2. **Resolve** — turn advances: movement executes, combat resolves, production spawns units, resources collected
3. **Report** — players see results (casualties, territory changes) filtered through fog of war

**Turn advance order (server-side):**
1. Apply movement orders (crossing detection first)
2. Resolve combat on contested hexes
3. Process production queue (spawn units at facilities)
4. Collect resources from owned hexes
5. Reset `turn_ready` for all players, increment turn counter

---

## Finish Turn

- Each player has a **Finish Turn** button on their portal
- Clicking it marks them `turn_ready = true`
- When ALL active player participants are ready → turn auto-advances
- GM has a Finish Turn button that **force-advances** regardless of player readiness
- GM portal shows a list of all players and their ready status

---

## Map

Hex grid, pointy-top axial coordinates (`hex_q`, `hex_r`). Planet-scale = hundreds to thousands of hexes per game.

### Terrain Types

Terrain determines base movement cost (via `terrain_movement_costs` table), resource output, LOS blocking, elevation, and combat modifiers.

| Terrain | Elevation | Combat Modifier | Defense Bonus* | Blocks LOS | Production | Manpower |
|---|---|---|---|---|---|---|
| Plains | 0 | 0 | 0 | No | 1 | 1 |
| Hills | 1 | +1 | +1 | No | 0 | 0 |
| Mountains | 2 | +2 | +1 | Yes | 0 | 0 |
| Coast | 0 | 0 | 0 | No | 1 | 1 |
| Sea | 0 | 0 | 0 | No | 0 | 0 |
| Urban | 0 | 0 | +3 | No | 3 | 2 |
| River | 0 | -1 | 0 | No | 0 | 0 |
| Wetlands | 0 | -1 | 0 | No | 0 | 0 |

*Defense bonus only applies to units that **did not move** this turn (defend, wait, or idle orders).

**Combat Modifier** applies to all units fighting FROM that hex, attack or defense. High ground helps regardless of whether you're attacking or defending.

### Hex Attributes

Two boolean attributes can overlay any terrain type:

- **`has_forest`** — Forest is a hex attribute, not a terrain type. A forested mountain or forested hill is valid. Forest:
  - Blocks LOS
  - Adds movement cost penalty on top of base terrain cost (ground units; amount varies by unit type — infantry are nimble in forests, armor is heavily penalized)
  - Adds minor combat modifier for defenders (cover)

- **`has_airstrip`** — An airstrip facility on this hex. Aircraft must end every turn on a hex with an airstrip. Any terrain type can have an airstrip.

### Elevation and Artillery Range

`elevation` on terrain type determines artillery bonus range:
- Plains/Coast/Sea/Urban/River/Wetlands: elevation 0
- Hills: elevation 1
- Mountains: elevation 2

**Effective artillery range** = `base_range + max(0, firer_elevation − target_elevation)`

- Firing down from a mountain to plains: base_range + 2 bonus
- Firing from mountain to mountain: base_range + 0 (no relative advantage)
- Firing up from plains to mountains: base_range + 0 (**no penalty** — artillery lobs shots; it just loses the height bonus)
- Artillery can fire OVER intervening terrain (indirect arc). Mountains between firer and target do **not** block the shot — only LOS.

### Hex Ownership

A hex is owned by whichever faction last controlled it. Capturing = have units there with no enemy units at end of combat phase. Owning a hex at end of turn collects its resources.

---

## Movement

### Movement Points

Each unit has a `movement` stat = total movement points per turn.

### Terrain Movement Costs (per unit type)

Stored in `terrain_movement_costs` table: `(terrain_name, unit_type_id, move_cost, impassable)`.

Movement formula: `hexes_in_terrain = max(1, floor(unit.movement / terrain_cost))`

Example results with Infantry (mv=2) and Armor (mv=4):

| Terrain | Infantry cost | Armor cost | Infantry hexes | Armor hexes |
|---|---|---|---|---|
| Plains | 1 | 1 | 2 | 4 |
| Hills | 2 | 2 | 1 | 2 |
| Mountains | 2 | 4 | 1 | 1 |
| Wetlands | 2 | 4 | 1 | 1 |
| Coast | 1 | 1 | 2 | 4 |
| Urban | 1 | 2 | 2 | 2 |
| River | 2 | 2 | 1 | 2 |
| Sea | impassable | impassable | — | — |

**Forest attribute** adds an additional move cost penalty on top of terrain base:
- Infantry in forested terrain: cost +0 (infantry is nimble in forests — same base cost)
- Armor in forested terrain: cost +2 or +3 (heavily penalized)
- Naval: forests are irrelevant (sea hexes)

Naval units (Destroyer mv=5, Battleship mv=4, Transport mv=4) can only enter Sea, Coast, and River hexes. Land is impassable.

Air units ignore terrain movement costs entirely but must start and end each turn on a hex with `has_airstrip = true`.

### Queued Orders

Players can queue movement orders for multiple future turns. These are stored with a `turn` and `sequence` field, allowing a unit to have a pre-planned multi-turn path. Orders for future turns execute automatically when those turns arrive.

**Enemy spotted clearing** (future): if a unit's queued path passes through a hex where an enemy is detected at turn advance, the queue may be auto-cleared with a flag shown to the player.

---

## Orders

Units can be given the following orders each turn:

| Order | Description | Notes |
|---|---|---|
| **Move** | Queue movement to a destination hex | Can chain multiple turns |
| **Defend** | Standing order, persists turn to turn | Unit gets terrain defense_bonus; never appears in "needs orders" list |
| **Wait** | Skip this turn only | Clears from needs-orders list; unit gets defense_bonus this turn |
| **Bombard** | Artillery/Battleship zone attack | Target hex, stationary required (except Battleship) |
| **Skirmish Hold** *(stub)* | Harass without committing | Reduced outgoing damage; no advance even if enemy wiped |
| **Skirmish Retreat** *(stub)* | Fire then fall back | Retreat to designated hex after exchange; attacker cannot advance |

### Skirmish (stub — not yet implemented)

A unit in **Skirmish** mode is delaying, not holding. It does not receive a defense bonus.

Two sub-modes, set when issuing the order:

**Skirmish Hold (attack tile designated):**
- Fights but deals reduced outgoing damage (partial engagement)
- Takes **reduced** incoming damage — UNLESS enemy physically moves into the unit's hex (direct assault = full damage)
- If enemy is wiped out, skirmisher stays in own hex regardless — does not advance
- After battle: stays put

**Skirmish Retreat (retreat tile designated):**
- Fires one exchange, then retreats to the designated tile if not wiped out
- The attacker **cannot advance** this turn even if they "won" — they are held at their origin hex
- Primary use: delaying enemy advance while preserving the unit

---

## Combat Resolution

### Domain Separation

- Ground units fight ground units only
- Naval units fight naval units only
- No cross-domain melee (Battleship can't fight Infantry directly)
- **Exception:** Artillery (ground) and Battleship (naval) can bombard across domains via bombardment orders

### Terrain in Combat

Two terrain values affect combat:

1. **`combat_modifier`** — always applies to your side's combat strength when fighting FROM that hex, regardless of attack or defense. High ground (mountains +2) benefits attacker and defender equally. Wetlands/river (-1) penalizes your forces regardless of role.

2. **`defense_bonus`** — ONLY applies to units that **did not move this turn** (defend, wait, or idle). A unit in a city that attacks out of it loses the city defense bonus. The unit LEAVING is the attacker and gets no fortification benefit.

### Combat Formula (Simultaneous Volleys)

All unit stacks on all sides fire simultaneously. Each stack rolls independently:

```
roll       = d6 + d6                           // 2–12, peaks at 7 (bell curve)
multiplier = roll / 7                          // 0.29 to 1.71, average 1.0
raw_hits   = floor((attack + terrain.combat_modifier) × qty × multiplier)
```

For each raw hit, the **target unit stack** rolls a save:

```
save_threshold = 11 − target.defense − terrain.defense_bonus(if_stationary) + attacker.penetration
// defender rolls 2d6; if ≥ save_threshold → hit negated
// if < save_threshold → 1 casualty applied to target stack
```

Casualties are applied weakest-unit-first on the target side. Both sides take casualties simultaneously (fire resolves before anyone is removed).

### Penetration Stat

`penetration` on the attacker's unit type raises the defender's save threshold (makes saves harder):

| Unit | Penetration | Effect vs Infantry (defense 2, threshold 9) |
|---|---|---|
| Infantry | 0 | Infantry saves on 9+ (28%) |
| Artillery | 1 | Infantry saves on 10+ (17%) |
| Armor | 3 | Infantry saves on 12+ (3%) — nearly impossible |
| Battleship | 2 | Infantry saves on 11+ (8%) |

### Unit Stats (current)

| Unit | Attack | Defense | Penetration | Move | LOS | Atk Range | Prod | Man |
|---|---|---|---|---|---|---|---|---|
| Infantry | 2 | 2 | 0 | 2 | 2 | 1 | 1 | 2 |
| Armor | 4 | 4 | 3 | 4 | 3 | 1 | 3 | 1 |
| Artillery | 5 | 1 | 1 | 2 | 2 | 4 | 4 | 1 |
| Supply | 0 | 0 | 0 | 2 | 2 | 1 | 2 | 1 |
| Destroyer | 3 | 2 | 1 | 5 | 4 | 1 | 3 | 1 |
| Battleship | 6 | 4 | 2 | 4 | 4 | 3 | 6 | 2 |
| Transport | 0 | 1 | 0 | 4 | 3 | 1 | 2 | 1 |
| Fighter* | 3 | 2 | 0 | 8 | 6 | 1 | 4 | 1 |
| Bomber* | 6 | 1 | 0 | 7 | 4 | 1 | 5 | 1 |

*Air units are stubs — not yet implemented. Aircraft must land on `has_airstrip` hex each turn.

### Multi-Faction Combat

When 3+ factions occupy the same hex, **simultaneous proportional fire** resolves it:

- Each faction splits their total attack pool proportionally across all enemies (by enemy total quantity)
- All factions fire simultaneously
- All factions take casualties simultaneously
- Winner = last faction standing in the hex

**Faction relationships** (`faction_relationships` table):
- `at_war` (default) — fight on sight
- `allied` — share hexes, fight together as one side
- `neutral` — cannot share hexes; movement into a neutral-occupied hex is blocked automatically. The moving unit stops at its origin. The player can change the relationship to `at_war` and attack next turn.

Two neutral factions both moving into the same empty hex: neither enters, both stop at origin.

### Movement and Combat Interaction

**Crossing detection:** If unit A has destination = unit B's origin AND unit B has destination = unit A's origin, a **border battle** triggers:

1. Neither unit moves
2. Combat resolves in place (using each unit's starting hex terrain)
3. If one side is wiped out → survivors advance into the loser's original hex
4. If both sides survive → both stay in their starting hex

Units that moved this turn do NOT receive their terrain's `defense_bonus` (they were in motion).

---

## Bombardment

Artillery (ground) and Battleship (naval) can attack at range without entering the target hex.

**Rules:**
- Artillery must be **stationary** that turn to bombard (no move + fire)
- Battleship **can move and bombard** in the same turn (naval mobility)
- If a Battleship is engaged in naval combat that turn → bombardment is **cancelled**; it fights the naval engagement instead. Cannot do both.
- Player designates a **target hex** when setting the order
- At resolution: if enemy units are present in the target hex → they take hits (save rolls still apply)
- If target hex is **empty** → shot wasted, no effect
- **No return fire** to the bombardment unit — the bombarded units cannot fire back at range

**Blind fire (LOS and range):**
- Artillery can fire beyond its own LOS (`attack_range` > `los_range`)
- If the firing unit OR any friendly unit has LOS to the target hex → player sees the battle result
- If no friendly LOS to the target hex → shot resolves server-side but player gets **no report** — they don't know if there was anything there or how much damage was dealt

---

## Fog of War

Three visibility states per hex per faction:
- **Visible** — currently in LOS of one of the faction's units
- **Scouted** — previously seen, not currently visible (terrain shown, no current unit info)
- **Dark** — never seen

LOS is blocked by Mountains and `has_forest` hexes. Each unit type has a `los_range` (in hexes).

### Combat Intel (Fog of War on Battle Reports)

After combat resolves, players see battle reports filtered by LOS:

| Situation | Own Casualties | Enemy Casualties |
|---|---|---|
| Had LOS to the battle | Exact | Exact |
| In the battle, no LOS | Exact | Estimated (±20–30%) |
| Blind bombardment, no spotter | No report | No report |

---

## Production

**Facilities** = any urban hex owned by the player's faction.

Players can queue unit production at a facility by clicking it. Resources are **deducted immediately** at queue time to prevent double-spending. Units spawn at the facility hex during the production phase of turn advance.

Unit costs come from `unit_type_config.production_cost` and `manpower_cost`.

`production_queue` table tracks: game, faction, target hex, unit type, quantity, turn queued, status (pending/cancelled/complete).

---

## Supply (STUB — not yet implemented)

Design intent (not built):
- Units within `supply_radius` hexes of a friendly owned urban hex are **supplied** automatically
- Units outside the radius need Supply units nearby (ratio: X Supply unit quantity per Y troop quantity)
- Supply units are consumed each turn while covering cut-off forces
- When supply runs out: cut-off troops take automatic attrition hits each turn

Current behavior: supply is ignored entirely. No penalty for being "cut off."

---

## Combat Log

Every combat event is persisted to `combat_log` and `combat_log_participants`. Players can review what happened each turn. Enemy casualty information is filtered by LOS (see Combat Intel above).

---

## Faction Relationships

Stored in `faction_relationships` table:
- `at_war` — default for all faction pairs
- `allied` — share hexes, fight together
- `neutral` — peaceful coexistence rules apply (can't share hexes)

Relationships are symmetric. Allied vision sharing (`allied_vision` table) is stubbed — exists in schema, not wired.

---

## GM Portal

Full map visibility. Can:
- Edit any hex (terrain, development, owner)
- Place or remove units
- Adjust faction resources
- Force-advance the turn regardless of player ready status
- See turn status (which players have clicked Finish Turn)

---

## Player Portal — Left Panel

Collapsible sidebar showing units that **need orders this turn**:
- Unit stacks without any order set (move/defend/wait/bombard)
- Owned urban hexes with no active production queue (facilities idle)
- Units with `standing_order = 'defend'` are **never** shown (they have a standing order)

Per unit in the panel:
- Click → map pans to that unit's hex
- **Move** button → enters order mode on the map
- **Defend** button → sets standing order (persists future turns)
- **Wait** button → clears unit from list this turn only, resets next turn

Panel auto-hides when empty (all units have orders). Has a toggle to manually open/close.

---

## Future Features (not yet designed)

- **Fortify** order: unit spends N turns fortifying a hex, building up a `fortification_level` that adds to `defense_bonus` for stationary defenders
- **Supply lines**: full radius + supply unit implementation (see stub above)
- **Air warfare**: Fighter/Bomber with airstrip requirement, sortie model
- **Allied vision sharing**: wire up `allied_vision` table
- **Naval transport**: loading/unloading ground units via Transport
- **Victory conditions**: beyond "eliminate all enemies"
- **Initiative/speed mechanics**: breaking simultaneous movement ties
- **Enemy-spotted queue clearing**: auto-clear movement queues when enemy detected on path
- **Hills terrain**: elevation 1 (between plains and mountains) — noted in terrain table, add when adding terrain variety to maps
- **Wetlands terrain**: already in terrain table
- **Skirmish orders**: fully implement hold and retreat sub-modes
