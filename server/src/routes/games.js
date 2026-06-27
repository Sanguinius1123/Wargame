import { Router } from 'express';
import { adminDb } from '../db.js';
import { requireAuth, requireGM } from '../middleware/auth.js';
import { resolveTurn } from '../utils/resolveTurn.js';

const router = Router();

// GET /api/games — list games the user participates in
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await adminDb
    .from('game_participants')
    .select('role, games(id, name, current_turn, current_phase, auto_resolve, created_at)')
    .eq('profile_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(d => ({ ...d.games, role: d.role })));
});

// POST /api/games — GM creates a new game
router.post('/', requireGM, async (req, res) => {
  const { name, map_width = 20, map_height = 20 } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const { data: game, error } = await adminDb
    .from('games')
    .insert({ name, map_width, map_height })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await adminDb.from('game_participants').insert({ game_id: game.id, profile_id: req.user.id, role: 'gm' });

  res.status(201).json(game);
});

// POST /api/games/:gameId/factions — GM adds a faction (player slot)
router.post('/:gameId/factions', requireGM, async (req, res) => {
  const { profile_id, name, color } = req.body;
  if (!profile_id || !name) return res.status(400).json({ error: 'profile_id and name required' });

  const { data, error } = await adminDb
    .from('factions')
    .insert({ game_id: req.params.gameId, profile_id, name, color: color ?? '#3b82f6' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await adminDb.from('game_participants').upsert({ game_id: req.params.gameId, profile_id, role: 'player' });

  res.status(201).json(data);
});

// GET /api/games/:gameId/factions
router.get('/:gameId/factions', requireAuth, async (req, res) => {
  const { data, error } = await adminDb
    .from('factions')
    .select('id, profile_id, name, color, materials, manpower, profiles(id, username)')
    .eq('game_id', req.params.gameId);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/games/:gameId/participants
router.get('/:gameId/participants', requireAuth, async (req, res) => {
  const { data, error } = await adminDb
    .from('game_participants')
    .select('role, profiles(id, username)')
    .eq('game_id', req.params.gameId);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/games/:gameId/finish-turn — player marks ready for next turn
// When all players (role='player') are ready, automatically advances the turn.
router.post('/:gameId/finish-turn', requireAuth, async (req, res) => {
  const { gameId } = req.params;

  // Mark this player ready
  const { error: markErr } = await adminDb
    .from('game_participants')
    .update({ turn_ready: true })
    .eq('game_id', gameId)
    .eq('profile_id', req.user.id);

  if (markErr) return res.status(500).json({ error: markErr.message });

  // Check if all players are ready
  const [{ data: players }, { data: game }] = await Promise.all([
    adminDb.from('game_participants').select('turn_ready').eq('game_id', gameId).eq('role', 'player'),
    adminDb.from('games').select('auto_resolve').eq('id', gameId).single(),
  ]);

  const allReady = players?.length > 0 && players.every(p => p.turn_ready);

  if (allReady && game?.auto_resolve !== false) {
    const result = await resolveTurn(adminDb, gameId);
    return res.json({ advanced: true, current_turn: result.game?.current_turn, phase3: result.phase3, phase4: result.phase4 });
  }

  if (allReady && game?.auto_resolve === false) {
    return res.json({ advanced: false, waiting_on: 0, gm_commit_required: true });
  }

  res.json({ advanced: false, waiting_on: players?.filter(p => !p.turn_ready).length ?? 0 });
});

// GET /api/games/:gameId/turn-status — GM view: which players are ready
router.get('/:gameId/turn-status', requireGM, async (req, res) => {
  const { data, error } = await adminDb
    .from('game_participants')
    .select('turn_ready, profiles(username)')
    .eq('game_id', req.params.gameId)
    .eq('role', 'player');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(p => ({ username: p.profiles?.username, ready: p.turn_ready })));
});

export default router;
