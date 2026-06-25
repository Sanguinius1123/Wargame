# Wargame — Design Document

Setting-agnostic hex-based operational wargame. Planet-scale map, ground + naval warfare, fog of war, async multiplayer via web portal.

## Core Loop

1. **Move** — issue movement orders to units (up to movement range per turn)
2. **Combat** — units in adjacent hostile hexes fight; attacker wins hex if defender is eliminated
3. **Produce** — controlled urban/developed hexes generate Production + Manpower; spend to recruit units

## Map

Hex grid, pointy-top axial coordinates (hex_q, hex_r). Planet-scale = hundreds to thousands of hexes per game.

### Terrain Types

| Terrain | Move Cost | Defense Bonus | Blocks LOS | Production | Manpower |
|---|---|---|---|---|---|
| Plains | 1 | 0 | No | 1 | 1 |
| Forest | 2 | +1 | Yes | 0 | 0 |
| Mountains | 3 | +2 | Yes | 0 | 0 |
| Coast | 1 | 0 | No | 1 | 1 |
| Sea | 1* | 0 | No | 0 | 0 |
| Urban | 1 | +1 | No | 3 | 2 |
| River | 2† | 0 | No | 0 | 0 |

*Sea: naval units only. Ground units cannot enter.
†River: +1 movement cost when crossing (entering from non-river hex).

Development level (0–3) multiplies Production and Manpower output.

### Hex Ownership

A hex is owned by whichever faction has units in it (or last captured it). Unowned hexes are neutral. Owning a hex at end of turn collects its resources.

## Units

### Ground

| Type | Attack | Defense | Move | LOS | Prod Cost | Man Cost | Notes |
|---|---|---|---|---|---|---|---|
| Infantry | 2 | 2 | 2 | 2 | 1 | 2 | Core unit |
| Armor | 4 | 2 | 4 | 3 | 3 | 1 | Fast, strong attacker |
| Artillery | 5 | 1 | 2 | 2 | 4 | 1 | Range 2 (can fire 2 hexes) |
| Supply | 0 | 0 | 3 | 2 | 2 | 1 | Future: enables supply lines |

### Naval

| Type | Attack | Defense | Move | LOS | Prod Cost | Man Cost | Notes |
|---|---|---|---|---|---|---|---|
| Destroyer | 3 | 2 | 5 | 4 | 3 | 1 | Fast naval combatant |
| Battleship | 6 | 4 | 3 | 4 | 6 | 2 | Heavy hitter |
| Transport | 0 | 1 | 4 | 3 | 2 | 1 | Carries ground units across sea |

### Air (STUB — not implemented)

| Type | Attack | Defense | Move | LOS | Prod Cost | Man Cost |
|---|---|---|---|---|---|---|
| Fighter | 3 | 2 | 8 | 6 | 4 | 1 |
| Bomber | 6 | 1 | 7 | 4 | 5 | 1 |

## Combat Resolution

Each combat is attacker vs defender, resolved at the end of movement phase.

**Formula:**
- Attacker strength = unit.attack × quantity
- Defender strength = (unit.defense + terrain.defense_bonus) × quantity
- Roll: `attacker_strength + d6` vs `defender_strength + d6`
- Winner takes the hex; loser loses 1 quantity (or is eliminated if quantity = 1)
- Ties = defender holds

Artillery can attack hexes at range 2 without entering them. Range attacks do not capture the hex — they just deal damage.

Values are tunable via the `unit_type_config` table.

## Fog of War

Three visibility states per hex per faction:
- **Visible** — hex currently in LOS of one of the faction's units
- **Scouted** — hex was previously seen, not currently visible (terrain shown, no unit info)
- **Dark** — never seen

LOS is blocked by Forest and Mountains. Each unit type has a `los_range` (in hexes).

Allied vision sharing: stubbed. Interface exists (`allied_vision` table), sharing is not wired — by design, allies must communicate to share information.

## Turn Structure

1. **Orders phase** — players submit movement orders and recruitment orders
2. **Resolve** — all moves execute simultaneously, combat resolves for contested hexes
3. **Production** — resources collected, recruits placed at controlled urban hexes

## Resources

- **Production** — industrial output. Spent to build units and structures.
- **Manpower** — population output. Required alongside Production to recruit units.

Both are collected per turn from controlled hexes based on terrain type × development level.

## GM Portal

Full map visibility. Can edit any hex, unit, or faction value directly. Can pause/advance turns. Optional — game runs without active GM.

## Future / Out of Scope for Now

- Supply lines and attrition
- Air warfare
- Allied vision sharing
- Structures and fortifications
- Naval transport mechanics (loading/unloading)
- Victory conditions (beyond "eliminate all enemies")
