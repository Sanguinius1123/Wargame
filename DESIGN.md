# Wargame — Design Document

Setting-agnostic hex-based operational wargame. Planet-scale map, ground + naval + air warfare, fog of war, async multiplayer via web portal.

---

## Core Loop

1. **Orders** — players queue movement, combat, production, patrol, and flight group orders
2. **Resolve** — turn advances through four phases
3. **Report** — players see results filtered through fog of war

---

## Turn Resolution

All phases resolve automatically when all players click Finish Turn (or GM force-advances). Each phase is fully simultaneous — all unit actions within a phase happen at once, not in sequence. Casualties and state changes within a phase are applied after all volleys in that phase complete.

---

### Phase 1 — Air

1. **All flight groups commit.** Players' designated paths and mission types are locked. Patrol orders already standing from previous turns remain active.
2. **AA Overwatch fires.** For each AA unit (AA Gun, Frigate, Battleship) with overwatch_skies behavior: identify every detected enemy flight group whose path passes within overwatch range this turn. Each AA unit rolls once per flight group. Stealth groups require a detection roll before AA can engage — undetected groups pass through silently. Multiple AA units fire independently; a flight group can take fire from several AA units along its path.
3. **Patrol intercepts.** For each patrolling fighter/scout unit: identify every detected enemy flight group entering the patrol area. Intercept combat sequence per group:
   a. Escort fighters vs patrol fighters (simultaneous fire, casualties applied)
   b. Surviving patrol fighters engage bombers (one more volley)
   c. Surviving bombers continue toward target
   Multiple patrol zones = multiple separate intercept combats in path order.
4. **Casualties from Phase 1 applied.** AA hits and intercept casualties are resolved; destroyed aircraft are removed.
5. **Surviving bombers note targets** for execution in Phase 3.

---

### Phase 2 — Naval

1. **All naval units execute movement orders simultaneously.** Ships travel to their final destination hexes. Units do not fight in intermediate hexes — only at final positions.
2. **Detection rolls.** Destroyers and surface ships attempt to detect submarines within sonar range. Submarines attempt to detect surface ships. Detection_score computed; rolls made. Undetected units cannot be targeted this phase.
3. **Contested naval hexes identified.** Any hex containing ships from factions at war → combat triggers.
4. **Naval combat resolves.** All contested naval hexes fight simultaneously. Both sides roll simultaneously; HP damage applied after all volleys. Submarines that were detected can participate.
5. **Sunk ships removed.** Carrier sinking triggers emergency rules for parked air units (emergency takeoff roll). Transport sinking triggers survival rolls for ground units aboard (if adjacent to land).
6. **Battleship bombard orders validated.** Battleships that engaged in naval combat this phase cannot bombard in Phase 3.

---

### Phase 3 — Ground

1. **All ground units execute movement orders simultaneously.**
   - Supply trucks on build orders (road, canal, airstrip, bridge) do not move — they execute their build action in place.
   - Transport planes execute cargo delivery missions.
2. **Contested ground hexes identified.** Any hex containing ground units from factions at war → combat triggers.
3. **All combat and bombardment resolves simultaneously** — every action in Phase 3 fires at the same moment:
   - **Direct ground combat:** units in contested hexes fight.
   - **Artillery bombardment:** all stationary artillery fire at designated target hexes.
   - **Naval bombardment:** all validated Battleship bombard orders fire at designated land hexes.
   - **Air-to-ground strikes:** surviving bombers from Phase 1 execute Bombing Run or Attack Run orders.
   - All hits from all sources are pooled; casualties and HP damage are applied after every volley completes.
4. **Bombardment is indiscriminate.** Unit-targeting rolls hit all units in the target hex — friendly, enemy, and allied alike.
5. **Building and infrastructure damage assessed.** Infra hits from bombardment applied: HP buildings lose HP, no-HP infra flagged damaged/destroyed.
6. **Hex capture.** Any hex where exactly one faction's ground units remain → that faction captures the hex. Hex ownership updated. Buildings and infrastructure transfer to new owner in current state.

---

### Phase 4 — Return and Collect

1. **Air units fly home.** All flight groups return to nearest friendly landing site (airbase, airstrip, carrier at its current position after Phase 2 movement).
   - If planned landing site was captured or destroyed: reroute to nearest alternative within remaining movement range.
   - Carrier-based units whose carrier sunk: find alternative landing site or crash.
   - Units with no reachable friendly landing site → crash and are destroyed.
2. **Manpower calculated.** Flood-fill from each owned `has_settlement` hex through contiguous `has_urban` tiles. Total = this turn's manpower budget. Damaged urban tiles produce nothing.
3. **Materials collected.** +1 per owned resource tile.
4. **Manpower allocated** (player specified this at order-setting time; system now deducts):
   - Building construction progress: HP added to all buildings with committed construction this turn.
   - Production reservations honored: manpower deducted for queued units. If actual manpower falls short of all reservations (e.g. a settlement was captured this turn), production orders are cancelled and materials refunded.
   - Road/canal construction: manpower deducted for supply truck build actions that completed in Phase 3. Shortfall = construction not completed, truck action wasted (no partial roads).
   - Unused manpower → wasted.
5. **Buildings that reached max HP** transition from `under_construction` to `operational`.
6. **Production queue advances.** All `pending` orders → `ready`. Units will be available to place at the next production panel.
7. **Win condition check.** Count `has_settlement` hexes per faction. Any faction holding ≥ 2/3 of all settlements → wins.
8. **Reset.** `turn_ready` cleared for all players. Turn counter increments.

---

**Between turns (player portal):**
1. Players review combat reports and battle log filtered through their fog of war.
2. **Production panel** — place all `ready` units at their spawn locations (Manufacturing Facility for ground, Airbase for air, Harbor for naval). Queue new production and pay materials immediately from stockpile.
3. Set orders for the new turn (movement, bombardment, flight groups, patrol, build orders, etc.).
4. Click Finish Turn when ready.

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
| `has_canal` | Naval units may enter this Wetlands hex. Costs **10 manpower** to build. Supply unit present (not consumed). No effect on land movement. |
| `is_damaged` | Building/infrastructure is damaged — reduced output. Still functional for movement (bridges still passable). |
| `is_destroyed` | Building/infrastructure is destroyed — non-functional. Still visible on map. Repairable. |

†The attribute hex itself is visible; hexes beyond it are not.

### Elevation and LOS

**LOS** (line of sight) = the radius in hexes a unit can see around itself. A unit with LOS 3 sees its own hex and every hex within 3 hexes. Elevation increases LOS range — a unit on Hills sees 1 hex further; on Mountains, 2 hexes further.

| Terrain | Elevation | LOS bonus |
|---|---|---|
| Plains / Desert / Wetlands / Water | 0 | +0 |
| Hills | 1 | +1 hex LOS |
| Mountains | 2 | +2 hex LOS |

LOS is blocked by Mountains and vegetation attributes (see Hex Attributes). Unit facing is not modeled — LOS is a full circle around the unit.

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
| Frigate | naval + air |
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

**Road construction rate:** Supply truck builds road segments in adjacent hexes. Manpower cost per segment varies by terrain. Max segments buildable per turn depends on terrain of the hex being built into:

| Target terrain | Max segments/turn | Manpower per segment |
|---|---|---|
| Plains | 3 | 1 |
| Desert | 3 | 1 |
| Hills | 2 | 2 |
| Mountains | 1 | 3 |
| Wetlands | 1 | 2 |

The supply truck does not enter the hex it is building into. It can build up to its maximum in a single turn (e.g. 3 plains road segments at 3 manpower total), or fewer if manpower is limited.

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

**If a Transport sinks while carrying ground units:**
- If the Transport is NOT adjacent to a land hex: all aboard are destroyed.
- If the Transport IS adjacent to a land hex: each ground unit rolls 1d6 — result ≥ 4 → makes it ashore (placed on the adjacent land hex); fail → drowned and destroyed.

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
Naval (at Harbor):    ceil(mat_cost / 4) mat + ceil(man_cost / 4) man → full HP, 1 turn, uses 1 Harbor repair slot

Air (at Airbase):     ceil(mat_cost / 4) mat + ceil(man_cost / 4) man → full HP, 1 turn, uses 1 Airbase repair slot

Mat-based buildings:  1 mat + 1 man per HP restored (same rate as construction)

Airstrip/Bridge:      1 Supply unit consumed + 1 man per HP restored
```

**Building status field:** `under_construction` → `operational` → `damaged` → `destroyed`
- `under_construction`: current_hp < max_hp, never yet reached full HP. No production.
- `operational`: at max HP. Fully functional.
- `damaged`: took battle damage after being operational. Reduced output.
- `destroyed`: HP = 0. Non-functional. Tag stays on hex.

**Damage states:**
- `is_damaged` — HP between 1 and 50% of max (after being operational). Reduced output. Bridges still passable. Airbases/airstrips can still land and take off — only production stops.
- `is_destroyed` — HP = 0. Non-functional. Bridge impassable. Tag stays on hex.

**Under-construction buildings bombed to 0 HP:** building vanishes entirely (no destroyed tag left on hex). No refund.

**Hex capture and buildings:** When a hex changes ownership, all buildings and infrastructure on it transfer to the new owner in whatever state they are in (including under-construction buildings). The new owner can continue construction, use, or repair them.

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

Uses the same roll-under direction as combat. Higher detection stat = better detector; higher stealth stat = harder to find.

```
effective_stealth    = unit.stealth_rating + terrain_stealth_modifier
effective_detection  = detector.detection + domain_modifier
detection_score      = 7 + effective_detection − effective_stealth − distance
```

Roll **2d6 ≤ detection_score** → detected this turn. Capped: detection_score > 12 = auto-detect, detection_score < 2 = impossible. Detection is attempted each turn within the detector's detection range.

Once detected, the unit is visible to that faction. The roll re-runs each turn — a faction can lose track of a unit if the detector moves away or is destroyed.

**Example — Destroyer (detection 6) vs Submarine (stealth 6):**

| Distance | Detection score | Chance |
|---|---|---|
| 1 | 6 | 42% |
| 2 | 5 | 28% |
| 3 | 4 | 17% |
| 4 | 3 | 8% |
| 5 | 2 | 3% |

### Submarine Rules

- LOS = 0. Completely blind visually.
- Detects via sonar (detection stat) only.
- Can only detect naval surface units — not ground, not air. Air units cannot detect or attack submarines either.
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
| Frigate | 0 | 5 | Specialized radar for detecting aircraft |
| Cruiser | 0 | 4 | |
| Battleship | 0 | 3 | |
| Transport (ship) | 0 | 2 | |
| Carrier | 0 | 5 | |
| Submarine | 6 | 5 | LOS = 0; sonar-only; naval targets only |

---

## Flight Groups

The fundamental unit of air action. Players compose flight groups; individual air unit orders are not used.

**Composition:** any fighters (escort) + any bombers (strike) + any scout planes (LOS). Fighter-only or scout-only groups are valid. Scout planes do not attack but provide excellent LOS along the flight path.

**Scout planes in groups:** A scout plane joining a flight group with fighters loses the stealth advantage of flying alone — the group's detection threshold uses the least-stealthy member. Flying a scout plane solo (or with other scout planes only) keeps stealth intact and makes detection very unlikely. However, if a solo scout group IS detected, it cannot fight back and will be shot down by interceptors. AA fires at all detected aircraft regardless of type — a scout in a detected group can be hit.

**Mission types:**

| Mission | Units | Effect |
|---|---|---|
| Bombing Run | Bombers + optional escort | Target specific infrastructure in designated hexes (3-hex line pattern). See Bombardment. |
| Attack Run | Bombers + optional escort | Target first detected enemy unit in a designated hex. Works against any domain (ground or naval). No infrastructure roll. |
| Scout | Fighters only | Fly path to gather LOS |
| Sweep | Fighters only | Clear patrol fighters from a path |

**Bombing Run** is for infrastructure destruction: 3-hex line, designated infra targets, both unit and infra rolls (see Bombardment section).

**Attack Run** is for targeting mobile forces or naval units:
- Player designates a destination hex. Fighter escorts engage any enemy fighters along the path (normal intercept rules).
- Bombers search for detected enemy units within **3 hexes of the destination** (large search area).
- **Target allocation** — assign bombers to detected targets using stack-priority algorithm:
  1. Sort detected targets by unit count, largest first.
  2. Assign `min(remaining_bombers, target_unit_count)` bombers to each target in order.
  3. If bombers remain after one pass, repeat from the top until all bombers are assigned.
  - *Examples: 10 bombers vs a 10-stack + 5-stack → all 10 bomb the 10-stack. 10 bombers vs a 9-stack + 6-stack → 9 bomb the 9-stack, 1 bombs the 6-stack. 10 bombers vs 5 single-unit tiles → 2 bombers per tile.*
- Each assigned bomber makes **1 attack roll** against its target hex (To-Hit 7, Pen 1 vs units only — no infrastructure roll).
- Normal defense save applies per hit. Bombers return to base after attacking.
- If no units are detected within 3 hexes of destination, the run is wasted.

**Path validation:** system checks every unit has enough movement for outbound path + return to nearest friendly airstrip/airbase. Rejected if any unit falls short.

**Attrition:** entirely destroyed groups report nothing. Only surviving members provide LOS.

**Future:** turn-around rules — abort if X casualties, return to base if movement permits.

---

## Patrol

Standing order for units. Patrolling units intercept enemies that move through their patrol area. The unit stays in place; the patrol area defines how far out it will react.

**Patrol radius by unit type:**

| Unit type | Patrol radius |
|---|---|
| Foot (Infantry, Artillery, AA Gun, Supply) | 1 — adjacent hexes only |
| Mechanized (Armor) | 2 |
| Naval | 2 |
| Air (Fighter, Scout Plane) | See formula below |

**Air patrol radius formula:**
```
patrol_radius = floor((movement − 2 × distance_to_patrol_center) / 6)
```
`distance_to_patrol_center` = hexes from the unit's home airbase to the designated patrol center hex.

- Fighter (move 30) patrolling its own airbase (distance 0): radius = floor(30 / 6) = **5 hexes**
- Fighter sent 6 hexes out: radius = floor((30 − 12) / 6) = **3 hexes**
- Fighter sent 12 hexes out: radius = floor((30 − 24) / 6) = **1 hex**
- Fighter sent 15 hexes out: radius = **0** (only intercepts groups passing through the patrol center itself)
- If `2 × distance > movement` → cannot assign patrol there (can't get there and back)

**UI:** when a player designates a patrol center, the map highlights the patrol center and the computed patrol radius so the player sees exactly what will be covered before confirming the order.

Patrol persists turn to turn until cancelled. A patrolling unit cannot also move that turn. Undetected stealth flight groups pass through without triggering intercept.

**Patrol engages every group** — each detected flight group that enters the patrol area triggers a separate intercept combat. Casualties from each engagement apply immediately before the next group is engaged. This means sending a fighter group first to attrit the defending patrol, then following with bombers, is a valid tactic.

---

## Air Phase Resolution (Phase 1 Detail)

1. All flight groups commit to paths simultaneously
2. **AA Overwatch fires** — each AA fires at every detected flight group passing through its overwatch zone. Multiple AA units fire independently. AA must detect the group first (stealth groups require a roll).
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
| **Flight Group (Bombing Run)** | Fighter, Bomber | Compose group, designate 3-hex line path, target infrastructure. |
| **Flight Group (Attack Run)** | Fighter, Bomber | Compose group, designate target hex, attack first detected unit. |
| **Skirmish Hold** *(stub)* | ground | Reduced damage; no advance even if enemy wiped. |
| **Skirmish Retreat** *(stub)* | ground | Fire then fall back to designated hex. |

---

## Combat Resolution

### Domain Separation

| Attacker | Can target | Phase |
|---|---|---|
| foot / mechanized | ground only | 3 |
| naval (surface) | naval (surface) only | 2 |
| submarine | naval (surface) only | 2 |
| air fighter | air (intercept) | 1 |
| air bomber | ground + naval surface (strike) | 3 |
| AA Gun (ground combat) | ground only | 3 |
| AA Gun (Overwatch Skies) | air only | 1 |
| Frigate (surface combat) | naval (surface) only | 2 |
| Frigate (Overwatch Skies) | air only | 1 |
| Battleship (surface combat) | naval (surface) only | 2 |
| Battleship (Overwatch Skies) | air only | 1 |
| Battleship (Bombard) | ground + naval surface | 3 |

**Submarine / air domain separation:** air units cannot detect or attack submarines; submarines cannot detect or attack air units. These two domains are completely blind to each other.

**Stealth rule:** units that have not been detected cannot be targeted by any attack.

### Movement Into Enemy Hexes

When a unit moves into a hex occupied by an enemy, both sides stop and fight. Exception: units with skirmish orders handle contact differently (stub).

### Naval Unit HP

Naval units (Destroyer, Cruiser, Battleship, Transport, Carrier, Submarine) use **hit points** instead of quantity stacks. They are individual vessels, fewer in number but able to absorb damage before sinking.

| Unit | HP |
|---|---|
| Destroyer | 6 |
| Frigate | 7 |
| Cruiser | 8 |
| Battleship | 12 |
| Transport (ship) | 5 |
| Carrier | 10 |
| Submarine | 6 |

Combat against naval units produces HP damage rather than quantity casualties. Naval units are repaired at Harbors.

### AA Gun — Overwatch Skies

AA Guns have base stats used for ground combat and separate overwatch stats for firing at air units.

| Mode | Trigger | To-Hit | Pen | Range |
|---|---|---|---|---|
| Ground combat (Phase 3) | Enemy ground in hex | 5 | 1 | 1 |
| Overwatch Skies (Phase 1) | Detected enemy air within range 2 | 10 | 0 | 2 |

Overwatch is a **passive standing behavior** — no order required. Any detected enemy flight group passing within range triggers AA fire automatically. **AA fires once per flight group** — each group that enters the overwatch zone is engaged separately. This prevents players from using a sacrificial plane group to exhaust AA defenses before sending the main strike.

### Naval AA — Overwatch Skies

Frigates and Battleships can fire at detected aircraft entering their overwatch zone. Same passive behavior as land AA — no order required, fires at every detected flight group.

| Unit | Mode | To-Hit | Pen | Range | Notes |
|---|---|---|---|---|---|
| Frigate | Overwatch Skies (Phase 1) | 10 | 1 | 3 | Primary role — strong AA, wide coverage |
| Battleship | Overwatch Skies (Phase 1) | 7 | 0 | 1 | Weak point defense only — adjacent hexes |

The Frigate is the dedicated naval AA platform: higher pen than the land AA Gun, and wider range (3 vs 2). The Battleship's AA is incidental — its short range and low To-Hit make it a last-ditch defense, not a screening tool.

Frigate detection stat = 5 (specialized radar). Stealth flight groups require a detection roll before the Frigate can fire at them.

### Terrain in Combat

**`combat_modifier`** — bonus added to a unit's Attack stat when fighting FROM that hex. High ground makes you a better attacker (roll ≤ Attack + CM to hit).

**Defense bonuses** — added to effective defense in the save formula.

| Source | Bonus | Applies to | Condition |
|---|---|---|---|
| Higher elevation than attacker | +1 | Ground vs ground only | Defender didn't move; attacker is on lower terrain |
| `has_light_vegetation` | +1 | All attacks including bombardment | Defender didn't move this turn |
| `has_heavy_vegetation` | +2 | All attacks including bombardment | Defender didn't move this turn |

**Elevation check for defense bonus:** Hills defender gets +1 only if attacker is on Plains/Desert/Wetlands/Water. Mountains defender gets +1 only if attacker is not also on Mountains. Elevation bonus does **not** apply against air attacks or bombardment. Vegetation bonuses **do** apply against bombardment. Units that moved receive no defense bonuses.

### Combat Formula (Simultaneous Volleys)

Both rolls use the same direction: **roll 2d6 equal to or under your stat to succeed. Higher stats are always better.**

**Attack roll — each unit rolls once:**
```
Roll 2d6 ≤ (To-Hit + combat_modifier) → 1 hit
```
`combat_modifier` = terrain bonus for fighting FROM that hex (see Terrain in Combat). Higher To-Hit = more accurate.

**Save roll — defender rolls once per hit received:**
```
Roll 2d6 ≤ (Defense + defense_bonus − Penetration) → saved
otherwise → 1 casualty (ground) or 1 HP damage (naval)
```
`defense_bonus` = sum of applicable terrain bonuses (see Terrain in Combat). Higher Defense = harder to kill. Penetration reduces effective defense.

If `Defense − Penetration < 2` → effective defense < 2 → impossible to save (all hits deal casualties).

Both sides roll simultaneously. Casualties and HP damage are removed after both volleys fully resolve.

**Probability table (roll ≤ n on 2d6):**

| Roll needed | Chance |
|---|---|
| ≤ 4 | 17% |
| ≤ 5 | 28% |
| ≤ 6 | 42% |
| ≤ 7 | 58% |
| ≤ 8 | 72% |
| ≤ 9 | 83% |
| ≤ 10 | 92% |
| ≤ 11 | 97% |

### Target Allocation (Proportional Fire)

Each attacking unit type spreads its shots proportionally across all defending unit types by count. Applies universally — mixed stacks, multi-faction, all cases.

```
shots_at_type_B = A_qty × (B_qty / total_enemy_qty)
```

Use largest-remainder rounding so totals add up exactly. Example: 10 infantry + 5 tanks attack 10 infantry + 5 tanks:
- Attacking infantry (10 shots): 10×(10/15)=6.67→**7** at infantry, 10×(5/15)=3.33→**3** at tanks
- Attacking tanks (5 shots): 5×(10/15)=3.33→**3** at infantry, 5×(5/15)=1.67→**2** at tanks

### Unit Combat Stats

**To-Hit** = roll 2d6 ≤ this value to score a hit. Higher = more accurate. Modified by terrain combat_modifier when fighting from elevated ground.

Manpower cost = `floor(mat_cost / 2)`. All costs are placeholder values — balance tuning deferred until after test games.

Ground:

| Unit | To-Hit | Defense | Pen | Move | LOS | Atk Range | Mat | Man | Slots |
|---|---|---|---|---|---|---|---|---|---|
| Infantry | 7 | 6 | 0 | 2 | 3 | 1 | 1 | 0 | 1 |
| Armor | 8 | 9 | 3 | 4 | 3 | 1 | 3 | 1 | 2 |
| Artillery | 8 | 4 | 2 | 2 | 3 | 4 | 4 | 2 | 2 |
| AA Gun | 5 | 4 | 1 | 1 | 3 | 1 | 2 | 1 | 1 |
| Supply | — | 3 | 0 | 4 | 3 | — | 2 | 1 | 1 |

Air:

| Unit | To-Hit | Def To-Hit | Defense | Pen | HP | Move | LOS | Atk Range | Mat | Man | Slots |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Fighter | 7 | — | 7 | 0 | — | 30 | 5 | 1 | 4 | 2 | 2 |
| Scout Plane | — | — | 6 | 0 | — | 35 | 6 | — | 3 | 1 | 2 |
| Bomber | 8 | 4 | 6 | 0 | 3 | 40 | 5 | 1 | 5 | 2 | 3 |
| Transport Plane | — | — | 3 | 0 | — | 25 | 3 | — | 3 | 1 | 2 |

`Def To-Hit` = to-hit of bomber's tail-gun defensive fire against intercepting fighters (4 = ~17% hit rate, rarely kills).

**Bomber HP** — bombers use a shared HP pool rather than quantity stacks. A group of 5 bombers has 15 HP. Every 3 HP lost removes 1 aircraft from the count (`quantity = ceil(current_hp / 3)`). Partial HP within a 3-HP band does not reduce count — the aircraft is damaged but still flying. Repaired at Airbase.

**Artillery in direct combat** — artillery has 0 attack dice when enemies enter its hex. It takes casualties normally. If artillery is the only friendly unit in a hex when combat resolves, it is automatically destroyed with no return fire.

Naval (HP-based; attack dice per ship):

| Unit | Atk dice | To-Hit | Defense | Pen | HP | Move | LOS | Atk Range | Mat | Man | Slots |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Destroyer | 1 | 7 | 6 | 1 | 6 | 5 | 4 | 1 | 3 | 1 | 2 |
| Frigate | 1 | 6 | 7 | 1 | 7 | 4 | 5 | 1 | 4 | 2 | 2 |
| Cruiser | 2 | 7 | 7 | 1 | 8 | 3 | 4 | 2 | 4 | 2 | 2 |
| Battleship | 3 | 8 | 9 | 2 | 12 | 4 | 4 | 3 | 6 | 3 | 3 |
| Transport (ship) | 0 | — | 4 | 0 | 5 | 4 | 4 | — | 2 | 1 | 1 |
| Carrier | 1 | 6 | 6 | 0 | 10 | 3 | 5 | 1 | 5 | 2 | 3 |
| Submarine | 2 | 8 | 7 | 4 | 6 | 4 | 0 | 1 | 4 | 2 | 2 |

**Frigate** — anti-air specialist. Mediocre surface combatant (To-Hit 6 = 42% vs ships); purpose is AA overwatch at sea. High LOS and detection for spotting incoming aircraft.

All stats are placeholder values — balance tuning deferred until after test games.

### Air Intercept Combat

| Matchup | Attacker to-hit | Defender to-hit |
|---|---|---|
| Fighter vs Fighter | 7 | 7 |
| Fighter vs Bombers (no escort) | 7 | 10 (tail gun only) |
| Escort vs Patrol Fighters | 7 | 7 |

After escort vs patrol resolves, surviving patrol fighters engage bombers. Bombers surviving any intercept continue to target.

### Movement and Combat Interaction

**Crossing detection:** A → B's origin, B → A's origin simultaneously → border battle. Combat resolves in each unit's starting hex. Survivors: if one side is wiped, the winning side advances into the hex they were originally heading toward. If both sides survive, each stays in their starting hex.

**Multi-faction combat:** When three or more factions occupy or contest the same hex, each faction attacks all factions it is `at_war` with. Allied factions pool into a shared defender/attacker group against common enemies. Neutral factions do not fire but still receive fire from factions at war with them.

**Bombardment is indiscriminate:** Unit-targeting rolls during bombardment (from artillery, battleships, or bombers) apply to ALL units in the hex — friendly, enemy, and allied. Players take responsibility for bombing hexes with mixed or friendly occupancy.

Units that moved do NOT receive `defense_bonus`.

---

## Bombardment

Bombardment is indirect fire — the target does not fire back. Resolves in Phase 3 alongside ground combat.

### Rules Common to All Bombardment

**Two rolls per targeted hex:**
1. **vs Units** — one 2d6 roll per bombarder. Each roll ≤ bombarder's To-Hit → 1 hit. Each hit: select a unit to receive it **proportional to unit count** (a hex with 10 infantry and 2 armor has a 10/12 chance of hitting infantry). That unit makes a normal defense save. Failed save = 1 casualty or 1 HP damage as normal.
2. **vs Infrastructure** — one 2d6 roll per bombarder (rolled simultaneously with the unit roll). Each roll ≤ To-Hit → 1 infrastructure hit. **No defense roll for infrastructure.** Per hit: randomly select one infrastructure piece present (buildings, bridge, urban, vegetation, road). If it has HP → loses 1 HP. If it has no HP (urban, vegetation, road) → immediately set to damaged, or destroyed if already damaged.

Multiple bombarders targeting the **same hex** pool their rolls as a single simultaneous attack — hits are totalled before any are applied.

Empty hex (no units, no infrastructure) → wasted bombardment, no report.

Blind fire (no friendly LOS to target) → bombardment resolves normally but player receives no combat report.

### Per-Unit Patterns and Rules

**Artillery**
- Must be stationary to bombard (cannot move and fire same turn)
- Target pattern: **1 hex** at range 4–6
- Rolls: 1 die vs units + 1 die vs infra (To-Hit 8, Pen 2)
- Infrastructure selection: random among present pieces
- No return fire from target

**Battleship**
- May move and bombard in the same turn; cancelled if engaged in naval combat that turn
- Target pattern: **3 mutually adjacent hexes (triangle)**; player picks which triangle
- Rolls: 3 dice per hex vs units + 3 vs infra (To-Hit 8, Pen 2)
- Infrastructure selection: random among present pieces

**Bombers**
- Bombing resolves as part of air-to-ground strikes (survivors from Phase 1)
- Target pattern: **3 hexes in a line** along the bomb run path
- Rolls: 1 die per hex vs units + 1 vs infra (To-Hit 7, Pen 1)
- Infrastructure selection: player may **designate one target** per hex. Designated target = 70% chance of being selected; remaining 30% distributed equally among other infra present. Undesignated = equal random weight.

---

## Fog of War

Two display states: **Visible** / **Dark**.

- **Visible** — hex is in current LOS. Full information: terrain, attributes, all detected units.
- **Dark** — hex is not in current LOS. If the faction has ever had LOS to this hex, terrain and infrastructure attributes are shown (you know the lay of the land). **No unit information** — you see where units were the last time you had LOS, but those markers are not shown; only terrain persists. If never seen, the hex renders as unknown.

"Scouted" is an internal database concept (`scouted_hexes` table) tracking whether a faction has ever seen a hex — used to determine whether to show terrain info on Dark hexes. It is not a separate display state.

LOS blocked by Mountains, `has_light_vegetation`, `has_heavy_vegetation`. Blocking hex is visible; hexes beyond are not.

Air units reveal LOS for every hex along flight path. Destroyed members contribute no LOS.

Stealth units are invisible until detected — they do not appear on enemy maps even within LOS range.

### Combat Intel

| Situation | Own Casualties | Enemy Casualties |
|---|---|---|
| Had LOS to battle | Exact | Exact |
| In battle, no LOS | Exact | Partial — see below |
| Blind bombardment | No report | No report |
| Flight group destroyed | — | No report |

**Partial intel (in battle, no external LOS):** When your units fought but you had no observer in LOS range, you know your own losses exactly. For each enemy unit that participated, roll independently: **2/3 chance (67%)** that unit appears in your battle report. Units that fail the roll are not reported — you know a battle occurred and what you lost, but your picture of the enemy force is incomplete.

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

Manpower spent on construction is committed to the building and persists as HP progress. Manpower not spent on anything is wasted at end of turn.

---

## Production

**Production panel** — shown at the **start of each turn**, before orders are set:
1. **Place completed units** — units whose production was queued last turn are ready. Player chooses spawn location at the relevant facility (Manufacturing Facility for ground, Airbase for air, Harbor for naval).
2. **Queue new production** — player selects unit types to produce this turn. Materials are deducted immediately from stockpile. Manpower is reserved from this turn's Phase 4 collection.

**Production time:** always 1 turn. Pay resources turn N → place unit at start of turn N+1.

**Spawn rules:**
- Ground units: spawn at Manufacturing Facility
- Air units: spawn at adjacent Airbase (or a Carrier within adjacent range)
- Naval units: spawn at adjacent Harbor

**Resource payment:** Materials deducted from stockpile immediately. Manpower reserved from this turn's collection (Phase 4). If a settlement is captured or destroyed before Phase 4 and manpower falls short, production is cancelled (materials refunded).

`production_queue`: game_id, faction_id, unit_type_id, quantity, turn_queued, status (`pending` → `ready` → `placed`).

**Production capacity:**
- All units produced at Manufacturing Facility. Slots per turn = `floor(current_hp / 2)`. Full facility (20 HP) = 10 slots. Damaged to 10 HP = 5 slots. Destroyed = 0.
- Each unit costs `ceil(mat_cost / 2)` production slots (see Slots column in unit stats).
- Manpower cost = `floor(mat_cost / 2)` per unit produced.

**Repair capacity** (separate from production):
- Harbor: `floor(current_hp / 2)` repair slots. Each naval unit being repaired occupies 1 slot. Full Harbor (10 HP) = 5 concurrent repairs.
- Airbase: `floor(current_hp / 2)` repair slots. Each air unit being repaired occupies 1 slot. Full Airbase (10 HP) = 5 concurrent repairs.
- Repair cost = `ceil(mat_cost / 4)` materials + `ceil(man_cost / 4)` manpower. Instant (1 turn). Restores to full HP.

---

## Transport Plane

- Tags: air + ground
- Capacity: 2 ground unit slots
- Moves ground units from an Airbase to any Airbase or Airstrip
- Units must **board at an Airbase** (Airstrips cannot load troops — receive only)
- One transport mission per turn (like a flight group)

## Carrier

- Tags: naval + air
- Air unit capacity: **4 fighters maximum**. Cannot carry bombers.
- Each unit type has a `carrier_slots` value (Fighter = 1, Bomber = N/A). Carrier capacity is stored per unit type in unit_type_config.
- Fighters launched from Carrier use it as their home airstrip/airbase for landing purposes.
- Air units produced at a Manufacturing Facility with adjacent Airbase may spawn aboard a Carrier within adjacent range of that Airbase.

**If the Carrier sinks (Phase 2):**
- Air units mid-mission (launched in Phase 1): in Phase 4, they attempt to land at the nearest friendly airstrip or airbase within remaining movement. If none reachable → crash and destroyed.
- Air units parked on the Carrier (no orders that turn): **emergency takeoff roll** — roll 1d6, result ≥ 4 → unit gets airborne and flies to nearest friendly landing site within movement. Fail → sunk with the Carrier.

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
- **Map visual clarity** — terrain types, buildings, roads, bridges, settlements, units in LOS must all be immediately readable at a glance. Drive hex rendering with distinct colors, icons, and overlays per attribute.
