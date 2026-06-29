# Wargame — Design Document

Setting-agnostic hex-based operational wargame. Planet-scale map, ground + naval + air warfare, fog of war, async multiplayer via web portal.

---

## Core Loop

1. **Orders** — players queue movement, combat, production, patrol, and flight group orders
2. **Resolve** — turn advances through four phases
3. **Report** — players see results filtered through fog of war

---

## Turn Resolution

All phases resolve automatically when all players click Finish Turn (or GM force-advances). Within each phase, all actions of the same type resolve simultaneously — volleys from both sides are rolled, then casualties applied together.

---

### Phase 1 — Air

1. **All flight groups commit.** Paths and mission types locked. Standing patrol orders from previous turns remain active.
2. **AA Overwatch fires.** For each AA unit (AA Gun, Frigate, Battleship) with overwatch_skies behavior: fire once at each detected enemy flight group whose path passes within overwatch range. Stealth groups require a detection roll first — undetected groups pass through silently. Multiple AA units fire independently. **AA casualties are applied immediately** before any patrol intercepts — flight groups enter patrol zones already attrited.
3. **Patrol intercepts (sequential).** For each detected enemy flight group, process each patrol zone in path order as a separate battle. All fighters and bombers on both sides roll simultaneously — no sequential escort-first sequence. Casualties applied immediately after each battle before the next patrol zone is resolved. The group continues into the next zone with whatever strength remains.
4. **Surviving bombers participate in their target phase(s):**
   - **Attack Run** designates a single target hex → Phase 2 if targeting a naval hex; Phase 3 if targeting a ground hex.
   - **Bombing Run** targets a 3-hex line. Bombers participate in **Phase 2** for any water hexes in the line and **Phase 3** for any land hexes. A Bombing Run spanning both domains participates in both phases — Phase 2 casualties reduce the group before Phase 3 attacks resolve.

---

### Phase 2 — Naval

Naval movement is step-by-step and simultaneous. All ships advance one hex at a time along their planned paths, synchronized. Contact is triggered only when ships occupy the same hex or cross each other's paths at the same step — mere adjacency does not interrupt movement.

1. **Ships step through movement simultaneously.** All ships advance one hex per step. Repeat until all ships have used their movement or stopped. Ships not involved in a contact continue stepping.
2. **Contact check per step.** After each hex is moved, check for two contact types:
   - **Hex collision**: two enemy ships occupy the same hex → both stop. Close combat resolves at the end of Phase 2 (step 5).
   - **Path crossing**: two enemy ships swapped hexes in this step (A→B while B→A simultaneously) → border battle. Neither ship is in a hex; both fire simultaneously. If both survive: each returns to their starting hex and movement ends. If one is wiped: the winner continues from the border.
3. **Detection rolls.** Surface ships attempt to detect submarines within sonar range; submarines attempt to detect surface ships. Undetected submarines cannot be targeted.
4. **Ranged fire (naval).** All ships fire once at every detected enemy ship within their Atk Range. Simultaneous volleys — all rolls resolved before HP damage is applied. Ships on directed Bombard orders skip this step. Bombers on Attack Run orders against naval hexes also attack in this step.
5. **Close combat.** Ships in hex collisions fight simultaneously.
6. **Sunk ships removed.** Carrier sinking → emergency rules for parked air units (see Carrier section). Transport sinking → survival rolls for embarked ground units (see Naval Landing).
7. **Battleship bombard validation.** A Battleship involved in a hex collision or path crossing this phase cannot bombard in Phase 3.

---

### Phase 3 — Ground

1. **All ground units execute movement orders simultaneously.** Supply trucks on build orders do not move — they execute their build action in place instead. Ground movement is **step-by-step**: units advance one hex at a time. Forced engagement occurs only when a unit enters the **same hex** as an enemy — both sides stop and close combat queues for step 5. Units within Atk Range of enemies but NOT in their hex are not forced to engage; they fire on them in the ranged fire step. Naval Transport ships offload ground units at the end of Phase 2; offloaded units are placed in the landing hex and have used all movement for the turn (cannot move further in Phase 3). See Movement and Combat Interaction for crossing (swap hex) rules. **Patrol note:** a stealthy unit moving into a patrolling unit's LOS range during this step triggers an immediate detection check — if detected, the patrol unit may respond.
2. **Detection rolls.** All ground units attempt to detect enemies within their LOS range. Standard detection formula applies (see Stealth and Detection). Units with effective_stealth > 0 (e.g., non-stealth units in vegetation or urban terrain) require a roll even without a stealth tag. Results determine who can be targeted in the ranged fire step.
3. **Ranged fire (ground).** All ground units fire once at detected enemies within their Atk Range. Simultaneous — both sides roll before damage is applied. Units with an active Bombard order targeting a specific distant hex skip this step. Artillery has no Atk Range and skips this step entirely.
4. **Contested ground hexes identified.** Any hex containing ground units from factions at war → combat triggers.
5. **All combat and bombardment resolves simultaneously.** Every action in Phase 3 fires at the same moment:
   - **Direct ground combat:** units in contested hexes fight.
   - **Artillery bombardment:** stationary artillery not engaged in close combat fire at designated target hexes.
   - **Naval bombardment:** Battleships with validated bombard orders fire at designated hexes (land or water).
   - **Air-to-ground strikes:** surviving bombers assigned to ground targets execute Bombing Run or Attack Run orders.
   - All bombardment and strikes are **indiscriminate** — all units in the targeted hex (friendly, enemy, allied) are eligible to be hit. If allied or friendly units are present in a bombarded hex, they may take casualties.
   - All hits from all sources pooled; casualties and HP damage applied after all volleys complete.
6. **Building and infrastructure damage assessed.** Each infrastructure hit from step 5 is applied: HP-based infrastructure (buildings, urban tiles) loses 1 HP per hit — no defense roll. Vegetation: each hit rolls 1d6 (4+ = thin one step: heavy → light, or light → cleared entirely; 1–3 = no change). Roads and canals are immune — they are excluded from the selection pool entirely.
7. **Objective hex capture.** Ownership is only tracked for hexes with objectives: settlements, urban tiles, resource tiles, and buildings (airbase, harbor, factory, etc.). Any such hex where exactly one faction's ground units remain → that faction captures it. Plain terrain hexes (empty hills, plains, desert, etc.) have no owner — units occupy them tactically but ownership is not recorded. Buildings and infrastructure transfer to new owner in current state.

   **Air units at a captured Airbase:** Air units parked at an Airbase (no orders that turn) that is captured in Phase 3 face the same emergency as carrier-parked aircraft: roll 1d6 per unit — result ≥ 4 → emergency scramble to nearest friendly Airbase, Airstrip, or Carrier within movement range; fail → destroyed on the ground.

---

### Phase 4 — Return and Collect

1. **Air units fly home.** All flight groups return to nearest friendly landing site (airbase, airstrip, or carrier at its current position after Phase 2).
   - If planned landing site was captured or destroyed: reroute to nearest alternative within remaining movement range.
   - Carrier-based units whose carrier sunk: find alternative or crash.
   - Units with no reachable landing site → crash and are destroyed.
2. **Materials collected.** +1 per owned resource tile.
3. **Production queue advances.** All `pending` orders → `ready`. Units available to place at start of next turn.
4. **Settlement control evaluated.** For each settlement: assign urban tiles by proximity (see Settlement Control rules), count ownership, apply the 3/4 threshold. Each settlement resolves to controlled (by one faction) or contested.
5. **Manpower calculated and held.** Using the settlement control results from step 4: sum the assigned urban tile counts of all controlled settlements per faction. Total = manpower budget available to spend at the start of the next turn. Urban tiles at 1–2 HP produce no manpower; at 0 HP they are destroyed and produce nothing. Manpower is NOT spent here — it carries forward to the ordering phase.
6. **Win condition check.** Count settlements in a **controlled** state per faction. Any faction controlling ≥ 2/3 of all settlements → wins. Contested settlements count for no one.
7. **Reset.** `turn_ready` cleared for all players. Turn counter increments.

---

### Between Turns — Player Orders Phase

This is where manpower from Phase 4 is spent. Players act in any order; the turn does not advance until all are ready.

1. **Review** combat reports and battle log, filtered through fog of war.
2. **Production panel:**
   - Place all `ready` units at valid spawn locations (ground → Factory hex or adjacent; air → Airbase/Airstrip/Carrier within 5 hexes of Factory; naval → Harbor within 5 hexes of Factory).
   - Queue new production: pay materials from stockpile + manpower from this turn's budget now.
3. **Building construction and repair:** allocate mat + manpower toward buildings under construction or repairing damaged buildings (same rate: 1 mat + 1 man per HP). HP credited immediately. Materials deducted from stockpile, manpower deducted from budget.
4. **Set orders:** movement, bombardment, flight groups, patrol, supply truck build actions (road, canal, airstrip, bridge — earmark manpower for these now).
5. Any manpower not allocated before clicking Finish Turn is wasted.
6. **Click Finish Turn.** When all players ready → next turn's phases execute.

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

| Terrain | Elevation | Combat Mod | Def Bonus* | Blocks LOS† |
|---|---|---|---|---|
| Plains | 0 | 0 | 0 | No |
| Hills | 1 | +1 | +1 | No |
| Mountains | 2 | +2 | +1 | Yes |
| Desert | 0 | 0 | 0 | No |
| Wetlands | 0 | -1 | 0 | No |
| Water | 0 | 0 | 0 | No |

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
| `has_light_vegetation` | Blocks LOS†. No move penalty for foot; +2 for mechanized. Stealth +1 for all units. Bombardment hit → 1d6: 4+ → cleared entirely. |
| `has_heavy_vegetation` | Blocks LOS†. +2 for foot; impassable for mechanized. Stealth +3 for all units. Bombardment hit → 1d6: 4+ → becomes `has_light_vegetation`. |
| `has_urban` | City environment. **4 HP.** Stealth +2. +1 move cost for mechanized. At 3–4 HP: produces manpower. At 1–2 HP: damaged — produces no manpower. At 0 HP: destroyed. Repair: 1 mat + 1 man per HP. |
| `has_settlement` | Major urban center. Counts toward win condition. Starts with a Factory. |
| `has_road` | Road. Reduces terrain movement cost to 2/3 (see Movement section). Supply unit builds segments in adjacent hexes (truck not consumed); manpower cost varies by terrain — see Road Construction table. |
| `has_railroad` | *(Stub)* Railroad. Very fast ground unit movement. Expensive to build. |
| `has_airstrip` | Hosts air units. Cannot produce them. Has HP. Built by consuming a Supply unit + 2 manpower. |
| `has_airbase` | Hosts air units; enables air production at any Factory within 5 hexes. Has HP. |
| `has_harbor` | Hosts and repairs naval units; enables naval production at any Factory within 5 hexes. Must be on/adjacent to a Water hex. Has HP. |
| `has_bridge` | Foot/mechanized may cross this Water hex. Has HP. Built by consuming a Supply unit + 2 manpower. |
| `has_canal` | Naval units may enter this Wetlands hex. Costs **10 manpower** to build. Supply unit present (not consumed). No effect on land movement. |

†The attribute hex itself is visible; hexes beyond it are not.

### Elevation and LOS

**LOS** (line of sight) = the radius in hexes a unit can see around itself. A unit with LOS 3 sees its own hex and every hex within 3 hexes. Elevation increases LOS range — a unit on Hills sees 1 hex further; on Mountains, 2 hexes further.

| Terrain | Elevation | LOS bonus |
|---|---|---|
| Plains / Desert / Wetlands / Water | 0 | +0 |
| Hills | 1 | +1 hex LOS |
| Mountains | 2 | +2 hex LOS |

LOS is blocked by Mountains and vegetation attributes (see Hex Attributes). Unit facing is not modeled — LOS is a full circle around the unit.

Elevation increases LOS for all units (see table above). Artillery additionally gains extended **Bombard Range** from high ground — see the Bombardment section.

### Hex Ownership

A hex is owned by whichever faction last controlled it. Capturing = have units there with no enemies present at end of Phase 3.

### Settlement Control

Owning the `has_settlement` hex is not sufficient — a settlement is only **controlled** if one player owns at least **3/4 of all urban tiles assigned to it**.

**Assigning urban tiles to settlements:**
1. Flood-fill from each `has_settlement` hex through contiguous `has_urban` tiles to find that settlement's urban cluster.
2. If two settlements' urban clusters are adjacent or overlapping (their urban sprawl touches), each `has_urban` tile is assigned to whichever settlement hex is closer (shortest hex distance).
3. **Tie-break:** if a tile is equidistant from two settlements, it is assigned to whichever settlement is owned by the same faction that owns that tile. If the tie cannot be resolved this way (the tile owner owns neither or both settlements), the tile is counted as contested and belongs to neither settlement's cluster.
4. **Isolated urban tiles** — `has_urban` tiles not flood-fill connected to any settlement are standalone. They do not contribute to any settlement's control threshold or manpower. Capturing them has no mechanical effect by itself, but if a player places a new `has_settlement` on or adjacent to them (via GM or future mechanics), the cluster would be absorbed into that settlement's urban count.

**Control threshold:**
```
controlled_by = P  if  (tiles owned by P / total assigned tiles) ≥ 3/4
contested          if  no single player meets the 3/4 threshold
```

**Contested settlements:**
- No faction collects manpower from them.
- No faction counts them toward the victory condition.
- The settlement hex itself may be owned by one player, but ownership alone grants nothing until the urban threshold is met.

**Controlled settlements:**
- The controlling faction collects manpower equal to the full urban tile count assigned to that settlement (not just the tiles they personally own — you control the city, you get the whole city's output).

### Win Condition

Hold **2/3 of all `has_settlement` hexes** in a **controlled** state (not contested) at the end of Phase 4. Threshold is tunable per player count. Settlement count set at map creation by GM.

---

## Locomotion Types (Tags)

Units have a combination of tags that describe what they are, what they can do, and where they can go. Tags are player-facing indicators that also inform cost (more tags = higher cost) and drive engine rules for terrain access, combat targeting, and special abilities.

| Tag | Meaning |
|---|---|
| `ground` | Can move on land terrain |
| `mobile` | Fast; higher movement stat; maneuverable. Not synonymous with mechanized — cavalry, eagle riders, etc. are mobile but not mechanized. |
| `mechanized` | Motorized vehicle. Uses the mechanized terrain cost column. Cannot enter Mountains without a road; cannot enter hex with `has_heavy_vegetation`. All mechanized units are also mobile. |
| `armored` | Tough; high defense; absorbs punishment (land units use quantity stacks, not HP) |
| `heavy` | Heavy firepower; specialized destructive capability; often ranged |
| `naval` | Can move on Water |
| `air` | Flies over all terrain; must land on airstrip, airbase, or Carrier |
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
| Armor | ground + mobile + armored + mechanized |
| Artillery | ground + heavy |
| AT Gun | ground + heavy |
| AA Gun | ground + air + heavy |
| Supply | ground + mobile + mechanized |
| Recon | ground + stealth |
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

**Foot vs mechanized:** Ground units with the `mechanized` tag use the **mechanized** terrain cost column. All other ground units (Infantry, Artillery, AA Gun) use the **foot** column. In a non-modern setting, cavalry would be mobile-but-not-mechanized and could use a separate cavalry cost column if defined.

**Movement formula:** `hexes = max(1, ceil(movement / cost))`. If any movement points remain after taking the maximum whole hexes, the unit can always enter one more hex, spending the remainder. Foot units can always enter at least 1 hex — no terrain cost alone makes a ground hex impassable to a foot unit. Mechanized units may be categorically blocked (Mountains without road, `has_heavy_vegetation`).

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

**Roads:** `has_road` is a tile tag only — not a structure. No HP. Can only be removed by a Supply truck spending its action to demolish it (same unit that builds them). Roads reduce movement cost to **2/3 of normal terrain cost** (integer math via ×3 scale: road cost = terrain_cost × 2 in the internal scale).

| Terrain | Off-road | Road cost | Infantry (mv=2) off → road | Armor (mv=4) off → road |
|---|---|---|---|---|
| Plains | 1 | 0.67 | 2 → 3 hexes | 4 → 6 hexes |
| Hills | 2 | 1.33 | 1 → **2 hexes** | 2 → 3 hexes |
| Mountains | 4 | 2.67 | 1 → **1 hex** | 1 → **2 hexes** |
| Desert (foot/mech) | 2 / 1 | 1.33 / 0.67 | 1 → **2 hexes** | 4 → 6 hexes |
| Wetlands | 2 / 4 | 1.33 / 2.67 | 1 → **2 hexes** | 1 → **2 hexes** |

Roads connect visually: adjacent road tiles draw a road line between them, including across bridges. Naval and air are unaffected.

**Desert asymmetry:** foot pays 2 (heat, exhausting); mechanized pays 1 (flat open terrain, ideal for armor).

### Hex Attribute Movement Effects

| Attribute | foot | mechanized | naval | air |
|---|---|---|---|---|
| `has_light_vegetation` | +0 | +2 | no effect | no effect |
| `has_heavy_vegetation` | +2 | impassable | no effect | no effect |

*Exception: Recon units ignore the `has_heavy_vegetation` movement penalty — they enter at base terrain cost with no +2 addition.*
| `has_urban` | +0 | +1 | no effect | no effect |
| `has_airstrip` / `has_airbase` | no effect | no effect | no effect | required to land |

### Ground Unit Stacks

All ground units of the same faction in a hex form a single stack and act together. Units of different types in the same hex (e.g. infantry + armor) are one combined force for combat purposes. To split a stack, give different movement orders to different portions — units with different destinations will separate at movement execution. Producing additional units of a type already present in a hex merges them automatically (one `units` row per faction + unit_type + hex).

### Naval Landing

Transport ships (naval + ground) offload ground units to adjacent land hexes at the end of Phase 2. Offloading **consumes the entire turn's movement** for the ground units — they land in the hex and cannot move further in Phase 3. They may be engaged in Phase 3 ground combat or hit by overwatch/bombardment. Transport capacity: **6 slots**. Each unit currently occupies 1 slot (subject to change; some units may occupy 2).

**If a Transport sinks while carrying ground units:**
- If the Transport is NOT adjacent to a land hex: all aboard are destroyed.
- If the Transport IS adjacent to a land hex: each ground unit rolls 1d6 — result ≥ 4 → makes it ashore (placed on the adjacent land hex); fail → drowned and destroyed.

### Air Movement

Air units ignore terrain costs. Must start and end every turn at a hex with `has_airstrip` or `has_airbase`, or on a Carrier. Air units provide LOS for every hex along their flight path. **Flight group LOS is reported at the end of Phase 4 when the group returns home.** A group that is entirely destroyed before returning does not report any scouting data — the intel is lost with the aircraft.

**If planned landing site is captured or destroyed:** system checks for nearest friendly airstrip/airbase/Carrier within remaining movement range. If found → reroute. If not → unit crashes. *(Emergency landing rules: future feature.)*

---

## Buildings and Infrastructure

Buildings are placed on the map (either by GM at start or built by players during the game). They have HP, can be damaged or destroyed.

| Building | Max HP | Mat cost | Man cost | Supply unit? | Placement rules |
|---|---|---|---|---|---|
| Factory | 20 | 20 | 20 | No | Pre-placed at settlements; player-buildable elsewhere |
| Airbase | 10 | 10 | 10 | No | Any hex; enables air production at any Factory within 5 hexes |
| Harbor | 10 | 10 | 10 | No | Must be on/adjacent to Water; enables naval production at any Factory within 5 hexes |
| Airstrip | 4 | 0 | 2 total | Consumed | Anywhere |
| Bridge | 4 | 0 | 2 total | Consumed | On a Water hex |
| Fortification | 4 | 0 | 2 total | Consumed | Any land hex |
| Road | — | 0 | 1–3 per segment | Present, not consumed | Any passable land hex |

HP = material cost for mat-based buildings. This makes all math trivial: **1 material + 1 manpower adds 1 HP of construction progress**.

**Construction:** Players allocate materials and manpower toward a building each turn. Each 1 mat + 1 man invested adds 1 HP. The building is not operational until it reaches max HP. Players can invest as little or as much as their budget allows per turn — a Factory (20 HP) can be half-built over one turn and completed the next. Enemies can attack under-construction buildings to damage or destroy them. If HP drops to 0: building is lost, no refund.

**Repair costs:**
```
Naval (at Harbor):    ceil(mat_cost / 4) mat + ceil(man_cost / 4) man → full HP, 1 turn, uses 1 Harbor repair slot

Air (at Airbase):     ceil(mat_cost / 4) mat + ceil(man_cost / 4) man → full HP, 1 turn, uses 1 Airbase repair slot

Mat-based buildings:  1 mat + 1 man per HP restored (same rate as construction)

Airstrip/Bridge:      1 Supply unit consumed + 1 man per HP restored

Urban tile:           1 mat + 1 man per HP restored (max 4 HP). No facility required.

Fortification:        1 manpower → restores to full HP (regardless of current HP). Completes in Phase 4. If
                      the Fortification is destroyed before Phase 4 completes, the manpower is lost and it
                      must be rebuilt from scratch. No materials required.
```

**Building status (Factory, Airbase, Harbor, Fortification, Airstrip, Bridge):**
- `under_construction`: never yet reached full HP. Not operational.
- `operational`: at max HP.
- `destroyed`: HP = 0 (previously operational). Non-functional. Tag stays on hex (ruins visible). Bridge at 0 HP = impassable. *Exception: under-construction buildings destroyed at HP=0 vanish entirely — no tag remains (see infrastructure damage).*
- No separate "damaged" status — HP directly scales production capacity (`floor(current_hp / 2)` slots). Airbases/Airstrips can still land and launch at any HP > 0.

**Urban tiles (4 HP, tracked as `urban_hp` on the hex):**
- 3–4 HP: operational, producing manpower.
- 1–2 HP: damaged — produces no manpower. Still present on map.
- 0 HP: destroyed. No manpower. Still visible.
- Repair: 1 mat + 1 man per HP. No facility required (repaired by any unit in hex during ordering phase).

**Vegetation (tag-based, no HP):**
- Heavy → light → cleared by bombardment hits. Each step is a 50/50 roll (1d6: 4+). Cannot be repaired — vegetation grows back naturally over very long timescales (not modeled).

**Roads and canals (immune to bombardment):**
- `has_road` = true/false. Demolished by enemy supply truck action → set to false. No partial state.
- `has_canal` = true/false. Same.

**Fortification damage exception:** A Fortification gives its full +1 defense bonus as long as it has any HP remaining (damaged or operational). Being damaged does not reduce the bonus. Only complete destruction (HP = 0) removes it. This represents partial bunker/trench systems still providing cover even when damaged.

**Under-construction buildings bombed to 0 HP:** building vanishes entirely (no destroyed tag left on hex). No refund.

**Hex capture and buildings:** When a hex changes ownership, all buildings and infrastructure on it transfer to the new owner in whatever state they are in (including under-construction buildings). The new owner can continue construction, use, or repair them.

**Production chain:**
- Ground units: produced at any Factory. Spawned at the Factory hex or any adjacent hex (1 hex radius).
- Air units: produced at a Factory with at least one Airbase within 5 hexes. Spawned at any Airbase, Airstrip, or Carrier within 5 hexes of that Factory.
- Naval units: produced at a Factory with at least one Harbor within 5 hexes. Spawned at any Harbor within 5 hexes of the Factory.

**Supply units as builders:** One action per turn — the truck either moves OR builds, not both. Build actions:
- **Road:** truck stays in place, builds up to 3 segments in adjacent hexes (per terrain limits). Truck not consumed. Segments complete immediately in Phase 4.
- **Airstrip / Bridge / Fortification / Canal:** truck commits to construction. Truck is consumed at completion. Construction completes at end of Phase 4 (production step). If the truck is destroyed during Phase 3 ground combat before Phase 4, construction fails and all resources spent are lost.

A truck executing a road order builds during Phase 3 in place. A truck committed to any other construction does not move that turn and is consumed at Phase 4.

---

## Stealth and Detection

### Who Needs a Detection Roll

The rule is simple: **effective_stealth = unit.stealth_rating + terrain_stealth_modifier**.

- **effective_stealth = 0** → unit is **auto-detected** by any unit with LOS to it. No roll required.
- **effective_stealth > 0** → detection roll required (see Detection Formula).

Non-stealth units (stealth_rating = 0) in open terrain (no stealth bonus) have effective_stealth = 0 and are always auto-detected within LOS. The same units inside cover (hills, vegetation, urban) gain a terrain bonus, giving them effective_stealth > 0, and now require a roll. Units with the `stealth` tag have a base stealth_rating > 0 and always require a roll regardless of terrain.

**You cannot target what you have not detected.** Undetected units cannot be fired upon by AA, intercepted by patrol, bombarded, or otherwise engaged.

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

Roll **2d6 ≤ detection_score** → detected this turn. Capped: detection_score > 12 = auto-detect, detection_score < 2 = impossible. Detection is attempted each turn within the detector's LOS range (submarines: sonar range instead of LOS).

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
- Detects via sonar (detection stat) only. **Sonar range: 4 hexes.** Cannot detect anything beyond 4 hexes regardless of formula.
- Can only detect naval surface units — not ground, not air. Air units cannot detect or attack submarines either.
- Contributes no fog-of-war vision to its faction beyond its own hex.
- **Destroyer sonar range: 3 hexes.** Destroyers can only detect submarines within 3 hexes. Beyond 3 hexes, detection is impossible. The standard detection formula applies within that range.

**One-sided submarine combat:** if a submarine detects a surface ship but the surface ship fails its detection roll, the submarine attacks and the surface ship cannot fire back. The surface ship receives a battle report: "attacked by undetected submarine(s)" — it knows it was hit but does not know the submarine's exact position.

**Post-attack detection bonus:** after a submarine fires, the attacked faction immediately makes a bonus detection roll with +2 to detection score (see Stealth Unit Firing rule below).

### Stealth Unit Firing

**Firing while undetected:** When a stealth unit fires (ranged fire step or close combat) against a faction that has not yet detected it this turn, that faction immediately makes a bonus detection roll with **+2 to detection score** against the firing unit. If the roll succeeds, the unit's position is revealed for the start of next turn — not in time to fire back this turn. This applies to all stealth units (currently Recon and Submarine).

**Hold Fire** (Recon and Submarine): standing order that prevents initiating fire in the ranged fire step. The unit will still fire back if it receives incoming fire in that same step. Useful for staying dark — not firing means no position reveal, and detection re-rolls each turn. A Recon unit on Hold Fire always fights normally in close combat. See Orders table.

### Stealth by Unit Type

| Unit | Stealth | Detection | Notes |
|---|---|---|---|
| Infantry | 0 | 2 | Auto-detected in open; hidden in cover |
| Armor | 0 | 2 | Auto-detected in open |
| Artillery | 0 | 2 | No direct fire; bombard only |
| AT Gun | 0 | 2 | |
| AA Gun | 0 | 4 | Specialized sensors |
| Supply | 0 | 1 | |
| Recon | 3 | 3 | Ignores heavy veg move penalty; Hold Fire available; Sabotage ability |
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
| Submarine | 6 | 5 | LOS = 0; sonar-only; naval targets only; Hold Fire available |

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
| Scout | Scout Planes + optional Fighter escort | Scout planes fly path to gather LOS. Solo scout groups retain full stealth (stealth 4) — very hard to detect. If a fighter escort is added, the group uses the lower stealth of the fighters. LOS only reported when the group returns home in Phase 4. |
| Sweep | Fighters only | Clear enemy patrol fighters from a path |

**Bombing missions use special stats** — when a flight group executes a Bombing Run or Attack Run, bombers use **bombing stats (To-Hit 7, Pen 1 vs ground/naval)** rather than their standard air-to-air stats. Intercepting fighters in Phase 1 fight bombers using the bombers' air-to-air stats (To-Hit 5, Pen 0). The bombing stats only apply when the bombers are actually dropping ordnance in Phase 2 or Phase 3.

**Bombing Run** is for infrastructure destruction: 3-hex line, designated infra targets, both unit and infra rolls (see Bombardment section).

**Attack Run** is for targeting mobile forces or naval units:
- Player designates a destination hex. Fighter escorts engage any enemy fighters along the path (normal intercept rules).
- Bombers search for detected enemy units within **3 hexes of the destination** (large search area).
- **Target allocation** — assign bombers to detected targets using stack-priority algorithm:
  1. Sort detected targets by **total effective HP** (ground = unit count, each unit counts as 1; naval = sum of actual HP of all ships in that group). Largest first.
  2. Assign `min(remaining_bombers, target_effective_hp)` bombers to each target in order.
  3. If bombers remain after one pass, repeat from the top until all bombers are assigned.
  - *Examples (ground): 10 bombers vs a 10-stack + 5-stack → all 10 bomb the 10-stack. 10 bombers vs 5 single-unit tiles → 2 bombers per tile. (Naval): 10 bombers vs a Battleship (12 HP) + 3 Destroyers (6 HP each = 18 HP) → all 10 bomb the destroyer group.*
- Each assigned bomber makes **1 attack roll** against its target hex (To-Hit 7, Pen 1 vs units only — no infrastructure roll).
- Normal defense save applies per hit. Bombers return to base after attacking.
- If no units are detected within 3 hexes of destination, the run is wasted.

**Path validation:** system checks every unit has enough movement for outbound path + return to nearest friendly airstrip/airbase/Carrier. Rejected if any unit falls short.

**Attrition:** entirely destroyed groups provide no LOS and report no enemy intel. However, the player **does** receive a combat log entry: the group's composition (unit types and counts), mission type, and planned flight path are recorded. The player knows the group was lost and can see the route it flew — they simply don't know what it encountered or what it saw. LOS from the mission is not delivered.

**Future:** turn-around rules — abort if X casualties, return to base if movement permits.

---

## Patrol

Standing order for units that can engage in close combat. A unit is eligible to patrol if and only if it meets **both** conditions:
1. Has a To-Hit stat (can attack at all)
2. Can fire at range 0 (fights in close combat — same hex)

Artillery fails condition 1: it has no To-Hit stat and no direct fire capability whatsoever. Units with no To-Hit stat (Artillery, Supply, Scout Plane, Transport Plane, Transport ship) fail condition 1.

Patrolling units intercept enemies that move through their patrol area. The unit stays in place; the patrol area defines how far out it will react.

**Patrol radius by unit type:**

| Unit type | Patrol radius |
|---|---|
| Foot (Infantry, AA Gun, AT Gun, Recon) | 1 — adjacent hexes only |
| Mechanized (Armor) | 2 |
| Naval (Destroyer, Frigate, Cruiser, Battleship, Carrier, Submarine) | 2 |
| Air (Fighter) | See formula below |

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

Patrol persists turn to turn until cancelled. A patrolling unit cannot also move that turn (it uses its movement to respond to contacts). Undetected units pass through without triggering intercept.

**Ground patrol:** one intercept per turn. When a detected enemy enters the patrol area, the patrolling unit moves into the hex the enemy tried to enter and close combat triggers there. After combat: if the patrol unit wins (enemy wiped), it stays in that hex and the patrol order is complete for this turn. If the enemy wins (patrol unit wiped), the enemy continues movement. If both survive, the enemy is pushed back to its prior hex; the patrol unit holds the intercepted hex.

**Naval patrol:** one intercept per turn. When a detected enemy ship enters the patrol area, the patrolling ship moves to intercept — it moves to the hex the enemy ship entered and triggers a hex collision there. After combat: if the patrol ship wins, it stays in that hex and the patrol order is complete for this turn. If the enemy wins, it continues movement from that hex. If both survive, the enemy is pushed back to its prior hex and the patrol ship holds the intercepted hex. LOS required to react; submarines require a detection roll before the patrol ship will respond.

**Submarine patrol:** Submarines use sonar instead of LOS to detect contacts. A patrolling submarine reacts to any ship it detects via sonar within its patrol radius (2 hexes). Detection roll required before intercept — if the contact isn't detected, it passes through. Intercept otherwise follows the same rules as naval patrol.

**Air patrol:** fighters intercept each detected enemy flight group that enters the patrol area — one combat per group, resolved sequentially in the order they enter. Casualties from each battle are applied before the next group is engaged (a group depleted early in Phase 1 may be too weak to handle a later contact). Sending a fighter sweep first to attrit the patrol, then following with bombers, is a valid tactic. Undetected stealth groups pass through without triggering intercept.

---

## Orders

| Order | Units | Description |
|---|---|---|
| **Move** | ground, naval | Queue movement. Multi-turn paths supported. |
| **Hold Position** | ground, naval | Default standing order. Unit stays put indefinitely and holds this hex until given new orders. No explicit action needed — units default to this state. |
| **Wait Turn** | ground, naval | Explicitly skip this turn. After the turn resolves, the unit returns to the orders panel (prompts for new orders next turn). |
| **Bombard** | Artillery, Battleship | Indirect fire at a specific hex at bombard range (Artillery: 1–8 hexes, 1 hex; Battleship: 1–8 hexes, 3-hex triangle). Artillery must be stationary. Artillery skips the Phase 3 ranged fire step; Battleship skips the Phase 2 naval ranged fire step. |
| **Patrol** | see Patrol section | Standing order. Unit intercepts detected enemies entering its patrol radius. Requires a To-Hit stat AND the ability to fight at range 0 (close combat). |
| **Hold Fire** | Recon, Submarine | Standing order. Unit will not initiate fire in the ranged fire step. Fires back if it receives incoming fire in that same step. Recon always fights in close combat regardless. Firing while undetected triggers a +2 bonus detection roll for the enemy — see Stealth Unit Firing. |
| **Flight Group (Bombing Run)** | Fighter, Bomber | Compose group, designate 3-hex line path, target infrastructure. |
| **Flight Group (Attack Run)** | Fighter, Bomber | Compose group, designate target hex, attack first detected unit. |
| **Flight Group (Scout)** | Scout Plane + optional Fighter escort | Fly path to gather LOS. Solo scout groups keep full stealth. LOS only reported if group returns home. |
| **Flight Group (Sweep)** | Fighter | Fly path to clear enemy patrol fighters. |
| **Fortify** | ground | Dig in. Completes at end of Phase 3 if not engaged in **close combat** (enemy in same hex). Ranged fire does NOT cancel it. +1 defense bonus next turn onward. Bonus lost when unit leaves hex. |
| **Repair** | naval (at Harbor), air (at Airbase) | Only available if unit is damaged AND at a repair facility. Uses 1 repair slot. Completes in 1 turn. |
| **Retreat** | ground (locked in combat) | Only available to units sharing a hex with an enemy. Unit moves to a designated adjacent non-enemy hex during the Phase 3 movement step. Skips close combat. Takes ranged fire from the enemy at range 1 during the ranged fire step. Cedes the hex to the enemy. Invalid if all adjacent hexes are enemy-occupied or impassable. |
| **Pursue if Retreat** | ground (locked in combat) | Conditional order. If the enemy retreats from this hex, attempt pursuit: roll 2d6 ≤ (5 + average pursuer Move − average retreater Move). Success → pursuing units move into the hex the retreating unit fled to (hex collision, combat continues). Failure → pursuing units hold the now-uncontested hex. Auto-fails if the retreat destination is terrain impassable to the pursuer. If the enemy does not retreat, this order is ignored and the unit fights normally. Averages use weighted unit count. |

---

## Combat Resolution

### Domain Separation

| Attacker | Can target | Phase |
|---|---|---|
| foot / mechanized | ground only | 3 |
| naval (surface) | naval (surface) only | 2 |
| submarine | naval (surface) only | 2 |
| air fighter | air (intercept) | 1 |
| air bomber (Attack Run vs naval) | naval surface | 2 |
| air bomber (Bombing Run or Attack Run vs ground) | ground + naval surface | 3 |
| air bomber (Bombing Run spanning water + land) | naval surface (Phase 2) + ground (Phase 3) | 2 and 3 |
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

When a unit moves into a hex occupied by an enemy, both sides stop and fight.

### Locked Combat and Retreat

Units sharing a hex with an enemy at the start of the ordering phase are **locked in combat**. They may only be given a **Retreat** or **Pursue if Retreat** order — all other orders are unavailable until the hex is uncontested.

**Retreat:** the unit moves to a designated adjacent non-enemy hex during the Phase 3 movement step. It skips close combat but takes ranged fire from the enemy at range 1 during the ranged fire step and may fire back. The original hex is ceded.

**Pursue if Retreat:** conditional — activates only if the enemy actually retreats that turn. Roll 2d6 ≤ (5 + average pursuer Move − average retreater Move). On success the pursuing units follow into the retreat destination hex (hex collision — combat continues there). On failure they hold the now-empty hex. Auto-fails if the retreat destination is impassable to the pursuer. If the enemy holds, this order is ignored and the unit fights close combat normally.

| Matchup | Score | Odds |
|---|---|---|
| Armor (4) pursuing Infantry (2) | 5 + 2 = 7 | 58% |
| Mixed avg 3 pursuing Infantry (2) | 5 + 1 = 6 | 42% |
| Equal speed | 5 + 0 = 5 | 28% |
| Infantry (2) pursuing Armor (4) | 5 − 2 = 3 | 8% |

**Critical pursuit rolls:** Natural 2 (both dice show 1) = pursuit always succeeds regardless of speed disadvantage. Natural 12 (both dice show 6) = pursuit always fails regardless of speed advantage.

**Mutual retreat:** if both sides issue Retreat orders simultaneously, both move out in the same step — the hex ends up empty, no combat resolves.

**Surrounded:** a unit with no valid adjacent retreat hex cannot issue a Retreat order. It must fight.

### Naval Unit HP

Naval units (Destroyer, Frigate, Cruiser, Battleship, Transport, Carrier, Submarine) use **hit points** instead of quantity stacks. They are individual vessels, fewer in number but able to absorb damage before sinking.

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
| Overwatch Skies (Phase 1) | Detected enemy air within range 2 | 7 | 0 | 2 |

Overwatch is a **passive standing behavior** — no order required. Any detected enemy flight group passing within range triggers AA fire automatically. **AA fires once per flight group** — each group that enters the overwatch zone is engaged separately. This prevents players from using a sacrificial plane group to exhaust AA defenses before sending the main strike.

**Hit distribution within flight groups:** When AA scores hits on a flight group, hits are assigned proportionally by unit type count. A group of 5 bombers and 10 fighters receiving 3 hits: 1 bomber hit (5/15) + 2 fighter hits (10/15). Largest-remainder rounding.

### Naval AA — Overwatch Skies

Frigates and Battleships can fire at detected aircraft entering their overwatch zone. Same passive behavior as land AA — no order required, fires at every detected flight group.

| Unit | Mode | To-Hit | Pen | Range | Notes |
|---|---|---|---|---|---|
| Frigate | Overwatch Skies (Phase 1) | 7 | 1 | 3 | Primary AA role — wide coverage |
| Battleship | Overwatch Skies (Phase 1) | 6 | 0 | 1 | Point defense only — adjacent hexes |

The Frigate is the dedicated naval AA platform — wide range (3 vs 2) and good To-Hit despite zero pen. The Battleship's Overwatch Skies is incidental point defense only.

Frigate detection stat = 5 (specialized radar). Stealth flight groups require a detection roll before the Frigate can fire at them.

### Terrain in Combat

**`combat_modifier`** — bonus added to a unit's Attack stat when fighting FROM that hex. High ground makes you a better attacker (roll ≤ Attack + CM to hit).

**Defense bonuses** — added to effective defense in the save formula.

| Source | Bonus | Applies to | Condition |
|---|---|---|---|
| Higher elevation than attacker | +1 | Ground vs ground only | Defender didn't move; attacker is on lower terrain |
| `has_light_vegetation` | +1 | All attacks including bombardment | Defender didn't move this turn |
| `has_heavy_vegetation` | +2 | All attacks including bombardment | Defender didn't move this turn |
| Fortified (unit order) | +1 | All attacks including bombardment | Unit completed Fortify in this hex and has not moved |
| Fortification (building) | +1 | All attacks including bombardment | Fortification present in hex with HP > 0; applies to all friendly ground units in hex |

**Elevation check for defense bonus:** Hills defender gets +1 only if attacker is on Plains/Desert/Wetlands/Water. Mountains defender gets +1 only if attacker is not also on Mountains. Elevation bonus does **not** apply against air attacks or bombardment. Vegetation and fortification bonuses **do** apply against bombardment. Units that moved receive no defense bonuses.

### Fortify

Any ground unit can be given the Fortify order. The unit does not move that turn — it digs in, builds cover, and establishes a defensive position.

**Completion:** Fortify completes at the end of Phase 3 if the unit was not engaged in combat that phase. The +1 defense bonus takes effect at the start of the following turn.

**Cancellation:** Fortification is cancelled only if an enemy enters the unit's hex (close combat triggers) before the end of Phase 3 — the unit fights normally with no bonus from this turn's fortify attempt. Being hit by ranged fire (enemy outside the hex) does **not** cancel fortification; the unit absorbs the fire and continues digging in. It can try again next turn if cancelled.

**Persistence:** Once fortified, the +1 defense bonus persists indefinitely as long as the unit remains in that hex. It applies against all attacks: direct combat, bombardment, and air strikes.

**Lost on movement:** The moment a fortified unit leaves its hex, the fortification bonus is gone. The physical works are abandoned. Returning to the same hex does not restore it — the unit must Fortify again.

**Stacking:** The unit Fortify bonus stacks with terrain bonuses and the Fortification building bonus. A fortified infantry in heavy vegetation inside a built Fortification gets +2 (veg) +1 (unit fortify) +1 (building) = +4 effective defense bonus.

**Fortification building vs unit Fortify order:** These are separate and cumulative. The building is a permanent hex feature benefiting all friendly units there. The unit order is personal and lost when the unit moves. Both can apply simultaneously.

`units.fortification_level` — integer, 0 = not fortified, 1 = fortified. Reset to 0 when unit moves.

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

If `(Defense + defense_bonus − Penetration) < 2` → impossible to save (the minimum 2d6 roll of 2 can never succeed; all hits deal casualties).

**Critical roll rules (override all stat calculations):**
- **Natural 12 on an attack roll** (both dice show 6) → always a miss, even if To-Hit + combat_modifier ≥ 12.
- **Natural 2 on a defense roll** (both dice show 1) → always a save, even if (Defense + defense_bonus − Penetration) < 2.

These ensure every die roll carries a small chance of the unexpected outcome. No combination of stats or bonuses makes a hit certain or a save impossible.

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

Shot distribution uses **inverse-distance weighting**: each enemy stack's weight = `unit_count / distance`. Shots are distributed proportionally to weight, with largest-remainder rounding so totals are exact.

```
weight(stack)     = unit_count / distance
shots_at_stack    = total_shots × (weight(stack) / sum_of_all_weights)
```

**Close combat (same hex, distance = 0):** all enemies are equidistant. Use pure proportional-by-count: `weight = unit_count`. This is the same formula with distance = 1 for all (distance cancels out).

**Ranged fire step (enemies at different distances):** closer stacks receive more shots per unit. At range 1 vs range 2, each unit in the nearer stack is worth 2× the shots of a unit in the farther stack. At equal range, reduces to pure proportional-by-count.

**Naval HP units:** each ship counts as `unit_count = 1` regardless of current HP. Three destroyers and one battleship = weights 1/d, 1/d, 1/d, 1/d respectively.

Example — 10 artillery (Atk Range 2) vs 4 infantry at range 1 and 6 armor at range 2:
- weight(infantry) = 4/1 = 4.0
- weight(armor)    = 6/2 = 3.0
- total weight = 7.0
- shots at infantry: 10 × 4/7 = 5.7 → **6**
- shots at armor:    10 × 3/7 = 4.3 → **4**

Even though armor is the larger stack, the infantry's closer range makes them the priority target.

### Unit Combat Stats

**To-Hit** = roll 2d6 ≤ this value to score a hit. Higher = more accurate. Modified by terrain combat_modifier when fighting from elevated ground.

Manpower cost = `floor(mat_cost / 2)`. All costs are placeholder values — balance tuning deferred until after test games.

Ground:

| Unit | To-Hit | Defense | Pen | Move | LOS | Atk Range | Mat | Man | Slots |
|---|---|---|---|---|---|---|---|---|---|
| Infantry | 6 | 6 | 0 | 2 | 3 | 1 | 1 | 0 | 1 |
| Armor | 7 | 8 | 2 | 4 | 3 | 2 | 4 | 2 | 2 |
| Artillery | — | 5 | 1 | 2 | 3 | — | 2 | 1 | 1 |
| AT Gun | 7 | 6 | 2 | 2 | 3 | 2 | 2 | 1 | 1 |
| AA Gun | 5 | 5 | 1 | 2 | 3 | 1 | 2 | 1 | 1 |
| Supply | — | 3 | 0 | 4 | 3 | — | 2 | 1 | 1 |
| Recon | 7 | 6 | 0 | 3 | 4 | 2 | 2 | 1 | 1 |

**Atk Range** = direct fire range used in the ranged fire step and close combat. Artillery has no Atk Range (—) — it has no direct fire capability and only operates via the Bombard order (indirect fire, range 8, 1 hex target — see Bombardment section). Units on a Bombard order skip the Phase 3 ranged fire step.

**Recon special rules:**
- **Stealth:** stealth 3, detection 3. See Stealth by Unit Type table. Defense is stealth — Recon units survive by not being found, not by absorbing hits.
- **Vegetation immunity:** ignores the `has_heavy_vegetation` movement penalty. Moves through heavy vegetation at base terrain cost.
- **Hold Fire:** standing order. Recon skips the Phase 3 ranged fire step and will not initiate fire. If the Recon unit receives incoming fire in the ranged fire step (detected and targeted by an enemy), it fires back in that same simultaneous volley. Always fights normally in close combat.
- **Sabotage:** takes the Recon unit's entire turn (no movement). Targets a hex **adjacent** to the Recon unit's hex. Effects: roads/canals set to false (destroyed); buildings, urban tiles, bridges lose 2 HP (no defense roll). Not reported to the enemy unless an enemy unit has LOS to the target hex at the moment of sabotage — if unseen, the owning player sees the infrastructure damage but not its cause or origin.

Air:

| Unit | To-Hit | Defense | Pen | HP | Move | LOS | Atk Range | Mat | Man | Slots |
|---|---|---|---|---|---|---|---|---|---|---|
| Fighter | 7 | 7 | 0 | — | 30 | 5 | 1 | 4 | 2 | 2 |
| Scout Plane | — | 6 | 0 | — | 35 | 6 | — | 3 | 1 | 2 |
| Bomber | 5 | 6 | 0 | 3 | 40 | 5 | 1 | 5 | 2 | 3 |
| Transport Plane | — | 3 | 0 | — | 25 | 3 | — | 3 | 1 | 2 |

These are standard air-to-air stats used in intercept combat. Bombers are poor dogfighters (To-Hit 5 = 28%). **Bombing Run and Attack Run are flight group special abilities** with their own stats — see Flight Groups and Bombardment sections.

**Bomber HP** — bombers use a shared HP pool rather than quantity stacks. A group of 5 bombers has 15 HP. Every 3 HP lost removes 1 aircraft from the count (`quantity = ceil(current_hp / 3)`). Partial HP within a 3-HP band does not reduce count — the aircraft is damaged but still flying. In intercept, each aircraft fires 1 die at To-Hit 5, Pen 0; dice count = `ceil(current_hp / 3)`. Repaired at Airbase.

**Artillery in direct combat** — artillery has no direct fire capability. It cannot participate in the ranged fire step and has no attack dice in close combat. It takes casualties normally. If artillery is the only friendly unit in a hex when combat resolves, it is automatically destroyed with no return fire.

Naval (HP-based; attack dice per ship):

| Unit | Atk dice | To-Hit | Defense | Pen | HP | Move | LOS | Atk Range | Mat | Man | Slots |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Destroyer | 1 | 6 | 6 | 1 | 6 | 5 | 4 | 1 | 3 | 1 | 2 |
| Frigate | 1 | 6 | 7 | 0 | 7 | 4 | 5 | 1 | 4 | 2 | 2 |
| Cruiser | 2 | 7 | 7 | 1 | 8 | 3 | 4 | 2 | 4 | 2 | 2 |
| Battleship | 3 | 7 | 9 | 2 | 12 | 4 | 4 | 3 | 6 | 3 | 3 |
| Transport (ship) | 0 | — | 4 | 0 | 5 | 4 | 4 | — | 2 | 1 | 1 |
| Carrier | 1 | 6 | 6 | 0 | 10 | 3 | 5 | 1 | 5 | 2 | 3 |
| Submarine | 2 | 6 | 7 | 2 | 6 | 4 | 0 | 1 | 4 | 2 | 2 |

**Frigate** — anti-air specialist. Mediocre surface combatant (To-Hit 6 = 42% vs ships); purpose is AA overwatch at sea. High LOS and detection for spotting incoming aircraft.

All stats are placeholder values — balance tuning deferred until after test games.

### Air Intercept Combat

Intercept is one combined simultaneous battle. All units on both sides roll at the same time — there is no sequential escort-first-then-bombers sequence. Proportional fire applies: each unit type on one side distributes shots across all unit types on the opposing side by count.

| Unit in intercept | To-Hit | Pen | Notes |
|---|---|---|---|
| Fighter | 7 | 0 | |
| Bomber | 5 | 0 | HP-based; fires ceil(current_hp/3) dice |

Each die is earmarked for a target unit type (via proportional fire calculation) before the attack roll is made, then the defense roll is made against that unit type's defense stat.

### Movement and Combat Interaction

**Crossing detection (ground and naval):** When two units move through each other simultaneously (A → B's origin, B → A's origin), a border battle occurs. Neither unit is in a hex — combat happens at the border between the two hexes. Both sides fire simultaneously. If both survive: each returns to their starting hex and movement ends. If one side is wiped: the winner continues their planned movement from the border forward.

**Movement into enemy hex:** When a unit steps into a hex containing enemies, both sides stop and fight. If the attacker wipes out all defenders, it occupies that hex and may continue its remaining movement. If defenders survive (or both sides take losses), the attacker's movement ends in that hex.

**Multi-faction combat:** When three or more factions occupy or contest the same hex, each faction attacks all factions it is `at_war` with. Allied factions pool into a shared defender/attacker group against common enemies. Neutral factions do not fire but still receive fire from factions at war with them.

**Bombardment is indiscriminate:** Unit-targeting rolls during bombardment (from artillery, battleships, or bombers) apply to ALL units in the hex — friendly, enemy, and allied. Players take responsibility for bombing hexes with mixed or friendly occupancy.

Units that moved do NOT receive `defense_bonus`.

---

## Bombardment

Bombardment is indirect fire — the target does not fire back. Resolves in Phase 3 (for Artillery and Battleship bombard targeting any hex; for Bombing Run/Attack Run vs land hexes) or Phase 2 (for Bombing Run/Attack Run vs naval/water hexes). Battleship bombard can target any hex — land or water — and always resolves in Phase 3 regardless. Ships that moved away or were sunk in Phase 2 are no longer present when the Phase 3 bombard resolves; if the targeted water hex is empty, the bombardment is wasted.

### Rules Common to All Bombardment

**Two rolls per targeted hex:**
1. **vs Units** — one 2d6 roll per bombarder. Each roll ≤ bombarder's To-Hit → 1 hit. Each hit: select a unit to receive it **proportional to unit count** (a hex with 10 infantry and 2 armor has a 10/12 chance of hitting infantry). That unit makes a normal defense save. Failed save = 1 casualty or 1 HP damage as normal.
2. **vs Infrastructure** — one 2d6 roll per bombarder (rolled simultaneously with the unit roll). Each roll ≤ To-Hit → 1 infrastructure hit. Roads and canals are **immune to bombardment** — exclude them from the selection pool. Per hit: randomly select one eligible infrastructure piece present (buildings, bridge, urban tile, vegetation).
   - **HP-based infrastructure** (Factory, Airbase, Harbor, Airstrip, Bridge, Fortification, urban tile): loses 1 HP. No defense roll for structures.
   - **Heavy vegetation** (`has_heavy_vegetation`): roll 1d6 — 4+ → hex becomes `has_light_vegetation` (thinned). On 1–3: no change.
   - **Light vegetation** (`has_light_vegetation`): roll 1d6 — 4+ → vegetation cleared entirely (tag removed). On 1–3: no change.

Multiple bombarders targeting the **same hex** pool their rolls as a single simultaneous attack — hits are totalled before any are applied.

Empty hex (no units, no infrastructure) → wasted bombardment, no report.

Blind fire (no friendly LOS to target) → bombardment resolves normally but player receives no combat report.

### Per-Unit Patterns and Rules

**Artillery**
- Must be stationary to bombard (cannot move and fire same turn)
- Cannot bombard if enemy units are present in the artillery's own hex (engaged in close combat — check before executing bombard orders)
- Target pattern: **1 hex** at range 1–8 (minimum range 1; cannot fire into own hex)
- **Elevation bonus:** `effective_bombard_range = 8 + max(0, firer_elevation − target_elevation)`. Artillery on Hills fires up to 9 hexes; on Mountains, up to 10 hexes. Terrain between firer and target does not block the shot arc (high-arc indirect fire).
- Rolls: 1 die vs units + 1 die vs infra (To-Hit 6, Pen 1)
- Infrastructure selection: random among present pieces
- No return fire from target; artillery has no direct fire capability and is completely helpless in close combat — destroyed automatically if enemies occupy its hex

**Battleship** — special **Bombard** ability (indirect fire, range 8, 3-hex triangle). Normal Atk Range 3 applies to surface combat and the Phase 2 naval ranged fire step.
- Directed bombardment: up to **8 hexes**. Can target **any hex** — land or water. Used to hit predicted enemy ship positions as well as shore targets. Resolves in Phase 3; ships that moved or sank in Phase 2 won't be there. May move and bombard in the same turn; cancelled only if an enemy ship engages it in close combat (hex collision or path crossing) during Phase 2 (see Phase 2 step 7). Taking fire from enemies during the Phase 2 ranged fire step does not cancel the bombard — the Battleship skips that step when it has a Bombard order, but being targeted by other ships' ranged fire does not void the order.
- Target pattern: **3 mutually adjacent hexes (triangle)** all within range; player picks which triangle.
- Rolls: 3 dice per hex vs units + 3 dice per hex vs infra (To-Hit 6, Pen 2)
- Infrastructure selection: random among present pieces

**Bombers**
- Bombing resolves in Phase 2 (for naval hex targets) or Phase 3 (for land hex targets); see Phase 1 step 4 for routing
- Target pattern: **3 hexes in a line** along the bomb run path
- Rolls: **1 die per bomber per hex** vs units + **1 die per bomber per hex** vs infra (To-Hit 7, Pen 1). Each bomber drops on every hex in the line.
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
| Flight group destroyed | Group composition + mission type + flight path logged as "never returned" | No enemy intel; no LOS delivered |

**Partial intel (in battle, no external LOS):** When your units fought but you had no observer in LOS range, you know your own losses exactly. For each **individual enemy unit** (each unit of quantity, not each unit type), roll independently: **2/3 chance (67%)** that unit appears in your battle report. Units that fail the roll are not reported. Example: enemy has 10 infantry remaining — expect ~6–7 to appear in the report; the other 3–4 are "undetected." You know a battle occurred and what you lost, but your count of the enemy force is imprecise.

---

## Resources

### Materials
Produced by specific resource tiles placed by the GM on the map. Each tile produces **1 material per turn** when owned (tunable later). Tile types: mines, lumbermills, quarries, farms, ports, etc. Materials **accumulate between turns** (saveable).

### Manpower
**Not saveable.** Generated each turn, must be spent that turn or lost.

Manpower per turn = sum over all **controlled** settlements of their assigned urban tile count (see Settlement Control). Contested settlements produce zero manpower for anyone.

- Small town (4 assigned urban tiles, controlled) → 4 manpower/turn
- Large city (10 assigned urban tiles, controlled) → 10 manpower/turn
- Contested city (any size) → 0 manpower/turn

Controlling the urban sprawl around a settlement — not just the settlement hex itself — is what generates manpower. Expensive constructions (Factory = 20 manpower) require large cities or multiple cities active in the same turn.

Manpower not spent during the ordering phase is wasted.

---

## Production

**Production panel** — shown at the **start of each turn**, before orders are set:
1. **Place completed units** — units whose production was queued last turn are ready. Player chooses a valid spawn location (see Spawn Rules below).
2. **Queue new production** — player selects unit types to produce this turn. Materials are deducted immediately from stockpile. Manpower is deducted from the budget carried forward from the previous turn's Phase 4.

**Production time:** always 1 turn. Pay resources at start of turn N → unit available to place at start of turn N+1.

**Spawn rules:**
- Ground units: spawn at the Factory hex or any adjacent hex (within 1 hex of Factory).
- Air units: spawn at any Airbase, Airstrip, or Carrier within 5 hexes of the producing Factory.
- Naval units: spawn at any Harbor within 5 hexes of the producing Factory.

**Resource payment:** Materials deducted from stockpile immediately. Manpower deducted from this turn's manpower budget (collected last Phase 4). You can only queue what your current budget allows — no shortfall risk since you spend known resources.

`production_queue`: game_id, faction_id, unit_type_id, quantity, turn_queued, status (`pending` → `ready` → `placed`).

**If a facility is captured in Phase 3:** all units in its production queue that have not yet been placed are lost. Defenders are assumed to destroy them before ceding the facility. No refund.

**Production capacity:**
- All units produced at Factory. Production slots per turn = `floor(current_hp / 2)`. Full Factory (20 HP) = 10 slots. Damaged to 10 HP = 5 slots. Destroyed = 0.
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
- Air unit capacity: **4 slots**. Can carry Fighters and Scout Planes (1 slot each). Cannot carry Bombers.
- Each unit type has a `carrier_slots` value (Fighter = 1, Scout Plane = 1, Bomber = N/A). Carrier capacity is stored per unit type in unit_type_config.
- Fighters launched from Carrier use it as their home airstrip/airbase for landing purposes.
- Air units spawn at any Airbase, Airstrip, or Carrier within 5 hexes of the producing Factory (see Spawn Rules in Production section).

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
- Units with `standing_order = hold_position` or `patrol` never appear
- Bombers without a flight group assignment appear

---

## Pending Dev Work (next sessions)

- **Player bridge build order not resolving** — the "Build Bridge" UI exists in the supply truck order panel (2-step water/land hex selection, confirmed working). The build order is submitted correctly to the server. However, `processBuildOrders` in `server/src/utils/phase4.js` handles `structure_type='bridge'` by creating the bridge building but does NOT set `has_road=true` on all 3 hexes or `has_bridge=true` on the water hex. Need to add that logic: truck hex (`unit.hex_q/r`) + water hex (`target_hex_q/r`) + far land hex (`to_hex_q/r`) all get `has_road=true`; water hex also gets `has_bridge=true`. GM bridge placement works correctly as a reference.

- **Naval unit LOS** — naval units have `los` values set in the seed (Destroyer=4, Frigate=5, Cruiser=4, Battleship=4, Carrier=5, Submarine=0) but this has not been tested in practice. Verify that ships are correctly contributing to faction fog-of-war. Submarine `los=0` is intentional (underwater). Consider whether naval LOS should be blocked by land terrain (hills/mountains on land hexes should presumably not block a ship's view of the sea, but a coastal mountain range could block line-of-sight to a harbor).

- **Urban terrain should block LOS** — `has_urban` hexes currently do NOT block LOS. They should behave like vegetation: block LOS into and through urban tiles (dense city blocks = visual obstruction). Implementation: add `h.has_urban` to the `blockingSet` filter in `server/src/utils/visibility.js` alongside `has_light_vegetation` and `has_heavy_vegetation`. Unlike vegetation, urban LOS blocking is not tiered — all urban is treated as fully blocking.

- **Hills/Mountains LOS — elevation-aware check needed** — current state: Mountains have `blocks_los=TRUE` (always blocks, even mountain-to-mountain). Hills have `blocks_los=FALSE` (never blocks). This is wrong. Correct behavior: a hex at lower elevation cannot see OVER a higher-elevation hex, but a hex at equal or greater elevation can. Requires elevation-aware LOS in `isBlocked()` in `visibility.js`: instead of binary blocked/not-blocked, compare the observer's elevation, target's elevation, and each intermediate hex's elevation. A hill (elevation=1) blocks LOS from plains (elevation=0) but not from another hill or mountain. A mountain (elevation=2) blocks from plains and hills but not from another mountain. Units on high ground see farther and over lower terrain — this is the core of the elevation combat advantage.

---

## Design Notes — Air Phase Rework (not yet implemented)

Ideas to consider when Phase 1 air is being built. **Do not implement until air phase work begins.**

**Step-based AA and intercept:**
- Aircraft move hex-by-hex. Casualties assessed at each movement step, not in one lump at the end.
- AA fires at airgroups for each step they take through hexes the AA covers (currently fires once per turn). Slightly nerf AA to-hit or dice count to compensate for firing multiple times.
- If multiple airgroups enter AA range in one step, AA picks one target per step. AA prefers groups NOT already engaged with friendly interceptors.
- Option/toggle: allow AA to fire anyway even if friendly planes are engaged with enemy air in the same hex step (friendly fire risk vs suppression value).
- Fighter patrols still engage only ONCE per turn total (not once per step). Patrol picks one enemy airgroup to fight; if multiple groups pass through its airspace it selects the first unengaged one.
- This collapses the current two-sub-phases (AA overwatch → patrol intercept) into a single step-resolution loop: each step → AA fires at any groups in range → patrol intercept triggered if applicable.
- Could reduce overall casualty scale in air combat to keep attrition from feeling too punishing across many steps.

---

## Future Features

- **Railroads** — `has_railroad` hex attribute. Very fast ground unit movement. Expensive to build. Supply unit + large material/manpower cost.
- **Flight group turn-around rules** — abort at X casualties if movement permits
- **Patrol range** — finalize 1 or 2 hexes after balance testing
- **Emergency landing** — air units with no valid airstrip crash; rules for forced landing at non-airstrip hexes
- **Supply lines** — full radius + Supply unit implementation
- **Allied vision sharing** — wire up `allied_vision` table
- **Victory condition tuning** — per player count, alternative win types
- **Skirmish orders** — Hold and Retreat sub-modes
- **Subterranean, hover, orbital, space** locomotion tags
- **Map visual clarity** — terrain types, buildings, roads, bridges, settlements, units in LOS must all be immediately readable at a glance. Drive hex rendering with distinct colors, icons, and overlays per attribute.
