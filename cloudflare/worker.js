/**
 * ============================================================================
 *  GIG Creative Hub — backend on Cloudflare
 *
 *  A Cloudflare Worker (this file) with:
 *    • D1  (binding "DB")    — all the data: talents, links, approvals, usage, print orders…
 *    • R2  (binding "FILES") — all the files: photos, videos, brand kit, creator uploads, print artwork
 *
 *  It answers the same actions as google-apps-script/Code.gs, so the website works
 *  the same way. Tables are created automatically on the first request.
 *
 *  Routes:
 *    POST /api                 every app action  ({ action, token, …args } → { ok, data })
 *    PUT  /upload/<ticket>     a file, or one 10 MB part of a big file
 *    POST /upload/<ticket>     finish a big (multi-part) upload
 *    GET  /f/<key>             view a file (?dl=1 downloads it); supports video seeking
 *
 *  Setup and deploy: see README.md → "Going live on Cloudflare".
 *  Optional secrets: RESEND_API_KEY (+ var MAIL_FROM) for team email alerts.
 * ============================================================================
 */

const TOKEN_DAYS = 30;           // how long a team login lasts
const PBKDF2_ROUNDS = 20000;     // password hashing strength (kept modest for the free plan's CPU limit)
const CHUNK = 10 * 1024 * 1024;  // upload part size — big files are sent in pieces of this size
const SCHEMA_V = '1';            // bump when SCHEMA changes so new columns get added

// ── Data model ──────────────────────────────────────────────────────────────
const SCHEMA = {
  team_members: { cols: ['id', 'email', 'name', 'pass_hash', 'pass_salt', 'session_v', 'created_at'], num: ['session_v'] },
  seasons:      { cols: ['id', 'name', 'color', 'sort_order', 'created_at'], num: ['sort_order'] },
  talents:      { cols: ['id', 'name', 'handle', 'platform', 'profile_url', 'followers', 'engagement_rate', 'niche', 'location',
                         'email', 'phone', 'rate', 'status', 'tags', 'notes', 'brand', 'tier', 'talent_type', 'languages',
                         'created_at', 'updated_at'],
                  num: ['followers', 'engagement_rate'], arr: ['tags', 'languages'] },
  upload_links: { cols: ['id', 'token', 'label', 'talent_id', 'season_id', 'instructions', 'is_active', 'expires_at',
                         'upload_count', 'last_upload_at', 'folder_id', 'created_at'],
                  num: ['upload_count'], bool: ['is_active'] },
  assets:       { cols: ['id', 'title', 'description', 'category', 'media_type', 'season_id', 'talent_id', 'upload_link_id',
                         'source', 'storage_path', 'file_name', 'mime_type', 'size_bytes', 'tags', 'status', 'review_note',
                         'reviewed_at', 'use_count', 'last_used_on', 'uploaded_by', 'created_at', 'updated_at'],
                  num: ['size_bytes', 'use_count'], arr: ['tags'] },
  asset_usage:  { cols: ['id', 'asset_id', 'channel', 'note', 'used_on', 'created_by', 'created_at'] },
  print_orders: { cols: ['id', 'order_no', 'status', 'customer_name', 'company', 'phone', 'email', 'summary', 'quantity',
                         'due_date', 'answers', 'history', 'internal_notes', 'created_at', 'updated_at'],
                  json: ['answers', 'history'] },
};

const DEFAULTS = {
  team_members: { session_v: 0 },
  seasons:      { color: '#6d5efc', sort_order: 0 },
  talents:      { status: 'prospect', tags: [], languages: [] },
  upload_links: { is_active: true, upload_count: 0 },
  assets:       { category: 'final', media_type: 'other', source: 'team', tags: [], status: 'pending', use_count: 0 },
  asset_usage:  {},
  print_orders: { status: 'new', history: [] },
};

const INDEXES = [
  'CREATE UNIQUE INDEX IF NOT EXISTS team_members_email ON team_members (email)',
  'CREATE UNIQUE INDEX IF NOT EXISTS upload_links_token ON upload_links (token)',
  'CREATE INDEX IF NOT EXISTS assets_link ON assets (upload_link_id)',
  'CREATE INDEX IF NOT EXISTS assets_path ON assets (storage_path)',
  'CREATE INDEX IF NOT EXISTS usage_asset ON asset_usage (asset_id)',
];

const SEED_SEASONS = [
  ['New Year', '#2a78d6'], ["Valentine's Day", '#e87ba4'], ['Spring', '#1baf7a'], ['Summer', '#eda100'],
  ['Back to School', '#4a3aa7'], ['Halloween', '#eb6834'], ['Black Friday / 11.11', '#0b0b0b'], ['Christmas & Holidays', '#e34948'],
];

// File keys in R2 start with one of these folders.
const FOLDERS = ['final/', 'raw/', 'brand/', 'creators/', 'print/'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Disposition, ETag, Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};

// Bindings are the same for every request in this isolate, so keep them handy.
let DB, FILES, ENV, SELF;

// ════════════════════════════════════════════════════════════════════════════
//  Entry point
// ════════════════════════════════════════════════════════════════════════════
export default {
  async fetch(request, env, ctx) {
    DB = env.DB; FILES = env.FILES; ENV = env;
    const url = new URL(request.url);
    SELF = url.origin;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (!DB || !FILES) throw new AppError('The Worker is missing its D1 (DB) or R2 (FILES) binding — see README.md.');
      if (url.pathname.startsWith('/f/') && (request.method === 'GET' || request.method === 'HEAD')) return await serveFile(request, url);
      await ensureSetup();
      if (url.pathname === '/api' && request.method === 'POST') {
        let req;
        try { req = JSON.parse(await request.text() || '{}'); } catch { throw new AppError('Bad request.'); }
        return json({ ok: true, data: await route(req, ctx) });
      }
      if (url.pathname.startsWith('/upload/')) return json({ ok: true, data: await handleUpload(request, url) });
      if (url.pathname === '/' || url.pathname === '/api') {
        return json({ ok: true, data: { app: 'GIG Creative Hub', message: 'The GIG Creative Hub backend is running. Paste this address into config.js (CLOUDFLARE_API_URL).' } });
      }
      return json({ ok: false, error: 'Not found.' }, 404);
    } catch (err) {
      if (!(err instanceof AppError)) console.error(err && err.stack || err);
      return json({ ok: false, error: err instanceof AppError ? err.message : 'Something went wrong on the server. Please try again.', code: err.code || null });
    }
  },
};

class AppError extends Error {
  constructor(message, code) { super(message); this.code = code || null; }
}
const fail = (message, code) => { throw new AppError(message, code); };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
}

const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const newKey = () => uuid().replace(/-/g, '') + uuid().replace(/-/g, '').slice(0, 8);

// ════════════════════════════════════════════════════════════════════════════
//  Router
// ════════════════════════════════════════════════════════════════════════════
async function route(req, ctx) {
  const a = String(req.action || '');

  // ── No login needed ──
  if (a === 'status') return { needsSetup: (await count('team_members')) === 0 };
  if (a === 'setupAdmin') return setupAdmin(req);
  if (a === 'login') return login(req);
  if (a === 'linkInfo') return linkInfo(req.linkToken);
  if (a === 'linkStartUpload') return linkStartUpload(req);
  if (a === 'linkSubmit') return linkSubmit(req);
  if (a === 'linkSubmissions') return linkSubmissions(req.linkToken);
  if (a.startsWith('print')) return printRoute(req, ctx);

  // ── Team only ──
  const me = await verify(req.token);
  switch (a) {
    case 'me': return publicMember(me);
    case 'changePassword': return changePassword(me, req.password);
    case 'bootstrap': return bootstrap();
    case 'list': return listRows(req.table, req.eq);
    case 'insert': return apiInsert(req.table, req.row || {}, me);
    case 'insertMany':
      if (req.table !== 'talents') fail('Bulk add is only for talents.');
      return insertRows('talents', (req.rows || []).slice(0, 5000));
    case 'update': return apiUpdate(req.table, req.id, req.patch || {});
    case 'updateMany': {
      const out = [];
      for (const id of req.ids || []) out.push(await apiUpdate(req.table, id, { ...(req.patch || {}) }));
      return out;
    }
    case 'remove': await apiRemove(req.table, [req.id]); return true;
    case 'removeMany': await apiRemove(req.table, req.ids || []); return true;
    case 'startUpload': {
      const folder = ['final', 'raw', 'brand'].includes(req.category) ? req.category : 'final';
      return startUpload(folder + '/', req);
    }
    case 'removeFiles': return removeFiles(req.ids || []);
  }
  fail('Unknown action: ' + a);
}

// ════════════════════════════════════════════════════════════════════════════
//  Database (D1) — one table per entity, same shape as the Sheets version
// ════════════════════════════════════════════════════════════════════════════
const colType = (t, c) => (c === 'id' ? 'TEXT PRIMARY KEY'
  : SCHEMA[t].num?.includes(c) ? 'NUMERIC' : SCHEMA[t].bool?.includes(c) ? 'INTEGER' : 'TEXT');

let ready = null;
function ensureSetup() {
  if (!ready) ready = setup().catch((e) => { ready = null; throw e; });
  return ready;
}

async function setup() {
  try {
    if ((await getSetting('SCHEMA_V')) === SCHEMA_V) return;
  } catch { /* first run: the settings table doesn't exist yet */ }
  const stmts = ['CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)'];
  for (const t of Object.keys(SCHEMA)) {
    stmts.push(`CREATE TABLE IF NOT EXISTS ${t} (${SCHEMA[t].cols.map((c) => `${c} ${colType(t, c)}`).join(', ')})`);
  }
  await DB.batch(stmts.map((s) => DB.prepare(s)));
  // Add any columns that are missing (after an update).
  for (const t of Object.keys(SCHEMA)) {
    const have = new Set((await DB.prepare(`PRAGMA table_info(${t})`).all()).results.map((c) => c.name));
    for (const c of SCHEMA[t].cols) if (!have.has(c)) await DB.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${colType(t, c)}`).run();
  }
  await DB.batch(INDEXES.map((s) => DB.prepare(s)));
  if ((await count('seasons')) === 0) {
    await insertRows('seasons', SEED_SEASONS.map((s, i) => ({ name: s[0], color: s[1], sort_order: i + 1 })));
  }
  await setSetting('SCHEMA_V', SCHEMA_V);
}

async function getSetting(key) {
  const r = await DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return r ? r.value : null;
}
async function setSetting(key, value) {
  await DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value).run();
}

function toDb(t, c, v) {
  const s = SCHEMA[t];
  if (v === undefined || v === null) return null;
  if (s.json?.includes(c)) return JSON.stringify(v);
  if (s.arr?.includes(c)) return JSON.stringify((Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean));
  if (s.bool?.includes(c)) return v === true || v === 1 || String(v).toLowerCase() === 'true' ? 1 : 0;
  if (v === '') return null;
  if (s.num?.includes(c)) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return String(v);
}

function fromDb(t, c, v) {
  const s = SCHEMA[t];
  if (s.arr?.includes(c)) {
    if (!v) return [];
    try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return String(v).split(',').map((x) => x.trim()).filter(Boolean); }
  }
  if (s.bool?.includes(c)) return v === 1 || v === true || v === '1';
  if (v === null || v === undefined || v === '') return null;
  if (s.json?.includes(c)) { try { return JSON.parse(v); } catch { return null; } }
  if (s.num?.includes(c)) return Number(v);
  return String(v);
}

const rowOut = (t, r) => Object.fromEntries(SCHEMA[t].cols.map((c) => [c, fromDb(t, c, r[c])]));
const norm = (t, obj) => Object.fromEntries(SCHEMA[t].cols.map((c) => [c, fromDb(t, c, toDb(t, c, obj[c]))]));

async function count(t) {
  return (await DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n;
}

async function readTable(t, where = '', ...binds) {
  const order = SCHEMA[t].cols.includes('created_at') ? ' ORDER BY created_at' : '';
  const res = await DB.prepare(`SELECT * FROM ${t} ${where}${order}`).bind(...binds).all();
  return res.results.map((r) => rowOut(t, r));
}

async function getRow(t, id) {
  if (!id) return null;
  const r = await DB.prepare(`SELECT * FROM ${t} WHERE id = ?`).bind(String(id)).first();
  return r ? rowOut(t, r) : null;
}

function buildRow(t, row) {
  const obj = { ...(DEFAULTS[t] || {}) };
  for (const c of SCHEMA[t].cols) if (row[c] !== undefined) obj[c] = row[c];
  obj.id = uuid();
  obj.created_at = nowIso();
  if (SCHEMA[t].cols.includes('updated_at')) obj.updated_at = obj.created_at;
  return obj;
}

function insertStmt(t, obj) {
  const cols = SCHEMA[t].cols;
  return DB.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .bind(...cols.map((c) => toDb(t, c, obj[c])));
}

async function insertRow(t, row) {
  const obj = buildRow(t, row);
  await insertStmt(t, obj).run();
  return norm(t, obj);
}

async function insertRows(t, rows) {
  const objs = rows.map((r) => buildRow(t, r));
  for (let i = 0; i < objs.length; i += 50) await DB.batch(objs.slice(i, i + 50).map((o) => insertStmt(t, o)));
  return objs.map((o) => norm(t, o));
}

async function updateRow(t, id, patch) {
  const obj = await getRow(t, id);
  if (!obj) fail('That item no longer exists.');
  const set = [];
  for (const k of Object.keys(patch)) {
    if (k !== 'id' && k !== 'created_at' && SCHEMA[t].cols.includes(k)) { obj[k] = patch[k]; set.push(k); }
  }
  if (SCHEMA[t].cols.includes('updated_at')) { obj.updated_at = nowIso(); set.push('updated_at'); }
  if (set.length) {
    await DB.prepare(`UPDATE ${t} SET ${set.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .bind(...set.map((k) => toDb(t, k, obj[k])), obj.id).run();
  }
  return norm(t, obj);
}

// Runs fn over ids in groups small enough for D1's limit on query parameters.
async function inGroups(ids, fn) {
  for (let i = 0; i < ids.length; i += 90) {
    const g = ids.slice(i, i + 90).map(String);
    await fn(g, g.map(() => '?').join(', '));
  }
}

async function deleteRows(t, ids) {
  await inGroups(ids, (g, q) => DB.prepare(`DELETE FROM ${t} WHERE id IN (${q})`).bind(...g).run());
}

// ════════════════════════════════════════════════════════════════════════════
//  Team API (same rules as the Google version)
// ════════════════════════════════════════════════════════════════════════════
const CLIENT_TABLES = ['seasons', 'talents', 'upload_links', 'assets', 'asset_usage', 'team_members'];
const checkTable = (t) => { if (!CLIENT_TABLES.includes(t)) fail('Unknown table: ' + t); };
const clean = (t, row) => (t === 'team_members' ? publicMember(row) : row);

async function listRows(t, eq) {
  checkTable(t);
  const keys = Object.keys(eq || {}).filter((k) => SCHEMA[t].cols.includes(k));
  const where = keys.length ? 'WHERE ' + keys.map((k) => `${k} = ?`).join(' AND ') : '';
  const rows = await readTable(t, where, ...keys.map((k) => toDb(t, k, eq[k])));
  return rows.map((r) => clean(t, r));
}

async function bootstrap() {
  const out = {};
  for (const t of ['assets', 'talents', 'seasons', 'upload_links', 'team_members']) out[t] = await listRows(t);
  out.links = null;
  return out;
}

async function apiInsert(t, row, me) {
  checkTable(t);
  if (t === 'team_members') {
    const email = String(row.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) fail('Enter a valid email.');
    if (await findMember(email)) fail('That already exists.');
    if (!row.password || String(row.password).length < 8) fail('Give them a password of at least 8 characters.');
    const salt = uuid();
    return publicMember(await insertRow('team_members', {
      email, name: row.name || null, pass_salt: salt, pass_hash: await hashPassword(row.password, salt), session_v: 0,
    }));
  }
  if (t === 'seasons') {
    const dup = await DB.prepare('SELECT 1 FROM seasons WHERE lower(name) = lower(?)').bind(String(row.name || '')).first();
    if (dup) fail('That already exists.');
  }
  if (t === 'assets') {
    const key = String(row.storage_path || '');
    if (!key) fail('Missing file.');
    if (!['final/', 'raw/', 'brand/'].some((p) => key.startsWith(p))) fail('That file is not in the GIG Creative Hub storage.');
    if (!(await FILES.head(key))) fail('We could not find the uploaded file. Please try again.');
  }
  if (t === 'upload_links') { row.token = newKey(); delete row.folder_id; }
  if (t === 'asset_usage' && !row.created_by) row.created_by = me.email;
  const created = await insertRow(t, row);
  if (t === 'asset_usage') await syncUsage(created.asset_id);
  return clean(t, created);
}

async function apiUpdate(t, id, patch) {
  checkTable(t);
  if (t === 'team_members') {
    const p = {};
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.password) {
      if (String(patch.password).length < 8) fail('Use at least 8 characters.');
      const m = await getRow('team_members', id);
      if (!m) fail('That person no longer exists.');
      p.pass_salt = uuid();
      p.pass_hash = await hashPassword(patch.password, p.pass_salt);
      p.session_v = (Number(m.session_v) || 0) + 1; // signs them out everywhere
    }
    return publicMember(await updateRow('team_members', id, p));
  }
  if (t === 'assets') delete patch.storage_path;
  if (t === 'upload_links') {
    delete patch.folder_id;
    if (patch.token !== undefined) patch.token = newKey(); // "Change link": the server makes the new code
  }
  const row = await updateRow(t, id, patch);
  if (t === 'asset_usage') await syncUsage(row.asset_id);
  return row;
}

async function apiRemove(t, ids) {
  checkTable(t);
  ids = ids.filter(Boolean).map(String);
  if (!ids.length) return;
  if (t === 'team_members' && (await count('team_members')) - ids.length < 1) fail('You need at least one team member.');
  let usageAssets = [];
  if (t === 'asset_usage') {
    await inGroups(ids, async (g, q) => {
      const r = await DB.prepare(`SELECT DISTINCT asset_id FROM asset_usage WHERE id IN (${q})`).bind(...g).all();
      usageAssets.push(...r.results.map((x) => x.asset_id));
    });
  }
  await deleteRows(t, ids);
  // Keep references tidy ("on delete set null").
  const refCol = { seasons: 'season_id', talents: 'talent_id', upload_links: 'upload_link_id' }[t];
  if (refCol) {
    for (const tbl of ['assets', 'upload_links']) {
      if (!SCHEMA[tbl].cols.includes(refCol)) continue;
      await inGroups(ids, (g, q) => DB.prepare(`UPDATE ${tbl} SET ${refCol} = NULL WHERE ${refCol} IN (${q})`).bind(...g).run());
    }
  }
  if (t === 'assets') await inGroups(ids, (g, q) => DB.prepare(`DELETE FROM asset_usage WHERE asset_id IN (${q})`).bind(...g).run());
  for (const id of usageAssets) await syncUsage(id);
}

async function syncUsage(assetId) {
  if (!assetId) return;
  await DB.prepare(`UPDATE assets SET
      use_count = (SELECT COUNT(*) FROM asset_usage WHERE asset_id = ?1),
      last_used_on = (SELECT MAX(used_on) FROM asset_usage WHERE asset_id = ?1 AND used_on <> ''),
      updated_at = ?2
    WHERE id = ?1`).bind(String(assetId), nowIso()).run();
}

// ════════════════════════════════════════════════════════════════════════════
//  Logins (email + password, signed tokens)
// ════════════════════════════════════════════════════════════════════════════
const enc = new TextEncoder();

function b64url(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
function sameText(a, b) { // constant-time compare
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

let hmacKey = null;
async function secretKey() {
  if (hmacKey) return hmacKey;
  await DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('SECRET', ?)").bind(newKey() + newKey()).run();
  const secret = await getSetting('SECRET');
  hmacKey = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hmacKey;
}
async function sign(text) {
  return b64url(await crypto.subtle.sign('HMAC', await secretKey(), enc.encode(text)));
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(String(salt)), iterations: PBKDF2_ROUNDS }, key, 256);
  return b64url(bits);
}

async function makeToken(m) {
  const payload = b64url(enc.encode(JSON.stringify({ e: m.email, v: Number(m.session_v) || 0, x: Date.now() + TOKEN_DAYS * 86400000 })));
  return payload + '.' + await sign(payload);
}

async function verify(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !sameText(await sign(parts[0]), parts[1])) fail('Please sign in again.', 'AUTH');
  let data;
  try { data = JSON.parse(new TextDecoder().decode(fromB64url(parts[0]))); } catch { fail('Please sign in again.', 'AUTH'); }
  if (!data.x || data.x < Date.now()) fail('Your session expired. Please sign in again.', 'AUTH');
  const m = await findMember(data.e);
  if (!m || (Number(m.session_v) || 0) !== data.v) fail('Please sign in again.', 'AUTH');
  return m;
}

async function findMember(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return null;
  const r = await DB.prepare('SELECT * FROM team_members WHERE email = ?').bind(email).first();
  return r ? rowOut('team_members', r) : null;
}

function publicMember(m) {
  return { id: m.id, email: m.email, name: m.name, created_at: m.created_at, links: null };
}

async function setupAdmin(req) {
  if ((await count('team_members')) > 0) fail('Setup is already done. Please sign in.');
  const m = await apiInsert('team_members', { email: req.email, name: req.name, password: req.password }, null);
  if ((await count('team_members')) > 1) { // someone else finished setup at the same moment
    await deleteRows('team_members', [m.id]);
    fail('Setup is already done. Please sign in.');
  }
  const full = await findMember(m.email);
  return { token: await makeToken(full), user: publicMember(full) };
}

async function login(req) {
  const email = String(req.email || '').trim().toLowerCase();
  const key = 'login:' + email;
  const now = Date.now();
  let tries = { n: 0, until: 0 };
  try { tries = JSON.parse(await getSetting(key)) || tries; } catch { /* none yet */ }
  if (tries.until > now && tries.n >= 10) fail('Too many attempts. Please wait 10 minutes and try again.');
  const m = await findMember(email);
  if (!m || !sameText(await hashPassword(req.password || '', m.pass_salt), m.pass_hash)) {
    const n = tries.until > now ? tries.n + 1 : 1;
    await setSetting(key, JSON.stringify({ n, until: now + 600000 }));
    fail("That email and password don't match.");
  }
  if (tries.n) await DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
  return { token: await makeToken(m), user: publicMember(m) };
}

async function changePassword(me, password) {
  const updated = await apiUpdate('team_members', me.id, { password });
  return { token: await makeToken(await findMember(updated.email)) };
}

// ════════════════════════════════════════════════════════════════════════════
//  Files in R2
// ════════════════════════════════════════════════════════════════════════════
const safeName = (name) => String(name || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+/, '').slice(-100) || 'file';
const fileUrl = (key) => `${SELF}/f/${key.split('/').map(encodeURIComponent).join('/')}`;
const knownKey = (key) => FOLDERS.some((p) => String(key).startsWith(p)) && !String(key).includes('..');

async function makeTicket(data) {
  const p = b64url(enc.encode(JSON.stringify({ ...data, x: Date.now() + 2 * 86400000 })));
  return p + '.' + await sign('upload:' + p);
}
async function readTicket(ticket) {
  const [p, s] = String(ticket || '').split('.');
  if (!p || !s || !sameText(await sign('upload:' + p), s)) fail('Invalid upload.');
  const d = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  if (!d.x || d.x < Date.now()) fail('This upload took too long. Please try again.');
  return d;
}

// Reserves a place for a file and returns where to send it. Big files go up in CHUNK-sized parts.
async function startUpload(prefix, req) {
  const name = String(req.name || 'file').slice(0, 200);
  const mime = String(req.mimeType || 'application/octet-stream').slice(0, 200);
  const size = Math.max(0, Number(req.size) || 0);
  const key = `${prefix}${uuid()}/${safeName(name)}`;
  let uploadId = null;
  if (size > CHUNK) {
    const mpu = await FILES.createMultipartUpload(key, { httpMetadata: { contentType: mime }, customMetadata: { name } });
    uploadId = mpu.uploadId;
  }
  return { uploadUrl: `${SELF}/upload/${await makeTicket({ k: key, u: uploadId, t: mime, n: name })}`, chunkSize: CHUNK };
}

async function handleUpload(request, url) {
  const d = await readTicket(url.pathname.slice('/upload/'.length));
  if (request.method === 'PUT' && !d.u) {
    await FILES.put(d.k, request.body, { httpMetadata: { contentType: d.t }, customMetadata: { name: d.n } });
    return { done: true, fileId: d.k };
  }
  if (!d.u) fail('Invalid upload.');
  const mpu = FILES.resumeMultipartUpload(d.k, d.u);
  if (request.method === 'PUT') {
    const n = Number(url.searchParams.get('part'));
    if (!Number.isInteger(n) || n < 1 || n > 10000) fail('Invalid upload.');
    const part = await mpu.uploadPart(n, request.body);
    return { partNumber: part.partNumber, etag: part.etag };
  }
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { fail('Invalid upload.'); }
    const parts = (body.parts || []).map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }));
    if (!parts.length) fail('Invalid upload.');
    await mpu.complete(parts);
    return { done: true, fileId: d.k };
  }
  fail('Invalid upload.');
}

// Types a browser could run as a web page are always downloaded, never shown.
const RISKY = /html|xml|svg|javascript|ecmascript|x-sh|x-msdownload/i;

async function serveFile(request, url) {
  let key;
  try { key = decodeURIComponent(url.pathname.slice(3)); } catch { key = ''; }
  if (!knownKey(key)) return new Response('Not found', { status: 404, headers: CORS });
  let obj;
  try {
    obj = request.method === 'HEAD' ? await FILES.head(key) : await FILES.get(key, { range: request.headers });
  } catch {
    return new Response('Range not satisfiable', { status: 416, headers: CORS });
  }
  if (!obj) return new Response('Not found', { status: 404, headers: CORS });

  const headers = new Headers(CORS);
  obj.writeHttpMetadata(headers);
  const type = headers.get('content-type') || 'application/octet-stream';
  const risky = RISKY.test(type);
  if (risky) headers.set('content-type', 'application/octet-stream');
  const name = (obj.customMetadata && obj.customMetadata.name) || key.split('/').pop();
  const asciiName = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  headers.set('content-disposition', `${url.searchParams.has('dl') || risky ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');

  let status = 200;
  const r = obj.range;
  if (request.method === 'GET' && r && request.headers.has('range')) {
    let start, end;
    if (r.suffix !== undefined) { start = Math.max(0, obj.size - r.suffix); end = obj.size - 1; }
    else { start = r.offset || 0; end = r.length !== undefined ? start + r.length - 1 : obj.size - 1; }
    headers.set('content-range', `bytes ${start}-${end}/${obj.size}`);
    headers.set('content-length', String(end - start + 1));
    status = 206;
  } else {
    headers.set('content-length', String(obj.size));
  }
  return new Response(request.method === 'HEAD' ? null : obj.body, { status, headers });
}

async function removeFiles(keys) {
  keys = keys.map(String).filter(knownKey);
  for (let i = 0; i < keys.length; i += 1000) await FILES.delete(keys.slice(i, i + 1000));
  return true;
}

function mediaTypeFor(mime) {
  mime = String(mime || '');
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || mime.startsWith('text/') || mime.startsWith('application/msword') || mime.startsWith('application/vnd.')) return 'document';
  return 'other';
}

// ════════════════════════════════════════════════════════════════════════════
//  Private upload links (creators — no login)
// ════════════════════════════════════════════════════════════════════════════
async function activeLink(token) {
  if (!token) return null;
  const r = await DB.prepare('SELECT * FROM upload_links WHERE token = ?').bind(String(token)).first();
  if (!r) return null;
  const l = rowOut('upload_links', r);
  return l.is_active && (!l.expires_at || new Date(l.expires_at) > new Date()) ? l : null;
}

async function linkInfo(token) {
  const l = await activeLink(token);
  if (!l) return null;
  const season = await getRow('seasons', l.season_id);
  const talent = await getRow('talents', l.talent_id);
  return { label: l.label, instructions: l.instructions, season_name: season ? season.name : null, talent_name: talent ? talent.name : null };
}

// Each link gets its own folder: creators/<name>-<id>/
async function linkFolder(l) {
  if (l.folder_id) return l.folder_id;
  const folder = `creators/${safeName(l.label || 'creator').slice(0, 40)}-${l.id.slice(0, 8)}/`;
  await DB.prepare('UPDATE upload_links SET folder_id = ? WHERE id = ? AND folder_id IS NULL').bind(folder, l.id).run();
  return (await getRow('upload_links', l.id)).folder_id || folder;
}

async function linkStartUpload(req) {
  const l = await activeLink(req.linkToken);
  if (!l) fail('This upload link is no longer active. Please contact the team.');
  return startUpload(await linkFolder(l), req);
}

async function linkSubmit(req) {
  const l = await activeLink(req.linkToken);
  if (!l) fail('This upload link is no longer active. Please contact the team.');
  const key = String(req.fileId || '');
  if (!l.folder_id || !key.startsWith(l.folder_id) || !knownKey(key)) fail('Invalid upload.');
  if (await DB.prepare('SELECT 1 FROM assets WHERE storage_path = ?').bind(key).first()) fail('This file was already sent.');
  const file = await FILES.head(key);
  if (!file) fail('We could not find the uploaded file. Please try again.');
  const mime = (file.httpMetadata && file.httpMetadata.contentType) || req.mime_type || 'application/octet-stream';
  const fileName = req.file_name || (file.customMetadata && file.customMetadata.name) || key.split('/').pop();
  const asset = await insertRow('assets', {
    title: String(req.title || '').trim().slice(0, 300) || fileName,
    description: String(req.description || '').trim().slice(0, 5000) || null,
    category: 'final', media_type: mediaTypeFor(mime),
    season_id: l.season_id, talent_id: l.talent_id, upload_link_id: l.id, source: 'talent',
    storage_path: key, file_name: fileName, mime_type: mime, size_bytes: file.size,
    status: 'pending', uploaded_by: l.label,
  });
  await DB.prepare('UPDATE upload_links SET upload_count = COALESCE(upload_count, 0) + 1, last_upload_at = ? WHERE id = ?')
    .bind(nowIso(), l.id).run();
  return asset.id;
}

async function linkSubmissions(token) {
  const l = await activeLink(token);
  if (!l) return [];
  const r = await DB.prepare('SELECT title, media_type, status, created_at FROM assets WHERE upload_link_id = ? ORDER BY created_at DESC LIMIT 200')
    .bind(l.id).all();
  return r.results;
}

// ════════════════════════════════════════════════════════════════════════════
//  PRINT HUB — orders from customers, worked on by admin, run by master
//
//    customer order link  → print/order.html#<orderKey>   (one shared link)
//    admin link           → print/index.html#k=<adminKey>
//    master link          → print/index.html#k=<masterKey>
//  Anyone signed in to the Creative Hub is treated as master.
// ════════════════════════════════════════════════════════════════════════════
const PRINT_STATUSES = ['new', 'pending', 'completed'];
const NOT_STICKER_OR_BANNER = { q: 'q_item', op: 'not_in', values: ['Stickers / labels', 'Banner / bunting'] };
const DEFAULT_PRINT_QUESTIONS = [
  { id: 'q_name', label: 'Your name', type: 'text', required: true, role: 'name' },
  { id: 'q_company', label: 'Company / brand', type: 'text', role: 'company' },
  { id: 'q_phone', label: 'Phone / WhatsApp', type: 'phone', required: true, role: 'phone' },
  { id: 'q_item', label: 'What do you need printed?', type: 'select', required: true, role: 'item',
    options: ['Flyers', 'Posters', 'Banner / bunting', 'Business cards', 'Stickers / labels', 'Brochures', 'Packaging', 'Other'] },
  { id: 'q_qty', label: 'Quantity', type: 'number', required: true, role: 'quantity' },
  { id: 'q_size', label: 'Size', type: 'text', required: true, help: 'e.g. A4, A5, 10cm × 15cm, 2m × 1m' },
  { id: 'q_paper', label: 'Paper type', type: 'radio', options: ['Hard card paper', 'Normal paper', 'Not sure'], help: 'Not sure? Choose “Not sure” and we’ll advise.' },
  { id: 'q_lamination', label: 'Do you need lamination?', type: 'radio', required: true, options: ['Yes', 'No'],
    help: 'A protective glossy or matte coating.', showIf: NOT_STICKER_OR_BANNER },
  { id: 'q_design', label: 'Do you have a design ready?', type: 'radio', required: true, options: ['Yes', 'No'] },
  { id: 'q_design_file', label: 'Upload your design', type: 'file', required: true, help: 'PDF, AI, PSD, PNG or JPG',
    showIf: { q: 'q_design', op: 'in', values: ['Yes'] } },
  { id: 'q_design_brief', label: 'Tell us what design you want', type: 'voice_text', required: true,
    help: 'Type it below, or record a voice note (up to 5 minutes).', showIf: { q: 'q_design', op: 'in', values: ['No'] } },
  { id: 'q_due', label: 'When do you need it?', type: 'date', required: true, role: 'deadline' },
  { id: 'q_notes', label: 'Anything else we should know?', type: 'textarea' },
];
const DEFAULT_READY_MESSAGE = 'Hi {name}! Your print order {order_no} ({item}) is completed and ready for pickup. Thank you!';
const DEFAULT_NEW_MESSAGE = "Hi {name}! We've received your print order {order_no} ({item} × {quantity}). We'll message you when it's ready.";

// Is this question shown, given the answers? (Same rule as the website.)
function isVisible(q, answers, questions, seen = {}) {
  const c = q.showIf;
  if (!c || !c.q || seen[q.id]) return true;
  seen[q.id] = true;
  const parent = questions.find((x) => x.id === c.q);
  if (!parent) return true;
  if (!isVisible(parent, answers, questions, seen)) return false;
  const v = answers[c.q];
  const vals = Array.isArray(v) ? v : (v === undefined || v === null || v === '') ? [] : [String(v)];
  if (!vals.length) return false;
  const hit = vals.some((x) => (c.values || []).includes(x));
  return c.op === 'not_in' ? !hit : hit;
}

async function printSettings() {
  let s = null;
  try { s = JSON.parse(await getSetting('PRINT_SETTINGS')); } catch { s = null; }
  if (!s) {
    s = { masterKey: newKey(), adminKey: newKey(), orderKey: newKey(), orderActive: true, adminActive: true,
          webhookUrl: '', webhookSecret: '', readyMessage: DEFAULT_READY_MESSAGE };
    await DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('PRINT_SETTINGS', ?)").bind(JSON.stringify(s)).run();
    s = JSON.parse(await getSetting('PRINT_SETTINGS')); // another request may have created them first
  }
  if (!s.readyMessage) s.readyMessage = DEFAULT_READY_MESSAGE;
  if (!s.newOrderMessage) s.newOrderMessage = DEFAULT_NEW_MESSAGE;
  if (s.notifyOnNew === undefined) s.notifyOnNew = true;
  if (s.notifyOnDone === undefined) s.notifyOnDone = true;
  if (s.teamEmails === undefined) { s.teamEmails = ''; s.teamEmailOn = false; s.siteUrl = ''; }
  return s;
}
const savePrintSettings = (s) => setSetting('PRINT_SETTINGS', JSON.stringify(s));

async function printQuestions() {
  try { return JSON.parse(await getSetting('PRINT_QUESTIONS')) || DEFAULT_PRINT_QUESTIONS; } catch { return DEFAULT_PRINT_QUESTIONS; }
}

async function printOrderKeyOk(key) {
  const s = await printSettings();
  return !!(s.orderActive && key && sameText(key, s.orderKey));
}

async function printRole(req) {
  const s = await printSettings();
  if (req.printKey && sameText(req.printKey, s.masterKey)) return 'master';
  if (req.printKey && s.adminActive && sameText(req.printKey, s.adminKey)) return 'admin';
  if (req.token) { await verify(req.token); return 'master'; }
  fail('This access link is no longer valid. Please ask for a new one.', 'PRINT_AUTH');
}

async function printRoute(req, ctx) {
  const a = req.action;
  // ── Customer (shared order link) ──
  if (a === 'printForm') return (await printOrderKeyOk(req.orderKey)) ? { questions: await printQuestions() } : null;
  if (a === 'printStartUpload') {
    if (!(await printOrderKeyOk(req.orderKey))) fail('This order link is no longer active. Please contact us.');
    return startUpload('print/', req);
  }
  if (a === 'printSubmit') {
    const created = await printSubmit(req);
    // Tell the team and the bot after replying, so the customer isn't kept waiting.
    ctx.waitUntil(afterNewOrder(created).catch((e) => console.error(e)));
    return { order_no: created.order_no };
  }

  // ── Admin & master ──
  const role = await printRole(req);
  const needMaster = () => { if (role !== 'master') fail('Only the master link can do that.'); };
  switch (a) {
    case 'printMe': return printMe(role);
    case 'printOrders': return readTable('print_orders');
    case 'printUpdate': return printUpdate(role, req.id, req.patch || {});
    case 'printNotify': return printNotifyAgain(req.id, req.kind);
    case 'printDelete': needMaster(); return printDelete(req.id);
    case 'printSaveQuestions': needMaster(); return printSaveQuestions(req.questions);
    case 'printSaveSettings': needMaster(); return printSaveSettings(req.settings || {});
    case 'printRegenerate': needMaster(); return printRegenerate(req.which);
    case 'printSetActive': needMaster(); return printSetActive(req.which, !!req.active);
    case 'printTestNotify': needMaster(); return printTestNotify(req.kind);
    case 'printTestTeamEmail': needMaster(); return teamEmail({ order_no: 'P-TEST', customer_name: 'Test Customer', company: 'Test Co',
      phone: '+60123456789', summary: 'Flyers', quantity: '500', due_date: null, answers: [], id: '' }, true);
  }
  fail('Unknown action: ' + a);
}

async function afterNewOrder(created) {
  const st = await printSettings();
  const entries = [];
  if (st.teamEmailOn && st.teamEmails) entries.push(await teamEmail(created, false));
  if (st.webhookUrl && st.notifyOnNew) entries.push(await notify('created', created, false));
  if (!entries.length) return;
  const o = await getRow('print_orders', created.id);
  if (o) await updateRow('print_orders', o.id, { history: (o.history || []).concat(entries) });
}

async function printMe(role) {
  const s = await printSettings();
  const out = { role, questions: await printQuestions(), botLinked: !!s.webhookUrl, readyMessage: s.readyMessage,
                newOrderMessage: s.newOrderMessage, notifyOnDone: s.notifyOnDone, emailReady: !!ENV.RESEND_API_KEY };
  if (role === 'master') {
    out.settings = { masterKey: s.masterKey, adminKey: s.adminKey, orderKey: s.orderKey, orderActive: s.orderActive, adminActive: s.adminActive,
                     webhookUrl: s.webhookUrl, webhookSecret: s.webhookSecret, readyMessage: s.readyMessage,
                     newOrderMessage: s.newOrderMessage, notifyOnNew: s.notifyOnNew, notifyOnDone: s.notifyOnDone,
                     teamEmails: s.teamEmails, teamEmailOn: s.teamEmailOn };
  }
  return out;
}

// Dates can't be in the past (one day of leeway for time-zone differences).
const earliestDate = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function printSubmit(req) {
  const s = await printSettings();
  if (!s.orderActive || !sameText(req.orderKey || '', s.orderKey)) fail('This order link is no longer active. Please contact us.');
  const answersIn = req.answers || {}, filesIn = req.files || {};
  const roleCol = { name: 'customer_name', company: 'company', email: 'email', phone: 'phone', item: 'summary', quantity: 'quantity', deadline: 'due_date' };
  const row = {}, answers = [];
  const cleanFiles = async (list) => {
    const out = [];
    for (const f of (list || []).slice(0, 20)) {
      const key = String(f.id || '');
      if (!key.startsWith('print/') || !knownKey(key) || !(await FILES.head(key))) fail('One of the files didn\'t finish uploading. Please attach it again.');
      out.push({ id: key, name: String(f.name || 'file').slice(0, 200), size: Number(f.size) || null, mime: f.mime || null });
    }
    return out;
  };
  const questions = await printQuestions();
  for (const q of questions) {
    if (!isVisible(q, answersIn, questions)) { answers.push({ id: q.id, label: q.label, type: q.type, value: null, hidden: true }); continue; }
    if (q.type === 'voice_text') {
      const text = String(answersIn[q.id] || '').trim().slice(0, 5000);
      const voice = await cleanFiles(filesIn[q.id]);
      if (q.required && !text && !voice.length) fail('Please answer: ' + q.label);
      answers.push({ id: q.id, label: q.label, type: q.type, value: (text || voice.length) ? { text: text || null, files: voice } : null });
      continue;
    }
    let v = q.type === 'file' ? (filesIn[q.id] || []) : answersIn[q.id];
    if (typeof v === 'string') v = v.trim().slice(0, 5000);
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (q.required && empty) fail('Please answer: ' + q.label);
    if (q.type === 'date' && !empty && String(v) < earliestDate()) fail('Please choose today or a future date for: ' + q.label);
    if (q.type === 'file' && !empty) v = await cleanFiles(v);
    answers.push({ id: q.id, label: q.label, type: q.type, value: empty ? null : v });
    if (q.role && roleCol[q.role] && !empty) row[roleCol[q.role]] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  // Order numbers count up from 1001 — done in one statement so two orders never get the same number.
  const n = await DB.prepare(`INSERT INTO settings (key, value) VALUES ('PRINT_NEXT_NO', '1001')
    ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1 RETURNING value`).first();
  row.order_no = 'P-' + n.value;
  row.status = 'new';
  row.answers = answers;
  row.history = [{ status: 'new', at: nowIso(), by: 'customer' }];
  return insertRow('print_orders', row);
}

async function findOrder(id) {
  const o = await getRow('print_orders', id);
  if (!o) fail('That order no longer exists.');
  return o;
}

async function printUpdate(role, id, patch) {
  const o = await findOrder(id);
  const p = {};
  const history = o.history || [];
  if (patch.status && PRINT_STATUSES.includes(patch.status) && patch.status !== o.status) {
    p.status = patch.status;
    history.push({ status: patch.status, at: nowIso(), by: role });
    const ps = await printSettings();
    if (patch.status === 'completed' && patch.notify !== false && ps.webhookUrl && ps.notifyOnDone) history.push(await notify('completed', o, false));
    p.history = history;
  }
  if (patch.whatsapp) { // staff opened WhatsApp with a message for the customer
    history.push({ event: 'whatsapp', kind: patch.whatsapp === 'created' ? 'created' : 'completed', at: nowIso(), by: role });
    p.history = history;
  }
  if (patch.internal_notes !== undefined) p.internal_notes = String(patch.internal_notes || '').slice(0, 20000) || null;
  return updateRow('print_orders', id, p);
}

async function printNotifyAgain(id, kind) {
  const o = await findOrder(id);
  const history = o.history || [];
  history.push(await notify(kind === 'created' ? 'created' : 'completed', o, false));
  return updateRow('print_orders', id, { history });
}

async function printDelete(id) {
  const o = await findOrder(id);
  const keys = [];
  for (const a of o.answers || []) {
    const list = a.type === 'file' ? a.value : a.type === 'voice_text' && a.value ? a.value.files : null;
    if (list && list.length) keys.push(...list.map((f) => f.id));
  }
  if (keys.length) await removeFiles(keys);
  await deleteRows('print_orders', [id]);
  return true;
}

async function printSaveQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length) fail('The form needs at least one question.');
  const types = ['text', 'textarea', 'number', 'email', 'phone', 'date', 'select', 'radio', 'checkbox', 'file', 'voice_text'];
  const cleaned = questions.slice(0, 100).map((q) => {
    if (!q.label || !String(q.label).trim()) fail('Every question needs a label.');
    return {
      id: String(q.id || ('q_' + uuid().slice(0, 8))), label: String(q.label).trim().slice(0, 300),
      type: types.includes(q.type) ? q.type : 'text', required: !!q.required,
      help: q.help ? String(q.help).slice(0, 500) : '', role: q.role || '',
      options: Array.isArray(q.options) ? q.options.map(String).filter(Boolean).slice(0, 50) : [],
      showIf: q.showIf && q.showIf.q ? { q: String(q.showIf.q), op: q.showIf.op === 'not_in' ? 'not_in' : 'in',
        values: (q.showIf.values || []).map(String).slice(0, 50) } : null,
    };
  });
  await setSetting('PRINT_QUESTIONS', JSON.stringify(cleaned));
  return cleaned;
}

async function printSaveSettings(input) {
  const s = await printSettings();
  if (input.webhookUrl !== undefined) {
    const url = String(input.webhookUrl || '').trim();
    if (url && !/^https:\/\//.test(url)) fail('The bot link must start with https://');
    s.webhookUrl = url;
  }
  if (input.webhookSecret !== undefined) s.webhookSecret = String(input.webhookSecret || '').trim();
  if (input.readyMessage !== undefined) s.readyMessage = String(input.readyMessage || '').trim() || DEFAULT_READY_MESSAGE;
  if (input.newOrderMessage !== undefined) s.newOrderMessage = String(input.newOrderMessage || '').trim() || DEFAULT_NEW_MESSAGE;
  if (input.notifyOnNew !== undefined) s.notifyOnNew = !!input.notifyOnNew;
  if (input.notifyOnDone !== undefined) s.notifyOnDone = !!input.notifyOnDone;
  if (input.teamEmails !== undefined) {
    const list = String(input.teamEmails || '').split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
    list.forEach((e) => { if (!/^\S+@\S+\.\S+$/.test(e)) fail('“' + e + '” doesn’t look like an email address.'); });
    s.teamEmails = list.join(', ');
  }
  if (input.teamEmailOn !== undefined) s.teamEmailOn = !!input.teamEmailOn;
  if (input.siteUrl && /^https?:\/\//.test(input.siteUrl)) s.siteUrl = String(input.siteUrl).split('#')[0];
  await savePrintSettings(s);
  return (await printMe('master')).settings;
}

async function printRegenerate(which) {
  const s = await printSettings();
  const field = { order: 'orderKey', admin: 'adminKey', master: 'masterKey' }[which];
  if (!field) fail('Unknown link.');
  s[field] = newKey();
  await savePrintSettings(s);
  return (await printMe('master')).settings;
}

async function printSetActive(which, active) {
  const s = await printSettings();
  const field = { order: 'orderActive', admin: 'adminActive' }[which];
  if (!field) fail("That link can't be turned off.");
  s[field] = active;
  await savePrintSettings(s);
  return (await printMe('master')).settings;
}

// ── Bot notifications: "order.created" (new order) and "order.completed" ──
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dueText(due) {
  if (!due) return '';
  const d = new Date(String(due).length === 10 ? due + 'T00:00:00Z' : due);
  return isNaN(d) ? String(due) : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function fillMessage(template, o) {
  const name = o.customer_name ? String(o.customer_name).split(' ')[0] : 'there';
  return String(template)
    .replace(/\{name\}/g, name).replace(/\{full_name\}/g, o.customer_name || '')
    .replace(/\{order_no\}/g, o.order_no || '').replace(/\{item\}/g, o.summary || 'your order')
    .replace(/\{quantity\}/g, o.quantity || '').replace(/\{company\}/g, o.company || '').replace(/\{due\}/g, dueText(o.due_date));
}

function teamMessage(o) {
  const who = (o.customer_name || 'a customer') + (o.company ? ' (' + o.company + ')' : '');
  const what = [o.summary, o.quantity ? '× ' + o.quantity : ''].filter(Boolean).join(' ');
  const due = dueText(o.due_date);
  return 'New print order ' + o.order_no + ' from ' + who + (what ? ': ' + what : '') + (due ? ', due ' + due : '') + '.';
}

function notifyPayload(kind, o, s, test) {
  const done = kind === 'completed';
  const files = [];
  for (const a of o.answers || []) {
    if (a.hidden || !a.value) continue;
    const list = a.type === 'file' ? a.value : a.type === 'voice_text' ? (a.value.files || []) : [];
    list.forEach((f) => files.push({ name: f.name, url: fileUrl(f.id), voice_note: a.type === 'voice_text' }));
  }
  const out = {
    event: done ? 'order.completed' : 'order.created', test: !!test, order_no: o.order_no, status: done ? 'completed' : 'new',
    message: fillMessage(done ? s.readyMessage : s.newOrderMessage, o),
    customer: { name: o.customer_name || null, company: o.company || null, phone: o.phone || null, email: o.email || null },
    order: {
      item: o.summary || null, quantity: o.quantity || null, due_date: o.due_date || null, files,
      answers: (o.answers || []).filter((a) => !a.hidden).map((a) => {
        let v = a.value;
        if (a.type === 'file' && v) v = v.map((f) => f.name).join(', ');
        else if (a.type === 'voice_text') v = v ? [v.text, (v.files || []).length ? 'Voice note attached' : ''].filter(Boolean).join(' · ') : null;
        else if (Array.isArray(v)) v = v.join(', ');
        return { question: a.label, answer: v };
      }),
    },
  };
  out[done ? 'completed_at' : 'created_at'] = nowIso();
  out.team_message = done
    ? 'Order ' + o.order_no + ' for ' + (o.customer_name || 'a customer') + (o.company ? ' (' + o.company + ')' : '') + ' is completed and ready for pickup.'
    : teamMessage(o);
  return out;
}

// Sends the order to the bot link. Returns a history entry describing what happened.
async function notify(kind, o, test) {
  const s = await printSettings();
  const at = nowIso();
  if (!s.webhookUrl) return { event: 'notify', kind, ok: false, at, detail: 'No bot linked yet — customer was not notified.' };
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (s.webhookSecret) headers['X-Webhook-Secret'] = s.webhookSecret;
    const res = await fetch(s.webhookUrl, { method: 'POST', headers, body: JSON.stringify(notifyPayload(kind, o, s, test)), signal: AbortSignal.timeout(15000) });
    return res.ok
      ? { event: 'notify', kind, ok: true, at, detail: kind === 'completed' ? 'Customer notified via bot.' : 'Bot told about the new order.' }
      : { event: 'notify', kind, ok: false, at, detail: 'Bot replied with an error (' + res.status + ').' };
  } catch (e) {
    return { event: 'notify', kind, ok: false, at, detail: 'Could not reach the bot: ' + String((e && e.message) || e).slice(0, 150) };
  }
}

function printTestNotify(kind) {
  const sample = { order_no: 'P-TEST', customer_name: 'Test Customer', company: 'Test Co', phone: '+60123456789', email: 'test@example.com',
                   summary: 'Flyers', quantity: '500', due_date: null, answers: [] };
  return notify(kind === 'created' ? 'created' : 'completed', sample, true);
}

// ── Team alert by email (through Resend — set the RESEND_API_KEY secret to turn it on) ──
async function teamEmail(o, test) {
  const s = await printSettings();
  const at = nowIso();
  const to = String(s.teamEmails || '').split(/,\s*/).filter(Boolean);
  if (!to.length) return { event: 'team', ok: false, at, detail: 'No team email addresses saved.' };
  if (!ENV.RESEND_API_KEY) return { event: 'team', ok: false, at, detail: 'Email sending isn\'t set up yet (see README → Team email alerts).' };
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = (o.answers || []).filter((a) => !a.hidden && a.value !== null && a.value !== '').map((a) => {
    let v = a.value;
    if (a.type === 'file') v = v.map((f) => f.name).join(', ');
    else if (a.type === 'voice_text') v = [v.text, (v.files || []).length ? '(voice note attached)' : ''].filter(Boolean).join(' ');
    else if (Array.isArray(v)) v = v.join(', ');
    return '<tr><td style="color:#777;padding:4px 12px 4px 0;vertical-align:top">' + esc(a.label) + '</td><td style="padding:4px 0"><b>' + esc(v) + '</b></td></tr>';
  }).join('');
  const link = s.siteUrl && o.id ? s.siteUrl + '#/order/' + o.id : '';
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d1033">' +
    '<p style="font-size:16px"><b>' + esc(teamMessage(o)) + '</b></p>' +
    (test ? '<p style="color:#b00">This is a test email from GIG Print Hub.</p>' : '') +
    (rows ? '<table style="border-collapse:collapse;margin:8px 0 16px">' + rows + '</table>' : '') +
    (link ? '<p><a href="' + esc(link) + '" style="background:#ff3d7f;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none">Open the order</a></p>' : '') +
    '</div>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ENV.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ENV.MAIL_FROM || 'GIG Print Hub <onboarding@resend.dev>', to,
        subject: (test ? '[TEST] ' : '') + teamMessage(o), html, text: teamMessage(o) + (link ? '\n\n' + link : '') }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { event: 'team', ok: true, at, detail: 'Emailed ' + to.join(', ') + '.' };
    const why = (await res.text().catch(() => '')).slice(0, 150);
    return { event: 'team', ok: false, at, detail: 'Could not send the team email (' + res.status + ')' + (why ? ': ' + why : '.') };
  } catch (e) {
    return { event: 'team', ok: false, at, detail: 'Could not send the team email: ' + String((e && e.message) || e).slice(0, 150) };
  }
}
