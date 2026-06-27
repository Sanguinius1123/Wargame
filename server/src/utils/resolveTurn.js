// Shared turn resolution pipeline — called by both GM advance-turn and player finish-turn.
// Phase 1 (Air) and Phase 2 (Naval) are stubs.
// Phase 3 executes ground movement (+ combat once combat.js is wired in).
// Phase 4 collects resources, places production, calculates manpower, checks win.

import { executeGroundMoves } from './movement.js';
import { executeGroundCombat } from './combat.js';
import { runPhase4 } from './phase4.js';

export async function resolveTurn(db, gameId) {
  const { data: game } = await db.from('games').select('current_turn').eq('id', gameId).single();
  const currentTurn = game?.current_turn ?? 0;
  const nextTurn = currentTurn + 1;

  // Phase 1: Air — stub
  // Phase 2: Naval — stub

  // Phase 3: Ground movement then combat
  const moveResult   = await executeGroundMoves(db, gameId, currentTurn);
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

  return {
    game: updated,
    phase3: {
      moved: moveResult.moved,
      skipped: moveResult.skipped,
      move_errors: moveResult.errors,
      hexes_fought: combatResult.hexesFought,
      total_casualties: combatResult.totalCasualties,
      combat_errors: combatResult.errors,
    },
    phase4: phase4Result,
  };
}
