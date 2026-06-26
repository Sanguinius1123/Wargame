# Wargame — Design Document

Setting-agnostic hex-based operational wargame. Planet-scale map, ground + naval + air warfare, fog of war, async multiplayer via web portal.

---

## Core Loop

1. **Orders** — players queue movement, combat, production, patrol, and flight group orders
2. **Resolve** — turn advances through four phases
3. **Report** — players see results filtered through fog of war

---

## Turn Resolution

**Phase 1 — Air**
1. All flight groups move along designated paths (paths recorded for LOS + intercept)
2. AA Overwatch fires at each flight group passing through coverage zones
3. Patrol intercepts engage each flight group passing through patrol areas
4. Surviving bombers carry strike orders into Phase 3

**Phase 2 — Naval**
- Naval units fight each other in contested hexes

**Phase 3 — Ground**
- Ground units fight in contested hexes
- Naval bombardment resolves (Battleship + Destroyer strikes against land targets)
- Air-to-ground strikes resolve (surviving bombers from Phase 1)

**Phase 4 — Collect**
- Resources collected from owned hexes
- Production queue advances; completed units spawn at facilities
- `turn_ready` reset for all players, turn counter increments

---

## Finish Turn

- Each player has a **Finish Turn** button on their portal
- Clicking marks them `turn_ready = true`
- All active players ready → turn auto-advances
- GM can force-advance regardless of player readiness
- GM portal shows all players and their ready status

---

## Map

### Terrain Types

| Terrain | Elevation | Combat Mod | Def Bonus* | Blocks LOS† | Production | Manpower |
|---|---|---|---|---|---|---|
| Plains | 0 | 0 | 0 | No | — | — |
| Hills | 1 | +1 | +1 | No | — | — |
| Mountains | 2 | +2 | +1 | Yes | — | — |
| Desert | 0 | 0 | 0 | No | — | — |
| Wetlands | 0 | -1 | 0 | No | — | — |
| Water | 0 | 0 | 0 | No | — | — |

*Defense bonus only applies to units that did not move this turn.
†Blocking hexes are visible — you can see INTO them, not THROUGH them.

Resources are not produced by terrain type. They are produced by specific resource tiles and buildings placed on the map by the GM.

**Notes:**
- "Coastal" = any land hex adjacent to Water (implicit, not a terrain type)
- Rivers = Water hexes going inland (same terrain type, same rules)
- Urban, forest, and other features are hex attributes

### Hex Attributes

| Attribute | Description |
|---|---|
| `has_light_vegetation` | Blocks LOS†. No move penalty for foot; +2 for mechanized. Stealth +1 for all units. |
| `has_heavy_vegetation` | Blocks LOS†. +2 for foot; impassable for mechanized. Stealth +3 for all units. |
| `has_urban` | City environment. Stealth +2. +1 move cost for mechanized. Contributes to manpower for connected settlement. |
| `has_settlement` | Major urban center. Counts toward win condition. Starts with a Manufacturing Facility. |
| `has_road` | Road. Reduces terrain movement cost to 2/3 (see Movement section). Supply unit builds (1 manpower; truck not consumed). |
| `has_railroad` | *(Stub)* Railroad. Very fast ground unit movement. Expensive to build. |
| `has_airstrip` | Hosts air units. Cannot produce them. Has HP. Built by consuming a Supply unit + 2 manpower. |
| `has_airbase` | Hosts and produces air units. Must be adjacent to a Manufacturing Facility. Has HP. |
| `has_harbor` | Naval production and repair. Must be on/adjacent to a Water hex. Has HP. |
| `has_bridge` | Foot/mechanized may cross this Water hex. Has HP. Built by consuming a Supply unit + 2 manpower. |
| `has_canal` | Naval units may enter this Wetlands hex. Significant manpower cost to build. |
| `is_damaged` | Building/infrastructure is damaged — reduced output. Still functional for movement (bridges still passable). |
| `is_destroyed` | Building/infrastructure is destroyed — non-functional. Still visible on map. Repairable. |

†The attribute hex itself is visible; hexes beyond it are not.

### Elevation and LOS

| Terrain | Elevation | LOS bonus (when standing on) |
|---|---|---|
| Plains / Desert / Wetlands / Water | 0 | +0 |
| Hills | 1 | +1 |
| Mountains | 2 | +2 |

**Artillery elevation bonus:** `effective_range = base_range + max(0, firer_elevation − target_elevation)`. Terrain between firer and target does not block the shot arc.

### Hex Ownership and Win Condition

A hex is owned by whichever faction last controlled it. Capturing = have units there with no enemies at end of Phase 3.

**Win condition:** Hold **2/3 of all `has_settlement` hexes** on the map at end of your turn. Threshold is tunable per player count (lower in 3+ player games). Settlement count is set at map creation by GM.

---

## Locomotion Types (Tags)

Units have a combination of tags that describe what they are, what they can do, and where they can go. Tags are player-facing indicators that also inform cost (more tags = higher cost) and drive engine rules for terrain access, combat targeting, and special abilities.

| Tag | Meaning |
|---|---|
| `ground` | Can move on land terrain |
| `mobile` | Fast; higher movement stat; maneuverable |
| `armored` | Tough; high defense; absorbs punishment (land units use quantity stacks, not HP) |
| `heavy` | Heavy firepower; specialized destructive capability; often ranged |
| `naval` | Can move on Water |
| `air` | Flies over all terrain; must land on airstrip/airbase |
| `stealth` | Has a stealth rating; always requires detection roll to be spotted |
| `orbital` | Stub |
| `space` | Stub |
| `subterranean` | Stub |

**Contextual meaning of `air` tag:**
- On a flying unit (Fighter, Bomber): it flies
- Combined with `naval` (Carrier): can host and launch aircraft
- Combined with `ground` (AA Gun, Transport Plane): can target OR carry air-domain objects

### Unit Roster

| Unit | Tags |
|---|---|
| Infantry | ground |
| Armor | ground + mobile + armored |
| Artillery | ground + heavy |
| AA Gun | ground + air + heavy |
| Supply | ground + mobile |
| Fighter | air |
| Scout Plane | air + mobile + stealth |
| Bomber | air + heavy |
| Transport Plane | air + ground |
| Destroyer | naval + mobile |
| Cruiser | naval |
| Battleship | naval + armored + heavy |
| Transport (ship) | naval + ground |
| Carrier | naval + air |
| Submarine | naval + stealth |

---

## Movement

### Terrain Costs by Tag

Costs are stored internally on a **×3 scale** (all movement stats and terrain costs multiplied by 3) so that the 2/3 road multiplier resolves as integers. User-facing values below; engine values = user value × 3.

**Movement formula:** `hexes = max(1, ceil(movement / cost))`. If any movement points remain after taking the maximum whole hexes, the unit can always enter one more hex, spending the remainder. Every ground unit can always enter at least 1 hex — no terrain cost alone makes a ground hex impassable to a foot unit.

| Terrain | foot | mechanized | naval | air |
|---|---|---|---|---|
| Plains | 1 | 1 | impassable | passable |
| Hills | 2 | 2 | impassable | passable |
| Mountains | 4 | **impassable** | impassable | passable |
| Desert | 2 | 1 | impassable | passable |
| Wetlands | 2 | **4** | impassable | passable |
| Water | impassable | impassable | 1 | passable |
| Water + `has_bridge` | 2 | 3 | 1 | passable |
| Wetlands + `has_canal` | 2 | 4 | **2** | passable |

Canals (`has_canal`) allow naval units to traverse Wetlands hexes. They have no effect on land movement. Naval cannot enter Wetlands without a canal.

**Mountains and mechanized:** Vehicles cannot enter Mountains without a road. Supply trucks build roads in **adjacent** hexes without entering them — park at the mountain's edge and construct the path forward. Infantry can screen the supply truck while it works.

**Roads:** `has_road` is a tile tag only — not a structure. No HP. Can only be removed by a ground unit spending an action to demolish it. Roads reduce movement cost to **2/3 of normal terrain cost** (integer math via ×3 scale: road cost = terrain_cost × 2 in the internal scale).

| Terrain | Off-road | Road cost | Infantry (mv=2) off → road | Armor (mv=4) off → road |
|---|---|---|---|---|
| Plains | 1 | 0.67 | 2 → 3 hexes | 4 → 6 hexes |
| Hills | 2 | 1.33 | 1 → **2 hexes** | 2 → 3 hexes |
| Mountains | 4 | 2.67 | 1 → **1 hex** | 1 → **2 hexes** |
| Desert (foot/mech) | 2 / 1 | 1.33 / 0.67 | 1 → 1 hex | 4 → 6 hexes |
| Wetlands | 2 / 4 | 1.33 / 2.67 | 1 → 1 hex | 1 → 1 hex |

Roads connect visually: adjacent road tiles draw a road line between them, including across bridges. Naval and air are unaffected.

**Desert asymmetry:** foot pays 2 (heat, exhausting); mechanized pays 1 (flat open terrain, ideal for armor).

### Hex Attribute Movement Effects

| Attribute | foot | mechanized | naval | air |
|---|---|---|---|---|
| `has_light_vegetation` | +0 | +2 | no effect | no effect |
| `has_heavy_vegetation` | +2 | impassable | no effect | no effect |
| `has_urban` | +0 | +1 | no effect | no effect |
| `has_airstrip` / `has_airbase` | no effect | no effect | no effect | required to land |

### Naval Landing

Transport ships (naval + ground) offload ground units to adjacent land hexes. Ground units enter the land hex at cost 1 movement. Transport capacity: **6 slots**. Each unit currently occupies 1 slot (subject to change; some units may occupy 2).

### Air Movement

Air units ignore terrain costs. Must start and end every turn on a hex with `has_airstrip` or `has_airbase`. Air units provide LOS for every hex along their flight path. Destroyed units contribute no LOS.

**If planned landing site is captured or destroyed:** system checks for nearest friendly airstrip/airbase within remaining movement range. If found → reroute. If not → unit crashes. *(Emergency landing rules: future feature.)*

---

## Buildings and Infrastructure

Buildings are placed on the map (either by GM at start or built by players during the game). They have HP, can be damaged or destroyed.

| Building | Max HP | Mat cost | Man cost | Supply unit? | Placement rules |
|---|---|---|---|---|---|
| Manufacturing Facility | 20 | 20 | 20 | No | Pre-placed at settlements; player-buildable elsewhere |
| Airbase | 10 | 10 | 10 | No | Must be adjacent to a Manufacturing Facility |
| Harbor | 10 | 10 | 10 | No | Must be on/adjacent to Water AND adjacent to a Manufacturing Facility |
| Airstrip | 4 | 0 | 2 total | Consumed | Anywhere |
| Bridge | 3 | 0 | 2 total | Consumed | On a Water hex |
| Road | — | 0 | 1 | Present, not consumed | Any passable land hex |

HP = material cost for mat-based buildings. This makes all math trivial: **1 material + 1 manpower adds 1 HP of construction progress**.

**Construction:** Players allocate materials and manpower toward a building each turn. Each 1 mat + 1 man invested adds 1 HP. The building is not operational until it reaches max HP. Players can invest as little or as much as their budget allows per turn — a Manufacturing Facility can be half-built (10 HP) over one turn and completed the next. Enemies can attack under-construction buildings to damage or destroy them. If HP drops to 0: building is lost, no refund.

**Repair costs:**
```
Naval (at Harbor):    ceil(build_cost / 4)  → restores to full HP

Mat-based buildings:  1 mat + 1 man per HP restored (same rate as construction)

Airstrip/Bridge:      1 Supply unit consumed + 1 man per HP restored
```

**Building status field:** `under_construction` → `operational` → `damaged` → `destroyed`
- `under_construction`: current_hp < max_hp, never yet reached full HP. No production.
- `operational`: at max HP. Fully functional.
- `damaged`: took battle damage after being operational. Reduced output.
- `destroyed`: HP = 0. Non-functional. Tag stays on hex.

**Damage states:**
- `is_damaged` — HP between 1 and 50% of max (after being operational). Reduced output. Bridges still passable.
- `is_destroyed` — HP = 0. Non-functional. Bridge impassable. Tag stays on hex.

**Production chain:**
- Ground units: produced at Manufacturing Facility
- Air units: produced at Manufacturing Facility with adjacent Airbase. Spawned at the Airbase (or a Carrier within adjacent range).
- Naval units: produced at Manufacturing Facility with adjacent Harbor. Spawned at the Harbor.

**Supply units as builders:** Construct roads (present in hex + 1 manpower), airstrips and bridges (consumed). Roads are cheap and repeatable — one Supply unit can pave a network over multiple turns.

---

## Stealth and Detection

### Who Needs a Detection Roll

| Unit type | In cover (vegetation/urban/hills/mountains) | In open (plains/desert/water) |
|---|---|---|
| No stealth tag | Gets terrain stealth bonus → roll required | Stealth = 0 → **auto-detected** within LOS |
| Has stealth tag | Base stealth + terrain modifier → roll required | Base stealth − terrain penalty → roll required |

Units with the `stealth` tag always require a detection roll. Terrain modifies effective stealth up or down.

**You cannot target what you have not detected.** Undetected stealth units cannot be fired upon by AA, intercepted by patrol fighters, bombarded, or otherwise engaged.

### Terrain Stealth Modifiers

Applied to the unit being detected (hiding unit's effective stealth):

| Terrain / Attribute | Stealth modifier |
|---|---|
| Heavy vegetation | +3 |
| Mountains | +2 |
| Urban (`has_urban`) | +2 |
| Light vegetation | +1 |
| Hills | +1 |
| Wetlands | +1 |
| Plains | 0 for non-stealth (auto-detected); −2 penalty for stealth units |
| Desert | 0 for non-stealth (auto-detected); −2 penalty for stealth units |
| Water (surface) | 0 for non-stealth (auto-detected); −2 penalty for naval stealth units |

### Domain Detection Modifiers

Applied to the detecting unit's effective detection:

| Detector → Target | Detection modifier |
|---|---|
| Air → Ground | −3 (hard to spot camouflaged ground units from altitude) |
| All other combinations | +0 |
| Submarine → anything | Detection stat only; naval targets only; LOS = 0 |

### Detection Formula

```
effective_stealth    = unit.stealth_rating + terrain_stealth_modifier
effective_detection  = detector.detection + domain_modifier
threshold            = 7 + distance + effective_stealth − effective_detection
```

Roll **2d6 ≥ threshold** → detected this turn. Capped: threshold < 2 = auto-detect, threshold > 12 = impossible. Detection is attempted each turn within the detector's detection range.

Once detected, the unit is visible to that faction. The roll re-runs each turn — a faction can lose track of a unit if the detector moves away or is destroyed.

**Example — Destroyer (detection 6) vs Submarine (stealth 6):**

| Distance | Threshold | Chance |
|---|---|---|
| 1 | 8 | 42% |
| 2 | 9 | 28% |
| 3 | 10 | 17% |
| 4 | 11 | 8% |
| 5 | 12 | 3% |

### Submarine Rules

- LOS = 0. Completely blind visually.
- Detects via sonar (detection stat) only.
- Can only detect naval surface units — not ground, not air.
- Contributes no fog-of-war vision to its faction beyond its own hex.

### Stealth by Unit Type

| Unit | Stealth | Detection | Notes |
|---|---|---|---|
| Infantry | 0 | 2 | Auto-detected in open; hidden in cover |
| Armor | 0 | 2 | Auto-detected in open |
| Artillery | 0 | 2 | |
| AA Gun | 0 | 4 | Specialized sensors |
| Supply | 0 | 1 | |
| Fighter | 0 | 3 | Airborne radar |
| Scout Plane | 4 | 4 | High stealth + good detection |
| Bomber | 0 | 2 | |
| Transport Plane | 0 | 1 | |
| Destroyer | 0 | 6 | Primary sub-hunter |
| Cruiser | 0 | 4 | |
| Battleship | 0 | 3 | |
| Transport (ship) | 0 | 2 | |
| Carrier | 0 | 5 | |
| Submarine | 6 | 5 | LOS = 0; sonar-only; naval targets only |

---

## Flight Groups

The fundamental unit of air action. Players compose flight groups; individual air unit orders are not used.

**Composition:** any fighters (escort) + any bombers (strike). Fighter-only groups valid for scouting, sweeps, and LOS missions.

**Mission types:**

| Mission | Units | Effect |
|---|---|---|
| Strike | Bombers + optional escort | Bombers attack designated target in Phase 3 |
| Scout | Fighters only | Fly path to gather LOS |
| Sweep | Fighters only | Clear patrol fighters from a path |

**Path validation:** system checks every unit has enough movement for outbound path + return to nearest friendly airstrip/airbase. Rejected if any unit falls short.

**Attrition:** entirely destroyed groups report nothing. Only surviving members provide LOS.

**Future:** turn-around rules — abort if X casualties, return to base if movement permits.

---

## Patrol

Standing order for fighters. Fighter stays in designated hex; intercepts any enemy flight group whose path enters patrol area.

**Patrol area:** all hexes within X of the patrol hex (range TBD, 1–2, pending balance).

Patrol persists turn to turn. Patrolling fighter cannot also move. Undetected stealth flight groups pass through without triggering intercept.

---

## Air Phase Resolution (Phase 1 Detail)

1. All flight groups commit to paths simultaneously
2. **AA Overwatch fires** — max 3 flight groups per AA unit per turn (cap resets each turn). Multiple AA units fire independently. AA must detect the group first (stealth groups require a roll).
3. **Patrol intercepts** — engage each group whose path crossed the patrol area. Multiple patrol zones = multiple separate intercept combats. Stealth groups that aren't detected pass through.
4. **Surviving bombers** carry strike orders into Phase 3

AA fires before patrol intercepts.

---

## Orders

| Order | Units | Description |
|---|---|---|
| **Move** | ground, naval | Queue movement. Multi-turn paths supported. |
| **Defend** | ground, naval | Standing order. Terrain defense_bonus. Never needs orders. |
| **Wait** | ground, naval | Skip this turn. Defense_bonus applies. Resets next turn. |
| **Bombard** | Artillery, Battleship | Attack target hex at range. Artillery must be stationary. |
| **Patrol** | Fighter | Standing order. Intercept enemy air in patrol area. |
| **Flight Group** | Fighter, Bomber | Compose group, designate path and mission. |
| **Skirmish Hold** *(stub)* | ground | Reduced damage; no advance even if enemy wiped. |
| **Skirmish Retreat** *(stub)* | ground | Fire then fall back to designated hex. |

---

## Combat Resolution

### Domain Separation

| Attacker | Can target | Phase |
|---|---|---|
| foot / mechanized | ground only | 3 |
| naval | naval only | 2 |
| air fighter | air (intercept) | 1 |
| air bomber | ground + naval (strike) | 3 |
| AA Gun (ground) | ground only | 3 |
| AA Gun (Overwatch Skies) | air only | 1 |

**Stealth rule:** units that have not been detected cannot be targeted by any attack.

### Movement Into Enemy Hexes

When a unit moves into a hex occupied by an enemy, both sides stop and fight. Exception: units with skirmish orders handle contact differently (stub).

### Naval Unit HP

Naval units (Destroyer, Cruiser, Battleship, Transport, Carrier, Submarine) use **hit points** instead of quantity stacks. They are individual vessels, fewer in number but able to absorb damage before sinking.

| Unit | HP |
|---|---|
| Destroyer | 6 |
| Cruiser | 8 |
| Battleship | 12 |
| Transport (ship) | 5 |
| Carrier | 10 |
| Submarine | 6 |

Combat against naval units produces HP damage rather than quantity casualties. Naval units are repaired at Harbors.

### AA Gun — Overwatch Skies

| Mode | Trigger | Attack | Pen | Range |
|---|---|---|---|---|
| Ground combat | Phase 3 | 2 | 1 | 1 |
| Overwatch Skies | Phase 1, detected air in range | 4 | 0 | 2 |

### Terrain in Combat

1. **`combat_modifier`** — applies to all units fighting FROM that hex (both attacker and defender).
2. **`defense_bonus`** — only for units that did not move this turn. Stacks terrain + `has_urban`.
3. **Vegetation** — `has_light_vegetation` and `has_heavy_vegetation` give minor defense modifier for stationary defenders (they're entrenched in cover).

### Combat Formula (Simultaneous Volleys)

```
roll       = d6 + d6
multiplier = roll / 7
raw_hits   = floor((attack + combat_modifier) × qty × multiplier)
```

Per hit, target saves:

```
save_threshold = 11 − target.defense − defense_bonus(if_stationary) + attacker.penetration
```

2d6 ≥ threshold → hit negated. Below → 1 casualty. Applied weakest-unit-first. Both sides fire before casualties removed.

### Unit Combat Stats

| Unit | Attack | Def Atk | Defense | Pen | Move | LOS | Atk Range | Prod | Man |
|---|---|---|---|---|---|---|---|---|---|
| Infantry | 2 | 0 | 2 | 0 | 2 | 3 | 1 | 1 | 2 |
| Armor | 4 | 0 | 4 | 3 | 4 | 3 | 1 | 3 | 1 |
| Artillery | 5 | 0 | 1 | 1 | 2 | 3 | 4 | 4 | 1 |
| AA Gun | 2 | 0 | 1 | 1 | 1 | 3 | 1 | 2 | 1 |
| Supply | 0 | 0 | 0 | 0 | 4 | 3 | 1 | 2 | 1 |
| Fighter | 3 | 0 | 0 | 0 | 8 | 5 | 1 | 4 | 1 |
| Scout Plane | 1 | 0 | 0 | 0 | 10 | 6 | 1 | 3 | 1 |
| Bomber | 6 | 1 | 0 | 0 | 7 | 5 | 1 | 5 | 1 |
| Transport Plane | 0 | 0 | 0 | 0 | 6 | 3 | 1 | 3 | 1 |
| Destroyer | 3 | 0 | 2 | 1 | 5 | 4 | 1 | 3 | 1 |
| Cruiser | 4 | 0 | 3 | 1 | 3 | 4 | 2 | 4 | 1 |
| Battleship | 6 | 0 | 4 | 2 | 4 | 4 | 3 | 6 | 2 |
| Transport (ship) | 0 | 0 | 1 | 0 | 4 | 4 | 1 | 2 | 1 |
| Carrier | 2 | 0 | 2 | 0 | 3 | 5 | 1 | 5 | 2 |
| Submarine | 4 | 0 | 3 | 2 | 4 | 0 | 1 | 4 | 1 |

`Def Atk` = defensive attack value (bombers only; used against intercepting fighters).
All stats are starting values — tunable.

### Air Intercept Combat

| Matchup | One side | Other side |
|---|---|---|
| Fighter vs Fighter | `attack` | `attack` |
| Fighter vs Bombers (no escort) | `attack` | `def_attack` only |
| Escort vs Patrol Fighters | `attack` | `attack` |

After escort vs patrol resolves, surviving patrol fighters engage bombers. Bombers surviving any intercept continue to target.

### Multi-Faction Combat

3+ factions: proportional fire. Each faction splits attack across all enemies by enemy quantity. All fire simultaneously.

### Movement and Combat Interaction

**Crossing detection:** A → B's origin, B → A's origin simultaneously → border battle. Neither moves. Combat in starting hexes. Survivors may advance.

Units that moved do NOT receive `defense_bonus`.

---

## Bombardment

- Artillery: stationary, attacks at range, no return fire
- Battleship: can move and bombard same turn; cancelled if engaged in naval combat
- Empty target hex → wasted shot
- Blind fire: no friendly LOS to target → player gets no report

---

## Fog of War

Three states: **Visible** / **Scouted** / **Dark**.

LOS blocked by Mountains, `has_light_vegetation`, `has_heavy_vegetation`. Blocking hex is visible; hexes beyond are not.

Air units reveal LOS for every hex along flight path. Destroyed members contribute no LOS.

Stealth units are invisible until detected — they do not appear on enemy maps even within LOS range.

### Combat Intel

| Situation | Own Casualties | Enemy Casualties |
|---|---|---|
| Had LOS to battle | Exact | Exact |
| In battle, no LOS | Exact | Estimated (±20–30%) |
| Blind bombardment | No report | No report |
| Flight group destroyed | — | No report |

---

## Resources

### Materials
Produced by specific resource tiles placed by the GM on the map. Each tile produces **1 material per turn** when owned (tunable later). Tile types: mines, lumbermills, quarries, farms, ports, etc. Materials **accumulate between turns** (saveable).

### Manpower
**Not saveable.** Generated each turn, must be spent that turn or lost.

Manpower per turn = sum over all controlled settlements of their connected urban tile count. "Connected" = contiguous cluster of `has_urban` hexes attached to the `has_settlement` hex (flood-fill adjacency).

- Small town (4 connected urban tiles) → 4 manpower/turn
- Large city (10 connected urban tiles) → 10 manpower/turn

Controlling urban sprawl around a settlement directly increases your manpower budget. Expensive constructions (Manufacturing Facility = 20 manpower) require large cities or multiple cities active in the same turn.

*(Open question: should expensive builds span multiple turns, drawing from each turn's manpower budget? TBD.)*

---

## Production

**Unit production:**
- Ground units: at Manufacturing Facility
- Air units: at Manufacturing Facility with adjacent Airbase → spawned at Airbase (or Carrier within adjacent range)
- Naval units: at Manufacturing Facility with adjacent Harbor → spawned at Harbor

`production_queue`: game, faction, target hex, unit type, quantity, turn queued, status.

---

## Transport Plane

- Tags: air + ground
- Capacity: 2 ground unit slots
- Moves ground units from an Airbase to any Airbase or Airstrip
- Units must **board at an Airbase** (Airstrips cannot load troops — receive only)
- One transport mission per turn (like a flight group)

---

## Supply (STUB)

Design intent: supply radius from urban hubs, Supply units extend coverage, cut-off troops take attrition. Currently not implemented — no penalty for being cut off.

---

## Combat Log

Every combat event persisted to `combat_log`. Players review turn results filtered by LOS and detection state.

---

## Faction Relationships

`faction_relationships` table: `at_war` (default) / `allied` / `neutral`.

Two neutrals moving into same empty hex: neither enters. Allied units share hexes and fight together.

---

## GM Portal

Full map visibility. Can edit hexes, place/remove units and buildings, adjust resources, force-advance turn, see turn status.

---

## Player Portal — Left Panel

Collapsible sidebar: units needing orders, idle facilities.
- Units with `standing_order = defend` or `patrol` never appear
- Bombers without a flight group assignment appear

---

## Future Features

- **Manpower multi-turn construction** — decide if expensive builds (MF = 20 manpower) can draw from consecutive turns' budgets
- **Railroads** — `has_railroad` hex attribute. Very fast ground unit movement. Expensive to build. Supply unit + large material/manpower cost.
- **Flight group turn-around rules** — abort at X casualties if movement permits
- **Patrol range** — finalize 1 or 2 hexes after balance testing
- **Emergency landing** — air units with no valid airstrip crash; rules for forced landing at non-airstrip hexes
- **Commando unit** — ground + stealth; infiltration behind lines
- **Naval AA** — Destroyers / Carriers firing at air units
- **Air vs naval strikes** — bombers targeting ships
- **Fortify order** — build up `fortification_level` defense bonus over turns
- **Supply lines** — full radius + Supply unit implementation
- **Allied vision sharing** — wire up `allied_vision` table
- **Victory condition tuning** — per player count, alternative win types
- **Skirmish orders** — Hold and Retreat sub-modes
- **Subterranean, hover, orbital, space** locomotion tags
- **Naval repair** — at Harbors, cost = ceil(build_cost / 4) → full HP restore
- **Canal building** — Supply unit digs canal through Wetlands hex (significant manpower cost)
- **Map visual clarity** — terrain types, buildings, roads, bridges, settlements, units in LOS must all be immediately readable at a glance. Drive hex rendering with distinct colors, icons, and overlays per attribute.
