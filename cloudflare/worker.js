/**
 * ============================================================================
 *  GIG Creative Hub — backend on Cloudflare
 *
 *  A Cloudflare Worker (this file) with:
 *    • D1  (binding "DB")    — all the data: talents, links, approvals, usage, print orders, POS sales…
 *    • R2  (binding "FILES") — all the files: photos, videos, brand kit, creator uploads, print artwork
 *
 *  The POS uses the same price maths as the till: ../js/pos/model.js (wrangler bundles it in on deploy).
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
 * ============================================================================
 */
import * as POS from '../js/pos/model.js';

const TOKEN_DAYS = 30;           // how long a team login lasts
const PBKDF2_ROUNDS = 20000;     // password hashing strength (kept modest for the free plan's CPU limit)
const CHUNK = 10 * 1024 * 1024;  // upload part size — big files are sent in pieces of this size
const SCHEMA_V = '13';            // bump when SCHEMA changes so new columns get added
const GB = 1e9;                  // storage is counted the way Cloudflare bills it (1 GB = 1,000,000,000 bytes)
const DEFAULT_LIMIT_GB = 10;     // uploads stop here (R2's free allowance) — change it in Settings

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
                         'reviewed_at', 'use_count', 'last_used_on', 'uploaded_by', 'cover_path', 'caption', 'external_url',
                         'thumb_path', 'preview_path', 'created_at', 'updated_at'],
                  num: ['size_bytes', 'use_count'], arr: ['tags'] },
  asset_usage:  { cols: ['id', 'asset_id', 'channel', 'note', 'used_on', 'created_by', 'created_at'] },
  print_orders: { cols: ['id', 'order_no', 'status', 'customer_name', 'company', 'phone', 'email', 'summary', 'quantity',
                         'due_date', 'answers', 'history', 'internal_notes', 'steps', 'created_at', 'updated_at'],
                  json: ['answers', 'history', 'steps'] },
  // The team (everyone except owners): they join with a name + 6-digit passcode and the owner approves them.
  // hub_access = true opens the Creative Hub as well as the Print Hub. link_key = their personal sign-in link.
  // email is only used to send a "forgot passcode" link (reset_hash / reset_exp hold that one-time link).
  print_staff:  { cols: ['id', 'name', 'login_name', 'email', 'pass_hash', 'pass_salt', 'status', 'link_key', 'is_active', 'hub_access',
                         'reset_hash', 'reset_exp', 'shared', 'requested_at', 'last_used_at', 'created_at', 'pos_role', 'pos_only', 'pos_stores'],
                  bool: ['is_active', 'hub_access', 'shared', 'pos_only'], json: ['pos_stores'] },
  // Phones and computers that get a notification for every new order (even with the app closed).
  push_subs:    { cols: ['id', 'endpoint', 'p256dh', 'auth', 'who', 'device', 'access', 'ref', 'key_hash', 'created_at'] },

  // ── GIG POS (money is in sen: RM 4.50 = 450) ──
  pos_stores:     { cols: ['id', 'name', 'brand', 'code', 'address', 'phone', 'settings', 'is_active', 'sort_order', 'created_at', 'updated_at'],
                    json: ['settings'], bool: ['is_active'], num: ['sort_order'] },
  pos_categories: { cols: ['id', 'store_id', 'name', 'color', 'sort_order', 'created_at'], num: ['sort_order'] },
  pos_products:   { cols: ['id', 'store_id', 'category_id', 'name', 'sku', 'price', 'cost', 'color', 'modifier_ids', 'track_stock', 'stock',
                           'low_stock', 'is_active', 'sort_order', 'created_at', 'updated_at'],
                    num: ['price', 'cost', 'stock', 'low_stock', 'sort_order'], bool: ['track_stock', 'is_active'], json: ['modifier_ids'] },
  // A group of choices for products, e.g. "Sugar level" (pick 1) or "Toppings" (pick up to 3), each with an extra price.
  pos_modifiers:  { cols: ['id', 'store_id', 'name', 'options', 'min_select', 'max_select', 'sort_order', 'created_at'],
                    json: ['options'], num: ['min_select', 'max_select', 'sort_order'] },
  // One row per sale (and per open order / parked bill). items, payments and refunds are kept as they were on the receipt.
  pos_sales:      { cols: ['id', 'store_id', 'shift_id', 'status', 'receipt_no', 'order_no', 'order_type', 'table_no', 'note',
                           'customer_id', 'customer_name', 'customer_phone', 'items', 'subtotal', 'discount', 'discount_info', 'service', 'tax',
                           'tax_included', 'rounding', 'total', 'payments', 'change_due', 'cashback_earned', 'cashback_used', 'refunds', 'refunded',
                           'kitchen', 'cashier', 'cashier_id', 'local_date', 'local_hour', 'paid_at', 'offline_at', 'created_at', 'updated_at'],
                    json: ['items', 'payments', 'refunds', 'discount_info'], bool: ['tax_included'],
                    num: ['order_no', 'subtotal', 'discount', 'service', 'tax', 'rounding', 'total', 'change_due', 'cashback_earned', 'cashback_used', 'refunded', 'local_hour'] },
  // For reports: one row per item sold or refunded (refunds negative), and one per payment or refund paid out.
  pos_lines:      { cols: ['id', 'sale_id', 'store_id', 'shift_id', 'kind', 'product_id', 'name', 'category', 'qty', 'net', 'cost', 'cashier',
                           'local_date', 'local_hour', 'created_at'], num: ['qty', 'net', 'cost', 'local_hour'] },
  pos_payments:   { cols: ['id', 'sale_id', 'store_id', 'shift_id', 'kind', 'method', 'amount', 'cashier', 'local_date', 'created_at'], num: ['amount'] },
  pos_shifts:     { cols: ['id', 'store_id', 'status', 'opened_by', 'opened_at', 'opening_float', 'moves', 'closed_by', 'closed_at', 'counted',
                           'summary', 'note', 'created_at', 'updated_at'], json: ['moves', 'summary'], num: ['opening_float', 'counted'] },
  pos_customers:  { cols: ['id', 'phone', 'name', 'email', 'birthday', 'notes', 'visits', 'spent', 'last_visit_at', 'last_store_id',
                           'created_at', 'updated_at'], num: ['visits', 'spent'] },
  // Cashback balance per customer per brand (outlets of the same brand share it).
  pos_wallets:    { cols: ['id', 'customer_id', 'brand', 'balance', 'earned', 'used', 'created_at', 'updated_at'], num: ['balance', 'earned', 'used'] },
  pos_stock_moves: { cols: ['id', 'store_id', 'product_id', 'product_name', 'qty_change', 'reason', 'note', 'sale_id', 'stock_after', 'who', 'created_at'],
                    num: ['qty_change', 'stock_after'] },
};

const DEFAULTS = {
  team_members: { session_v: 0 },
  seasons:      { color: '#6d5efc', sort_order: 0 },
  talents:      { status: 'prospect', tags: [], languages: [] },
  upload_links: { is_active: true, upload_count: 0 },
  assets:       { category: 'final', media_type: 'other', source: 'team', tags: [], status: 'pending', use_count: 0 },
  asset_usage:  {},
  print_orders: { status: 'new', history: [] },
  print_staff:  { is_active: true, hub_access: false, status: 'approved' },
  push_subs:    {},
  pos_stores:     { is_active: true, sort_order: 0 },
  pos_categories: { sort_order: 0 },
  pos_products:   { is_active: true, track_stock: false, stock: 0, sort_order: 0, modifier_ids: [] },
  pos_modifiers:  { min_select: 0, max_select: 1, sort_order: 0 },
  pos_sales:      {}, pos_lines: {}, pos_payments: {}, pos_stock_moves: {},
  pos_shifts:     { moves: [] },
  pos_customers:  { visits: 0, spent: 0 },
  pos_wallets:    { balance: 0, earned: 0, used: 0 },
};

const INDEXES = [
  'CREATE UNIQUE INDEX IF NOT EXISTS team_members_email ON team_members (email)',
  'CREATE UNIQUE INDEX IF NOT EXISTS upload_links_token ON upload_links (token)',
  'CREATE INDEX IF NOT EXISTS assets_link ON assets (upload_link_id)',
  'CREATE INDEX IF NOT EXISTS assets_path ON assets (storage_path)',
  'CREATE INDEX IF NOT EXISTS usage_asset ON asset_usage (asset_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS print_staff_key ON print_staff (link_key)',
  'CREATE UNIQUE INDEX IF NOT EXISTS print_staff_login ON print_staff (login_name)',
  'CREATE UNIQUE INDEX IF NOT EXISTS print_staff_email ON print_staff (email)',
  'CREATE UNIQUE INDEX IF NOT EXISTS push_subs_endpoint ON push_subs (endpoint)',
  'CREATE INDEX IF NOT EXISTS pos_products_store ON pos_products (store_id)',
  'CREATE INDEX IF NOT EXISTS pos_categories_store ON pos_categories (store_id)',
  'CREATE INDEX IF NOT EXISTS pos_modifiers_store ON pos_modifiers (store_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS pos_sales_receipt ON pos_sales (receipt_no)',
  'CREATE INDEX IF NOT EXISTS pos_sales_date ON pos_sales (local_date, store_id)',
  'CREATE INDEX IF NOT EXISTS pos_sales_status ON pos_sales (store_id, status)',
  'CREATE INDEX IF NOT EXISTS pos_sales_shift ON pos_sales (shift_id)',
  'CREATE INDEX IF NOT EXISTS pos_sales_customer ON pos_sales (customer_id)',
  'CREATE INDEX IF NOT EXISTS pos_lines_date ON pos_lines (local_date, store_id)',
  'CREATE INDEX IF NOT EXISTS pos_lines_shift ON pos_lines (shift_id)',
  'CREATE INDEX IF NOT EXISTS pos_payments_date ON pos_payments (local_date, store_id)',
  'CREATE INDEX IF NOT EXISTS pos_payments_shift ON pos_payments (shift_id)',
  'CREATE INDEX IF NOT EXISTS pos_shifts_store ON pos_shifts (store_id, opened_at)',
  "CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_one_open ON pos_shifts (store_id) WHERE status = 'open'", // one open shift per store
  'CREATE UNIQUE INDEX IF NOT EXISTS pos_customers_phone ON pos_customers (phone)',
  'CREATE UNIQUE INDEX IF NOT EXISTS pos_wallets_brand ON pos_wallets (customer_id, brand)',
  'CREATE INDEX IF NOT EXISTS pos_stock_moves_store ON pos_stock_moves (store_id, created_at)',
];

const SEED_SEASONS = [
  ['New Year', '#2a78d6'], ["Valentine's Day", '#e87ba4'], ['Back to School', '#4a3aa7'], ['Christmas & Holidays', '#e34948'],
];

// File keys in R2 start with one of these folders. previews/ holds the small copies of library photos
// (thumb_path for the grid, preview_path for the details view) — originals are never changed.
const FOLDERS = ['final/', 'raw/', 'brand/', 'creators/', 'print/', 'previews/'];

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
        req._ip = request.headers.get('CF-Connecting-IP') || 'local';
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
  if (a === 'status') return { needsSetup: (await count('team_members')) === 0, emailReset: emailReady() };
  if (a === 'setupAdmin') return setupAdmin(req);
  if (a === 'login') return login(req);
  if (a === 'linkLogin') return linkLogin(req.linkKey, req.app);
  if (a === 'passcodeLogin') return passcodeLogin(req);
  if (a === 'joinInfo') return { ok: await joinKeyOk(req.joinKey) };
  if (a === 'joinRequest') return joinRequest(req, ctx);
  if (a === 'changePasscode') return changePasscode(req);
  if (a === 'passcodeResetRequest') return passcodeResetRequest(req);
  if (a === 'passcodeResetConfirm') return passcodeResetConfirm(req);
  if (a === 'changeMyEmail') return changeMyEmail(req);
  if (a === 'linkInfo') return linkInfo(req.linkToken);
  if (a === 'linkStartUpload') return linkStartUpload(req);
  if (a === 'linkSubmit') return linkSubmit(req);
  if (a === 'linkSubmissions') return linkSubmissions(req.linkToken);
  if (a.startsWith('print')) return printRoute(req, ctx);

  // ── Team only ──
  const me = await verify(req.token);
  if (a.startsWith('pos')) return posRoute(req, me);
  if (me.viaLink && me.posOnly && a !== 'me') fail('Your access is for the POS only.', 'POS_ONLY');
  if (me.viaLink && !me.hub && a !== 'me') fail('Your access is for the Print Hub only.', 'PRINT_ONLY');
  const ownersOnly = (what) => { if (me.viaLink) fail(`Only owners (who sign in with a password) can ${what}.`); };
  if (a === 'changePassword') ownersOnly('change passwords');
  if (a === 'setStorageLimit') ownersOnly('change the storage limit');
  if (['insert', 'update', 'updateMany', 'remove', 'removeMany'].includes(a) && req.table === 'team_members') ownersOnly('manage team members');
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
      const folder = ['final', 'raw', 'brand', 'previews'].includes(req.category) ? req.category : 'final';
      return startUpload(folder + '/', req, 'team');
    }
    case 'removeFiles': return removeFiles(req.ids || []);
    case 'storage': return storageInfo();
    case 'setStorageLimit': {
      const gb = Number(req.gb);
      if (!Number.isFinite(gb) || gb < 1 || gb > 100000) fail('Enter a limit between 1 and 100,000 GB.');
      await setSetting('STORAGE_LIMIT_GB', String(Math.round(gb * 10) / 10));
      return storageInfo();
    }
    // Socmed Hub: everyone with Creative Hub access sees the overview; owners connect Buffer.
    case 'socmedOverview': return socmedOverview(!!req.refresh);
    case 'socmedSetup': ownersOnly('connect Buffer'); return socmedSetup();
    case 'socmedConnect': ownersOnly('connect Buffer'); return socmedConnect(req);
    case 'socmedRemove': ownersOnly('connect Buffer'); return socmedRemove(String(req.id || ''));
    case 'socmedSaveChannels': ownersOnly('change Socmed Hub brands'); return socmedSaveChannels(req.channels);
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
  // Team members made before joining existed count as approved.
  await DB.prepare("UPDATE print_staff SET status = 'approved' WHERE status IS NULL").run();
  // Shared admin links were removed (the team joins with the join link + passcode): any left are deleted,
  // with the phones that got order alerts through them. The people using them are signed out.
  try {
    const old = (await DB.prepare("SELECT id FROM print_staff WHERE shared = 1 OR (pass_hash IS NULL AND name IN ('Shared admin link', 'Print Hub admin link', 'Creative Hub admin link'))").all()).results.map((r) => r.id);
    if (old.length) {
      await inGroups(old, (g, q) => DB.prepare(`DELETE FROM push_subs WHERE access = 'staff' AND ref IN (${q})`).bind(...g).run());
      await deleteRows('print_staff', old);
    }
  } catch (e) { console.error('removing admin links', e); }
  // Open orders made before production steps existed get theirs (lamination / cutting) now.
  try {
    for (const o of await readTable('print_orders', "WHERE status <> 'completed' AND steps IS NULL")) {
      const steps = makeSteps(finishingFor(o.answers, o.summary));
      if (steps) await DB.prepare('UPDATE print_orders SET steps = ? WHERE id = ?').bind(JSON.stringify(steps), o.id).run();
    }
  } catch (e) { console.error('steps for open orders', e); } // never stops the app from starting
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
  out.storage = await storageInfo();
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
    checkColour(row.color);
  }
  if (t === 'assets' && row.external_url) { // a link (Google Drive, Dropbox, WeTransfer…) instead of an uploaded file
    row.external_url = cleanLink(row.external_url);
    if (!row.external_url) fail("That link doesn't look right — copy the whole link (it usually starts with https://).");
    row.storage_path = null; row.file_name = null; row.size_bytes = null; row.mime_type = null;
    if (!LINK_TYPES.includes(row.media_type)) row.media_type = 'other';
    if (row.cover_path) await checkCover(row.cover_path);
    if (row.caption != null) row.caption = cleanCaption(row.caption);
    await checkPreviews(row);
  } else if (t === 'assets') {
    const key = String(row.storage_path || '');
    if (!key) fail('Missing file.');
    if (!LIBRARY.some((p) => key.startsWith(p))) fail('That file is not in the GIG Creative Hub storage.');
    if (!(await FILES.head(key))) fail('We could not find the uploaded file. Please try again.');
    if (row.cover_path) await checkCover(row.cover_path);
    if (row.caption != null) row.caption = cleanCaption(row.caption);
    await checkPreviews(row);
  }
  if (t === 'upload_links') { row.token = newKey(); delete row.folder_id; }
  if (t === 'asset_usage' && !row.created_by) row.created_by = me.email || me.name;
  const created = await insertRow(t, row);
  if (t === 'asset_usage') await syncUsage(created.asset_id);
  return clean(t, created);
}

// A season's colour is a colour code like #ff3d7f (from the palette, the colour wheel or typed in).
const checkColour = (c) => { if (c != null && !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(c))) fail('Pick a colour, or type a colour code like #ff3d7f.'); };

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
  if (t === 'assets') {
    delete patch.storage_path;
    if (patch.cover_path) await checkCover(patch.cover_path); // null removes the cover
    await checkPreviews(patch, ['previews/', 'creators/']);
    if (patch.caption !== undefined) patch.caption = cleanCaption(patch.caption);
    if (patch.external_url !== undefined) {
      const cur = await getRow('assets', String(id || ''));
      if (!cur || !cur.external_url) delete patch.external_url; // only link items have a link
      else if (!(patch.external_url = cleanLink(patch.external_url))) fail("That link doesn't look right — copy the whole link (it usually starts with https://).");
    }
  }
  if (t === 'seasons' && patch.color !== undefined) checkColour(patch.color);
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
  if (t === 'assets') { // the small copies go with the item (the app removes the original and the cover)
    const keys = [];
    await inGroups(ids, async (g, q) => {
      const r = await DB.prepare(`SELECT thumb_path, preview_path FROM assets WHERE id IN (${q})`).bind(...g).all();
      for (const x of r.results) keys.push(x.thumb_path, x.preview_path);
    });
    const own = keys.filter((k) => k && String(k).startsWith('previews/'));
    if (own.length) await removeFiles(own);
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
  if (data.s) { // a team member: valid while they're approved and on, and their passcode/link hasn't been reset
    const st = await getRow('print_staff', data.s);
    if (!st || !st.is_active || st.status !== 'approved' || (await sessionMark(st)) !== data.k) {
      fail('Please sign in again.', 'AUTH');
    }
    return linkUser(st);
  }
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
  if (m.viaLink) return { id: m.id, email: null, name: m.name, created_at: m.created_at, links: null, viaLink: true, hub: m.hub, passcode: m.passcode, resetEmail: m.resetEmail,
    pos: m.pos, posOnly: m.posOnly };
  return { id: m.id, email: m.email, name: m.name, created_at: m.created_at, links: null };
}

// A team member (not an owner): signed in with their name + passcode, or their personal link.
const linkUser = (st) => ({ id: 'link:' + st.id, email: null, name: st.name, created_at: st.created_at, viaLink: true,
  hub: !!st.hub_access, passcode: !!st.pass_hash, resetEmail: st.email || null, staffId: st.id, linkKey: st.link_key,
  pos: POS_ROLES.includes(st.pos_role) ? st.pos_role : null, posOnly: !!st.pos_only, posStores: st.pos_stores || [] });

async function staffByKey(key) {
  if (!key) return null;
  const r = await DB.prepare('SELECT * FROM print_staff WHERE link_key = ?').bind(String(key)).first();
  return r ? rowOut('print_staff', r) : null;
}
async function touchStaff(st) { // "last opened" — written at most once an hour
  if (!st.last_used_at || Date.now() - new Date(st.last_used_at).getTime() > 3600e3) {
    await DB.prepare('UPDATE print_staff SET last_used_at = ? WHERE id = ?').bind(nowIso(), st.id).run();
  }
}

// Sessions are tied to the person's current link and passcode — resetting either signs them out everywhere.
const sessionMark = async (st) => (await sha256(st.link_key + '|' + (st.pass_hash || ''))).slice(0, 16);
async function teamSession(st) {
  const payload = b64url(enc.encode(JSON.stringify({ s: st.id, k: await sessionMark(st), x: Date.now() + TOKEN_DAYS * 86400000 })));
  return { token: payload + '.' + await sign(payload), user: publicMember(linkUser(st)) };
}

async function linkLogin(key, app) {
  const st = await staffByKey(key);
  if (!st || !st.is_active || st.status !== 'approved' || st.shared) fail('This link is no longer valid. Please ask for a new one.');
  if (app === 'pos') { // a personal sign-in link opened in the POS (e.g. the shop's tablet)
    if (!POS_ROLES.includes(st.pos_role)) fail("This person doesn't have POS access yet — the owner can give it in POS → Team.");
  } else if (st.pos_only) fail('This link opens the POS only.', 'POS_ONLY');
  else if (!st.hub_access) fail('This link opens the Print Hub only.', 'PRINT_ONLY');
  await touchStaff(st);
  return teamSession(st);
}

// ── Name + 6-digit passcode ──
const loginName = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
function checkPasscode(p) {
  if (!/^\d{6}$/.test(String(p || ''))) fail('Your passcode must be exactly 6 digits.');
}
const cleanPersonName = (n) => {
  const name = String(n || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) fail('Type your name.');
  if (name.length > 40) fail('Please use a shorter name (up to 40 characters).');
  return name;
};

// Counts tries for a key (a name, or a network address) — blocks for 15 minutes after `max`.
async function guard(key, max, message = 'Too many tries. Please wait 15 minutes and try again.') {
  const now = Date.now();
  let t = { n: 0, until: 0 };
  try { t = JSON.parse(await getSetting(key)) || t; } catch { /* first try */ }
  if (t.until > now && t.n >= max) fail(message);
  return {
    count: () => setSetting(key, JSON.stringify({ n: t.until > now ? t.n + 1 : 1, until: now + 900000 })),
    clear: async () => { if (t.n) await DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run(); },
  };
}

async function passcodeLogin(req) {
  const ln = loginName(req.name);
  const byName = await guard('pc:' + ln, 5);
  const byIp = await guard('pcip:' + req._ip, 30);
  const r = ln ? await DB.prepare('SELECT * FROM print_staff WHERE login_name = ?').bind(ln).first() : null;
  const st = r && rowOut('print_staff', r);
  const good = st && st.pass_hash && /^\d{6}$/.test(String(req.passcode || '')) && sameText(await hashPassword(req.passcode, st.pass_salt), st.pass_hash);
  if (!good) { await byName.count(); await byIp.count(); fail("That name and passcode don't match."); }
  await byName.clear();
  if (st.status !== 'approved') fail("You're waiting for approval — ask the owner to approve you, then try again.", 'PENDING');
  if (!st.is_active) fail('Your access is turned off. Please ask the owner.');
  await touchStaff(st);
  return teamSession(st);
}

const cleanEmail = (e) => {
  const email = String(e || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) fail('Type a valid email address — it\'s only used if you forget your passcode.');
  return email;
};

// ── Forgot passcode: a one-time link by email (no owner needed) ──
async function passcodeResetRequest(req) {
  if (!emailReady()) fail("Email resets aren't switched on yet — please ask the owner to give you a new passcode.", 'NO_EMAIL');
  const email = cleanEmail(req.email);
  const byIp = await guard('rsip:' + req._ip, 10, 'Too many requests. Please wait 15 minutes.');
  const byEmail = await guard('rs:' + email, 3, 'A reset email was just sent — please check your inbox (and spam), or wait 15 minutes.');
  await byIp.count(); await byEmail.count();
  const r = await DB.prepare("SELECT * FROM print_staff WHERE email = ? AND status = 'approved' AND is_active = 1").bind(email).first();
  if (r) {
    const st = rowOut('print_staff', r);
    const token = newKey() + newKey();
    await DB.prepare('UPDATE print_staff SET reset_hash = ?, reset_exp = ? WHERE id = ?').bind(await sha256(token), Date.now() + 30 * 60e3, st.id).run();
    const link = new URL('reset.html#' + token, ENV.SITE_URL).href;
    const sent = await sendEmail({
      to: email,
      subject: 'Reset your passcode',
      text: `Hi ${st.name},\n\nTap this link to choose a new 6-digit passcode (it works for 30 minutes):\n${link}\n\nDidn't ask for this? You can ignore this email — your passcode stays the same.`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1d1033"><p>Hi ${escapeHtml(st.name)},</p>
        <p>Tap the button to choose a new 6-digit passcode. The link works for 30 minutes.</p>
        <p><a href="${escapeHtml(link)}" style="background:#ff3d7f;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;display:inline-block">Choose a new passcode</a></p>
        <p style="color:#777;font-size:13px">Didn't ask for this? Ignore this email — your passcode stays the same.</p></div>`,
    });
    if (!sent.ok) fail("We couldn't send the email right now. Please try again later, or ask the owner for a new passcode.");
  }
  // Same answer either way, so nobody can find out which emails are on the team.
  return { sent: true };
}

async function passcodeResetConfirm(req) {
  const token = String(req.token || '');
  const r = token.length >= 40 ? await DB.prepare('SELECT * FROM print_staff WHERE reset_hash = ?').bind(await sha256(token)).first() : null;
  const st = r && rowOut('print_staff', r);
  if (!st || !(Number(r.reset_exp) > Date.now())) fail('This reset link has expired or was already used. Ask for a new one on the sign-in page.');
  if (st.status !== 'approved' || !st.is_active) fail('Your access is turned off. Please ask the owner.');
  checkPasscode(req.passcode);
  const salt = uuid();
  const fresh = await updateRow('print_staff', st.id, { pass_salt: salt, pass_hash: await hashPassword(req.passcode, salt), reset_hash: null, reset_exp: null });
  await touchStaff(fresh);
  return teamSession(fresh); // signs them in straight away (and everywhere else out)
}

async function changeMyEmail(req) {
  const me = await verify(req.token);
  if (!me.viaLink) fail('Owners change their details in Settings → Owners.');
  const email = cleanEmail(req.email);
  if (await DB.prepare('SELECT 1 FROM print_staff WHERE email = ? AND id <> ?').bind(email, me.staffId).first()) fail('Someone on the team already uses that email.');
  await updateRow('print_staff', me.staffId, { email });
  return { email };
}

// ── Sending email (Resend — set the RESEND_API_KEY secret and the MAIL_FROM / SITE_URL vars) ──
const emailReady = () => !!(ENV.RESEND_API_KEY && ENV.MAIL_FROM && ENV.SITE_URL);
const escapeHtml = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function sendEmail({ to, subject, text, html }) {
  try {
    const res = await fetch(ENV.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ENV.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ENV.MAIL_FROM, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.error('email failed', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return { ok: res.ok };
  } catch (e) {
    console.error('email failed', e);
    return { ok: false };
  }
}

async function changePasscode(req) {
  const me = await verify(req.token);
  if (!me.viaLink) fail('Owners sign in with a password — change it in Settings.');
  checkPasscode(req.passcode);
  const salt = uuid();
  const st = await updateRow('print_staff', me.staffId, { pass_salt: salt, pass_hash: await hashPassword(req.passcode, salt) });
  return teamSession(st);
}

// ── Joining: one shared join link; new people wait for the owner's approval ──
async function joinKeyOk(key) {
  const s = await printSettings();
  return !!(s.joinActive && key && sameText(key, s.joinKey));
}

async function joinRequest(req, ctx) {
  const ipGuard = await guard('join:' + req._ip, 5, 'Too many sign-ups from here. Please wait 15 minutes.');
  if (!(await joinKeyOk(req.joinKey))) fail('This join link is no longer active. Please ask the owner for a new one.');
  const name = cleanPersonName(req.name);
  const email = cleanEmail(req.email);
  checkPasscode(req.passcode);
  await ipGuard.count();
  const ln = loginName(name);
  if (await DB.prepare('SELECT 1 FROM print_staff WHERE login_name = ?').bind(ln).first()) {
    fail('That name is already taken — add your surname or an initial (e.g. "Ali K").');
  }
  if (await DB.prepare('SELECT 1 FROM print_staff WHERE email = ?').bind(email).first()) {
    fail('Someone on the team already uses that email.');
  }
  const waiting = (await DB.prepare("SELECT COUNT(*) AS n FROM print_staff WHERE status = 'pending'").first()).n;
  if (waiting >= 30) fail('There are too many people waiting for approval. Please ask the owner.');
  const salt = uuid();
  const st = await insertRow('print_staff', { name, login_name: ln, email, pass_salt: salt, pass_hash: await hashPassword(req.passcode, salt),
    status: 'pending', link_key: newKey(), is_active: true, hub_access: false, requested_at: nowIso() });
  ctx.waitUntil(pushOwners({ title: `${name} wants to join`, body: 'Tap to approve or decline.', url: 'index.html#/access', tag: 'join-' + st.id, at: Date.now() })
    .catch((e) => console.error(e)));
  return { status: 'pending', name };
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
async function startUpload(prefix, req, who) {
  const name = String(req.name || 'file').slice(0, 200);
  const mime = String(req.mimeType || 'application/octet-stream').slice(0, 200);
  const size = Math.max(0, Number(req.size) || 0);
  await checkSpace(size, who);
  const key = `${prefix}${uuid()}/${safeName(name)}`;
  let uploadId = null;
  if (size > CHUNK) {
    const mpu = await FILES.createMultipartUpload(key, { httpMetadata: { contentType: mime }, customMetadata: { name } });
    uploadId = mpu.uploadId;
  }
  return { uploadUrl: `${SELF}/upload/${await makeTicket({ k: key, u: uploadId, t: mime, n: name, s: size })}`, chunkSize: CHUNK };
}

async function handleUpload(request, url) {
  const d = await readTicket(url.pathname.slice('/upload/'.length));
  const length = Number(request.headers.get('content-length') || 0);
  if (request.method === 'PUT' && !d.u) {
    if (length > (d.s || 0) + 4096) fail('This file is bigger than expected. Please try again.');
    const obj = await FILES.put(d.k, request.body, { httpMetadata: { contentType: d.t }, customMetadata: { name: d.n } });
    await addStored(obj ? obj.size : length);
    return { done: true, fileId: d.k };
  }
  if (!d.u) fail('Invalid upload.');
  const mpu = FILES.resumeMultipartUpload(d.k, d.u);
  if (request.method === 'PUT') {
    const n = Number(url.searchParams.get('part'));
    if (!Number.isInteger(n) || n < 1 || n > Math.ceil((d.s || 0) / CHUNK) || length > CHUNK) fail('Invalid upload.');
    const part = await mpu.uploadPart(n, request.body);
    return { partNumber: part.partNumber, etag: part.etag };
  }
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { fail('Invalid upload.'); }
    const parts = (body.parts || []).map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }));
    if (!parts.length) fail('Invalid upload.');
    const obj = await mpu.complete(parts);
    await addStored(obj.size);
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
  let freed = 0;
  for (let i = 0; i < keys.length; i += 50) {
    const heads = await Promise.all(keys.slice(i, i + 50).map((k) => FILES.head(k).catch(() => null)));
    freed += heads.reduce((n, h) => n + (h ? h.size : 0), 0);
  }
  for (let i = 0; i < keys.length; i += 1000) await FILES.delete(keys.slice(i, i + 1000));
  if (freed) await addStored(-freed);
  return true;
}

// ── Storage limit: new uploads stop once the limit is reached, so Cloudflare never bills for more ──
// The running total is kept in settings and recounted from R2 every few hours to stay accurate.
async function storageUsed() {
  const [bytes, at] = await Promise.all([getSetting('STORED_BYTES'), getSetting('STORED_AT')]);
  if (bytes !== null && Date.now() - Number(at || 0) < 6 * 3600e3) return Math.max(0, Number(bytes) || 0);
  let total = 0, cursor;
  do {
    const r = await FILES.list({ cursor, limit: 1000 });
    for (const o of r.objects) total += o.size;
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  await setSetting('STORED_BYTES', String(total));
  await setSetting('STORED_AT', String(Date.now()));
  return total;
}

async function addStored(delta) {
  if (!delta) return;
  await DB.prepare("UPDATE settings SET value = MAX(0, CAST(value AS INTEGER) + ?) WHERE key = 'STORED_BYTES'").bind(Math.round(delta)).run();
}

async function storageInfo() {
  const limitGb = Number(await getSetting('STORAGE_LIMIT_GB')) || DEFAULT_LIMIT_GB;
  return { used: await storageUsed(), limit: limitGb * GB };
}

const gbText = (b) => (b < GB ? Math.round(b / 1e6) + ' MB' : (b / GB).toFixed(1).replace(/\.0$/, '') + ' GB');

async function checkSpace(size, who) {
  const { used, limit } = await storageInfo();
  if (used + size <= limit) return;
  if (who !== 'team') fail('Uploads are paused right now because our storage is full. Please contact the GIG team.', 'STORAGE_FULL');
  fail(used >= limit
    ? `Storage is full (${gbText(used)} of your ${gbText(limit)} limit). Delete old files, or raise the limit in Settings, to upload more.`
    : `Not enough space for this file — ${gbText(used)} of your ${gbText(limit)} limit is used. Delete old files, or raise the limit in Settings.`,
  'STORAGE_FULL');
}

// Library files live under these folders; a video's cover photo must be an uploaded image in one of them.
const LIBRARY = ['final/', 'raw/', 'brand/'];
async function checkCover(key, folders = [...LIBRARY, 'creators/'], what = 'cover photo') {
  key = String(key || '');
  if (!knownKey(key) || !folders.some((p) => key.startsWith(p))) fail(`That ${what} isn't in the GIG Creative Hub storage.`);
  const head = await FILES.head(key);
  if (!head) fail(`The ${what} didn't finish uploading. Please try again.`);
  if (!String(head.httpMetadata?.contentType || '').startsWith('image/')) fail(`The ${what} must be a photo (JPG, PNG…).`);
}
// The small copies (thumb_path / preview_path) are photos in previews/ (team) or the creator's own folder.
async function checkPreviews(row, folders = ['previews/']) {
  for (const c of ['thumb_path', 'preview_path']) if (row[c]) await checkCover(row[c], folders, 'preview');
}
const cleanCaption = (c) => String(c || '').trim().slice(0, 5000) || null;
const LINK_TYPES = ['video', 'image', 'document', 'other']; // what a link item points to

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
  return startUpload(await linkFolder(l), req, 'creator');
}

async function linkSubmit(req) {
  const l = await activeLink(req.linkToken);
  if (!l) fail('This upload link is no longer active. Please contact the team.');
  if (req.externalUrl && !req.fileId) { // the creator sent a link (Drive, Dropbox, WeTransfer…) instead of a file
    const url = cleanLink(req.externalUrl);
    if (!url) fail("That link doesn't look right — copy the whole link (it usually starts with https://).");
    if (req.coverId) await checkCover(req.coverId, [await linkFolder(l)]);
    if (req.thumbId) await checkCover(req.thumbId, [await linkFolder(l)], 'preview');
    const asset = await insertRow('assets', {
      title: String(req.title || '').trim().slice(0, 300) || 'Link from ' + (l.label || 'creator'),
      description: String(req.description || '').trim().slice(0, 5000) || null,
      category: 'final', media_type: LINK_TYPES.includes(req.mediaType) ? req.mediaType : 'other',
      season_id: l.season_id, talent_id: l.talent_id, upload_link_id: l.id, source: 'talent',
      external_url: url, status: 'pending', uploaded_by: l.label, cover_path: req.coverId || null, caption: cleanCaption(req.caption),
      thumb_path: (req.coverId && req.thumbId) || null,
    });
    await DB.prepare('UPDATE upload_links SET upload_count = COALESCE(upload_count, 0) + 1, last_upload_at = ? WHERE id = ?').bind(nowIso(), l.id).run();
    return asset.id;
  }
  const key = String(req.fileId || '');
  if (!l.folder_id || !key.startsWith(l.folder_id) || !knownKey(key)) fail('Invalid upload.');
  if (await DB.prepare('SELECT 1 FROM assets WHERE storage_path = ?').bind(key).first()) fail('This file was already sent.');
  const file = await FILES.head(key);
  if (!file) fail('We could not find the uploaded file. Please try again.');
  const mime = (file.httpMetadata && file.httpMetadata.contentType) || req.mime_type || 'application/octet-stream';
  const fileName = req.file_name || (file.customMetadata && file.customMetadata.name) || key.split('/').pop();
  if (req.coverId) await checkCover(req.coverId, [l.folder_id]);
  const previews = { thumb_path: req.thumbId || null, preview_path: req.previewId || null };
  await checkPreviews(previews, [l.folder_id]);
  const asset = await insertRow('assets', {
    title: String(req.title || '').trim().slice(0, 300) || fileName,
    description: String(req.description || '').trim().slice(0, 5000) || null,
    category: 'final', media_type: mediaTypeFor(mime),
    season_id: l.season_id, talent_id: l.talent_id, upload_link_id: l.id, source: 'talent',
    storage_path: key, file_name: fileName, mime_type: mime, size_bytes: file.size,
    status: 'pending', uploaded_by: l.label, cover_path: req.coverId || null, caption: cleanCaption(req.caption), ...previews,
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
//    staff (admin) links  → print/index.html#k=<link_key>  (one per person, in print_staff)
//    master link          → print/index.html#k=<masterKey>
//  Anyone signed in to the Creative Hub is treated as master.
// ════════════════════════════════════════════════════════════════════════════
const PRINT_STATUSES = ['new', 'pending', 'completed'];

// Production steps (same rules as js/print/model.js): an order that needs lamination (the customer chose it)
// or cutting (stickers / labels) goes Printing → waiting for lamination / cutting → Completed, and ticking
// the last step completes it. Other orders keep the plain New → Pending → Completed.
const STEP_ORDER = ['print', 'laminate', 'cut'];
const saidYes = (v) => (Array.isArray(v) ? v : [v]).some((x) => /^\s*yes\b/i.test(String(x == null ? '' : x)));
function finishingFor(answers, summary) {
  const out = [];
  if ((answers || []).some((a) => !a.hidden && (a.id === 'q_lamination' || /laminat/i.test(a.label || '')) && saidYes(a.value))) out.push('laminate');
  if (/sticker|label/i.test(summary || '')) out.push('cut');
  return out;
}
function makeSteps(finishing, prev) {
  if (!finishing || !finishing.length) return null;
  return STEP_ORDER.filter((id) => id === 'print' || finishing.includes(id))
    .map((id) => { const p = (prev || []).find((x) => x.id === id); return { id, at: (p && p.at) || null, by: (p && p.by) || null }; });
}
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
  { id: 'q_lamination', label: 'Do you want plastic lamination?', type: 'radio', required: true, options: ['Yes', 'No'],
    showIf: NOT_STICKER_OR_BANNER },
  { id: 'q_design', label: 'Do you have a design ready?', type: 'radio', required: true, options: ['Yes', 'No'] },
  { id: 'q_design_file', label: 'Upload your design', type: 'file', required: true, eitherWith: 'q_design_link',
    help: 'PDF, AI, PSD, PNG or JPG — or paste a link below instead', showIf: { q: 'q_design', op: 'in', values: ['Yes'] } },
  { id: 'q_design_link', label: 'Or paste a link to your design', type: 'link',
    help: 'Google Drive, Canva, Dropbox… make sure anyone with the link can open it.', showIf: { q: 'q_design', op: 'in', values: ['Yes'] } },
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
    s = { masterKey: newKey(), orderKey: newKey(), orderActive: true,
          webhookUrl: '', webhookSecret: '', readyMessage: DEFAULT_READY_MESSAGE };
    await DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('PRINT_SETTINGS', ?)").bind(JSON.stringify(s)).run();
    s = JSON.parse(await getSetting('PRINT_SETTINGS')); // another request may have created them first
  }
  if (!s.joinKey) { s.joinKey = newKey(); s.joinActive = true; await savePrintSettings(s); }
  if (!s.readyMessage) s.readyMessage = DEFAULT_READY_MESSAGE;
  if (!s.newOrderMessage) s.newOrderMessage = DEFAULT_NEW_MESSAGE;
  if (s.notifyOnNew === undefined) s.notifyOnNew = true;
  if (s.notifyOnDone === undefined) s.notifyOnDone = true;
  if (s.adminKey) { delete s.adminKey; delete s.adminActive; await savePrintSettings(s); } // the old shared admin link no longer works
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

// Who is using the Print Hub: the master link, one person's staff link, or someone signed in to the Creative Hub.
async function printActor(req) {
  const s = await printSettings();
  if (req.printKey && sameText(req.printKey, s.masterKey)) return { role: 'master', who: 'Master', access: 'master', keyHash: await sha256(s.masterKey), via: 'key' };
  if (req.printKey) {
    const st = await staffByKey(req.printKey);
    if (st && st.is_active && st.status === 'approved' && !st.shared) {
      if (st.pos_only) fail('Your access is for the POS only.', 'POS_ONLY');
      await touchStaff(st);
      return { role: 'admin', who: st.name || 'Admin', access: 'staff', ref: st.id, keyHash: await sha256(st.link_key), via: 'key', hub: st.hub_access };
    }
  }
  if (req.token) {
    const m = await verify(req.token);
    if (m.viaLink && m.posOnly) fail('Your access is for the POS only.', 'POS_ONLY');
    if (m.viaLink) return { role: 'admin', who: m.name, access: 'staff', ref: m.staffId, keyHash: await sha256(m.linkKey), via: 'token', hub: m.hub, passcode: m.passcode };
    return { role: 'master', who: m.name || m.email, access: 'team', ref: m.email, via: 'token', hub: true };
  }
  fail('This access link is no longer valid. Please ask for a new one.', 'PRINT_AUTH');
}

// ── Staff links: one private admin link per person, no account needed ──
async function staffList() {
  return (await readTable('print_staff', 'WHERE shared IS NULL OR shared = 0')).map((x) => ({ id: x.id, name: x.name, key: x.link_key, active: x.is_active, hub: x.hub_access,
    status: x.status || 'approved', passcode: !!x.pass_hash, email: x.email, requested_at: x.requested_at, last_used_at: x.last_used_at, created_at: x.created_at,
    pos: x.pos_role || null, posOnly: !!x.pos_only }));
}

const cleanStaffName = (name) => {
  const n = String(name || '').trim().slice(0, 60);
  if (!n) fail("Type the person's name.");
  return n;
};

async function staffAdd(name, hub) {
  if ((await count('print_staff')) >= 200) fail('You can have up to 200 team links.');
  await insertRow('print_staff', { name: cleanStaffName(name), link_key: newKey(), is_active: true, hub_access: !!hub });
  return staffList();
}

async function staffUpdate(id, patch) {
  const p = {};
  if (patch.name !== undefined) {
    p.name = cleanStaffName(patch.name);
    p.login_name = loginName(p.name);
    const taken = await DB.prepare('SELECT id FROM print_staff WHERE login_name = ? AND id <> ?').bind(p.login_name, String(id || '')).first();
    if (taken) fail('Someone already has that name — add a surname or an initial.');
  }
  if (patch.active !== undefined) p.is_active = !!patch.active;
  if (patch.hub !== undefined) p.hub_access = !!patch.hub;
  if (patch.hub) p.pos_only = false; // given the Creative Hub: no longer POS only
  await updateRow('print_staff', String(id || ''), p);
  return staffList();
}

async function staffRegenerate(id) {
  await updateRow('print_staff', String(id || ''), { link_key: newKey(), last_used_at: null });
  return staffList();
}

// Forgot passcode: a new 6-digit passcode for the owner to pass on. Signs them out everywhere and stops old devices' alerts.
const randomPasscode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');

async function staffResetPasscode(id) {
  const passcode = randomPasscode();
  const salt = uuid();
  await updateRow('print_staff', String(id || ''), { pass_salt: salt, pass_hash: await hashPassword(passcode, salt), link_key: newKey() });
  return { staff: await staffList(), passcode };
}

async function staffApprove(id, hub, pos) {
  const st = await getRow('print_staff', String(id || ''));
  if (!st) fail('That request no longer exists.');
  await updateRow('print_staff', st.id, pos // POS only: a cashier at the till, no Print Hub or Creative Hub
    ? { status: 'approved', hub_access: false, is_active: true, pos_only: true, pos_role: POS_ROLES.includes(st.pos_role) ? st.pos_role : 'cashier' }
    : { status: 'approved', hub_access: !!hub, is_active: true });
  return staffList();
}

async function printRoute(req, ctx) {
  const a = req.action;
  // ── Customer (shared order link) ──
  if (a === 'printForm') return (await printOrderKeyOk(req.orderKey)) ? { questions: await printQuestions() } : null;
  if (a === 'printStartUpload') {
    if (!(await printOrderKeyOk(req.orderKey))) fail('This order link is no longer active. Please contact us.');
    return startUpload('print/', req, 'customer');
  }
  if (a === 'printSubmit') {
    const created = await printSubmit(req);
    // Tell the team and the bot after replying, so the customer isn't kept waiting.
    ctx.waitUntil(afterNewOrder(created).catch((e) => console.error(e)));
    return { order_no: created.order_no };
  }

  // ── Staff (admin) & master ──
  const actor = await printActor(req);
  const needMaster = () => { if (actor.role !== 'master') fail('Only the master link can do that.'); };
  switch (a) {
    case 'printMe': return printMe(actor);
    case 'printOrders': return readTable('print_orders');
    case 'printStaffStartUpload': return startUpload('print/', req, 'team');
    case 'printAddOrder': {
      const created = await createOrder(req.answers, req.files, { strict: false, by: actor.who, status: req.status, notes: req.notes });
      ctx.waitUntil(afterNewOrder(created, { except: actor, bot: req.notifyBot !== false }).catch((e) => console.error(e)));
      return created;
    }
    case 'printUpdate': return printUpdate(actor, req.id, req.patch || {});
    case 'printNotify': return printNotifyAgain(req.id, req.kind);
    case 'printDelete': return printDelete(req.id); // the team can delete orders too
    case 'printSaveQuestions': needMaster(); return printSaveQuestions(req.questions);
    case 'printSaveSettings': needMaster(); return printSaveSettings(req.settings || {});
    case 'printRegenerate': needMaster(); return printRegenerate(req.which);
    case 'printSetActive': needMaster(); return printSetActive(req.which, !!req.active);
    case 'printStaffAdd': needMaster(); return staffAdd(req.name, req.hub);
    case 'printStaffUpdate': needMaster(); return staffUpdate(req.id, req.patch || {});
    case 'printStaffRegenerate': needMaster(); return staffRegenerate(req.id);
    case 'printStaffDelete': needMaster(); await deleteRows('print_staff', [String(req.id || '')]); return staffList();
    case 'printStaffApprove': needMaster(); return staffApprove(req.id, req.hub, req.pos);
    case 'printStaffResetPasscode': needMaster(); return staffResetPasscode(req.id);
    case 'printPushSubscribe': return pushSubscribe(actor, req.subscription || {}, req.device);
    case 'printPushUnsubscribe': await DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(String(req.endpoint || '')).run(); return true;
    case 'printPushTest': return pushTest(req.endpoint);
    case 'printPushRemove': needMaster(); await deleteRows('push_subs', [String(req.id || '')]); return pushDevices();
    case 'printTestNotify': needMaster(); return printTestNotify(req.kind);
  }
  fail('Unknown action: ' + a);
}

async function afterNewOrder(created, { except = null, bot = true } = {}) {
  const st = await printSettings();
  await pushNewOrder(created, except);
  if (!(bot && st.webhookUrl && st.notifyOnNew)) return;
  const entry = await notify('created', created, false);
  const o = await getRow('print_orders', created.id);
  if (o) await updateRow('print_orders', o.id, { history: (o.history || []).concat([entry]) });
}

async function printMe(actor) {
  const s = await printSettings();
  const role = actor.role;
  const out = { role, name: actor.who, via: actor.via || 'key', hub: !!actor.hub, passcode: !!actor.passcode, questions: await printQuestions(), botLinked: !!s.webhookUrl, readyMessage: s.readyMessage,
                newOrderMessage: s.newOrderMessage, notifyOnDone: s.notifyOnDone, hubLinks: true,
                pushKey: (await vapid()).publicKey,
                storage: await storageInfo() };
  if (role === 'master') {
    out.staff = await staffList();
    out.devices = await pushDevices();
    out.settings = { masterKey: s.masterKey, orderKey: s.orderKey, orderActive: s.orderActive, joinKey: s.joinKey, joinActive: s.joinActive,
                     webhookUrl: s.webhookUrl, webhookSecret: s.webhookSecret, readyMessage: s.readyMessage,
                     newOrderMessage: s.newOrderMessage, notifyOnNew: s.notifyOnNew, notifyOnDone: s.notifyOnDone };
  }
  return out;
}

const blank = (v) => v == null || (typeof v === 'string' ? !v.trim() : Array.isArray(v) && !v.length);
function cleanLink(v) {
  let s = String(v || '').trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') && !/\s/.test(s) ? u.href.slice(0, 2000) : null; } catch { return null; }
}

// Dates can't be in the past (one day of leeway for time-zone differences).
const earliestDate = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function printSubmit(req) {
  const s = await printSettings();
  if (!s.orderActive || !sameText(req.orderKey || '', s.orderKey)) fail('This order link is no longer active. Please contact us.');
  return createOrder(req.answers, req.files, { strict: true, by: 'customer' });
}

// Builds and saves an order from form answers. Customers (strict) must answer every required question;
// staff adding an order for a walk-in or phone customer only need the customer's name or phone.
async function createOrder(answersIn, filesIn, { strict, by, status = 'new', notes = null }) {
  answersIn = answersIn || {}; filesIn = filesIn || {};
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
      if (strict && q.required && !text && !voice.length) fail('Please answer: ' + q.label);
      answers.push({ id: q.id, label: q.label, type: q.type, value: (text || voice.length) ? { text: text || null, files: voice } : null });
      continue;
    }
    let v = q.type === 'file' ? (filesIn[q.id] || []) : answersIn[q.id];
    if (typeof v === 'string') v = v.trim().slice(0, 5000);
    if (q.type === 'link' && v) { // a web link: add https:// if missing, refuse anything else
      const link = cleanLink(v);
      if (!link) fail('Please check the link for: ' + q.label);
      v = link;
    }
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    // eitherWith: also answered when that other question is (e.g. a design file OR a link)
    const other = q.eitherWith && questions.find((x) => x.id === q.eitherWith);
    const otherDone = other && isVisible(other, answersIn, questions) && !blank(other.type === 'file' ? filesIn[other.id] : answersIn[other.id]);
    if (strict && q.required && empty && !otherDone) fail('Please answer: ' + q.label + (other ? ' (or ' + other.label + ')' : ''));
    if (strict && q.type === 'date' && !empty && String(v) < earliestDate()) fail('Please choose today or a future date for: ' + q.label);
    if (q.type === 'file' && !empty) v = await cleanFiles(v);
    answers.push({ id: q.id, label: q.label, type: q.type, value: empty ? null : v });
    if (q.role && roleCol[q.role] && !empty) row[roleCol[q.role]] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  if (!strict && !row.customer_name && !row.phone && !row.company) fail("Add at least the customer's name or phone number.");
  // Order numbers count up from 1001 — done in one statement so two orders never get the same number.
  const n = await DB.prepare(`INSERT INTO settings (key, value) VALUES ('PRINT_NEXT_NO', '1001')
    ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1 RETURNING value`).first();
  row.order_no = 'P-' + n.value;
  row.status = PRINT_STATUSES.includes(status) ? status : 'new';
  row.answers = answers;
  row.history = [{ status: 'new', at: nowIso(), by, ...(strict ? {} : { added: true }) }];
  if (row.status !== 'new') row.history.push({ status: row.status, at: nowIso(), by });
  row.steps = makeSteps(finishingFor(answers, row.summary));
  if (row.steps && row.status === 'completed') row.steps.forEach((x) => { x.at = nowIso(); x.by = by || null; });
  if (notes) row.internal_notes = String(notes).slice(0, 20000);
  return insertRow('print_orders', row);
}

async function findOrder(id) {
  const o = await getRow('print_orders', id);
  if (!o) fail('That order no longer exists.');
  return o;
}

async function printUpdate(actor, id, patch) {
  const o = await findOrder(id);
  const p = {};
  const history = o.history || [];
  const at = nowIso();
  // Which finishing steps this order needs (staff can change what the order form decided).
  if (patch.finishing && typeof patch.finishing === 'object') {
    const fin = ['laminate', 'cut'].filter((k) => patch.finishing[k]);
    o.steps = p.steps = makeSteps(fin, o.steps);
    history.push({ event: 'finishing', steps: fin, at, by: actor.who });
    p.history = history;
  }
  let status = patch.status && PRINT_STATUSES.includes(patch.status) ? patch.status : null;
  if (patch.step) { // a production step ticked (or un-ticked): the status follows
    const s = (o.steps || []).find((x) => x.id === patch.step);
    if (!s) fail("This order doesn't have that step.");
    const done = patch.done !== false;
    if (done && !s.at) { s.at = at; s.by = actor.who || null; history.push({ event: 'step', step: s.id, at, by: actor.who }); }
    if (!done && s.at) { s.at = null; s.by = null; history.push({ event: 'step', step: s.id, undone: true, at, by: actor.who }); }
    p.steps = o.steps;
    p.history = history;
    status = o.steps.every((x) => x.at) ? 'completed' : o.steps.some((x) => x.at) || o.status === 'completed' ? 'pending' : o.status;
  } else if (status && status !== o.status && o.steps && o.steps.length) { // moved by hand: keep the steps in line
    if (status === 'completed') o.steps.forEach((x) => { if (!x.at) { x.at = at; x.by = actor.who || null; } });
    else if (status === 'new') o.steps.forEach((x) => { x.at = null; x.by = null; });
    else if (status === 'pending' && o.status === 'completed') { const last = [...o.steps].reverse().find((x) => x.at); if (last) { last.at = null; last.by = null; } }
    p.steps = o.steps;
  }
  if (status && status !== o.status) {
    p.status = status;
    history.push({ status, at, by: actor.who });
    const ps = await printSettings();
    if (status === 'completed' && patch.notify !== false && ps.webhookUrl && ps.notifyOnDone) history.push(await notify('completed', o, false));
    p.history = history;
  }
  if (patch.whatsapp) { // staff opened WhatsApp with a message for the customer
    history.push({ event: 'whatsapp', kind: patch.whatsapp === 'created' ? 'created' : 'completed', at: nowIso(), by: actor.who });
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
  const types = ['text', 'textarea', 'number', 'email', 'phone', 'date', 'select', 'radio', 'checkbox', 'file', 'link', 'voice_text'];
  const cleaned = questions.slice(0, 100).map((q) => {
    if (!q.label || !String(q.label).trim()) fail('Every question needs a label.');
    return {
      id: String(q.id || ('q_' + uuid().slice(0, 8))), label: String(q.label).trim().slice(0, 300),
      type: types.includes(q.type) ? q.type : 'text', required: !!q.required,
      help: q.help ? String(q.help).slice(0, 500) : '', role: q.role || '',
      options: Array.isArray(q.options) ? q.options.map(String).filter(Boolean).slice(0, 50) : [],
      showIf: q.showIf && q.showIf.q ? { q: String(q.showIf.q), op: q.showIf.op === 'not_in' ? 'not_in' : 'in',
        values: (q.showIf.values || []).map(String).slice(0, 50) } : null,
      eitherWith: q.eitherWith ? String(q.eitherWith) : null,
    };
  });
  const ids = new Set(cleaned.map((q) => q.id));
  cleaned.forEach((q) => { if (!ids.has(q.eitherWith) || q.eitherWith === q.id) q.eitherWith = null; });
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
  await savePrintSettings(s);
  return (await printMe({ role: 'master' })).settings;
}

async function printRegenerate(which) {
  const s = await printSettings();
  const field = { order: 'orderKey', master: 'masterKey', join: 'joinKey' }[which];
  if (!field) fail(which === 'admin' ? 'Admin links are per person now — use Staff links.' : 'Unknown link.');
  s[field] = newKey();
  await savePrintSettings(s);
  return (await printMe({ role: 'master' })).settings;
}

async function printSetActive(which, active) {
  const s = await printSettings();
  const field = { order: 'orderActive', join: 'joinActive' }[which];
  if (!field) fail("That link can't be turned off.");
  s[field] = active;
  await savePrintSettings(s);
  return (await printMe({ role: 'master' })).settings;
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
    if (res.ok) return { event: 'notify', kind, ok: true, at, detail: kind === 'completed' ? 'Customer notified via bot.' : 'Bot told about the new order.' };
    // 520–530 are Cloudflare's own "couldn't reach that site" codes.
    const detail = res.status >= 520 && res.status <= 530 ? 'Could not reach the bot — check its link is right and the bot is online.'
      : 'Bot replied with an error (' + res.status + ').';
    return { event: 'notify', kind, ok: false, at, detail };
  } catch (e) {
    const detail = e && e.name === 'TimeoutError' ? 'The bot took too long to answer.'
      : 'Could not reach the bot — check its link is right and the bot is online.';
    return { event: 'notify', kind, ok: false, at, detail };
  }
}

function printTestNotify(kind) {
  const sample = { order_no: 'P-TEST', customer_name: 'Test Customer', company: 'Test Co', phone: '+60123456789', email: 'test@example.com',
                   summary: 'Flyers', quantity: '500', due_date: null, answers: [] };
  return notify(kind === 'created' ? 'created' : 'completed', sample, true);
}

// ════════════════════════════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS — new-order alerts on phones even when the app is closed
//  Standard Web Push (RFC 8030/8291/8292): this server signs (VAPID) and encrypts each
//  message itself, so no outside service or account is needed.
// ════════════════════════════════════════════════════════════════════════════
const concatBytes = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of parts) { out.set(a, o); o += a.length; }
  return out;
};
async function hmacBytes(keyBytes, data) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function sha256(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(text))))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// This server's signing keys, made once and kept in the database.
let vapidCache = null;
async function vapid() {
  if (vapidCache) return vapidCache;
  let v = null;
  try { v = JSON.parse(await getSetting('VAPID')); } catch { v = null; }
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const made = { publicKey: b64url(await crypto.subtle.exportKey('raw', kp.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
    await DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('VAPID', ?)").bind(JSON.stringify(made)).run();
    v = JSON.parse(await getSetting('VAPID')); // another request may have made them first
  }
  const key = await crypto.subtle.importKey('jwk', v.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return (vapidCache = { publicKey: v.publicKey, key });
}

async function vapidHeader(endpoint) {
  const v = await vapid();
  const part = (obj) => b64url(enc.encode(JSON.stringify(obj)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' +
    part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SELF || 'mailto:alerts@example.com' });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${v.publicKey}`;
}

// Encrypts a message for one device (aes128gcm, RFC 8291).
async function encryptPush(sub, text) {
  const uaPublic = fromB64url(sub.p256dh), authSecret = fromB64url(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const one = new Uint8Array([1]);
  const prkKey = await hmacBytes(authSecret, shared);
  const ikm = (await hmacBytes(prkKey, concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic, one))).slice(0, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacBytes(salt, ikm);
  const cek = (await hmacBytes(prk, concatBytes(enc.encode('Content-Encoding: aes128gcm\0'), one))).slice(0, 16);
  const nonce = (await hmacBytes(prk, concatBytes(enc.encode('Content-Encoding: nonce\0'), one))).slice(0, 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concatBytes(enc.encode(text), new Uint8Array([2]))));
  return concatBytes(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPublic.length]), asPublic, cipher);
}

async function sendPush(sub, data) {
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { Authorization: await vapidHeader(sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
      body: await encryptPush(sub, JSON.stringify(data)),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404 || res.status === 410) { // the device unsubscribed or the app was removed
      await DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(sub.id).run();
      return { ok: false, detail: 'This device is no longer subscribed.' };
    }
    return res.ok ? { ok: true } : { ok: false, detail: `The notification service replied ${res.status}.` };
  } catch (e) {
    return { ok: false, detail: 'Could not reach the notification service.' };
  }
}

const validB64 = (v, min, max) => typeof v === 'string' && /^[A-Za-z0-9_-]+=*$/.test(v) && v.length >= min && v.length <= max;

async function pushSubscribe(actor, sub, device) {
  const endpoint = String(sub.endpoint || '');
  let url;
  try { url = new URL(endpoint); } catch { fail('That device can\'t receive notifications.'); }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if ((url.protocol !== 'https:' && !local) || endpoint.length > 1000) fail('That device can\'t receive notifications.');
  const keys = sub.keys || {};
  if (!validB64(keys.p256dh, 80, 100) || !validB64(keys.auth, 16, 30)) fail('That device can\'t receive notifications.');
  if ((await count('push_subs')) >= 500) fail('Too many devices have alerts turned on. Turn some off first.');
  await DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(endpoint).run();
  await insertRow('push_subs', { endpoint, p256dh: keys.p256dh, auth: keys.auth, who: actor.who, device: String(device || '').slice(0, 40) || null,
    access: actor.access, ref: actor.ref || null, key_hash: actor.keyHash || null });
  return true;
}

// Which phones/computers get new-order alerts (for the master's Links & access page).
async function pushDevices() {
  await allowedSubs(); // tidies away devices whose link was changed or deleted
  return (await readTable('push_subs')).map((x) => ({ id: x.id, who: x.who, device: x.device, since: x.created_at }));
}

async function pushTest(endpoint) {
  const r = await DB.prepare('SELECT * FROM push_subs WHERE endpoint = ?').bind(String(endpoint || '')).first();
  if (!r) return { ok: false, detail: 'This device isn\'t subscribed yet.' };
  return sendPush(r, { title: 'New-order alerts are on', body: 'You\'ll get a notification like this for every new order — even when the app is closed.', tag: 'gig-test' });
}

// Devices whose access still works: a turned-off staff link pauses its alerts; a changed or deleted link ends them.
async function allowedSubs() {
  const subs = (await DB.prepare('SELECT * FROM push_subs').all()).results;
  if (!subs.length) return [];
  const masterHash = await sha256((await printSettings()).masterKey);
  const staff = new Map((await readTable('print_staff')).map((x) => [x.id, x]));
  const out = [], stale = [];
  for (const sub of subs) {
    if (sub.access === 'master') (sub.key_hash === masterHash ? out : stale).push(sub);
    else if (sub.access === 'staff') {
      const st = staff.get(sub.ref);
      if (!st || sub.key_hash !== await sha256(st.link_key)) stale.push(sub);
      else if (st.is_active && !st.pos_only) out.push(sub); // POS-only people don't get print-order alerts
    } else if (sub.access === 'team') ((await findMember(sub.ref)) ? out : stale).push(sub);
    else stale.push(sub);
  }
  if (stale.length) await deleteRows('push_subs', stale.map((x) => x.id));
  return out;
}

async function pushOwners(data) {
  const subs = (await allowedSubs()).filter((x) => x.access === 'master' || x.access === 'team');
  await Promise.all(subs.map((sub) => sendPush(sub, data)));
}

async function pushNewOrder(o, except = null) {
  // Everyone's devices — except the person who added the order themselves.
  const subs = (await allowedSubs()).filter((sub) => !except || !(sub.access === except.access && (sub.ref || null) === (except.ref || null)));
  if (!subs.length) return;
  const who = (o.customer_name || 'A customer') + (o.company ? ` (${o.company})` : '');
  const what = [o.summary, o.quantity ? '× ' + o.quantity : ''].filter(Boolean).join(' ');
  const due = dueText(o.due_date);
  const waiting = (await DB.prepare("SELECT COUNT(*) AS n FROM print_orders WHERE status = 'new'").first()).n; // number on the app icon
  const data = { title: `New order ${o.order_no}`, body: [who, what, due ? 'due ' + due : ''].filter(Boolean).join(' — '), orderId: o.id, tag: o.id, at: Date.now(), badge: waiting };
  await Promise.all(subs.map((sub) => sendPush(sub, data)));
}

// ════════════════════════════════════════════════════════════════════════════
//  Socmed Hub — an overview of what's scheduled in Buffer (posting itself happens in Buffer)
//
//  An owner pastes a Buffer API key in the Socmed Hub. It stays here on the server and is never sent
//  back to the website. Buffer's free plan allows 3,000 requests a month per key (shared with any bot
//  using the same key), so Buffer's answer is kept for a while and shared by everyone who opens the page.
// ════════════════════════════════════════════════════════════════════════════
// Reuse Buffer's answer for 30 minutes (change with the BUFFER_REFRESH_MINUTES var); "Refresh" can ask again after 2.
const bufferFreshMs = () => (Number(ENV.BUFFER_REFRESH_MINUTES) || 30) * 60e3;
const bufferManualMs = () => Math.min(2 * 60e3, bufferFreshMs());
const BUFFER_DAILY_MAX = 40;         // most requests per Buffer account per day
const BUFFER_ORGS_MS = 24 * 3600e3;  // re-read the account's organizations once a day
const BUFFER_SENT_DAYS = 7;          // also show what went out in the last week

const BUFFER_ACCOUNT_Q = 'query GigAccount { account { id name email organizations { id name } } }';
const BUFFER_POST = `fragment P on Post {
  id text status dueAt sentAt channelId channelService externalLink schedulingType
  error { message supportUrl }
  assets { type thumbnail }
  tags { name color }
  author { name }
  metadata {
    ... on InstagramPostMetadata { type }
    ... on FacebookPostMetadata { type title }
    ... on TiktokPostMetadata { type title }
    ... on YoutubePostMetadata { type title }
    ... on ThreadsPostMetadata { type }
    ... on LinkedInPostMetadata { type }
    ... on TwitterPostMetadata { type }
    ... on PinterestPostMetadata { type title }
    ... on GoogleBusinessPostMetadata { type title }
    ... on MastodonPostMetadata { type }
    ... on BlueskyPostMetadata { type }
    ... on SubstackPostMetadata { type }
  }
}`;
const BUFFER_UPCOMING = 'posts(first: 100, after: $after, input: { organizationId: $org, filter: { status: [scheduled, sending, error, needs_approval] }, sort: [{ field: dueAt, direction: asc }] })';
// One request per organization: its channels, what's coming up, and what went out recently.
const BUFFER_OVERVIEW_Q = `query GigOverview($org: OrganizationId!, $since: DateTime, $after: String) {
  channels(input: { organizationId: $org }) { id name displayName service avatar type externalLink isQueuePaused isDisconnected isLocked }
  upcoming: ${BUFFER_UPCOMING} { edges { node { ...P } } pageInfo { hasNextPage endCursor } }
  recent: posts(first: 50, input: { organizationId: $org, filter: { status: [sent], dueAt: { start: $since } }, sort: [{ field: dueAt, direction: desc }] }) { edges { node { ...P } } }
}
${BUFFER_POST}`;
const BUFFER_MORE_Q = `query GigMore($org: OrganizationId!, $after: String) {
  upcoming: ${BUFFER_UPCOMING} { edges { node { ...P } } pageInfo { hasNextPage endCursor } }
}
${BUFFER_POST}`;

const httpsOnly = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u.slice(0, 2000) : null);
const readJson = async (key) => { try { return JSON.parse(await getSetting(key)) || null; } catch { return null; } };
const socmedConfig = async () => ({ accounts: [], channels: {}, ...(await readJson('SOCMED')) });
const socmedCacheKey = (id) => 'SOCMED_CACHE:' + id;

async function bufferCall(key, query, variables = {}) {
  let res;
  try {
    res = await fetch(ENV.BUFFER_API_URL || 'https://api.buffer.com', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
    });
  } catch { fail("Couldn't reach Buffer just now. Please try again in a minute.", 'BUFFER_DOWN'); }
  let j = null;
  try { j = await res.json(); } catch { /* not JSON */ }
  const err = j && Array.isArray(j.errors) ? j.errors[0] : null;
  const code = err && err.extensions && err.extensions.code;
  if (res.status === 401 || res.status === 403 || code === 'UNAUTHENTICATED' || code === 'FORBIDDEN') {
    fail("Buffer didn't accept the API key — it may have been deleted. Make a new key in Buffer (Settings → API) and connect again.", 'BUFFER_KEY');
  }
  if (res.status === 429) {
    const e = new AppError("Buffer says we've asked too often. It will refresh again by itself in a while.", 'BUFFER_BUSY');
    e.retryAfter = Number(res.headers.get('Retry-After')) || 900;
    throw e;
  }
  if (!j || !j.data) fail('Buffer had a problem: ' + String((err && err.message) || 'error ' + res.status).slice(0, 160), 'BUFFER_ERROR');
  return j.data;
}

function bufferChannel(c, acct, org) {
  return {
    id: String(c.id), account: acct.id, accountLabel: acct.label, org: org.name,
    defaultBrand: acct.orgs.length > 1 ? org.name : null, // a Buffer organization per brand
    name: String(c.displayName || c.name || 'Channel').slice(0, 80), handle: String(c.name || '').slice(0, 80),
    service: String(c.service || 'other'), type: c.type || null, avatar: httpsOnly(c.avatar), profile: httpsOnly(c.externalLink),
    paused: !!c.isQueuePaused, disconnected: !!c.isDisconnected, locked: !!c.isLocked,
  };
}

function bufferPost(p, acct) {
  const assets = Array.isArray(p.assets) ? p.assets : [];
  const meta = p.metadata || {};
  return {
    id: String(p.id), account: acct.id, channelId: String(p.channelId), service: String(p.channelService || 'other'),
    status: p.status, dueAt: p.dueAt || null, sentAt: p.sentAt || null, text: String(p.text || '').slice(0, 700),
    kind: meta.type || null, title: meta.title ? String(meta.title).slice(0, 140) : null,
    thumb: assets.map((x) => httpsOnly(x && x.thumbnail)).find(Boolean) || null, media: assets.length,
    mediaType: (assets[0] && assets[0].type) || null, link: httpsOnly(p.externalLink),
    error: p.error ? { message: String(p.error.message || '').slice(0, 300), help: httpsOnly(p.error.supportUrl) } : null,
    tags: (Array.isArray(p.tags) ? p.tags : []).slice(0, 8).map((t) => ({ name: String(t.name || '').slice(0, 40), color: /^#[0-9a-f]{3,8}$/i.test(t.color) ? t.color : null })),
    by: (p.author && p.author.name) || null, reminder: p.schedulingType === 'notification',
  };
}

const bufferOrgs = (account) => (account.organizations || []).slice(0, 10).map((o) => ({ id: String(o.id), name: String(o.name || 'Buffer').slice(0, 80) }));

// Asks Buffer again for one account and keeps the answer. On a problem, the last good answer stays.
async function bufferRefresh(cfg, acct) {
  const prev = (await readJson(socmedCacheKey(acct.id))) || {};
  const day = nowIso().slice(0, 10);
  const calls = prev.calls && prev.calls.day === day ? prev.calls : { day, n: 0 };
  const out = { ...prev, calls };
  const ask = async (query, vars) => {
    if (calls.n >= BUFFER_DAILY_MAX) fail("Buffer has been asked a lot today, so this shows the last update. It refreshes again tomorrow.", 'BUFFER_DAILY');
    calls.n++;
    return bufferCall(acct.key, query, vars);
  };
  try {
    if (!acct.orgs || !acct.orgsAt || Date.now() - acct.orgsAt > BUFFER_ORGS_MS) {
      const d = await ask(BUFFER_ACCOUNT_Q);
      acct.orgs = bufferOrgs(d.account || {});
      acct.orgsAt = Date.now();
      await setSetting('SOCMED', JSON.stringify(cfg));
    }
    const since = new Date(Date.now() - BUFFER_SENT_DAYS * 864e5).toISOString();
    const channels = [], posts = new Map();
    let more = false;
    for (const org of acct.orgs.slice(0, 5)) {
      const d = await ask(BUFFER_OVERVIEW_Q, { org: org.id, since });
      for (const c of d.channels || []) channels.push(bufferChannel(c, acct, org));
      let page = d.upcoming;
      const take = (pg) => { for (const e of (pg && pg.edges) || []) if (e && e.node) posts.set(String(e.node.id), bufferPost(e.node, acct)); };
      take(page);
      for (let i = 0; page && page.pageInfo && page.pageInfo.hasNextPage && i < 3; i++) {
        page = (await ask(BUFFER_MORE_Q, { org: org.id, after: page.pageInfo.endCursor })).upcoming;
        take(page);
      }
      if (page && page.pageInfo && page.pageInfo.hasNextPage) more = true;
      take(d.recent);
    }
    Object.assign(out, { at: Date.now(), channels, posts: [...posts.values()], more, error: null, errorCode: null, errorAt: null, busyUntil: null });
  } catch (e) {
    if (!(e instanceof AppError)) { console.error('buffer refresh', e && e.stack || e); e = new AppError("Couldn't read Buffer just now. Please try again in a minute.", 'BUFFER_ERROR'); }
    Object.assign(out, { error: e.message, errorCode: e.code, errorAt: Date.now() });
    if (e.code === 'BUFFER_BUSY') out.busyUntil = Date.now() + Math.min(e.retryAfter || 900, 86400) * 1000;
  }
  await setSetting(socmedCacheKey(acct.id), JSON.stringify(out));
  return out;
}

// Whether it's time to ask Buffer again (otherwise everyone sees the kept answer).
function bufferDue(c, force) {
  const now = Date.now();
  if (c.busyUntil && c.busyUntil > now) return false;
  const last = Math.max(c.at || 0, c.errorAt || 0);
  if (force) return now - last > bufferManualMs();
  if (c.errorCode === 'BUFFER_KEY') return false; // waits for a new key (or "Refresh")
  return now - last > bufferFreshMs();
}

const channelBrand = (ch, cfg) => ((cfg.channels[ch.id] || {}).brand || ch.defaultBrand || null);
const channelLink = (ch, cfg) => (cfg.channels[ch.id] || {}).link || `https://publish.buffer.com/channels/${encodeURIComponent(ch.id)}`;

async function socmedOverview(force) {
  const cfg = await socmedConfig();
  const channels = [], posts = [], problems = [];
  let updatedAt = null, more = false;
  for (const acct of cfg.accounts) {
    let c = (await readJson(socmedCacheKey(acct.id))) || {};
    if (bufferDue(c, force)) c = await bufferRefresh(cfg, acct);
    for (const ch of c.channels || []) channels.push({ ...ch, accountLabel: acct.label, brand: channelBrand(ch, cfg), buffer: channelLink(ch, cfg) });
    posts.push(...(c.posts || []));
    if (c.error) problems.push({ account: acct.label, message: c.error, code: c.errorCode, at: c.errorAt ? new Date(c.errorAt).toISOString() : null });
    if (c.at && (!updatedAt || c.at < updatedAt)) updatedAt = c.at;
    if (c.more) more = true;
  }
  return { connected: cfg.accounts.length > 0, channels, posts, problems, more, updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null };
}

async function socmedSetup() {
  const cfg = await socmedConfig();
  const accounts = [], channels = [];
  for (const a of cfg.accounts) {
    const c = (await readJson(socmedCacheKey(a.id))) || {};
    accounts.push({ id: a.id, label: a.label, name: a.name || null, email: a.email || null, keyEnd: a.key.slice(-4),
      orgs: (a.orgs || []).map((o) => o.name), added_at: a.added_at, error: c.error || null, updatedAt: c.at ? new Date(c.at).toISOString() : null });
    for (const ch of c.channels || []) {
      const m = cfg.channels[ch.id] || {};
      channels.push({ ...ch, accountLabel: a.label, brand: m.brand || '', link: m.link || '', defaultBrand: ch.defaultBrand, buffer: channelLink(ch, cfg) });
    }
  }
  // Brand names already in use (channels + talents), offered as suggestions.
  const talentBrands = (await DB.prepare("SELECT DISTINCT brand FROM talents WHERE brand IS NOT NULL AND brand <> ''").all()).results.map((r) => r.brand);
  const brands = [...new Set([...Object.values(cfg.channels).map((m) => m.brand), ...channels.map((c) => c.defaultBrand), ...talentBrands].filter(Boolean))]
    .sort((x, y) => x.localeCompare(y));
  return { accounts, channels, brands };
}

async function socmedConnect(req) {
  const key = String(req.apiKey || '').trim();
  if (key.length < 16 || key.length > 500 || /\s/.test(key)) fail("That doesn't look like a Buffer API key — copy the whole key from Buffer (Settings → API).");
  const tries = await guard('bufconn:' + req._ip, 10);
  await tries.count();
  let d;
  try { d = await bufferCall(key, BUFFER_ACCOUNT_Q); } catch (e) {
    if (e.code === 'BUFFER_KEY') fail("Buffer didn't accept that key. Copy it again from Buffer (Settings → API) — the whole key, with nothing extra.");
    throw e;
  }
  const account = d.account || {};
  const cfg = await socmedConfig();
  const label = String(req.label || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  let acct = cfg.accounts.find((a) => a.buffer_id && a.buffer_id === String(account.id));
  if (acct) { acct.key = key; if (label) acct.label = label; } else {
    if (cfg.accounts.length >= 10) fail('You can connect up to 10 Buffer accounts.');
    acct = { id: uuid(), buffer_id: String(account.id || uuid()), label: label || String(account.name || account.email || 'Buffer').slice(0, 40), added_at: nowIso() };
    cfg.accounts.push(acct);
  }
  Object.assign(acct, { key, name: account.name || null, email: account.email || null, orgs: bufferOrgs(account), orgsAt: Date.now() });
  await setSetting('SOCMED', JSON.stringify(cfg));
  // Read the schedule right away (keeps today's request count).
  const prev = (await readJson(socmedCacheKey(acct.id))) || {};
  await setSetting(socmedCacheKey(acct.id), JSON.stringify({ calls: prev.calls, channels: prev.channels, posts: prev.posts }));
  await bufferRefresh(cfg, acct);
  return socmedSetup();
}

async function socmedRemove(id) {
  const cfg = await socmedConfig();
  if (!cfg.accounts.some((a) => a.id === id)) fail('That Buffer account is no longer connected.');
  cfg.accounts = cfg.accounts.filter((a) => a.id !== id);
  await setSetting('SOCMED', JSON.stringify(cfg));
  await DB.prepare('DELETE FROM settings WHERE key = ?').bind(socmedCacheKey(id)).run();
  return socmedSetup();
}

async function socmedSaveChannels(map) {
  const cfg = await socmedConfig();
  for (const [id, v] of Object.entries(map || {}).slice(0, 500)) {
    if (!/^[\w-]{1,64}$/.test(id)) continue;
    const brand = String((v && v.brand) || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    let link = String((v && v.link) || '').trim();
    if (link) {
      link = cleanLink(link);
      if (!link || !link.startsWith('https://')) fail("One of the Buffer links doesn't look right — copy the whole address (it starts with https://).");
    }
    if (brand || link) cfg.channels[id] = { brand: brand || null, link: link || null }; else delete cfg.channels[id];
  }
  await setSetting('SOCMED', JSON.stringify(cfg));
  return socmedSetup();
}

// ════════════════════════════════════════════════════════════════════════════
//  GIG POS — the till for the shops and cafés (pos/index.html)
//
//  Owners (email + password) can do everything. Team members get a POS role from an owner (POS → Team):
//  cashier (sell, shifts, open orders, kitchen, customers) or manager (+ refunds, menu, stock, reports),
//  for every store or only chosen ones. A cashier's refund needs a manager's name + passcode on the spot.
//  Totals, rounding and refunds come from js/pos/model.js — the file the till itself runs — so what the
//  cashier sees is exactly what gets saved. Money is in sen (RM 4.50 = 450).
// ════════════════════════════════════════════════════════════════════════════
const POS_ROLES = ['cashier', 'manager'];
const SOLD = "('paid', 'partially_refunded', 'refunded')";
const MENU = { category: 'pos_categories', product: 'pos_products', modifier: 'pos_modifiers' };
const posTz = () => ENV.POS_TIME_ZONE || POS.TIME_ZONE;
const posCountry = () => ENV.COUNTRY_CODE || '60';
const posText = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const posId = (v) => (/^[A-Za-z0-9-]{8,64}$/.test(String(v || '')) ? String(v) : uuid());
const posMoney = (v, what = 'amount') => {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 1e9) fail(`Check the ${what}.`);
  return n;
};

// Who is at the till: an owner, or a team member with a POS role (for all stores, or some).
function posActor(me) {
  if (!me.viaLink) return { role: 'owner', who: me.name || me.email, id: me.email, stores: null, hub: true };
  if (!POS_ROLES.includes(me.pos)) fail("You don't have access to the POS yet — ask the owner to give you a POS role.", 'POS_AUTH');
  return { role: me.pos, who: me.name, id: me.staffId, stores: me.posStores && me.posStores.length ? me.posStores : null, hub: !!me.hub };
}
const isManager = (a) => a.role === 'owner' || a.role === 'manager';
const needManager = (a, what) => { if (!isManager(a)) fail(`Only a manager or owner can ${what}.`); };
const needOwner = (a, what) => { if (a.role !== 'owner') fail(`Only owners can ${what}.`); };
const canStore = (a, id) => !a.stores || a.stores.includes(id);

async function posStore(actor, id, { active = true } = {}) {
  const s = await getRow('pos_stores', String(id || ''));
  if (!s || !canStore(actor, s.id)) fail('That store no longer exists.');
  if (active && !s.is_active) fail('That store is switched off. An owner can switch it on in POS → Stores.');
  return { ...s, settings: POS.cleanSettings(s.settings) };
}

async function posRoute(req, me) {
  const actor = posActor(me);
  const a = req.action;
  switch (a) {
    case 'posMe': return posMe(actor);
    // Stores & team (owners)
    case 'posSaveStore': needOwner(actor, 'change stores'); return posSaveStore(req.store || {});
    case 'posTeam': needOwner(actor, 'manage POS access'); return posTeam();
    case 'posTeamSet': needOwner(actor, 'manage POS access'); return posTeamSet(req.id, req.patch || {});
    // Menu
    case 'posCatalog': return posCatalog(actor, req.storeId);
    case 'posSaveItem': needManager(actor, 'change the menu'); return posSaveItem(actor, req.kind, req.row || {});
    case 'posDeleteItem': needManager(actor, 'change the menu'); return posDeleteItem(actor, req.kind, req.id);
    case 'posImport': needManager(actor, 'change the menu'); return posImport(actor, req.storeId, req.rows);
    case 'posCopyMenu': needManager(actor, 'change the menu'); return posCopyMenu(actor, req.fromId, req.toId);
    // Selling
    case 'posCheckout': return posCheckout(actor, req.sale || {});
    case 'posSaveOpen': return posSaveOpen(actor, req.order || {});
    case 'posOpenOrders': {
      const s = await posStore(actor, req.storeId, { active: false });
      await posUnstick(s.id);
      return readTable('pos_sales', "WHERE store_id = ? AND status = 'open'", s.id);
    }
    case 'posCancelOpen': return posCancelOpen(actor, req.id, req.reason);
    case 'posKitchen': return posKitchen(actor, req.storeId);
    case 'posKitchenSet': return posKitchenSet(actor, req.id, req.status);
    case 'posSales': return posSales(actor, req);
    case 'posSale': return posSaleFor(actor, req.id);
    case 'posRefund': return posRefund(actor, req);
    // Shifts
    case 'posShift': return posShift(actor, req.storeId);
    case 'posOpenShift': return posOpenShift(actor, req.storeId, req.float);
    case 'posCashMove': return posCashMove(actor, req.shiftId, req.move || {});
    case 'posCloseShift': return posCloseShift(actor, req.shiftId, req.counted, req.note);
    case 'posShifts': needManager(actor, 'see past shifts'); return posShifts(actor, req.storeId);
    case 'posShiftReport': needManager(actor, 'see past shifts'); return posShiftReport(actor, req.id);
    // Customers & cashback
    case 'posFindCustomers': return posFindCustomers(actor, req.q, req.storeId);
    case 'posCustomer': return posCustomer(actor, req.id, req.storeId);
    case 'posSaveCustomer': return posSaveCustomer(req.customer || {});
    case 'posCustomers': needManager(actor, 'see the customer list'); return posCustomers(actor);
    // Stock
    case 'posStockAdjust': needManager(actor, 'change stock'); return posStockAdjust(actor, req);
    case 'posStockMoves': needManager(actor, 'see stock history'); return posStockMoves(actor, req.storeId, req.productId);
    // Reports
    case 'posReport': needManager(actor, 'see reports'); return posReport(actor, req.storeId, req.from, req.to);
  }
  fail('Unknown action: ' + a);
}

const byOrder = (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || String(a.name).localeCompare(String(b.name));

async function posMe(actor) {
  const stores = (await readTable('pos_stores')).filter((s) => canStore(actor, s.id) && (actor.role === 'owner' || s.is_active))
    .sort(byOrder).map((s) => ({ ...s, settings: POS.cleanSettings(s.settings) }));
  return { role: actor.role, name: actor.who, staffId: actor.role === 'owner' ? null : actor.id, stores, timeZone: posTz(),
           allStores: !actor.stores, countryCode: posCountry(), hub: actor.hub };
}

// ── Stores (owners) ──
async function posSaveStore(input) {
  const name = posText(input.name, 60);
  if (!name) fail('Give the store a name.');
  const id = input.id ? String(input.id) : null;
  const ex = id ? await getRow('pos_stores', id) : null;
  if (id && !ex) fail('That store no longer exists.');
  if (!ex && (await count('pos_stores')) >= 50) fail('You can have up to 50 stores.');
  // Receipt numbers start with the store's code (e.g. CHJ-000123), so each store needs its own.
  const typed = String(input.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const taken = async (c) => !!(await DB.prepare('SELECT 1 FROM pos_stores WHERE code = ? AND id <> ?').bind(c, id || '').first());
  let code = typed;
  if (typed && (await taken(typed))) fail(`Another store already uses the receipt code ${typed} — pick a different one.`);
  if (!code) {
    const base = (name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'S').slice(0, 4);
    code = base;
    for (let i = 2; await taken(code); i++) code = base + i;
  }
  const row = { name, code, brand: posText(input.brand, 60) || null, address: posText(input.address, 300) || null, phone: posText(input.phone, 40) || null,
    settings: POS.cleanSettings(input.settings), is_active: input.is_active !== false, sort_order: Math.round(Number(input.sort_order) || 0) };
  const saved = ex ? await updateRow('pos_stores', ex.id, row) : await insertRow('pos_stores', row);
  return { ...saved, settings: POS.cleanSettings(saved.settings) };
}

// ── Team: who can use the POS (owners) ──
async function posTeam() {
  return (await readTable('print_staff', "WHERE status = 'approved' AND (shared IS NULL OR shared = 0)")).map((x) => ({
    id: x.id, name: x.name, active: x.is_active, hub: x.hub_access, pos: POS_ROLES.includes(x.pos_role) ? x.pos_role : null,
    posOnly: !!x.pos_only, stores: x.pos_stores || [], key: x.link_key, last_used_at: x.last_used_at }));
}
async function posTeamSet(id, patch) {
  const st = await getRow('print_staff', String(id || ''));
  if (!st || st.status !== 'approved') fail('That person is no longer on the team.');
  const p = {};
  if (patch.pos !== undefined) p.pos_role = POS_ROLES.includes(patch.pos) ? patch.pos : null;
  if (patch.stores !== undefined) {
    const ids = new Set((await readTable('pos_stores')).map((s) => s.id));
    p.pos_stores = (Array.isArray(patch.stores) ? patch.stores : []).map(String).filter((x) => ids.has(x));
  }
  if (patch.posOnly !== undefined) p.pos_only = !!patch.posOnly;
  const role = p.pos_role !== undefined ? p.pos_role : st.pos_role;
  if (p.pos_only && !role) fail('Give them a POS role first.');
  if (p.pos_only) p.hub_access = false; // POS only: no Creative Hub (and no Print Hub)
  if (role === null && st.pos_only) p.pos_only = false; // POS access taken away: back to the Print Hub
  await updateRow('print_staff', st.id, p);
  return posTeam();
}

// ── Menu: categories, products, modifier groups ──
async function posCatalog(actor, storeId) {
  const s = await posStore(actor, storeId, { active: false });
  const [categories, products, modifiers] = await Promise.all(['pos_categories', 'pos_products', 'pos_modifiers']
    .map((t) => readTable(t, 'WHERE store_id = ?', s.id)));
  return { store_id: s.id, categories: categories.sort(byOrder), products: products.sort(byOrder), modifiers: modifiers.sort(byOrder) };
}

async function posSaveItem(actor, kind, row) {
  const t = MENU[kind];
  if (!t) fail('Unknown menu item.');
  const ex = row.id ? await getRow(t, String(row.id)) : null;
  if (row.id && !ex) fail('That item no longer exists.');
  const store = await posStore(actor, ex ? ex.store_id : row.store_id, { active: false });
  const p = { store_id: store.id, sort_order: Math.round(Number(row.sort_order) || 0) };
  if (kind === 'category') {
    p.name = posText(row.name, 40);
    if (!p.name) fail('Give the category a name.');
    p.color = row.color || null;
    checkColour(p.color);
  } else if (kind === 'modifier') {
    p.name = posText(row.name, 40);
    if (!p.name) fail('Give the group a name (e.g. Sugar level).');
    const seen = new Set();
    p.options = (Array.isArray(row.options) ? row.options : []).slice(0, 40).map((o) => {
      let oid = posText(o.id, 24).replace(/[^\w-]/g, '') || uuid().slice(0, 8);
      while (seen.has(oid)) oid = uuid().slice(0, 8);
      seen.add(oid);
      return { id: oid, name: posText(o.name, 40), price: posMoney(o.price || 0, 'price of ' + (o.name || 'a choice')) };
    }).filter((o) => o.name);
    if (!p.options.length) fail('Add at least one choice.');
    p.min_select = Math.min(p.options.length, Math.max(0, Math.round(Number(row.min_select) || 0)));
    p.max_select = Math.min(p.options.length, Math.max(1, p.min_select, Math.round(Number(row.max_select) || 1)));
  } else {
    p.name = posText(row.name, 80);
    if (!p.name) fail('Give the product a name.');
    if (!ex && (await DB.prepare('SELECT COUNT(*) AS n FROM pos_products WHERE store_id = ?').bind(store.id).first()).n >= 3000) fail('A store can have up to 3,000 products.');
    p.category_id = null;
    if (row.category_id) {
      const c = await getRow('pos_categories', String(row.category_id));
      if (!c || c.store_id !== store.id) fail("Pick one of this store's categories.");
      p.category_id = c.id;
    }
    p.price = posMoney(row.price, 'price');
    if (p.price == null) fail('Give it a price (0 is fine for something free).');
    p.cost = posMoney(row.cost, 'cost');
    p.sku = posText(row.sku, 40) || null;
    if (p.sku && await DB.prepare('SELECT 1 FROM pos_products WHERE store_id = ? AND sku = ? AND id <> ?').bind(store.id, p.sku, ex ? ex.id : '').first()) {
      fail(`Another product already has the code ${p.sku}.`);
    }
    p.color = row.color || null;
    checkColour(p.color);
    const mods = new Set((await readTable('pos_modifiers', 'WHERE store_id = ?', store.id)).map((m) => m.id));
    p.modifier_ids = (Array.isArray(row.modifier_ids) ? row.modifier_ids : []).map(String).filter((x) => mods.has(x));
    p.track_stock = !!row.track_stock;
    p.low_stock = row.low_stock === '' || row.low_stock == null ? null : Math.max(0, Math.round(Number(row.low_stock) || 0));
    if (!ex) p.stock = Math.round(Number(row.stock) || 0); // after that, stock changes through Stock (so it's all in the history)
    p.is_active = row.is_active !== false;
  }
  return ex ? updateRow(t, ex.id, p) : insertRow(t, p);
}

async function posDeleteItem(actor, kind, id) {
  const t = MENU[kind];
  if (!t) fail('Unknown menu item.');
  const ex = await getRow(t, String(id || ''));
  if (!ex) fail('That item no longer exists.');
  await posStore(actor, ex.store_id, { active: false });
  if (kind === 'category') await DB.prepare('UPDATE pos_products SET category_id = NULL WHERE category_id = ?').bind(ex.id).run();
  if (kind === 'modifier') {
    for (const pr of await readTable('pos_products', 'WHERE store_id = ? AND modifier_ids LIKE ?', ex.store_id, '%"' + ex.id + '"%')) {
      await updateRow('pos_products', pr.id, { modifier_ids: (pr.modifier_ids || []).filter((x) => x !== ex.id) });
    }
  }
  await deleteRows(t, [ex.id]); // past sales keep the names and prices they had
  return posCatalog(actor, ex.store_id);
}

// Add many products at once (from a spreadsheet): rows of { name, category, price, cost, sku, stock } — money in sen.
async function posImport(actor, storeId, rows) {
  const store = await posStore(actor, storeId, { active: false });
  rows = (Array.isArray(rows) ? rows : []).slice(0, 1000);
  if (!rows.length) fail('There are no products in that file.');
  const cats = await readTable('pos_categories', 'WHERE store_id = ?', store.id);
  const catId = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
  const have = new Set((await readTable('pos_products', 'WHERE store_id = ?', store.id)).map((p) => p.name.toLowerCase()));
  const newCats = [...new Set(rows.map((r) => posText(r.category, 40)).filter((c) => c && !catId.has(c.toLowerCase())))];
  if (newCats.length) {
    for (const c of await insertRows('pos_categories', newCats.map((name, i) => ({ store_id: store.id, name, sort_order: cats.length + i + 1 })))) {
      catId.set(c.name.toLowerCase(), c.id);
    }
  }
  const out = [];
  let skipped = 0;
  for (const r of rows) {
    const name = posText(r.name, 80);
    const price = Math.round(Number(r.price));
    if (!name || !Number.isFinite(price) || price < 0 || price > 1e9 || have.has(name.toLowerCase())) { skipped++; continue; }
    have.add(name.toLowerCase());
    const stock = r.stock === '' || r.stock == null ? null : Math.round(Number(r.stock));
    const cost = Math.round(Number(r.cost));
    out.push({ store_id: store.id, name, price, cost: r.cost === '' || r.cost == null || !Number.isFinite(cost) || cost < 0 ? null : cost,
      sku: posText(r.sku, 40) || null, category_id: catId.get(posText(r.category, 40).toLowerCase()) || null,
      track_stock: Number.isFinite(stock), stock: Number.isFinite(stock) ? stock : 0, is_active: true, modifier_ids: [] });
  }
  await insertRows('pos_products', out);
  return { added: out.length, skipped, catalog: await posCatalog(actor, store.id) };
}

// Copy one store's menu into another (e.g. a new outlet of the same brand). Names already there are skipped.
async function posCopyMenu(actor, fromId, toId) {
  const from = await posCatalog(actor, fromId);
  const to = await posCatalog(actor, toId);
  if (from.store_id === to.store_id) fail('Pick a different store to copy from.');
  const catMap = new Map(), modMap = new Map();
  const toCats = new Map(to.categories.map((c) => [c.name.toLowerCase(), c.id]));
  for (const c of from.categories) {
    catMap.set(c.id, toCats.get(c.name.toLowerCase()) || (await insertRow('pos_categories', { store_id: to.store_id, name: c.name, color: c.color, sort_order: c.sort_order })).id);
  }
  const toMods = new Map(to.modifiers.map((m) => [m.name.toLowerCase(), m.id]));
  for (const m of from.modifiers) {
    modMap.set(m.id, toMods.get(m.name.toLowerCase()) || (await insertRow('pos_modifiers', { store_id: to.store_id, name: m.name, options: m.options,
      min_select: m.min_select, max_select: m.max_select, sort_order: m.sort_order })).id);
  }
  const have = new Set(to.products.map((p) => p.name.toLowerCase()));
  const rows = from.products.filter((p) => !have.has(p.name.toLowerCase())).map((p) => ({
    store_id: to.store_id, name: p.name, price: p.price, cost: p.cost, sku: p.sku, color: p.color, category_id: catMap.get(p.category_id) || null,
    modifier_ids: (p.modifier_ids || []).map((x) => modMap.get(x)).filter(Boolean), track_stock: p.track_stock, stock: 0, low_stock: p.low_stock,
    is_active: p.is_active, sort_order: p.sort_order }));
  await insertRows('pos_products', rows);
  return { added: rows.length, catalog: await posCatalog(actor, to.store_id) };
}

// ── Selling ──
// Receipt numbers count up per receipt code (CHJ-000001…); order numbers (to call out) start at 1 each day.
async function posNextReceipt(store) {
  const r = await DB.prepare("INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1 RETURNING value")
    .bind('POS_NO:' + store.code).first();
  return `${store.code}-${String(r.value).padStart(6, '0')}`;
}
async function posNextOrderNo(store, date) {
  const r = await DB.prepare(`INSERT INTO settings (key, value) VALUES (?, ? || ':1') ON CONFLICT(key) DO UPDATE SET value =
    CASE WHEN substr(value, 1, 10) = ? THEN ? || ':' || (CAST(substr(value, 12) AS INTEGER) + 1) ELSE ? || ':1' END RETURNING value`)
    .bind('POS_Q:' + store.id, date, date, date, date).first();
  return Number(String(r.value).slice(11));
}

function posCleanItems(items) {
  if (!Array.isArray(items) || !items.length) fail('The order is empty — add something first.');
  if (items.length > 300) fail('That order has too many lines.');
  return items.map((it) => {
    const name = posText(it.name, 80);
    if (!name) fail('An item has no name.');
    const qty = Math.round(Number(it.qty));
    if (!(qty >= 1 && qty <= 9999)) fail(`Check the quantity of ${name}.`);
    const price = Math.round(Number(it.price));
    if (!(price >= 0 && price <= 1e8)) fail(`Check the price of ${name}.`);
    const mods = (Array.isArray(it.mods) ? it.mods : []).slice(0, 30).map((m) => ({
      group: posText(m.group, 40) || null, name: posText(m.name, 40), price: Math.round(Number(m.price) || 0) })).filter((m) => m.name);
    if (price + mods.reduce((t, m) => t + m.price, 0) < 0) fail(`Check the price of ${name}.`);
    const d = it.discount && typeof it.discount === 'object' && Number(it.discount.value) > 0
      ? { type: it.discount.type === 'percent' ? 'percent' : 'amount', value: Math.min(it.discount.type === 'percent' ? 100 : 1e9, Number(it.discount.value)) } : null;
    return { key: posText(it.key, 40) || uuid().slice(0, 8), product_id: it.product_id ? String(it.product_id) : null, name, price, qty, mods,
      note: posText(it.note, 200) || null, discount: d, sent_at: typeof it.sent_at === 'string' ? it.sent_at.slice(0, 30) : null };
  });
}
const posCleanDiscount = (d) => (d && typeof d === 'object' && Number(d.value) > 0
  ? { type: d.type === 'percent' ? 'percent' : 'amount', value: Math.min(d.type === 'percent' ? 100 : 1e9, Number(d.value)), reason: posText(d.reason, 80) || null }
  : null);

// Category, cost and stock tracking of the products on an order (by id, within the store).
async function posProductInfo(storeId, lines) {
  const ids = [...new Set(lines.map((l) => l.product_id).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const cats = new Map((await readTable('pos_categories', 'WHERE store_id = ?', storeId)).map((c) => [c.id, c.name]));
  await inGroups(ids, async (g, q) => {
    for (const r of (await DB.prepare(`SELECT id, category_id, cost, track_stock FROM pos_products WHERE store_id = ? AND id IN (${q})`).bind(storeId, ...g).all()).results) {
      out.set(r.id, { category: cats.get(r.category_id) || null, cost: Number(r.cost) || 0, track: r.track_stock === 1 });
    }
  });
  return out;
}

const stockMoveStmt = (m) => DB.prepare(`INSERT INTO pos_stock_moves (id, store_id, product_id, product_name, qty_change, reason, note, sale_id, stock_after, who, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT stock FROM pos_products WHERE id = ?), ?, ?)`)
  .bind(uuid(), m.store_id, m.product_id, m.name, m.change, m.reason, m.note || null, m.sale_id || null, m.product_id, m.who, m.at);
// Changes a customer's cashback for a brand (never below zero). earned / used keep running totals.
const walletStmt = (cid, brand, delta, earned, used, at) => DB.prepare(`INSERT INTO pos_wallets (id, customer_id, brand, balance, earned, used, created_at, updated_at)
  VALUES (?, ?, ?, MAX(0, ?), ?, ?, ?, ?) ON CONFLICT(customer_id, brand) DO UPDATE SET balance = MAX(0, balance + ?), earned = earned + ?, used = used + ?, updated_at = ?`)
  .bind(uuid(), cid, brand, delta, Math.max(0, earned), Math.max(0, used), at, at, delta, earned, used, at);
const salePlaceholders = (t) => SCHEMA[t].cols.map((c) => `${c} = ?`).join(', ');
const saleUpdateStmt = (row, status) => DB.prepare(`UPDATE pos_sales SET ${salePlaceholders('pos_sales')} WHERE id = ? AND status = ?`)
  .bind(...SCHEMA.pos_sales.cols.map((c) => toDb('pos_sales', c, row[c])), row.id, status);

// An open order stays "paying" only while its payment is being saved; if that was cut off, it's open again after 2 minutes.
const posUnstick = (storeId) => DB.prepare("UPDATE pos_sales SET status = 'open' WHERE store_id = ? AND status = 'paying' AND updated_at < ?")
  .bind(storeId, new Date(Date.now() - 120e3).toISOString()).run();

async function posOpenShiftRow(storeId) {
  const r = await DB.prepare("SELECT * FROM pos_shifts WHERE store_id = ? AND status = 'open'").bind(storeId).first();
  return r ? rowOut('pos_shifts', r) : null;
}

// Builds the sale's lines (what's on the receipt) from the priced cart.
const saleLines = (priced) => priced.lines.map((l) => ({ key: l.key, product_id: l.product_id, name: l.name, price: l.price, qty: l.qty, mods: l.mods,
  note: l.note, disc: l.disc, unit: l.unit, gross: l.gross, discount: l.discount, net: l.net, sent_at: l.sent_at || null }));

// Takes payment for a new sale, or for an open order (same id). Safe to send twice: the second time
// returns the sale that was already saved (the till retries after a dropped connection).
async function posCheckout(actor, input) {
  const id = posId(input.id);
  let ex = await getRow('pos_sales', id);
  if (ex && ex.status === 'paying') { await posUnstick(ex.store_id); ex = await getRow('pos_sales', id); }
  if (ex && ex.status !== 'open') {
    if (ex.status === 'cancelled') fail('This order was cancelled.');
    if (ex.status === 'paying') fail('This order is being paid on another device.');
    return ex;
  }
  const store = await posStore(actor, ex ? ex.store_id : input.store_id);
  const st = store.settings;
  const shift = await posOpenShiftRow(store.id);
  if (!shift) fail('Open a shift before taking payments (menu → Shift).', 'NO_SHIFT');
  const orderType = st.orderTypes.includes(input.order_type) ? input.order_type : st.orderTypes[0];
  const priced = POS.priceCart({ items: posCleanItems(input.items), discount: posCleanDiscount(input.discount), order_type: orderType }, st);
  if (input.client_total != null && Math.round(Number(input.client_total)) !== priced.total) {
    fail('The total on the till is out of date — please refresh the page and try again.', 'PRICE_CHANGED');
  }
  const brand = POS.brandKey(store);
  let customer = null, wallet = null;
  if (input.customer_id) {
    customer = await getRow('pos_customers', String(input.customer_id));
    if (!customer) fail('That customer no longer exists — remove them from the sale.');
    wallet = await DB.prepare('SELECT balance FROM pos_wallets WHERE customer_id = ? AND brand = ?').bind(customer.id, brand).first();
  }
  let pay;
  try { pay = POS.checkPayments(priced.total, input.payments, st, { cashback: wallet ? Number(wallet.balance) || 0 : 0 }); } catch (e) { fail(e.message); }
  if (pay.cashbackUsed && !customer) fail('Add the customer to pay with their cashback.');
  const earned = customer ? POS.cashbackEarned(pay.paid, pay.cashbackUsed, st) : 0;
  const at = nowIso();
  const local = POS.localParts(at, posTz());
  if (ex) { // claim the open order so two tills can't take payment for it at the same time
    const c = await DB.prepare("UPDATE pos_sales SET status = 'paying', updated_at = ? WHERE id = ? AND status = 'open'").bind(at, id).run();
    if (!c.meta.changes) fail('This order is being paid on another device.');
  }
  try {
    const items = saleLines(priced);
    let kitchen = ex ? ex.kitchen : null;
    if (st.kitchen) { let fresh = false; items.forEach((l) => { if (!l.sent_at) { l.sent_at = at; fresh = true; } }); if (fresh || !kitchen) kitchen = 'new'; }
    const row = {
      id, store_id: store.id, shift_id: shift.id, status: 'paid', receipt_no: await posNextReceipt(store),
      order_no: (ex && ex.order_no) || await posNextOrderNo(store, local.date), order_type: orderType,
      table_no: posText(input.table_no, 20) || null, note: posText(input.note, 300) || null,
      customer_id: customer ? customer.id : null, customer_name: customer ? customer.name : null, customer_phone: customer ? customer.phone : null,
      items, subtotal: priced.subtotal, discount: priced.discount, discount_info: posCleanDiscount(input.discount), service: priced.service, tax: priced.tax,
      tax_included: priced.tax_included, rounding: pay.rounding, total: priced.total, payments: pay.payments, change_due: pay.change,
      cashback_earned: earned, cashback_used: pay.cashbackUsed, refunds: [], refunded: 0, kitchen,
      cashier: actor.who, cashier_id: actor.id, local_date: local.date, local_hour: local.hour, paid_at: at,
      offline_at: input.offline_at ? posText(input.offline_at, 30) : null, created_at: ex ? ex.created_at : at, updated_at: at,
    };
    const info = await posProductInfo(store.id, items);
    const stmts = [ex ? saleUpdateStmt(row, 'paying') : insertStmt('pos_sales', row)];
    const base = { sale_id: id, store_id: store.id, shift_id: shift.id, cashier: actor.who, local_date: local.date, created_at: at };
    for (const l of items) {
      const pi = info.get(l.product_id);
      stmts.push(insertStmt('pos_lines', { ...base, id: uuid(), kind: 'sale', product_id: l.product_id, name: l.name, category: pi ? pi.category : null,
        qty: l.qty, net: l.net, cost: pi ? pi.cost * l.qty : 0, local_hour: local.hour }));
    }
    for (const p of pay.payments) stmts.push(insertStmt('pos_payments', { ...base, id: uuid(), kind: 'sale', method: p.method, amount: p.amount }));
    const sold = new Map();
    for (const l of items) if (info.get(l.product_id)?.track) sold.set(l.product_id, { name: l.name, qty: (sold.get(l.product_id)?.qty || 0) + l.qty });
    for (const [pid, s] of sold) {
      stmts.push(DB.prepare('UPDATE pos_products SET stock = COALESCE(stock, 0) - ? WHERE id = ?').bind(s.qty, pid));
      stmts.push(stockMoveStmt({ store_id: store.id, product_id: pid, name: s.name, change: -s.qty, reason: 'sale', note: row.receipt_no, sale_id: id, who: actor.who, at }));
    }
    if (customer) {
      stmts.push(DB.prepare('UPDATE pos_customers SET visits = COALESCE(visits, 0) + 1, spent = COALESCE(spent, 0) + ?, last_visit_at = ?, last_store_id = ?, updated_at = ? WHERE id = ?')
        .bind(pay.paid, at, store.id, at, customer.id));
      if (earned || pay.cashbackUsed) stmts.push(walletStmt(customer.id, brand, earned - pay.cashbackUsed, earned, pay.cashbackUsed, at));
    }
    await DB.batch(stmts); // all or nothing
  } catch (e) {
    if (ex) await DB.prepare("UPDATE pos_sales SET status = 'open' WHERE id = ? AND status = 'paying'").bind(id).run();
    else { const again = await getRow('pos_sales', id); if (again && again.status !== 'open') return again; } // the same sale arrived twice at once
    throw e;
  }
  return getRow('pos_sales', id);
}

// Open orders (parked bills): saved now, paid later — e.g. a table that orders more as they go.
async function posSaveOpen(actor, input) {
  const id = posId(input.id);
  const ex = await getRow('pos_sales', id);
  if (ex && ex.status !== 'open') fail(ex.status === 'cancelled' ? 'This order was cancelled.' : 'This order was already paid.');
  const store = await posStore(actor, ex ? ex.store_id : input.store_id);
  const st = store.settings;
  const orderType = st.orderTypes.includes(input.order_type) ? input.order_type : st.orderTypes[0];
  const discount = posCleanDiscount(input.discount);
  const priced = POS.priceCart({ items: posCleanItems(input.items), discount, order_type: orderType }, st);
  const customer = input.customer_id ? await getRow('pos_customers', String(input.customer_id)) : null;
  const at = nowIso();
  const local = POS.localParts(at, posTz());
  const items = saleLines(priced);
  let kitchen = ex ? ex.kitchen : null;
  if (st.kitchen && input.send !== false) { // new lines go to the kitchen
    let fresh = false;
    items.forEach((l) => { if (!l.sent_at) { l.sent_at = at; fresh = true; } });
    if (fresh) kitchen = 'new';
  }
  const row = {
    id, store_id: store.id, shift_id: null, status: 'open', receipt_no: null, order_no: (ex && ex.order_no) || await posNextOrderNo(store, local.date),
    order_type: orderType, table_no: posText(input.table_no, 20) || null, note: posText(input.note, 300) || null,
    customer_id: customer ? customer.id : null, customer_name: customer ? customer.name : null, customer_phone: customer ? customer.phone : null,
    items, subtotal: priced.subtotal, discount: priced.discount, discount_info: discount, service: priced.service, tax: priced.tax, tax_included: priced.tax_included,
    rounding: 0, total: priced.total, payments: [], change_due: 0, cashback_earned: 0, cashback_used: 0, refunds: [], refunded: 0, kitchen,
    cashier: ex ? ex.cashier : actor.who, cashier_id: ex ? ex.cashier_id : actor.id, local_date: local.date, local_hour: local.hour,
    paid_at: null, offline_at: null, created_at: ex ? ex.created_at : at, updated_at: at,
  };
  if (ex) {
    const r = await saleUpdateStmt(row, 'open').run();
    if (!r.meta.changes) fail('This order was just paid or changed on another device.');
  } else await insertStmt('pos_sales', row).run();
  return getRow('pos_sales', id);
}

async function posCancelOpen(actor, id, reason) {
  const o = await getRow('pos_sales', String(id || ''));
  if (!o || !canStore(actor, o.store_id)) fail('That order no longer exists.');
  if (o.status !== 'open') fail('Only open orders can be cancelled — use Refund for paid sales.');
  const note = [o.note, `Cancelled by ${actor.who}${reason ? ': ' + posText(reason, 200) : ''}`].filter(Boolean).join(' · ');
  return updateRow('pos_sales', o.id, { status: 'cancelled', kitchen: null, note });
}

// Kitchen display: tickets still being made or waiting to be collected (last 24 hours).
async function posKitchen(actor, storeId) {
  const s = await posStore(actor, storeId, { active: false });
  return readTable('pos_sales', "WHERE store_id = ? AND kitchen IN ('new', 'ready') AND status IN ('open', 'paying', 'paid', 'partially_refunded') AND created_at > ?",
    s.id, new Date(Date.now() - 86400e3).toISOString());
}
async function posKitchenSet(actor, id, status) {
  const o = await getRow('pos_sales', String(id || ''));
  if (!o || !canStore(actor, o.store_id)) fail('That order no longer exists.');
  if (!['new', 'ready', 'done'].includes(status)) fail('Unknown kitchen status.');
  await DB.prepare('UPDATE pos_sales SET kitchen = ? WHERE id = ?').bind(status, o.id).run();
  return { ...o, kitchen: status };
}

async function posSales(actor, req) {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const from = ymd.test(req.from) ? req.from : POS.localParts(new Date(), posTz()).date;
  const to = ymd.test(req.to) ? req.to : from;
  const where = ['local_date BETWEEN ? AND ?'], binds = [from, to];
  if (req.storeId) { where.push('store_id = ?'); binds.push((await posStore(actor, req.storeId, { active: false })).id); }
  else if (actor.stores) { where.push(`store_id IN (${actor.stores.map(() => '?').join(', ')})`); binds.push(...actor.stores); }
  const statuses = { sold: SOLD, open: "('open')", cancelled: "('cancelled')", refunds: "('partially_refunded', 'refunded')" };
  where.push(`status IN ${statuses[req.status] || SOLD}`);
  const q = posText(req.q, 60);
  if (q) {
    const digits = q.replace(/\D/g, '');
    where.push('(receipt_no LIKE ? OR lower(customer_name) LIKE ? OR (? <> \'\' AND customer_phone LIKE ?) OR order_no = ?)');
    binds.push('%' + q.toUpperCase() + '%', '%' + q.toLowerCase() + '%', digits, '%' + digits.replace(/^0/, '') + '%', Number(digits) || -1);
  }
  const res = await DB.prepare(`SELECT * FROM pos_sales WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 500`).bind(...binds).all();
  return res.results.map((r) => rowOut('pos_sales', r));
}
async function posSaleFor(actor, id) {
  const o = await getRow('pos_sales', String(id || ''));
  if (!o || !canStore(actor, o.store_id)) fail('That sale no longer exists.');
  return o;
}

// A cashier's refund needs a manager there: their name + 6-digit passcode, checked here.
async function posApprover(ap, storeId) {
  if (!ap || !ap.name || !ap.passcode) fail('A manager needs to approve this refund with their name and passcode.', 'NEED_MANAGER');
  const ln = loginName(ap.name);
  const g = await guard('pc:' + ln, 5);
  const r = ln ? await DB.prepare('SELECT * FROM print_staff WHERE login_name = ?').bind(ln).first() : null;
  const st = r && rowOut('print_staff', r);
  const good = st && st.pass_hash && /^\d{6}$/.test(String(ap.passcode)) && sameText(await hashPassword(ap.passcode, st.pass_salt), st.pass_hash);
  if (!good) { await g.count(); fail("That manager name and passcode don't match.", 'NEED_MANAGER'); }
  await g.clear();
  if (!st.is_active || st.status !== 'approved' || st.pos_role !== 'manager' || (st.pos_stores && st.pos_stores.length && !st.pos_stores.includes(storeId))) {
    fail(`${st.name} isn't a manager at this store.`, 'NEED_MANAGER');
  }
  return st.name;
}

// Refund some or all of a sale: picks [{ index, qty }] of its lines. Money goes back by `method`.
async function posRefund(actor, req) {
  const sale = await getRow('pos_sales', String(req.id || ''));
  if (!sale || !canStore(actor, sale.store_id)) fail('That sale no longer exists.');
  if (!['paid', 'partially_refunded'].includes(sale.status)) fail(sale.status === 'refunded' ? 'This sale was already refunded in full.' : 'Only paid sales can be refunded.');
  const reason = posText(req.reason, 200);
  if (!reason) fail('Add a reason for the refund.');
  const approvedBy = isManager(actor) ? null : await posApprover(req.approver, sale.store_id);
  const store = await posStore(actor, sale.store_id, { active: false });
  const st = store.settings;
  const shift = await posOpenShiftRow(store.id);
  if (!shift) fail('Open a shift first — refunds are paid out of the drawer.', 'NO_SHIFT');
  const method = String(req.method || '');
  if (method === POS.CASHBACK ? !sale.customer_id : !st.methods.includes(method)) fail('Choose how the money goes back to the customer.');
  let q;
  try { q = POS.refundQuote(sale, req.lines, { method, settings: st }); } catch (e) { fail(e.message); }
  const at = nowIso();
  const local = POS.localParts(at, posTz());
  // Cashback the customer earned on this sale is taken back in proportion.
  const paid = sale.total + (sale.rounding || 0);
  const reversedSoFar = (sale.refunds || []).reduce((t, r) => t + (r.cashback_reversed || 0), 0);
  const left = (sale.cashback_earned || 0) - reversedSoFar;
  const reverse = !left ? 0 : q.full ? left : Math.min(left, Math.round(((sale.cashback_earned || 0) * q.amount) / (paid || 1)));
  const items = (sale.items || []).map((it, i) => {
    const ls = q.lines.filter((l) => l.index === i);
    return ls.length ? { ...it, refunded_qty: (it.refunded_qty || 0) + ls.reduce((t, l) => t + l.qty, 0), refunded_net: (it.refunded_net || 0) + ls.reduce((t, l) => t + l.net, 0) } : it;
  });
  const record = { id: uuid(), at, by: actor.who, approved_by: approvedBy, method, amount: q.amount, net: q.net, service: q.service, tax: q.tax,
    lines: q.lines, reason, restock: !!req.restock, cashback_reversed: reverse };
  // Claim the sale first (by its last-changed time) so two refunds can't go through at once.
  const claim = await DB.prepare('UPDATE pos_sales SET updated_at = ? WHERE id = ? AND updated_at = ?').bind(at, sale.id, sale.updated_at).run();
  if (!claim.meta.changes) fail('This sale was just changed on another device — open it again.');
  const stmts = [DB.prepare('UPDATE pos_sales SET items = ?, refunds = ?, refunded = ?, status = ? WHERE id = ?')
    .bind(JSON.stringify(items), JSON.stringify([...(sale.refunds || []), record]), (sale.refunded || 0) + q.amount, q.full ? 'refunded' : 'partially_refunded', sale.id)];
  const info = await posProductInfo(store.id, q.lines);
  const base = { sale_id: sale.id, store_id: store.id, shift_id: shift.id, cashier: actor.who, local_date: local.date, created_at: at };
  for (const l of q.lines) {
    const pi = info.get(l.product_id);
    stmts.push(insertStmt('pos_lines', { ...base, id: uuid(), kind: 'refund', product_id: l.product_id, name: l.name, category: pi ? pi.category : null,
      qty: -l.qty, net: -l.net, cost: pi ? -pi.cost * l.qty : 0, local_hour: local.hour }));
  }
  if (q.amount) stmts.push(insertStmt('pos_payments', { ...base, id: uuid(), kind: 'refund', method, amount: -q.amount }));
  if (req.restock) {
    for (const l of q.lines) {
      if (!info.get(l.product_id)?.track) continue;
      stmts.push(DB.prepare('UPDATE pos_products SET stock = COALESCE(stock, 0) + ? WHERE id = ?').bind(l.qty, l.product_id));
      stmts.push(stockMoveStmt({ store_id: store.id, product_id: l.product_id, name: l.name, change: l.qty, reason: 'refund', note: sale.receipt_no, sale_id: sale.id, who: actor.who, at }));
    }
  }
  if (sale.customer_id) {
    stmts.push(DB.prepare('UPDATE pos_customers SET spent = MAX(0, COALESCE(spent, 0) - ?), updated_at = ? WHERE id = ?').bind(q.amount, at, sale.customer_id));
    const back = method === POS.CASHBACK ? q.amount : 0;
    if (back || reverse) stmts.push(walletStmt(sale.customer_id, POS.brandKey(store), back - reverse, -reverse, -back, at));
  }
  await DB.batch(stmts);
  return getRow('pos_sales', sale.id);
}

// ── Shifts: opening float → pay in / pay out → count the drawer at close ──
async function posShiftTotals(sh, counted = null) {
  const [pays, sales, lines, refunds] = (await DB.batch([
    DB.prepare('SELECT method, kind, SUM(amount) AS amount, COUNT(DISTINCT sale_id) AS count FROM pos_payments WHERE shift_id = ? GROUP BY method, kind').bind(sh.id),
    DB.prepare(`SELECT COUNT(*) AS count, SUM(discount) AS discount, SUM(service) AS service, SUM(tax) AS tax, SUM(rounding) AS rounding FROM pos_sales WHERE shift_id = ? AND status IN ${SOLD}`).bind(sh.id),
    DB.prepare("SELECT SUM(net) AS net, SUM(CASE WHEN kind = 'sale' THEN qty ELSE 0 END) AS items FROM pos_lines WHERE shift_id = ?").bind(sh.id),
    DB.prepare("SELECT COUNT(DISTINCT sale_id) AS n FROM pos_payments WHERE shift_id = ? AND kind = 'refund'").bind(sh.id),
  ])).map((r) => r.results);
  const s = sales[0] || {}, l = lines[0] || {};
  return POS.shiftTotals({
    float: Number(sh.opening_float) || 0, moves: sh.moves || [], counted,
    pays: pays.map((p) => ({ method: p.method, kind: p.kind, amount: Number(p.amount) || 0, count: Number(p.count) || 0 })),
    sales: { count: Number(s.count) || 0, discount: Number(s.discount) || 0, service: Number(s.service) || 0, tax: Number(s.tax) || 0,
      rounding: Number(s.rounding) || 0, net: Number(l.net) || 0, items: Number(l.items) || 0, refundCount: Number(refunds[0]?.n) || 0 },
  });
}
async function posShiftFor(actor, id, { open = false } = {}) {
  const sh = await getRow('pos_shifts', String(id || ''));
  if (!sh || !canStore(actor, sh.store_id)) fail('That shift no longer exists.');
  if (open && sh.status !== 'open') fail('That shift is already closed.');
  return sh;
}
async function posShift(actor, storeId) {
  const s = await posStore(actor, storeId, { active: false });
  const sh = await posOpenShiftRow(s.id);
  return sh ? { ...sh, totals: await posShiftTotals(sh) } : null;
}
async function posOpenShift(actor, storeId, float) {
  const s = await posStore(actor, storeId);
  const f = posMoney(float, 'opening cash') || 0;
  const open = await posOpenShiftRow(s.id);
  if (open) fail(`A shift is already open at ${s.name} (opened by ${open.opened_by}).`);
  const at = nowIso();
  try {
    await insertRow('pos_shifts', { store_id: s.id, status: 'open', opened_by: actor.who, opened_at: at, opening_float: f, moves: [] });
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) fail(`A shift was just opened at ${s.name} on another device.`);
    throw e;
  }
  return posShift(actor, s.id);
}
async function posCashMove(actor, shiftId, move) {
  const sh = await posShiftFor(actor, shiftId, { open: true });
  const type = move.type === 'out' ? 'out' : move.type === 'in' ? 'in' : null;
  if (!type) fail('Choose pay in or pay out.');
  const amount = posMoney(move.amount);
  if (!amount) fail('Enter the amount.');
  const reason = posText(move.reason, 80);
  if (!reason) fail('Choose a reason.');
  const moves = [...(sh.moves || []), { id: uuid().slice(0, 8), type, amount, reason, note: posText(move.note, 200) || null, by: actor.who, at: nowIso() }];
  if (moves.length > 300) fail('This shift has too many pay ins / pay outs.');
  await updateRow('pos_shifts', sh.id, { moves });
  return posShift(actor, sh.store_id);
}
async function posCloseShift(actor, shiftId, counted, note) {
  const sh = await posShiftFor(actor, shiftId, { open: true });
  const c = posMoney(counted, 'cash counted');
  if (c == null) fail('Count the cash in the drawer and enter the total.');
  const totals = await posShiftTotals(sh, c);
  const r = await DB.prepare("UPDATE pos_shifts SET status = 'closed', closed_by = ?, closed_at = ?, counted = ?, summary = ?, note = ?, updated_at = ? WHERE id = ? AND status = 'open'")
    .bind(actor.who, nowIso(), c, JSON.stringify(totals), posText(note, 300) || null, nowIso(), sh.id).run();
  if (!r.meta.changes) fail('That shift is already closed.');
  return getRow('pos_shifts', sh.id);
}
async function posShifts(actor, storeId) {
  const s = await posStore(actor, storeId, { active: false });
  const res = await DB.prepare('SELECT * FROM pos_shifts WHERE store_id = ? ORDER BY opened_at DESC LIMIT 60').bind(s.id).all();
  return res.results.map((r) => rowOut('pos_shifts', r));
}
async function posShiftReport(actor, id) {
  const sh = await posShiftFor(actor, id);
  return sh.status === 'open' ? { ...sh, totals: await posShiftTotals(sh) } : { ...sh, totals: sh.summary };
}

// ── Customers & cashback ──
async function posWallets(ids, brand) {
  const out = new Map();
  if (!ids.length) return out;
  await inGroups(ids, async (g, q) => {
    const rows = (await DB.prepare(`SELECT customer_id, brand, balance FROM pos_wallets WHERE customer_id IN (${q})${brand ? ' AND brand = ?' : ''}`)
      .bind(...g, ...(brand ? [brand] : [])).all()).results;
    for (const w of rows) { const list = out.get(w.customer_id) || []; list.push({ brand: w.brand, balance: Number(w.balance) || 0 }); out.set(w.customer_id, list); }
  });
  return out;
}
const withCashback = (c, wallets, brand) => ({ ...c, cashback: brand ? ((wallets.get(c.id) || []).find((w) => w.brand === brand)?.balance || 0) : null,
  wallets: wallets.get(c.id) || [] });

async function posFindCustomers(actor, q, storeId) {
  const store = storeId ? await posStore(actor, storeId, { active: false }) : null;
  q = posText(q, 60);
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, '');
  const res = digits.length >= 3 && !/[a-z]/i.test(q)
    ? await DB.prepare('SELECT * FROM pos_customers WHERE phone LIKE ? ORDER BY last_visit_at DESC LIMIT 20').bind('%' + digits.replace(/^0/, '') + '%').all()
    : await DB.prepare('SELECT * FROM pos_customers WHERE lower(name) LIKE ? ORDER BY last_visit_at DESC LIMIT 20').bind('%' + q.toLowerCase() + '%').all();
  const rows = res.results.map((r) => rowOut('pos_customers', r));
  const brand = store ? POS.brandKey(store) : null;
  const wallets = await posWallets(rows.map((r) => r.id), brand);
  return rows.map((c) => withCashback(c, wallets, brand));
}
async function posCustomer(actor, id, storeId) {
  const c = await getRow('pos_customers', String(id || ''));
  if (!c) fail('That customer no longer exists.');
  const store = storeId ? await posStore(actor, storeId, { active: false }) : null;
  const brand = store ? POS.brandKey(store) : null;
  const wallets = await posWallets([c.id], null);
  const where = actor.stores ? ` AND store_id IN (${actor.stores.map(() => '?').join(', ')})` : '';
  const sales = (await DB.prepare(`SELECT * FROM pos_sales WHERE customer_id = ? AND status IN ${SOLD}${where} ORDER BY created_at DESC LIMIT 30`)
    .bind(c.id, ...(actor.stores || [])).all()).results.map((r) => rowOut('pos_sales', r));
  return { ...withCashback(c, wallets, brand), sales };
}
async function posSaveCustomer(input) {
  const phone = POS.normPhone(input.phone, posCountry());
  if (phone.length < 8 || phone.length > 15) fail('Enter the customer\'s phone number (e.g. 012-345 6789).');
  const email = posText(input.email, 120).toLowerCase() || null;
  if (email && !/^\S+@\S+\.\S+$/.test(email)) fail('That email doesn\'t look right.');
  const birthday = posText(input.birthday, 10) || null;
  if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) fail('Pick the birthday from the calendar.');
  const p = { phone, name: posText(input.name, 60) || null, email, birthday, notes: posText(input.notes, 500) || null };
  const other = await DB.prepare('SELECT id, name FROM pos_customers WHERE phone = ? AND id <> ?').bind(phone, String(input.id || '')).first();
  if (other) fail(`That phone number already belongs to ${other.name || 'another customer'}.`, 'EXISTS');
  if (input.id) {
    if (!(await getRow('pos_customers', String(input.id)))) fail('That customer no longer exists.');
    return updateRow('pos_customers', String(input.id), p);
  }
  return insertRow('pos_customers', p);
}
// Everyone (for the customer list and the marketing export), with every brand's cashback.
async function posCustomers() {
  const rows = (await DB.prepare('SELECT * FROM pos_customers ORDER BY last_visit_at DESC LIMIT 5000').all()).results.map((r) => rowOut('pos_customers', r));
  const wallets = new Map();
  for (const w of (await DB.prepare('SELECT customer_id, brand, balance FROM pos_wallets WHERE balance > 0').all()).results) {
    const list = wallets.get(w.customer_id) || [];
    list.push({ brand: w.brand, balance: Number(w.balance) || 0 });
    wallets.set(w.customer_id, list);
  }
  return rows.map((c) => ({ ...c, wallets: wallets.get(c.id) || [] }));
}

// ── Stock ──
async function posStockAdjust(actor, req) {
  const pr = await getRow('pos_products', String(req.productId || ''));
  if (!pr) fail('That product no longer exists.');
  const store = await posStore(actor, pr.store_id, { active: false });
  const mode = ['add', 'remove', 'set'].includes(req.mode) ? req.mode : null;
  if (!mode) fail('Choose what happened to the stock.');
  const qty = Math.round(Number(req.qty));
  if (!Number.isFinite(qty) || qty < 0 || qty > 1e6 || (mode !== 'set' && !qty)) fail('Enter how many.');
  const reason = Object.keys(POS.STOCK_REASONS).includes(req.reason) && !['sale', 'refund'].includes(req.reason) ? req.reason
    : { add: 'received', remove: 'wastage', set: 'count' }[mode];
  const change = mode === 'set' ? qty - (Number(pr.stock) || 0) : mode === 'add' ? qty : -qty;
  const at = nowIso();
  await DB.batch([
    mode === 'set' ? DB.prepare('UPDATE pos_products SET stock = ?, track_stock = 1, updated_at = ? WHERE id = ?').bind(qty, at, pr.id)
      : DB.prepare('UPDATE pos_products SET stock = COALESCE(stock, 0) + ?, track_stock = 1, updated_at = ? WHERE id = ?').bind(change, at, pr.id),
    stockMoveStmt({ store_id: store.id, product_id: pr.id, name: pr.name, change, reason, note: posText(req.note, 200), who: actor.who, at }),
  ]);
  return getRow('pos_products', pr.id);
}
async function posStockMoves(actor, storeId, productId) {
  const s = await posStore(actor, storeId, { active: false });
  const res = productId
    ? await DB.prepare('SELECT * FROM pos_stock_moves WHERE store_id = ? AND product_id = ? ORDER BY created_at DESC LIMIT 200').bind(s.id, String(productId)).all()
    : await DB.prepare('SELECT * FROM pos_stock_moves WHERE store_id = ? ORDER BY created_at DESC LIMIT 200').bind(s.id).all();
  return res.results.map((r) => rowOut('pos_stock_moves', r));
}

// ── Reports: summed by the database (fast, and within the free plan's limits), shaped by POS.buildReport ──
async function posReport(actor, storeId, from, to) {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!ymd.test(from) || !ymd.test(to) || from > to) fail('Pick the dates for the report.');
  if ((new Date(to) - new Date(from)) / 86400e3 > 400) fail('Pick a range of up to about a year.');
  let ids = actor.stores;
  if (storeId) ids = [(await posStore(actor, storeId, { active: false })).id];
  const W = 'local_date BETWEEN ? AND ?' + (ids ? ` AND store_id IN (${ids.map(() => '?').join(', ')})` : '');
  const q = (sql) => DB.prepare(sql).bind(from, to, ...(ids || []));
  const [sales, lines, days, daySales, hours, hourSales, methods, products, categories, stores, storeSales, cashiers] = (await DB.batch([
    q(`SELECT COUNT(*) AS count, SUM(subtotal) AS gross, SUM(discount) AS discount, SUM(service) AS service, SUM(tax) AS tax, SUM(rounding) AS rounding,
       SUM(total + rounding) AS paid, SUM(cashback_earned) AS cb_earned, SUM(cashback_used) AS cb_used FROM pos_sales WHERE status IN ${SOLD} AND ${W}`),
    q(`SELECT SUM(net) AS net, SUM(CASE WHEN kind = 'sale' THEN qty ELSE 0 END) AS items, SUM(CASE WHEN kind = 'refund' THEN -net ELSE 0 END) AS refunded_net,
       SUM(cost) AS cost FROM pos_lines WHERE ${W}`),
    q(`SELECT local_date AS date, SUM(net) AS net FROM pos_lines WHERE ${W} GROUP BY local_date`),
    q(`SELECT local_date AS date, COUNT(*) AS sales FROM pos_sales WHERE status IN ${SOLD} AND ${W} GROUP BY local_date`),
    q(`SELECT local_hour AS hour, SUM(net) AS net FROM pos_lines WHERE ${W} GROUP BY local_hour`),
    q(`SELECT local_hour AS hour, COUNT(*) AS sales FROM pos_sales WHERE status IN ${SOLD} AND ${W} GROUP BY local_hour`),
    q(`SELECT method, SUM(CASE WHEN kind = 'sale' THEN amount ELSE 0 END) AS sales, SUM(CASE WHEN kind = 'refund' THEN -amount ELSE 0 END) AS refunds,
       COUNT(DISTINCT CASE WHEN kind = 'sale' THEN sale_id END) AS count FROM pos_payments WHERE ${W} GROUP BY method`),
    q(`SELECT MAX(name) AS name, product_id, SUM(qty) AS qty, SUM(net) AS net FROM pos_lines WHERE ${W} GROUP BY COALESCE(product_id, name) ORDER BY SUM(net) DESC LIMIT 100`),
    q(`SELECT COALESCE(category, '') AS name, SUM(qty) AS qty, SUM(net) AS net FROM pos_lines WHERE ${W} GROUP BY COALESCE(category, '') ORDER BY SUM(net) DESC`),
    q(`SELECT store_id, SUM(net) AS net FROM pos_lines WHERE ${W} GROUP BY store_id`),
    q(`SELECT store_id, COUNT(*) AS sales FROM pos_sales WHERE status IN ${SOLD} AND ${W} GROUP BY store_id`),
    q(`SELECT cashier AS name, COUNT(*) AS sales, SUM(total + rounding) AS paid FROM pos_sales WHERE status IN ${SOLD} AND ${W} GROUP BY cashier ORDER BY SUM(total + rounding) DESC`),
  ])).map((r) => r.results);
  const storeNames = Object.fromEntries((await readTable('pos_stores')).map((s) => [s.id, s.name]));
  return POS.buildReport({ from, to, sales: sales[0], lines: lines[0], days, daySales, hours, hourSales, methods, products, categories, stores, storeSales, cashiers, storeNames });
}
