import express from 'express';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { registerMoodRoutes } from './routes/mood.js';
import { getDb } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cookieParser());
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

registerMoodRoutes(app);

app.get('/api/health', (req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

app.listen(PORT, () => {
  console.log(`Mood tracking app listening on http://localhost:${PORT}`);
});
