import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_PATH = path.join(DATA_DIR, 'cache.json');
const GEOCACHE_PATH = path.join(DATA_DIR, 'geocache.json');

const CSV_URLS = [
  'https://www.war.gov/Portals/1/Interactive/2026/UFO/uap-csv.csv',
  'https://www.war.gov/ufo/uap-csv.csv',
  'https://www.war.gov/UFO/uap-csv.csv',
];

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const GEOCODER_UA = 'uap-viewer/1.0 (+https://github.com/seren00/ufo)';

const MANUAL_LOCATIONS = {
  'western united states':       [40.0, -113.0],
  'eastern united states':       [38.0, -78.0],
  'southern united states':      [32.0, -90.0],
  'northern united states':      [46.0, -95.0],
  'midwestern united states':    [41.5, -93.0],
  'continental united states':   [39.5, -98.5],
  'united states':               [39.5, -98.5],
  'usa':                         [39.5, -98.5],
  'u.s.':                        [39.5, -98.5],
  'atlantic ocean':              [25.0, -45.0],
  'pacific ocean':               [10.0, -150.0],
  'indian ocean':                [-15.0, 75.0],
  'mediterranean sea':           [35.5, 18.0],
  'caribbean sea':               [15.0, -75.0],
  'gulf of mexico':              [25.0, -90.0],
  'north atlantic':              [45.0, -35.0],
  'south atlantic':              [-25.0, -15.0],
  'north pacific':               [35.0, -160.0],
  'south pacific':               [-25.0, -140.0],
  'south china sea':             [15.0, 115.0],
  'persian gulf':                [27.0, 51.0],
  'bering sea':                  [58.0, -178.0],
  'arctic ocean':                [85.0, 0.0],
  'middle east':                 [29.0, 42.0],
  'europe':                      [50.0, 10.0],
  'asia':                        [35.0, 100.0],
  'africa':                      [0.0, 20.0],
  'south america':               [-15.0, -60.0],
  'central america':             [13.0, -85.0],
  'low earth orbit':             [0.0, 0.0],
  'orbit':                       [0.0, 0.0],
  'space':                       [0.0, 0.0],
  'outer space':                 [0.0, 0.0],
};

const SKIP_LOCATIONS = new Set([
  'classified', 'redacted', 'unknown', 'n/a', '',
]);

async function fetchCSV() {
  const errors = [];
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/csv,application/vnd.ms-excel,text/plain,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.war.gov/UFO/',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Ch-Ua': '"Chromium";v="120", "Not.A/Brand";v="24", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Linux"',
  };
  for (const url of CSV_URLS) {
    try {
      const resp = await fetch(url, { headers, redirect: 'follow' });
      if (!resp.ok) {
        errors.push(`${url} -> HTTP ${resp.status}`);
        continue;
      }
      const text = await resp.text();
      if (text.length > 500) {
        console.log(`[refresh] Fetched CSV from ${url} (${text.length} bytes)`);
        return text;
      }
      errors.push(`${url} -> body ${text.length} bytes`);
    } catch (e) {
      errors.push(`${url} -> ${e.message}`);
      console.warn(`[refresh] Fetch failed for ${url}: ${e.message}`);
    }
  }
  throw new Error('All CSV URLs failed: ' + errors.join('; '));
}

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const firstLine = text.split('\n', 1)[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delim = (tabCount > 2 && tabCount >= commaCount) ? '\t' : ',';

  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cell += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') { /* skip */ }
      else cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function findCol(header, ...candidates) {
  const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const headers = header.map(norm);
  for (const cand of candidates) {
    const want = norm(cand);
    let i = headers.indexOf(want);
    if (i !== -1) return i;
    i = headers.findIndex(h => h.startsWith(want));
    if (i !== -1) return i;
    i = headers.findIndex(h => h.includes(want));
    if (i !== -1) return i;
  }
  return -1;
}

function clean(s) {
  if (s == null) return '';
  return String(s).replace(/^\s+|\s+$/g, '').replace(/^"|"$/g, '').trim();
}

function cleanURL(s) {
  s = clean(s);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) return 'https://www.war.gov' + s;
  return s;
}

function cleanID(s) {
  return clean(s).replace(/[^\d]/g, '');
}

function rowsToRecords(rows) {
  if (rows.length < 2) return [];
  const header = rows[0].map(h => clean(h));
  const cols = {
    redaction:         findCol(header, 'Redaction'),
    title:             findCol(header, 'Title'),
    type:              findCol(header, 'Type'),
    agency:            findCol(header, 'Agency'),
    incident_date:     findCol(header, 'Incident Date'),
    incident_location: findCol(header, 'Incident Location'),
    description:       findCol(header, 'Description Blurb', 'Description'),
    pdf_url:           findCol(header, 'PDF | Image Link', 'PDF Image Link', 'PDF | Image', 'PDF Link', 'Image Link', 'PDF'),
    thumb:             findCol(header, 'Modal Image', 'Thumbnail'),
    dvids:             findCol(header, 'DVIDS Video ID', 'DVIDS Video', 'DVIDS ID', 'DVIDS'),
    video_title:       findCol(header, 'Video Title'),
    video_pairing:     findCol(header, 'Video Pairing'),
    pdf_pairing:       findCol(header, 'PDF Pairing'),
  };

  const recs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const title = clean(r[cols.title]);
    if (!title) continue;
    recs.push({
      id: i,
      title,
      type: clean(r[cols.type]),
      agency: clean(r[cols.agency]),
      incident_date: clean(r[cols.incident_date]),
      incident_location: clean(r[cols.incident_location]),
      description: clean(r[cols.description]),
      redaction: clean(r[cols.redaction]).toUpperCase() === 'TRUE',
      pdf_url: cleanURL(r[cols.pdf_url]),
      thumb: cleanURL(r[cols.thumb]),
      dvids: cleanID(r[cols.dvids]),
      video_title: clean(r[cols.video_title]),
      video_pairing: clean(r[cols.video_pairing]),
      pdf_pairing: clean(r[cols.pdf_pairing]),
      lat: null,
      lng: null,
    });
  }
  return recs;
}

async function loadGeocache() {
  try {
    const text = await fs.readFile(GEOCACHE_PATH, 'utf-8');
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function saveGeocache(cache) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(GEOCACHE_PATH, JSON.stringify(cache, null, 2));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function geocodePhoton(query) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`;
  const resp = await fetch(url, { headers: { 'User-Agent': GEOCODER_UA, 'Accept': 'application/json' } });
  if (!resp.ok) throw new Error(`photon http ${resp.status}`);
  const data = await resp.json();
  const f = data.features && data.features[0];
  if (!f || !f.geometry || !Array.isArray(f.geometry.coordinates)) return null;
  const [lng, lat] = f.geometry.coordinates;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return [lat, lng];
}

async function geocodeNominatim(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, { headers: { 'User-Agent': GEOCODER_UA, 'Accept': 'application/json' } });
  if (!resp.ok) throw new Error(`nominatim http ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data) || !data.length) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

function lookupManual(key) {
  if (SKIP_LOCATIONS.has(key)) return { found: true, coords: null };
  if (key in MANUAL_LOCATIONS) return { found: true, coords: MANUAL_LOCATIONS[key] };
  for (const [pattern, coords] of Object.entries(MANUAL_LOCATIONS)) {
    if (pattern && key.includes(pattern)) return { found: true, coords };
  }
  for (const skip of SKIP_LOCATIONS) {
    if (skip && key.includes(skip)) return { found: true, coords: null };
  }
  return { found: false, coords: null };
}

async function geocodeRecord(location, geocache) {
  const key = location.toLowerCase().trim();
  if (!key) return null;

  const manual = lookupManual(key);
  if (manual.found) return manual.coords;

  if (key in geocache) return geocache[key];

  try {
    await sleep(200);
    const result = await geocodePhoton(key);
    if (result) {
      geocache[key] = result;
      return result;
    }
  } catch (e) {
    console.warn(`[geocode] photon failed for "${key}": ${e.message}`);
  }

  try {
    await sleep(1100);
    const result = await geocodeNominatim(key);
    if (result) {
      geocache[key] = result;
      return result;
    }
  } catch (e) {
    console.warn(`[geocode] nominatim failed for "${key}": ${e.message}`);
  }

  geocache[key] = null;
  return null;
}

export async function refresh() {
  console.log('[refresh] Starting refresh at', new Date().toISOString());
  await fs.mkdir(DATA_DIR, { recursive: true });

  const csv = await fetchCSV();
  const rows = parseCSV(csv);
  const records = rowsToRecords(rows);
  console.log(`[refresh] Parsed ${records.length} records`);

  const geocache = await loadGeocache();
  let placed = 0;
  let processed = 0;

  for (const rec of records) {
    if (rec.incident_location) {
      const coords = await geocodeRecord(rec.incident_location, geocache);
      if (coords) {
        rec.lat = coords[0];
        rec.lng = coords[1];
        placed++;
      }
    }
    processed++;
    if (processed % 10 === 0) {
      await saveGeocache(geocache);
      console.log(`[refresh] Geocoded ${processed}/${records.length} (${placed} placed)`);
    }
  }
  await saveGeocache(geocache);

  const cache = {
    generated_at: new Date().toISOString(),
    record_count: records.length,
    placed_count: placed,
    records,
  };
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(`[refresh] Wrote ${CACHE_PATH}: ${records.length} records, ${placed} placed`);
  return { record_count: records.length, placed_count: placed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  refresh().catch(e => {
    console.error('[refresh] Failed:', e);
    process.exit(1);
  });
}
