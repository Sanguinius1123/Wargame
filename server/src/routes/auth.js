import { Router } from 'express';
import { anonDb } from '../db.js';

const router = Router();

router.post('/register', async (req, res) => {
  const { email, password, username, registrationCode } = req.body;

  if (!registrationCode || registrationCode !== process.env.REGISTRATION_CODE) {
    return res.status(403).json({ error: 'Invalid registration code' });
  }
  if (!email || !password || !username) {
    return res.status(400).json({ error: 'email, password, and username are required' });
  }

  const { error } = await anonDb.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Check your email to confirm your account.' });
});

export default router;
