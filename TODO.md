# Wargame — Todo / Design Notes

Items to revisit before or during implementation. Add notes here during sessions.

---

## Implementation (priority order)

- [ ] Migration 007 — massive schema overhaul (main blocker for everything else)
- [ ] `server/src/utils/combat.js` — roll-under formula, proportional fire, stealth detection
- [ ] `server/src/utils/movement.js` — ×3 scale validation, crossing/border battle logic
- [ ] Rewrite `advance-turn` with full 4-phase pipeline
- [ ] `finish-turn` + `turn-status` endpoints
- [ ] Production queue endpoint
- [ ] Client: movement order UI (click unit → click destination → SVG arrows)
- [ ] Client: left panel (unit order list + facility list)
- [ ] Client: Finish Turn button (player portal)
- [ ] Client: GM turn status panel
- [ ] Win condition check (end of Phase 4)

---

## Design — Needs Decision

### LOS & Attack Range Review
Current ground LOS is 3 for all units, atk range 1–2. At ~6 miles/hex these may be too generous
(realistic) or about right (fun). **Do not change without playtesting first** — short LOS removes
scouting/positioning decisions that make the game interesting.

Specific items to think through:
- Ground unit LOS: all currently 3. Infantry/Armor/Artillery may feel too far; Recon is fine.
- Ground Atk Range: Armor currently 2 — consider 1. AT Gun at 2 seems right (specialist).
- Naval Atk Range: Destroyer/Frigate currently 1 — may want 2 at this scale.
- LOS over water: ground units should see farther when looking across water (coast/river). Possible rule: water hexes don't consume LOS range, cap at LOS×2.
- Air detection of ground units: planes should be bad at spotting concealed units. Consider domain penalty (−3 detection_score when air detects ground) so cover is very effective vs air.

**Hold until after first test game** — see how it feels before tuning.
