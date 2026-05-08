import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refresh } from './refresh.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_PATH = path.join(DATA_DIR, 'cache.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

const app = express();
app.use(express.static(PUBLIC_DIR));

let refreshing = false;
async function safeRefresh() {
  if (refreshing) {
    console.log('[server] Refresh already in progress; skipping');
    return null;
  }
  refreshing = true;
  try {
    return await refresh();
  } catch (e) {
    console.error('[server] Refresh failed:', e);
    return null;
  } finally {
    refreshing = false;
  }
}

app.get('/api/data.json', async (req, res) => {
  try {
    const text = await fs.readFile(CACHE_PATH, 'utf-8');
    res.type('application/json').send(text);
  } catch {
    res.status(503).json({ error: 'cache not ready', refreshing });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const text = await fs.readFile(CACHE_PATH, 'utf-8');
    const data = JSON.parse(text);
    res.json({
      generated_at: data.generated_at,
      record_count: data.record_count,
      placed_count: data.placed_count,
      refreshing,
    });
  } catch {
    res.status(503).json({ error: 'cache not ready', refreshing });
  }
});

app.post('/api/refresh', async (req, res) => {
  if (refreshing) {
    return res.status(429).json({ error: 'refresh already in progress' });
  }
  const result = await safeRefresh();
  if (!result) {
    return res.status(500).json({ error: 'refresh failed' });
  }
  res.json(result);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[server] Listening on :${port}`);
  fs.access(CACHE_PATH).then(
    () => console.log('[server] Existing cache found; serving immediately'),
    () => console.log('[server] No cache yet; first refresh will populate it'),
  );
  safeRefresh();
  setInterval(safeRefresh, SIX_HOURS_MS);
});
