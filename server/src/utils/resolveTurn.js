// Shared turn resolution pipeline — called by both GM advance-turn and player finish-turn.
// Phase 1 (Air) and Phase 2 (Naval) are stubs.
// Phase 3 executes ground movement (+ combat once combat.js is wired in).
// Phase 4 collects resources, places production, calculates manpower, checks win.

import { executeRetreatsAndPursuit } from './retreat.js';
import { executeGroundMoves } from './movement.js';
import { processEndOfPhase3 } from './ordersPhase.js';
import { executeRangedFireStep } from './rangedFire.js';
import { executeGroundCombat } from './combat.js';
import { runPhase4 } from './phase4.js';
import { computeVisibility, markScouted, computeDetectionEvents } from './visibility.js';
import { executePhase1 } from './airPhase.js';
import { executePhase2 } from './navalPhase.js';
import { captureObjectives } from './captureObjectives.js';

export async function resolveTurn(db, gameId) {
  const { data: game } = await db.from('games').select('current_turn').eq('id', gameId).single();
  const currentTurn = game?.current_turn ?? 0;
  const nextTurn = currentTurn + 1;

  // Phase 1: Air — AA overwatch + patrol intercepts; returns surviving bombers for Phase 2/3
  const phase1Result = await executePhase1(db, gameId, currentTurn);
  const { survivingBombers = [] } = phase1Result;

  // Phase 2: Naval — step movement, contact, ranged fire, bomber strikes on water hexes
  const phase2Result = await executePhase2(db, gameId, currentTurn, survivingBombers);

  // Phase 3: Retreats first (locked units escape before movers arrive)
  const retreatResult = await executeRetreatsAndPursuit(db, gameId, currentTurn);

  // Phase 3: Regular ground movement
  const moveResult = await executeGroundMoves(db, gameId, currentTurn);

  // Phase 3: Fortify order processing (must know which units moved)
  const ordersResult = await processEndOfPhase3(db, gameId, currentTurn, moveResult.movedUnitIds);

  // Phase 3: Ranged fire step — bombard orders + automatic direct fire (before close combat)
  const rangedResult = await executeRangedFireStep(db, gameId, currentTurn, moveResult.movedUnitIds);

  // Phase 3: Close combat — same-hex battles
  const combatResult = await executeGroundCombat(db, gameId, currentTurn);

  // Phase 3: Auto-capture objective hexes (settlements, urban, buildings, resources)
  // when exactly one faction's units occupy them post-combat.
  const captureResult = await captureObjectives(db, gameId);

  // Phase 4 (repair/build orders must be read before we delete movement_orders)
  const phase4Result = await runPhase4(db, gameId, currentTurn);

  // Clear orders now that Phase 4 has consumed them
  await db.from('movement_orders').delete().eq('game_id', gameId).eq('turn', currentTurn);

  // Advance turn counter
  const { data: updated } = await db
    .from('games')
    .update({ current_turn: nextTurn })
    .eq('id', gameId)
    .select()
    .single();

  // Update scouted_hexes + run detection rolls for all factions.
  const { data: factions } = await db.from('factions').select('id').eq('game_id', gameId);
  for (const f of factions ?? []) {
    const { visible } = await computeVisibility(db, f.id, gameId);
    await markScouted(db, f.id, gameId, visible, nextTurn);
  }
  await computeDetectionEvents(db, gameId, currentTurn);

  return {
    game: updated,
    phase1: {
      aa_engagements: phase1Result.aaLog?.length ?? 0,
      intercepts: phase1Result.interceptLog?.length ?? 0,
      surviving_bombers: survivingBombers.length,
      errors: phase1Result.errors ?? [],
    },
    phase2: {
      engagements: phase2Result.engagements?.length ?? 0,
      bomber_strikes: phase2Result.bomberStrikes?.length ?? 0,
      errors: phase2Result.errors ?? [],
    },
    phase3: {
      retreats: retreatResult.retreatCount,
      pursuits: retreatResult.pursuitCount,
      moved: moveResult.moved,
      skipped: moveResult.skipped,
      fortified: ordersResult.fortified,
      ranged_casualties: rangedResult.totalCasualties,
      infra_damage: rangedResult.infraDamage,
      hexes_fought: combatResult.hexesFought,
      total_casualties: combatResult.totalCasualties,
      captures: captureResult.captures?.length ?? 0,
      errors: [
        ...(retreatResult.errors ?? []),
        ...(moveResult.errors ?? []),
        ...(rangedResult.errors ?? []),
        ...(combatResult.errors ?? []),
        ...(captureResult.errors ?? []),
      ],
    },
    phase4: phase4Result,
  };
}
