import { Router } from 'express';
import { adminDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/maps — list all saved map templates
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await adminDb
    .from('maps')
    .select('id, name, description, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Attach hex counts in a single query
  const ids = (data ?? []).map(m => m.id);
  let countsByMap = {};
  if (ids.length > 0) {
    const { data: counts } = await adminDb
      .from('map_hexes')
      .select('map_id')
      .in('map_id', ids);
    for (const row of counts ?? []) {
      countsByMap[row.map_id] = (countsByMap[row.map_id] ?? 0) + 1;
    }
  }

  res.json((data ?? []).map(m => ({
    ...m,
    hex_count: countsByMap[m.id] ?? 0,
  })));
});

export default router;
