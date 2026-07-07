import { Router } from 'express';
import { adminDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/settings — list all available game settings
router.get('/', requireAuth, async (_req, res) => {
  const { data, error } = await adminDb
    .from('settings')
    .select('id, name, description')
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
