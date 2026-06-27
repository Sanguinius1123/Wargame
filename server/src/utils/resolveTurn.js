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
import { computeVisibility, markScouted } from './visibility.js';

export async function resolveTurn(db, gameId) {
  const { data: game } = await db.from('games').select('current_turn').eq('id', gameId).single();
  const currentTurn = game?.current_turn ?? 0;
  const nextTurn = currentTurn + 1;

  // Phase 1: Air — stub
  // Phase 2: Naval — stub

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

  // Clear orders
  await db.from('movement_orders').delete().eq('game_id', gameId).eq('turn', currentTurn);

  // Phase 4
  const phase4Result = await runPhase4(db, gameId, currentTurn);

  // Advance turn counter
  const { data: updated } = await db
    .from('games')
    .update({ current_turn: nextTurn })
    .eq('id', gameId)
    .select()
    .single();

  // Update scouted_hexes for all factions based on post-turn unit positions.
  // This ensures fog-of-war is current when players load the map next turn.
  const { data: factions } = await db.from('factions').select('id').eq('game_id', gameId);
  for (const f of factions ?? []) {
    const { visible } = await computeVisibility(db, f.id, gameId);
    await markScouted(db, f.id, gameId, visible, nextTurn);
  }

  return {
    game: updated,
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
      errors: [
        ...(retreatResult.errors ?? []),
        ...(moveResult.errors ?? []),
        ...(rangedResult.errors ?? []),
        ...(combatResult.errors ?? []),
      ],
    },
    phase4: phase4Result,
  };
}
