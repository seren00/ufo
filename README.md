# UAP Viewer

Gallery and interactive map for the [war.gov UFO/PURSUE](https://www.war.gov/UFO/) document release.

The Express server fetches `uap-csv.csv` from war.gov on startup (and every 6
hours), parses it, geocodes each `Incident Location` server-side, and writes the
result to `data/cache.json`. The frontend reads from `/api/data.json` for an
instant first paint. PDFs and videos are linked back to war.gov / DVIDS, never
mirrored.

## Run locally

```bash
npm install
npm run refresh        # one-shot CSV fetch + geocode (~3-5 minutes)
npm start              # serves on http://localhost:3000
```

`npm start` will also kick off a background refresh; if a stale cache exists, it
is served immediately while the new one is generated.

## Endpoints

- `GET /api/data.json` — full payload (`{generated_at, record_count, placed_count, records}`)
- `GET /api/status` — counts and timestamp only
- `POST /api/refresh` — triggers a refresh, returns counts

## Stack

- Node.js 20+, Express, ES modules
- Vanilla JS frontend with Leaflet 1.9.4 + leaflet.markercluster (CDN)
- No database, no build step

## Deploy to Railway

1. Push this repo to GitHub.
2. Railway → **New Project** → **Deploy from GitHub repo** → pick your fork.
3. Railway → **Settings** → **Networking** → **Generate Domain**.

Railway uses `railway.json` (NIXPACKS builder, `npm start`). The committed
`data/` folder gives the first deploy an instant cache; subsequent refreshes
update it on the running container.

## File layout

```
package.json
server.js               Express server + 6h refresh schedule
refresh.js              CSV fetch + parse + geocode (also runnable standalone)
railway.json            Railway config
public/index.html       Single-file frontend
data/cache.json         Generated; full payload served by /api/data.json
data/geocache.json      Generated; persists geocoder lookups across runs
```
