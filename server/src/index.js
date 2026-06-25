import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes  from './routes/auth.js';
import gamesRoutes from './routes/games.js';
import mapRoutes   from './routes/map.js';
import gmRoutes    from './routes/gm.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? '*' }));
app.use(express.json());

app.use('/api/auth',  authRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/map',   mapRoutes);
app.use('/api/gm',    gmRoutes);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT ?? 3001;
app.listen(port, () => console.log(`Wargame server on :${port}`));
