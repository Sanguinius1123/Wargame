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
2. AA Overwatch fires at each flight group whose path passed through coverage zones
3. Patrol intercepts engage each flight group whose path passed through patrol areas
4. Surviving bombers carry strike orders into Phase 3

**Phase 2 — Naval**
- Naval units fight each other in contested hexes

**Phase 3 — Ground**
- Ground units fight in contested hexes
- Naval bombardment resolves (Battleship + Destroyer strikes against land targets)
- Air-to-ground strikes resolve (surviving bombers from Phase 1 execute against designated targets)

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
| Plains | 0 | 0 | 0 | No | 1 | 1 |
| Hills | 1 | +1 | +1 | No | 0 | 0 |
| Mountains | 2 | +2 | +1 | Yes | 0 | 0 |
| Desert | 0 | 0 | 0 | No | 0 | 0 |
| Wetlands | 0 | -1 | 0 | No | 0 | 0 |
| Water | 0 | 0 | 0 | No | 0 | 0 |

*Defense bonus only applies to units that did not move this turn (defend, wait, or idle orders).

†Blocking hexes are **visible** — you can see INTO them, not THROUGH them to hexes beyond.

**Notes:**
- "Coastal" is not a terrain type. Any land hex adjacent to a Water hex is implicitly coastal for naval landing and bombardment purposes.
- Rivers are Water hexes going inland — same terrain type, same rules. Ground units cannot cross without a bridge or Transport.
- Urban areas are the `has_urban` hex attribute, not a terrain type. Urban overlays any terrain.

### Hex Attributes

| Attribute | Description |
|---|---|
| `has_light_vegetation` | Blocks LOS†. No move penalty for foot; +2 cost for mechanized. Minor defense modifier for stationary defenders. |
| `has_heavy_vegetation` | Blocks LOS†. +2 move cost for foot; impassable for mechanized. Defense modifier for stationary defenders. |
| `has_urban` | Production/manpower output. +3 defense bonus for stationary units. +1 move cost for mechanized (tight streets). |
| `has_airstrip` | Air units must start and end every turn here. Cannot land elsewhere. |
| `has_bridge` | Foot and mechanized units may cross this Water hex at extra movement cost. |

†The attribute hex itself is visible. Hexes behind it (from the viewer's perspective) are not.

### Elevation and LOS

Units standing on elevated terrain see further:

| Terrain | Elevation | LOS bonus |
|---|---|---|
| Plains / Desert / Wetlands / Water | 0 | +0 |
| Hills | 1 | +1 |
| Mountains | 2 | +2 |

**Artillery range bonus from elevation:** `effective_range = base_range + max(0, firer_elevation − target_elevation)`. Artillery fires in an arc — terrain between firer and target does not block the shot; only LOS matters for spotting.

### Hex Ownership

A hex is owned by whichever faction last controlled it. Capturing = have units there with no enemy units at end of Phase 3. Owned hexes generate resources in Phase 4.

---

## Locomotion Types

Every unit has a locomotion type. The movement engine keys all terrain cost and accessibility rules to locomotion type — not to specific unit names. A different game/setting can introduce any unit roster using these types with no engine changes.

| Locomotion | Description | Current Units | Stub |
|---|---|---|---|
| `foot` | Infantry on foot | Infantry, Artillery, AA Gun | No |
| `mechanized` | Wheeled/tracked ground | Armor, Supply | No |
| `naval` | Surface water travel | Destroyer, Battleship, Transport | No |
| `air` | Atmospheric flight; must land on airstrip | Fighter, Bomber | No |
| `hover` | Low-altitude hover; ignores ground terrain costs | — | Yes |
| `orbital` | In orbit over a planetary body | — | Yes |
| `space` | Deep space travel | — | Yes |
| `subterranean` | Underground movement | — | Yes |

`unit_type_config` is scoped per game — each game/ruleset defines its own unit roster with its own stats. Not global.

---

## Movement

### Terrain Costs by Locomotion Type

| Terrain | foot | mechanized | naval | air | hover |
|---|---|---|---|---|---|
| Plains | 1 | 1 | impassable | passable | passable |
| Hills | 2 | 2 | impassable | passable | passable |
| Mountains | 2 | 4 | impassable | passable | passable |
| Desert | 2 | 1 | impassable | passable | passable |
| Wetlands | 2 | 4 | 1 | passable | passable |
| Water | impassable | impassable | 1 | passable | passable |
| Water + `has_bridge` | 2 | 3 | 1 | passable | passable |

**Desert asymmetry:** foot pays 2 (heat, no roads, exhausting march); mechanized pays 1 (flat, open — ideal tank terrain).

### Hex Attribute Movement Effects

| Attribute | foot | mechanized | naval | air / hover |
|---|---|---|---|---|
| `has_light_vegetation` | +0 | +2 | no effect | no effect |
| `has_heavy_vegetation` | +2 | impassable | no effect | no effect |
| `has_urban` | +0 | +1 | no effect | no effect |
| `has_airstrip` | no effect | no effect | no effect | required to land |
| `has_bridge` | enables Water crossing | enables Water crossing | no extra cost | no effect |

Attribute costs stack on top of base terrain cost (e.g., mechanized in forested hills = 2 base + 2 vegetation = 4).

### Naval Landing

Naval units cannot enter land hexes. Transport units offload ground troops: a Transport adjacent to a land hex can transfer ground units into that hex (costs the ground unit 1 movement).

### Air Movement

Air units ignore terrain movement costs entirely. Each air unit must start and end every turn on a hex with `has_airstrip`. Air units provide LOS for **every hex along their flight path**, not just their destination. Only surviving units contribute LOS.

---

## Flight Groups

The fundamental unit of air action. Players compose flight groups; individual unit orders are not used for air.

**Composition:** any number of fighters (escort) + any number of bombers (strike). Fighter-only groups are valid for scouting, patrol sweeps, and LOS missions.

**Mission types:**

| Mission | Units | Effect |
|---|---|---|
| Strike | Bombers (+ optional escort fighters) | Bombers attack designated target hex in Phase 3 |
| Scout | Fighters only | Fly path to gather LOS; no attack |
| Sweep | Fighters only | Clear patrol fighters from a path; no bombing |

**Path planning:** Player designates a waypoint route. System validates that every unit in the group has enough movement for the full round trip: outbound path + distance from target to nearest friendly airstrip. If any unit falls short, the plan is rejected.

Return to airstrip is automatic — after executing the mission, surviving units fly to the nearest valid friendly airstrip. Player only plans the outbound path.

**Attrition and reporting:** A flight group entirely destroyed reports nothing — no LOS, no battle report. Only groups with surviving members provide LOS of hexes they passed through.

**Future:** Turn-around rules — player designates a casualty threshold at which the group aborts the mission and returns to base if sufficient movement remains.

---

## Patrol

Standing order for fighters. A patrolling fighter stays in its designated hex and intercepts any enemy flight group whose path enters the patrol area.

**Patrol area:** all hexes within X hexes of the patrol hex (range TBD — 1 or 2, pending balance testing).

**Patrol persists** turn to turn (like Defend for ground units). A patrolling fighter cannot move that turn.

---

## Air Phase Resolution (Phase 1 Detail)

All events resolve simultaneously based on committed paths — not sequentially along the path.

1. **All flight groups commit** to their paths (simultaneous)
2. **AA Overwatch fires** at each flight group whose path passed through any AA coverage zone (range 2). Each AA unit fires at a maximum of **3 different flight groups per turn**. The 3-shot cap resets each turn. Multiple AA units in overlapping zones each fire independently.
3. **Patrol intercepts** engage each flight group whose path passed through the patrol area. If a path crosses multiple patrol areas, a separate intercept combat resolves in each.
4. **Surviving bombers** carry strike orders into Phase 3

**AA fires before patrol intercepts.** Flight groups may be weakened by flak before fighters engage them.

**Bombers that survive** any number of intercepts continue to their target.

---

## Orders

| Order | Units | Description |
|---|---|---|
| **Move** | ground, naval | Queue movement to destination. Multi-turn paths supported. |
| **Defend** | ground, naval | Standing order. Terrain defense_bonus applies. Never appears in needs-orders list. |
| **Wait** | ground, naval | Skip this turn only. Defense_bonus applies. Resets next turn. |
| **Bombard** | Artillery, Battleship | Attack target hex at range. Artillery must be stationary. Battleship can move and bombard same turn. |
| **Patrol** | Fighter | Standing order. Stay in hex; intercept enemy air entering patrol area. |
| **Flight Group** | Fighter, Bomber | Compose group, designate path and mission type. |
| **Skirmish Hold** *(stub)* | ground | Reduced outgoing damage; no advance even if enemy wiped. |
| **Skirmish Retreat** *(stub)* | ground | Fire one exchange then fall back to designated hex. |

---

## Combat Resolution

### Domain Separation

| Attacker | Can target | Phase |
|---|---|---|
| foot / mechanized | ground only | 3 |
| naval | naval only | 2 |
| air fighter | air (intercept) | 1 |
| air bomber | ground + naval (strike) | 3 |
| AA Gun (ground attack) | ground only | 3 |
| AA Gun (Overwatch Skies) | air only | 1 |

### AA Gun — Overwatch Skies

AA Gun has two combat modes:

| Mode | Trigger | Attack | Pen | Range |
|---|---|---|---|---|
| Ground combat | Phase 3 normal engagement | 2 | 1 | 1 |
| Overwatch Skies | Phase 1, flight group in range | 4 | 0 | 2 |

Pen 0 vs air is sufficient — planes have Defense 0, saves are near-impossible regardless.

### Terrain in Combat

1. **`combat_modifier`** — applies to all units fighting FROM that hex, attack or defense. High ground benefits attacker and defender equally.
2. **`defense_bonus`** — only for units that did not move this turn (defend, wait, or idle). Stacks from terrain + `has_urban`.

### Combat Formula (Simultaneous Volleys)

```
roll       = d6 + d6                              // 2–12, bell curve peaking at 7
multiplier = roll / 7                             // 0.29 to 1.71, average 1.0
raw_hits   = floor((attack + combat_modifier) × qty × multiplier)
```

Per raw hit, target rolls a save:

```
save_threshold = 11 − target.defense − defense_bonus(if_stationary) + attacker.penetration
// roll 2d6 ≥ threshold → hit negated
// roll 2d6 < threshold → 1 casualty
```

Casualties applied weakest-unit-first. Both sides fire before anyone is removed.

### Air Intercept Combat

| Matchup | One side uses | Other side uses |
|---|---|---|
| Fighter vs Fighter | `attack` | `attack` (simultaneous) |
| Fighter vs unescorted Bombers | `attack` | `def_attack` only |
| Escort Fighters vs Patrol Fighters | `attack` | `attack` (fighters fight first) |

After escort vs patrol resolves, surviving patrol fighters engage bombers using `def_attack`. Bombers that survive continue to target.

### Unit Stats

| Unit | Locomotion | Attack | Def Atk | Defense | Pen | Move | LOS | Atk Range | Prod | Man |
|---|---|---|---|---|---|---|---|---|---|---|
| Infantry | foot | 2 | 0 | 2 | 0 | 2 | 3 | 1 | 1 | 2 |
| Armor | mechanized | 4 | 0 | 4 | 3 | 4 | 3 | 1 | 3 | 1 |
| Artillery | foot | 5 | 0 | 1 | 1 | 2 | 3 | 4 | 4 | 1 |
| AA Gun | foot | 2 | 0 | 1 | 1 | 1 | 3 | 1 | 2 | 1 |
| Supply | mechanized | 0 | 0 | 0 | 0 | 4 | 3 | 1 | 2 | 1 |
| Destroyer | naval | 3 | 0 | 2 | 1 | 5 | 4 | 1 | 3 | 1 |
| Battleship | naval | 6 | 0 | 4 | 2 | 4 | 4 | 3 | 6 | 2 |
| Transport | naval | 0 | 0 | 1 | 0 | 4 | 4 | 1 | 2 | 1 |
| Fighter | air | 3 | 0 | 0 | 0 | 8 | 5 | 1 | 4 | 1 |
| Bomber | air | 6 | 1 | 0 | 0 | 7 | 5 | 1 | 5 | 1 |

`Def Atk` = defensive attack value, used only when intercepted by fighters.
AA Gun Overwatch Skies uses separate stats: attack 4, pen 0, range 2.

### Multi-Faction Combat

3+ factions in same hex: each splits attack pool proportionally across all enemies. All fire simultaneously. Winner = last faction standing.

**Faction relationships:**
- `at_war` — fight on sight (default)
- `allied` — share hexes, fight together as one side
- `neutral` — can't share hexes; movement into neutral-occupied hex blocked

Two neutrals moving into same empty hex: neither enters.

### Movement and Combat Interaction

**Crossing detection:** Unit A's destination = unit B's origin AND vice versa → border battle. Neither moves. Combat resolves in starting hexes. Survivors may advance.

Units that moved this turn do NOT receive `defense_bonus`.

---

## Bombardment

Artillery (ground) and Battleship (naval) attack at range without entering target hex.

- Artillery must be stationary that turn to bombard
- Battleship can move and bombard same turn; if engaged in naval combat → bombardment cancelled
- No return fire from bombarded units
- Empty target hex → shot wasted, no effect

**Blind fire:** If no friendly unit has LOS to target hex, shot resolves server-side but player receives no report.

---

## Fog of War

Three states per hex per faction:
- **Visible** — currently in LOS of one of the faction's units
- **Scouted** — previously seen; terrain shown, no current unit info
- **Dark** — never seen

LOS is blocked by Mountains, `has_light_vegetation`, and `has_heavy_vegetation`. The blocking hex is visible; hexes beyond it are not.

Air units provide LOS for every hex along their flight path, not just destination. Destroyed flight group members contribute no LOS.

### Combat Intel

| Situation | Own Casualties | Enemy Casualties |
|---|---|---|
| Had LOS to battle | Exact | Exact |
| In battle, no LOS | Exact | Estimated (±20–30%) |
| Blind bombardment, no spotter | No report | No report |
| Flight group entirely destroyed | — | No report |

---

## Production

Facilities = any hex with `has_urban` owned by the player's faction.

Resources deducted immediately at queue time (prevents double-spending). Units spawn at facility hex in Phase 4.

`production_queue` table: game, faction, target hex, unit type, quantity, turn queued, status (pending/cancelled/complete).

---

## Supply (STUB — not yet implemented)

Design intent: units within supply radius of friendly owned urban hex are supplied. Supply units extend coverage. Cut-off units take attrition. Currently: no penalty for being cut off.

---

## Combat Log

Every combat event persisted to `combat_log` and `combat_log_participants`. Players review turn results filtered by LOS.

---

## GM Portal

Full map visibility. Can edit hexes, place/remove units, adjust faction resources, force-advance turn, view turn status (which players have finished their turn).

---

## Player Portal — Left Panel

Collapsible sidebar showing units that need orders:
- Unit stacks with no order set
- Owned urban hexes with no active production queue
- Units with `standing_order = defend` or `patrol` never appear

Per unit: click to pan map, Move / Defend / Wait buttons.

---

## Future Features

- **Flight group turn-around rules** — abort if X casualties, return to base if movement permits
- **Patrol range** — finalize intercept radius (1 or 2) after balance testing
- **Naval AA** — Battleships / Destroyers firing at air units
- **Air vs naval strikes** — bombers targeting ships directly
- **Fortify order** — unit builds up `fortification_level` defense bonus over multiple turns
- **Supply lines** — full radius + Supply unit implementation
- **Allied vision sharing** — wire up `allied_vision` table
- **Naval transport** — loading/unloading ground units via Transport
- **Victory conditions** — beyond eliminate all enemies
- **Skirmish orders** — Hold and Retreat sub-modes
- **Subterranean, hover, orbital, space** locomotion types (stubs exist)
