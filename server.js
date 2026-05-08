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
let lastError = null;
let lastErrorAt = null;
let lastSuccessAt = null;

async function safeRefresh() {
  if (refreshing) {
    console.log('[server] Refresh already in progress; skipping');
    return { skipped: true };
  }
  refreshing = true;
  try {
    const result = await refresh();
    lastError = null;
    lastErrorAt = null;
    lastSuccessAt = new Date().toISOString();
    return result;
  } catch (e) {
    console.error('[server] Refresh failed:', e);
    lastError = e.message || String(e);
    lastErrorAt = new Date().toISOString();
    return { error: lastError };
  } finally {
    refreshing = false;
  }
}

app.get('/api/data.json', async (req, res) => {
  try {
    const text = await fs.readFile(CACHE_PATH, 'utf-8');
    res.type('application/json').send(text);
  } catch {
    res.status(503).json({
      error: 'cache not ready',
      refreshing,
      last_error: lastError,
      last_error_at: lastErrorAt,
      hint: refreshing
        ? 'refresh in progress, try again in a few minutes'
        : (lastError ? 'last refresh failed; POST /api/refresh to retry' : 'no refresh has run yet'),
    });
  }
});

app.get('/api/status', async (req, res) => {
  let cache = null;
  try {
    cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf-8'));
  } catch {}
  res.json({
    generated_at: cache?.generated_at || null,
    record_count: cache?.record_count || 0,
    placed_count: cache?.placed_count || 0,
    refreshing,
    last_error: lastError,
    last_error_at: lastErrorAt,
    last_success_at: lastSuccessAt,
  });
});

app.post('/api/refresh', async (req, res) => {
  if (refreshing) {
    return res.status(429).json({ error: 'refresh already in progress' });
  }
  const result = await safeRefresh();
  if (result?.error) {
    return res.status(500).json({ error: result.error });
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
