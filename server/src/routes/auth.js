import { Router } from 'express';
import { anonDb } from '../db.js';

const router = Router();

// Derive a deterministic fake email from a username.
// Users never see or type this — it's just how Supabase stores the account.
function toEmail(username) {
  return `${username.toLowerCase().replace(/[^a-z0-9._-]/g, '')}@wargame.local`;
}

// POST /api/auth/register — username + password + registration code
router.post('/register', async (req, res) => {
  const { username, password, registrationCode } = req.body;

  if (!registrationCode || registrationCode !== process.env.REGISTRATION_CODE) {
    return res.status(403).json({ error: 'Invalid registration code' });
  }
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const email = toEmail(username);
  const { error } = await anonDb.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });

  if (error) {
    const msg = error.message ?? error.name ?? '';
    if (msg.includes('already registered') || msg.includes('User already')) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    return res.status(400).json({ error: msg || 'Registration failed' });
  }
  res.json({ ok: true });
});

// POST /api/auth/signin — username + password → Supabase session
// Client calls supabase.auth.setSession() with the returned tokens.
router.post('/signin', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const email = toEmail(username);
  const { data, error } = await anonDb.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: 'Invalid username or password' });

  res.json({
    access_token:  data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at:    data.session.expires_at,
  });
});

export default router;
