import { adminDb } from '../db.js';

export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data, error } = await adminDb.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Invalid token' });

  const { data: profile } = await adminDb
    .from('profiles')
    .select('id, username, global_role')
    .eq('id', data.user.id)
    .single();

  req.user = { ...data.user, ...profile };
  next();
}

export async function requireGM(req, res, next) {
  await requireAuth(req, res, async () => {
    if (req.user.global_role !== 'gm') return res.status(403).json({ error: 'GM only' });
    next();
  });
}
