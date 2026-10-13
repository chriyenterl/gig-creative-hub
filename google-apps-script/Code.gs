/**
 * ============================================================================
 *  GIG Creative Hub — free backend on Google Drive + Google Sheets
 *
 *  What this does: stores your files in a "GIG Creative Hub files" folder in your
 *  Google Drive, and all the data (talents, links, approvals, usage…) in the
 *  Google Sheet this script is attached to. The GIG Creative Hub website talks to it.
 *
 *  Setup (full steps in README.md):
 *   1. Create a Google Sheet → Extensions → Apps Script → paste this whole file.
 *   2. Choose the function "setup" at the top and click Run (allow access).
 *   3. Deploy → New deployment → Web app → Execute as: Me,
 *      Who has access: Anyone → Deploy → copy the web app URL.
 *   4. Paste that URL into config.js (GOOGLE_SCRIPT_URL).
 *
 *  After changing this code later: Deploy → Manage deployments → Edit (pencil)
 *  → Version: New version → Deploy. (The URL stays the same.)
 * ============================================================================
 */

// Make uploaded files viewable by anyone who has the exact file link (links are
// long random codes, only shown inside the app). Needed so previews, video
// playback and downloads work in the app without everyone signing in to Google.
var SHARE_FILES_BY_LINK = true;

var TOKEN_DAYS = 30;          // how long a team login lasts
var PASSWORD_ROUNDS = 400;    // password hashing strength

// ── Data model: one sheet tab per table ────────────────────────────────────
var SCHEMA = {
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

var DEFAULTS = {
  team_members: { session_v: 0 },
  seasons:      { color: '#6d5efc', sort_order: 0 },
  talents:      { status: 'prospect', tags: [], languages: [] },
  upload_links: { is_active: true, upload_count: 0 },
  assets:       { category: 'final', media_type: 'other', source: 'team', tags: [], status: 'pending', use_count: 0 },
  asset_usage:  {},
  print_orders: { status: 'new', history: [] },
};

var SEED_SEASONS = [
  ['New Year', '#2a78d6'], ["Valentine's Day", '#e87ba4'], ['Spring', '#1baf7a'], ['Summer', '#eda100'],
  ['Back to School', '#4a3aa7'], ['Halloween', '#eb6834'], ['Black Friday / 11.11', '#0b0b0b'], ['Christmas & Holidays', '#e34948'],
];

var FOLDERS = { root: 'GIG Creative Hub files', final: 'Final content', raw: 'Raw footage', brand: 'Brand kit', creators: 'Creator uploads', print: 'Print orders' };

// ════════════════════════════════════════════════════════════════════════════
//  Entry points
// ════════════════════════════════════════════════════════════════════════════
function doGet() {
  return json_({ ok: true, data: { app: 'GIG Creative Hub', message: 'The GIG Creative Hub backend is running. Paste this URL into config.js.' } });
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    ensureSetup_();
    out = { ok: true, data: route_(req) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err), code: (err && err.code) || null };
  }
  return json_(out);
}

/** Run this once from the editor (choose "setup" → Run). Safe to run again. */
function setup() {
  var ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) { sheet_(name); });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  if (readTable_('seasons').rows.length === 0) {
    SEED_SEASONS.forEach(function (s, i) { insertRow_('seasons', { name: s[0], color: s[1], sort_order: i + 1 }); });
  }
  ['root', 'final', 'raw', 'brand', 'creators'].forEach(folder_);
  secret_();
  PropertiesService.getScriptProperties().setProperty('SETUP_V', '1');
  Logger.log('GIG Creative Hub is set up. Data: ' + ss.getUrl() + '  Files: ' + folder_('root').getUrl());
}

function ensureSetup_() {
  if (!PropertiesService.getScriptProperties().getProperty('SETUP_V')) setup();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(message, code) {
  var e = new Error(message);
  e.code = code || null;
  throw e;
}

// ════════════════════════════════════════════════════════════════════════════
//  Router
// ════════════════════════════════════════════════════════════════════════════
function route_(req) {
  var a = req.action;

  // ── No login needed ──
  if (a === 'status') return { needsSetup: readTable_('team_members').rows.length === 0 };
  if (a === 'setupAdmin') return setupAdmin_(req);
  if (a === 'login') return login_(req);
  if (a === 'linkInfo') return linkInfo_(req.linkToken);
  if (a === 'linkStartUpload') return linkStartUpload_(req);
  if (a === 'linkSubmit') return withLock_(function () { return linkSubmit_(req); });
  if (a === 'linkSubmissions') return linkSubmissions_(req.linkToken);
  if (a === 'relay') {
    if (!(req.linkToken && activeLink_(req.linkToken)) && !(req.orderKey && printOrderKeyOk_(req.orderKey))) verify_(req.token);
    return relay_(req);
  }
  if (String(a).indexOf('print') === 0) return printRoute_(req);

  // ── Team only ──
  var me = verify_(req.token);
  switch (a) {
    case 'me': return publicMember_(me, true);
    case 'changePassword': return withLock_(function () { return changePassword_(me, req.password); });
    case 'bootstrap': return bootstrap_();
    case 'list': return listRows_(req.table, req.eq);
    case 'insert': return withLock_(function () { return apiInsert_(req.table, req.row || {}, me); });
    case 'insertMany': return withLock_(function () {
      if (req.table !== 'talents') fail_('Bulk add is only for talents.');
      return insertRows_('talents', req.rows || []);
    });
    case 'update': return withLock_(function () { return apiUpdate_(req.table, req.id, req.patch || {}); });
    case 'updateMany': return withLock_(function () {
      return (req.ids || []).map(function (id) { return apiUpdate_(req.table, id, req.patch || {}); });
    });
    case 'remove': return withLock_(function () { apiRemove_(req.table, [req.id]); return true; });
    case 'removeMany': return withLock_(function () { apiRemove_(req.table, req.ids || []); return true; });
    case 'startUpload': return startUpload_(req);
    case 'removeFiles': return removeFiles_(req.ids || []);
  }
  fail_('Unknown action: ' + a);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ════════════════════════════════════════════════════════════════════════════
//  Sheets as tables
// ════════════════════════════════════════════════════════════════════════════
var _ss = null, _sheets = {};

function ss_() {
  if (_ss) return _ss;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  if (id) return (_ss = SpreadsheetApp.openById(id));
  var active = SpreadsheetApp.getActiveSpreadsheet();
  _ss = active || SpreadsheetApp.create('GIG Creative Hub — data');
  props.setProperty('SHEET_ID', _ss.getId());
  return _ss;
}

function sheet_(name) {
  if (!SCHEMA[name]) fail_('Unknown table: ' + name);
  if (_sheets[name]) return _sheets[name];
  var ss = ss_();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var cols = SCHEMA[name].cols;
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    // Add any columns that are missing (e.g. after an update).
    var header = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
    cols.forEach(function (c) {
      if (header.indexOf(c) < 0) { sh.getRange(1, header.length + 1).setValue(c).setFontWeight('bold'); header.push(c); }
    });
  }
  return (_sheets[name] = sh);
}

function readTable_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var header = values[0].map(String);
  var rows = [], rowNum = {};
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === '' || values[i][0] === null) continue;
    var obj = {};
    for (var c = 0; c < header.length; c++) if (header[c]) obj[header[c]] = fromCell_(name, header[c], values[i][c]);
    rows.push(obj);
    rowNum[obj.id] = i + 1;
  }
  return { sh: sh, header: header, rows: rows, rowNum: rowNum };
}

function fromCell_(table, col, v) {
  var s = SCHEMA[table];
  if (v instanceof Date) v = v.toISOString();
  if (s.json && s.json.indexOf(col) >= 0) { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  if (s.num && s.num.indexOf(col) >= 0) return v === '' || v === null ? null : Number(v);
  if (s.bool && s.bool.indexOf(col) >= 0) return v === true || String(v).toUpperCase() === 'TRUE';
  if (s.arr && s.arr.indexOf(col) >= 0) return v ? String(v).split(',').map(function (x) { return x.trim(); }).filter(String) : [];
  return v === '' || v === null ? null : String(v);
}

function toCell_(table, col, v) {
  var s = SCHEMA[table];
  if (v === null || v === undefined) return '';
  if (s.json && s.json.indexOf(col) >= 0) return JSON.stringify(v);
  if (s.arr && s.arr.indexOf(col) >= 0) return (Array.isArray(v) ? v : [v]).join(', ');
  if (s.bool && s.bool.indexOf(col) >= 0) return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function writeRow_(t, rowNumber, obj) {
  var cells = t.header.map(function (col) { return col ? toCell_(t.sh.getName(), col, obj[col]) : ''; });
  t.sh.getRange(rowNumber, 1, 1, cells.length).setNumberFormat('@').setValues([cells]);
}

function insertRow_(name, row) {
  var t = readTable_(name);
  var now = new Date().toISOString();
  var obj = {};
  var defaults = DEFAULTS[name] || {};
  Object.keys(defaults).forEach(function (k) { obj[k] = defaults[k]; });
  SCHEMA[name].cols.forEach(function (c) { if (row[c] !== undefined) obj[c] = row[c]; });
  obj.id = Utilities.getUuid();
  obj.created_at = now;
  if (SCHEMA[name].cols.indexOf('updated_at') >= 0) obj.updated_at = now;
  writeRow_(t, Math.max(t.sh.getLastRow(), 1) + 1, obj);
  return obj;
}

// Adds many rows in one write (used by the talent import).
function insertRows_(name, rows) {
  var t = readTable_(name);
  var now = new Date().toISOString();
  var start = Math.max(t.sh.getLastRow(), 1) + 1;
  var objs = rows.map(function (row) {
    var obj = {};
    var defaults = DEFAULTS[name] || {};
    Object.keys(defaults).forEach(function (k) { obj[k] = defaults[k]; });
    SCHEMA[name].cols.forEach(function (c) { if (row[c] !== undefined) obj[c] = row[c]; });
    obj.id = Utilities.getUuid();
    obj.created_at = now;
    if (SCHEMA[name].cols.indexOf('updated_at') >= 0) obj.updated_at = now;
    return obj;
  });
  if (!objs.length) return [];
  var cells = objs.map(function (obj) {
    return t.header.map(function (col) { return col ? toCell_(name, col, obj[col]) : ''; });
  });
  t.sh.getRange(start, 1, cells.length, t.header.length).setNumberFormat('@').setValues(cells);
  return objs;
}

function updateRow_(name, id, patch) {
  var t = readTable_(name);
  var n = t.rowNum[id];
  if (!n) fail_('That item no longer exists.');
  var obj = t.rows.filter(function (r) { return r.id === id; })[0];
  Object.keys(patch).forEach(function (k) {
    if (k !== 'id' && k !== 'created_at' && SCHEMA[name].cols.indexOf(k) >= 0) obj[k] = patch[k];
  });
  if (SCHEMA[name].cols.indexOf('updated_at') >= 0) obj.updated_at = new Date().toISOString();
  writeRow_(t, n, obj);
  return obj;
}

function deleteRows_(name, ids) {
  var t = readTable_(name);
  ids.map(function (id) { return t.rowNum[id]; }).filter(Boolean)
    .sort(function (a, b) { return b - a; })
    .forEach(function (n) { t.sh.deleteRow(n); });
}

// ════════════════════════════════════════════════════════════════════════════
//  Team API (with the same rules as the database version)
// ════════════════════════════════════════════════════════════════════════════
var CLIENT_TABLES = ['seasons', 'talents', 'upload_links', 'assets', 'asset_usage', 'team_members'];

function checkTable_(name) { if (CLIENT_TABLES.indexOf(name) < 0) fail_('Unknown table: ' + name); }

function clean_(name, row) { return name === 'team_members' ? publicMember_(row) : row; }

function listRows_(name, eq) {
  checkTable_(name);
  var rows = readTable_(name).rows;
  if (eq) rows = rows.filter(function (r) {
    return Object.keys(eq).every(function (k) { return String(r[k]) === String(eq[k]); });
  });
  return rows.map(function (r) { return clean_(name, r); });
}

function bootstrap_() {
  var out = {};
  ['assets', 'talents', 'seasons', 'upload_links', 'team_members'].forEach(function (t) { out[t] = listRows_(t); });
  out.links = { sheet: ss_().getUrl(), folder: folder_('root').getUrl() };
  return out;
}

function apiInsert_(name, row, me) {
  checkTable_(name);
  if (name === 'team_members') {
    var email = String(row.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) fail_('Enter a valid email.');
    if (findMember_(email)) fail_('That already exists.');
    if (!row.password || String(row.password).length < 8) fail_('Give them a password of at least 8 characters.');
    var salt = Utilities.getUuid();
    return publicMember_(insertRow_('team_members', {
      email: email, name: row.name || null, pass_salt: salt, pass_hash: hash_(row.password, salt), session_v: 0,
    }));
  }
  if (name === 'seasons' && readTable_('seasons').rows.some(function (s) {
    return String(s.name).toLowerCase() === String(row.name || '').toLowerCase();
  })) fail_('That already exists.');
  if (name === 'assets') {
    if (!row.storage_path) fail_('Missing file.');
    shareFile_(row.storage_path, ['final', 'raw', 'brand'].map(function (k) { return folder_(k).getId(); }));
  }
  if (name === 'upload_links' && !row.token) row.token = Utilities.getUuid().replace(/-/g, '');
  if (name === 'asset_usage' && !row.created_by) row.created_by = me.email;
  var created = insertRow_(name, row);
  if (name === 'asset_usage') syncUsage_(created.asset_id);
  return clean_(name, created);
}

function apiUpdate_(name, id, patch) {
  checkTable_(name);
  if (name === 'team_members') {
    var p = {};
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.password) {
      if (String(patch.password).length < 8) fail_('Use at least 8 characters.');
      var m = readTable_('team_members').rows.filter(function (r) { return r.id === id; })[0];
      if (!m) fail_('That person no longer exists.');
      p.pass_salt = Utilities.getUuid();
      p.pass_hash = hash_(patch.password, p.pass_salt);
      p.session_v = (Number(m.session_v) || 0) + 1; // signs them out everywhere
    }
    return publicMember_(updateRow_('team_members', id, p));
  }
  if (name === 'assets') delete patch.storage_path;
  var row = updateRow_(name, id, patch);
  if (name === 'asset_usage') syncUsage_(row.asset_id);
  return row;
}

function apiRemove_(name, ids) {
  checkTable_(name);
  if (!ids.length) return;
  if (name === 'team_members' && readTable_('team_members').rows.length - ids.length < 1) fail_('You need at least one team member.');
  var usageAssets = [];
  if (name === 'asset_usage') {
    usageAssets = readTable_('asset_usage').rows.filter(function (u) { return ids.indexOf(u.id) >= 0; }).map(function (u) { return u.asset_id; });
  }
  deleteRows_(name, ids);
  // Keep references tidy, like "on delete set null" in a database.
  var refCol = { seasons: 'season_id', talents: 'talent_id', upload_links: 'upload_link_id' }[name];
  if (refCol) {
    ['assets', 'upload_links'].forEach(function (tbl) {
      if (SCHEMA[tbl].cols.indexOf(refCol) < 0) return;
      readTable_(tbl).rows.forEach(function (r) {
        if (ids.indexOf(r[refCol]) >= 0) { var patch = {}; patch[refCol] = null; updateRow_(tbl, r.id, patch); }
      });
    });
  }
  if (name === 'assets') {
    var usage = readTable_('asset_usage').rows.filter(function (u) { return ids.indexOf(u.asset_id) >= 0; });
    deleteRows_('asset_usage', usage.map(function (u) { return u.id; }));
  }
  usageAssets.forEach(syncUsage_);
}

function syncUsage_(assetId) {
  var uses = readTable_('asset_usage').rows.filter(function (u) { return u.asset_id === assetId; });
  var last = uses.map(function (u) { return u.used_on; }).filter(String).sort().pop() || null;
  try { updateRow_('assets', assetId, { use_count: uses.length, last_used_on: last }); } catch (e) { /* asset deleted */ }
}

// ════════════════════════════════════════════════════════════════════════════
//  Logins (email + password, signed tokens)
// ════════════════════════════════════════════════════════════════════════════
function secret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('SECRET', s); }
  return s;
}

function hash_(password, salt) {
  var key = Utilities.newBlob(String(salt)).getBytes();
  var h = Utilities.computeHmacSha256Signature(Utilities.newBlob(String(password)).getBytes(), key);
  for (var i = 0; i < PASSWORD_ROUNDS; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return Utilities.base64Encode(h);
}

function sign_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, secret_()));
}

function makeToken_(m) {
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ e: m.email, v: Number(m.session_v) || 0, x: Date.now() + TOKEN_DAYS * 86400000 }));
  return payload + '.' + sign_(payload);
}

function verify_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) fail_('Please sign in again.', 'AUTH');
  var data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  if (!data.x || data.x < Date.now()) fail_('Your session expired. Please sign in again.', 'AUTH');
  var m = findMember_(data.e);
  if (!m || (Number(m.session_v) || 0) !== data.v) fail_('Please sign in again.', 'AUTH');
  return m;
}

function findMember_(email) {
  email = String(email || '').trim().toLowerCase();
  return readTable_('team_members').rows.filter(function (m) { return String(m.email).toLowerCase() === email; })[0] || null;
}

function publicMember_(m, withLinks) {
  var out = { id: m.id, email: m.email, name: m.name, created_at: m.created_at };
  if (withLinks) out.links = { sheet: ss_().getUrl(), folder: folder_('root').getUrl() };
  return out;
}

function setupAdmin_(req) {
  return withLock_(function () {
    if (readTable_('team_members').rows.length > 0) fail_('Setup is already done. Please sign in.');
    var m = apiInsert_('team_members', { email: req.email, name: req.name, password: req.password }, null);
    var full = findMember_(m.email);
    return { token: makeToken_(full), user: publicMember_(full, true) };
  });
}

function login_(req) {
  var email = String(req.email || '').trim().toLowerCase();
  var cache = CacheService.getScriptCache();
  var key = 'login_' + email;
  var tries = Number(cache.get(key) || 0);
  if (tries >= 10) fail_('Too many attempts. Please wait 10 minutes and try again.');
  var m = findMember_(email);
  if (!m || hash_(req.password || '', m.pass_salt) !== m.pass_hash) {
    cache.put(key, String(tries + 1), 600);
    fail_("That email and password don't match.");
  }
  cache.remove(key);
  return { token: makeToken_(m), user: publicMember_(m, true) };
}

function changePassword_(me, password) {
  var updated = apiUpdate_('team_members', me.id, { password: password });
  return { token: makeToken_(findMember_(updated.email)) };
}

// ════════════════════════════════════════════════════════════════════════════
//  Files in Google Drive
// ════════════════════════════════════════════════════════════════════════════
function folder_(key) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_' + key);
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ }
  }
  var parent = key === 'root' ? DriveApp.getRootFolder() : folder_('root');
  var created = parent.createFolder(FOLDERS[key]);
  props.setProperty('FOLDER_' + key, created.getId());
  return created;
}

// Starts a resumable upload straight into Drive and returns its one-time upload URL.
function createUploadSession_(name, mimeType, size, folderId, origin) {
  var meta = { name: String(name || 'file'), parents: [folderId], mimeType: mimeType || 'application/octet-stream' };
  var headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': meta.mimeType };
  if (size) headers['X-Upload-Content-Length'] = String(size);
  var url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id';
  var opts = { method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify(meta), headers: headers, muteHttpExceptions: true };
  var res;
  // Passing the website's origin lets the browser upload directly (faster). If Google refuses it, go without.
  try {
    if (origin) { headers.Origin = origin; res = UrlFetchApp.fetch(url, opts); }
  } catch (e) { res = null; }
  if (!res || res.getResponseCode() !== 200) { delete headers.Origin; res = UrlFetchApp.fetch(url, opts); }
  if (res.getResponseCode() !== 200) fail_('Could not start the upload: ' + res.getContentText().slice(0, 200));
  var h = res.getHeaders();
  return h.Location || h.location;
}

function startUpload_(req) {
  var key = ['final', 'raw', 'brand'].indexOf(req.category) >= 0 ? req.category : 'final';
  return { uploadUrl: createUploadSession_(req.name, req.mimeType, req.size, folder_(key).getId(), req.origin) };
}

// Forwards one piece of a file to Drive (used when the browser can't upload directly).
function relay_(req) {
  var url = String(req.uploadUrl || '');
  if (url.indexOf('https://www.googleapis.com/upload/drive/v3/files?') !== 0 || url.indexOf('upload_id=') < 0) fail_('Invalid upload.');
  var total = Number(req.total);
  var headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var opts = { method: 'put', headers: headers, muteHttpExceptions: true, followRedirects: false };
  if (req.data) {
    var bytes = Utilities.base64Decode(req.data);
    var start = Number(req.start);
    headers['Content-Range'] = 'bytes ' + start + '-' + (start + bytes.length - 1) + '/' + total;
    opts.contentType = 'application/octet-stream';
    opts.payload = bytes;
  } else {
    headers['Content-Range'] = 'bytes */' + total; // "how much have you received?"
  }
  var res = UrlFetchApp.fetch(url, opts);
  var code = res.getResponseCode();
  if (code === 200 || code === 201) return { done: true, fileId: JSON.parse(res.getContentText()).id };
  if (code === 308) {
    var h = res.getHeaders();
    var range = h.Range || h.range;
    return { done: false, next: range ? Number(String(range).split('-')[1]) + 1 : 0 };
  }
  fail_('Upload failed (' + code + '). Please try again.');
}

function shareFile_(fileId, allowedParents) {
  var file;
  try { file = DriveApp.getFileById(fileId); } catch (e) { fail_('We could not find the uploaded file. Please try again.'); }
  if (allowedParents) {
    var ok = false, it = file.getParents();
    while (it.hasNext()) if (allowedParents.indexOf(it.next().getId()) >= 0) ok = true;
    if (!ok) fail_('That file is not in the GIG Creative Hub folder.');
  }
  if (SHARE_FILES_BY_LINK) {
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* blocked by admin policy */ }
  }
  return file;
}

function removeFiles_(ids) {
  ids.forEach(function (id) {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* already gone */ }
  });
  return true; // files go to Drive's Trash (recoverable for 30 days)
}

// ════════════════════════════════════════════════════════════════════════════
//  Private upload links (creators — no login)
// ════════════════════════════════════════════════════════════════════════════
function activeLink_(token) {
  if (!token) return null;
  return readTable_('upload_links').rows.filter(function (l) {
    return l.token === token && l.is_active && (!l.expires_at || new Date(l.expires_at) > new Date());
  })[0] || null;
}

function linkInfo_(token) {
  var l = activeLink_(token);
  if (!l) return null;
  var season = l.season_id && readTable_('seasons').rows.filter(function (s) { return s.id === l.season_id; })[0];
  var talent = l.talent_id && readTable_('talents').rows.filter(function (t) { return t.id === l.talent_id; })[0];
  return { label: l.label, instructions: l.instructions, season_name: season ? season.name : null, talent_name: talent ? talent.name : null };
}

function linkFolder_(l) {
  if (l.folder_id) {
    try { var f = DriveApp.getFolderById(l.folder_id); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ }
  }
  var created = folder_('creators').createFolder(String(l.label || 'Creator').slice(0, 80));
  withLock_(function () { updateRow_('upload_links', l.id, { folder_id: created.getId() }); });
  return created;
}

function linkStartUpload_(req) {
  var l = activeLink_(req.linkToken);
  if (!l) fail_('This upload link is no longer active. Please contact the team.');
  return { uploadUrl: createUploadSession_(req.name, req.mimeType, req.size, linkFolder_(l).getId(), req.origin) };
}

function mediaTypeFor_(mime) {
  mime = String(mime || '');
  if (mime.indexOf('image/') === 0) return 'image';
  if (mime.indexOf('video/') === 0) return 'video';
  if (mime.indexOf('audio/') === 0) return 'audio';
  if (mime === 'application/pdf' || mime.indexOf('text/') === 0 || mime.indexOf('application/msword') === 0 || mime.indexOf('application/vnd.') === 0) return 'document';
  return 'other';
}

function linkSubmit_(req) {
  var l = activeLink_(req.linkToken);
  if (!l) fail_('This upload link is no longer active. Please contact the team.');
  if (!l.folder_id) fail_('Invalid upload.');
  if (readTable_('assets').rows.some(function (a) { return a.storage_path === req.fileId; })) fail_('This file was already sent.');
  var file = shareFile_(req.fileId, [l.folder_id]);
  var mime = file.getMimeType() || req.mime_type || 'application/octet-stream';
  var asset = insertRow_('assets', {
    title: String(req.title || '').trim() || req.file_name || file.getName(),
    description: String(req.description || '').trim() || null,
    category: 'final', media_type: mediaTypeFor_(mime),
    season_id: l.season_id, talent_id: l.talent_id, upload_link_id: l.id, source: 'talent',
    storage_path: req.fileId, file_name: req.file_name || file.getName(), mime_type: mime, size_bytes: file.getSize(),
    status: 'pending', uploaded_by: l.label,
  });
  updateRow_('upload_links', l.id, { upload_count: (Number(l.upload_count) || 0) + 1, last_upload_at: new Date().toISOString() });
  return asset.id;
}

function linkSubmissions_(token) {
  var l = activeLink_(token);
  if (!l) return [];
  return readTable_('assets').rows
    .filter(function (a) { return a.upload_link_id === l.id; })
    .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })
    .slice(0, 200)
    .map(function (a) { return { title: a.title, media_type: a.media_type, status: a.status, created_at: a.created_at }; });
}


// ════════════════════════════════════════════════════════════════════════════
//  PRINT HUB — orders from customers, worked on by admin, run by master
//
//  Links (all changeable by master):
//    customer order link  → print/order.html#<orderKey>   (one shared link)
//    admin link           → print/index.html#k=<adminKey>
//    master link          → print/index.html#k=<masterKey>
//  Anyone signed in to the Creative Hub is treated as master.
// ════════════════════════════════════════════════════════════════════════════
var PRINT_STATUSES = ['new', 'pending', 'completed'];
var NOT_STICKER_OR_BANNER = { q: 'q_item', op: 'not_in', values: ['Stickers / labels', 'Banner / bunting'] };
var DEFAULT_PRINT_QUESTIONS = [
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

// Is this question shown, given the answers? (Same rule as the website.)
function isVisible_(q, answers, questions, seen) {
  seen = seen || {};
  var c = q.showIf;
  if (!c || !c.q || seen[q.id]) return true;
  seen[q.id] = true;
  var parent = questions.filter(function (x) { return x.id === c.q; })[0];
  if (!parent) return true;
  if (!isVisible_(parent, answers, questions, seen)) return false;
  var v = answers[c.q];
  var vals = Array.isArray(v) ? v : (v === undefined || v === null || v === '') ? [] : [String(v)];
  if (!vals.length) return false;
  var hit = vals.some(function (x) { return (c.values || []).indexOf(x) >= 0; });
  return c.op === 'not_in' ? !hit : hit;
}
var DEFAULT_READY_MESSAGE = 'Hi {name}! Your print order {order_no} ({item}) is completed and ready for pickup. Thank you!';
var DEFAULT_NEW_MESSAGE = 'Hi {name}! We\'ve received your print order {order_no} ({item} × {quantity}). We\'ll message you when it\'s ready.';

function newKey_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); }

function printSettings_() {
  var props = PropertiesService.getScriptProperties();
  var s = JSON.parse(props.getProperty('PRINT_SETTINGS') || 'null');
  if (!s) {
    s = { masterKey: newKey_(), adminKey: newKey_(), orderKey: newKey_(), orderActive: true, adminActive: true, nextNo: 1001,
          webhookUrl: '', webhookSecret: '', readyMessage: DEFAULT_READY_MESSAGE };
    props.setProperty('PRINT_SETTINGS', JSON.stringify(s));
  }
  if (!s.readyMessage) s.readyMessage = DEFAULT_READY_MESSAGE;
  if (!s.newOrderMessage) s.newOrderMessage = DEFAULT_NEW_MESSAGE;
  if (s.notifyOnNew === undefined) s.notifyOnNew = true;
  if (s.notifyOnDone === undefined) s.notifyOnDone = true;
  if (s.teamEmails === undefined) { s.teamEmails = ''; s.teamEmailOn = false; s.siteUrl = ''; }
  return s;
}
function savePrintSettings_(s) { PropertiesService.getScriptProperties().setProperty('PRINT_SETTINGS', JSON.stringify(s)); }
function printQuestions_() {
  var q = PropertiesService.getScriptProperties().getProperty('PRINT_QUESTIONS');
  return q ? JSON.parse(q) : DEFAULT_PRINT_QUESTIONS;
}
function printOrderKeyOk_(key) { var s = printSettings_(); return !!(s.orderActive && key && key === s.orderKey); }

function printRole_(req) {
  var s = printSettings_();
  if (req.printKey && req.printKey === s.masterKey) return 'master';
  if (req.printKey && s.adminActive && req.printKey === s.adminKey) return 'admin';
  if (req.token) { verify_(req.token); return 'master'; }
  fail_('This access link is no longer valid. Please ask for a new one.', 'PRINT_AUTH');
}

function printRoute_(req) {
  var a = req.action;
  // ── Customer (shared order link) ──
  if (a === 'printForm') return printOrderKeyOk_(req.orderKey) ? { questions: printQuestions_() } : null;
  if (a === 'printStartUpload') {
    if (!printOrderKeyOk_(req.orderKey)) fail_('This order link is no longer active. Please contact us.');
    return { uploadUrl: createUploadSession_(req.name, req.mimeType, req.size, folder_('print').getId(), req.origin) };
  }
  if (a === 'printSubmit') {
    var created = withLock_(function () { return printSubmit_(req); });
    var st = printSettings_();
    var entries = [];  // done outside the lock — email and the bot can be slow
    if (st.teamEmailOn && st.teamEmails) entries.push(teamEmail_(created, false));
    if (st.webhookUrl && st.notifyOnNew) entries.push(notify_('created', created, false));
    if (entries.length) withLock_(function () {
      var o = findOrder_(created.id);
      updateRow_('print_orders', o.id, { history: (o.history || []).concat(entries) });
    });
    return { order_no: created.order_no };
  }

  // ── Admin & master ──
  var role = printRole_(req);
  var master = role === 'master';
  var needMaster = function () { if (!master) fail_('Only the master link can do that.'); };
  switch (a) {
    case 'printMe': return printMe_(role);
    case 'printOrders': return readTable_('print_orders').rows;
    case 'printUpdate': return withLock_(function () { return printUpdate_(role, req.id, req.patch || {}); });
    case 'printNotify': return withLock_(function () { return printNotifyAgain_(role, req.id, req.kind); });
    case 'printDelete': needMaster(); return withLock_(function () { return printDelete_(req.id); });
    case 'printSaveQuestions': needMaster(); return printSaveQuestions_(req.questions);
    case 'printSaveSettings': needMaster(); return withLock_(function () { return printSaveSettings_(req.settings || {}); });
    case 'printRegenerate': needMaster(); return withLock_(function () { return printRegenerate_(req.which); });
    case 'printSetActive': needMaster(); return withLock_(function () { return printSetActive_(req.which, !!req.active); });
    case 'printTestNotify': needMaster(); return printTestNotify_(req.kind);
    case 'printTestTeamEmail': needMaster(); return teamEmail_({ order_no: 'P-TEST', customer_name: 'Test Customer', company: 'Test Co',
      phone: '+60123456789', summary: 'Flyers', quantity: '500', due_date: null, answers: [], id: '' }, true);
  }
  fail_('Unknown action: ' + a);
}

function printMe_(role) {
  var s = printSettings_();
  var out = { role: role, questions: printQuestions_(), botLinked: !!s.webhookUrl, readyMessage: s.readyMessage,
              newOrderMessage: s.newOrderMessage, notifyOnDone: s.notifyOnDone };
  if (role === 'master') {
    out.settings = { masterKey: s.masterKey, adminKey: s.adminKey, orderKey: s.orderKey, orderActive: s.orderActive, adminActive: s.adminActive,
                     webhookUrl: s.webhookUrl, webhookSecret: s.webhookSecret, readyMessage: s.readyMessage,
                     newOrderMessage: s.newOrderMessage, notifyOnNew: s.notifyOnNew, notifyOnDone: s.notifyOnDone,
                     teamEmails: s.teamEmails, teamEmailOn: s.teamEmailOn };
  }
  return out;
}

function printSubmit_(req) {
  var s = printSettings_();
  if (!s.orderActive || req.orderKey !== s.orderKey) fail_('This order link is no longer active. Please contact us.');
  var answersIn = req.answers || {}, filesIn = req.files || {};
  var printFolderId = folder_('print').getId();
  var roleCol = { name: 'customer_name', company: 'company', email: 'email', phone: 'phone', item: 'summary', quantity: 'quantity', deadline: 'due_date' };
  var row = {}, answers = [];
  var cleanFiles = function (list) {
    return (list || []).map(function (f) {
      shareFile_(f.id, [printFolderId]);
      return { id: String(f.id), name: String(f.name || 'file'), size: Number(f.size) || null, mime: f.mime || null };
    });
  };
  var questions = printQuestions_();
  questions.forEach(function (q) {
    if (!isVisible_(q, answersIn, questions)) { answers.push({ id: q.id, label: q.label, type: q.type, value: null, hidden: true }); return; }
    if (q.type === 'voice_text') {
      var text = String(answersIn[q.id] || '').trim().slice(0, 5000);
      var voice = cleanFiles(filesIn[q.id]);
      if (q.required && !text && !voice.length) fail_('Please answer: ' + q.label);
      answers.push({ id: q.id, label: q.label, type: q.type, value: (text || voice.length) ? { text: text || null, files: voice } : null });
      return;
    }
    var v = q.type === 'file' ? (filesIn[q.id] || []) : answersIn[q.id];
    if (typeof v === 'string') v = v.trim().slice(0, 5000);
    var empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (q.required && empty) fail_('Please answer: ' + q.label);
    if (q.type === 'date' && !empty && String(v) < earliestDate_()) fail_('Please choose today or a future date for: ' + q.label);
    if (q.type === 'file' && !empty) v = cleanFiles(v);
    answers.push({ id: q.id, label: q.label, type: q.type, value: empty ? null : v });
    if (q.role && roleCol[q.role] && !empty) row[roleCol[q.role]] = Array.isArray(v) ? v.join(', ') : String(v);
  });
  var orderNo = 'P-' + s.nextNo;
  s.nextNo += 1;
  savePrintSettings_(s);
  row.order_no = orderNo;
  row.status = 'new';
  row.answers = answers;
  row.history = [{ status: 'new', at: new Date().toISOString(), by: 'customer' }];
  return insertRow_('print_orders', row);
}

// Dates can't be in the past (one day of leeway for time-zone differences).
function earliestDate_() {
  return Utilities.formatDate(new Date(Date.now() - 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function findOrder_(id) {
  var o = readTable_('print_orders').rows.filter(function (r) { return r.id === id; })[0];
  if (!o) fail_('That order no longer exists.');
  return o;
}

function printUpdate_(role, id, patch) {
  var o = findOrder_(id);
  var p = {};
  var history = o.history || [];
  if (patch.status && PRINT_STATUSES.indexOf(patch.status) >= 0 && patch.status !== o.status) {
    p.status = patch.status;
    history.push({ status: patch.status, at: new Date().toISOString(), by: role });
    var ps = printSettings_();
    if (patch.status === 'completed' && patch.notify !== false && ps.webhookUrl && ps.notifyOnDone) history.push(notify_('completed', o, false));
    p.history = history;
  }
  if (patch.whatsapp) { // staff opened WhatsApp with a message for the customer
    history.push({ event: 'whatsapp', kind: patch.whatsapp === 'created' ? 'created' : 'completed', at: new Date().toISOString(), by: role });
    p.history = history;
  }
  if (patch.internal_notes !== undefined) p.internal_notes = String(patch.internal_notes || '').slice(0, 20000) || null;
  return updateRow_('print_orders', id, p);
}

function printNotifyAgain_(role, id, kind) {
  var o = findOrder_(id);
  var history = o.history || [];
  history.push(notify_(kind === 'created' ? 'created' : 'completed', o, false));
  return updateRow_('print_orders', id, { history: history });
}

function printDelete_(id) {
  var o = findOrder_(id);
  (o.answers || []).forEach(function (a) {
    var list = a.type === 'file' ? a.value : a.type === 'voice_text' && a.value ? a.value.files : null;
    if (list && list.length) removeFiles_(list.map(function (f) { return f.id; }));
  });
  deleteRows_('print_orders', [id]);
  return true;
}

function printSaveQuestions_(questions) {
  if (!Array.isArray(questions) || !questions.length) fail_('The form needs at least one question.');
  var types = ['text', 'textarea', 'number', 'email', 'phone', 'date', 'select', 'radio', 'checkbox', 'file', 'voice_text'];
  var clean = questions.map(function (q) {
    if (!q.label || !String(q.label).trim()) fail_('Every question needs a label.');
    return {
      id: String(q.id || ('q_' + Utilities.getUuid().slice(0, 8))), label: String(q.label).trim().slice(0, 300),
      type: types.indexOf(q.type) >= 0 ? q.type : 'text', required: !!q.required,
      help: q.help ? String(q.help).slice(0, 500) : '', role: q.role || '',
      options: Array.isArray(q.options) ? q.options.map(String).filter(String).slice(0, 50) : [],
      showIf: q.showIf && q.showIf.q ? { q: String(q.showIf.q), op: q.showIf.op === 'not_in' ? 'not_in' : 'in',
        values: (q.showIf.values || []).map(String).slice(0, 50) } : null,
    };
  });
  var text = JSON.stringify(clean);
  if (text.length > 8500) fail_('The form is too long to save. Try shorter help texts or fewer options.');
  PropertiesService.getScriptProperties().setProperty('PRINT_QUESTIONS', text);
  return clean;
}

function printSaveSettings_(input) {
  var s = printSettings_();
  if (input.webhookUrl !== undefined) {
    var url = String(input.webhookUrl || '').trim();
    if (url && !/^https:\/\//.test(url)) fail_('The bot link must start with https://');
    s.webhookUrl = url;
  }
  if (input.webhookSecret !== undefined) s.webhookSecret = String(input.webhookSecret || '').trim();
  if (input.readyMessage !== undefined) s.readyMessage = String(input.readyMessage || '').trim() || DEFAULT_READY_MESSAGE;
  if (input.newOrderMessage !== undefined) s.newOrderMessage = String(input.newOrderMessage || '').trim() || DEFAULT_NEW_MESSAGE;
  if (input.notifyOnNew !== undefined) s.notifyOnNew = !!input.notifyOnNew;
  if (input.notifyOnDone !== undefined) s.notifyOnDone = !!input.notifyOnDone;
  if (input.teamEmails !== undefined) {
    var list = String(input.teamEmails || '').split(/[,;\s]+/).map(function (e) { return e.trim(); }).filter(String);
    list.forEach(function (e) { if (!/^\S+@\S+\.\S+$/.test(e)) fail_('“' + e + '” doesn’t look like an email address.'); });
    s.teamEmails = list.join(', ');
  }
  if (input.teamEmailOn !== undefined) s.teamEmailOn = !!input.teamEmailOn;
  if (input.siteUrl && /^https?:\/\//.test(input.siteUrl)) s.siteUrl = String(input.siteUrl).split('#')[0];
  savePrintSettings_(s);
  return printMe_('master').settings;
}

function printRegenerate_(which) {
  var s = printSettings_();
  var field = { order: 'orderKey', admin: 'adminKey', master: 'masterKey' }[which];
  if (!field) fail_('Unknown link.');
  s[field] = newKey_();
  savePrintSettings_(s);
  return printMe_('master').settings;
}

function printSetActive_(which, active) {
  var s = printSettings_();
  var field = { order: 'orderActive', admin: 'adminActive' }[which];
  if (!field) fail_('That link can\'t be turned off.');
  s[field] = active;
  savePrintSettings_(s);
  return printMe_('master').settings;
}

// ── Bot notifications: "order.created" (new order) and "order.completed" ──
function fillMessage_(template, o) {
  var name = o.customer_name ? String(o.customer_name).split(' ')[0] : 'there';
  var due = '';
  if (o.due_date) { var d = new Date(String(o.due_date).length === 10 ? o.due_date + 'T00:00:00' : o.due_date); due = isNaN(d) ? String(o.due_date) : Utilities.formatDate(d, Session.getScriptTimeZone(), 'd MMM yyyy'); }
  return String(template)
    .replace(/\{name\}/g, name).replace(/\{full_name\}/g, o.customer_name || '')
    .replace(/\{order_no\}/g, o.order_no || '').replace(/\{item\}/g, o.summary || 'your order')
    .replace(/\{quantity\}/g, o.quantity || '').replace(/\{company\}/g, o.company || '').replace(/\{due\}/g, due);
}

function notifyPayload_(kind, o, s, test) {
  var done = kind === 'completed';
  var files = [];
  (o.answers || []).forEach(function (a) {
    if (a.hidden || !a.value) return;
    var list = a.type === 'file' ? a.value : a.type === 'voice_text' ? (a.value.files || []) : [];
    list.forEach(function (f) { files.push({ name: f.name, url: 'https://drive.google.com/file/d/' + f.id + '/view', voice_note: a.type === 'voice_text' }); });
  });
  var out = {
    event: done ? 'order.completed' : 'order.created', test: !!test, order_no: o.order_no, status: done ? 'completed' : 'new',
    message: fillMessage_(done ? s.readyMessage : s.newOrderMessage, o),
    customer: { name: o.customer_name || null, company: o.company || null, phone: o.phone || null, email: o.email || null },
    order: {
      item: o.summary || null, quantity: o.quantity || null, due_date: o.due_date || null, files: files,
      answers: (o.answers || []).filter(function (a) { return !a.hidden; }).map(function (a) {
        var v = a.value;
        if (a.type === 'file' && v) v = v.map(function (f) { return f.name; }).join(', ');
        else if (a.type === 'voice_text') v = v ? [v.text, (v.files || []).length ? 'Voice note attached' : ''].filter(String).join(' · ') : null;
        else if (Array.isArray(v)) v = v.join(', ');
        return { question: a.label, answer: v };
      }),
    },
  };
  out[done ? 'completed_at' : 'created_at'] = new Date().toISOString();
  out.team_message = done
    ? 'Order ' + o.order_no + ' for ' + (o.customer_name || 'a customer') + (o.company ? ' (' + o.company + ')' : '') + ' is completed and ready for pickup.'
    : teamMessage_(o);
  return out;
}

// Sends the order to the bot link. Returns a history entry describing what happened.
function notify_(kind, o, test) {
  var s = printSettings_();
  var at = new Date().toISOString();
  if (!s.webhookUrl) return { event: 'notify', kind: kind, ok: false, at: at, detail: 'No bot linked yet — customer was not notified.' };
  try {
    var headers = {};
    if (s.webhookSecret) headers['X-Webhook-Secret'] = s.webhookSecret;
    var res = UrlFetchApp.fetch(s.webhookUrl, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(notifyPayload_(kind, o, s, test)),
      headers: headers, muteHttpExceptions: true, followRedirects: true,
    });
    var code = res.getResponseCode();
    return code >= 200 && code < 300
      ? { event: 'notify', kind: kind, ok: true, at: at, detail: kind === 'completed' ? 'Customer notified via bot.' : 'Bot told about the new order.' }
      : { event: 'notify', kind: kind, ok: false, at: at, detail: 'Bot replied with an error (' + code + ').' };
  } catch (e) {
    return { event: 'notify', kind: kind, ok: false, at: at, detail: 'Could not reach the bot: ' + String(e.message || e).slice(0, 150) };
  }
}

function printTestNotify_(kind) {
  var sample = { order_no: 'P-TEST', customer_name: 'Test Customer', company: 'Test Co', phone: '+60123456789', email: 'test@example.com',
                 summary: 'Flyers', quantity: '500', due_date: null, answers: [] };
  return notify_(kind === 'created' ? 'created' : 'completed', sample, true);
}



// ── Team alert by email (sent from the Google account that owns this script) ──
function teamMessage_(o) {
  var who = (o.customer_name || 'a customer') + (o.company ? ' (' + o.company + ')' : '');
  var what = [o.summary, o.quantity ? '× ' + o.quantity : ''].filter(String).join(' ');
  var due = '';
  if (o.due_date) { var d = new Date(String(o.due_date).length === 10 ? o.due_date + 'T00:00:00' : o.due_date); due = isNaN(d) ? String(o.due_date) : Utilities.formatDate(d, Session.getScriptTimeZone(), 'd MMM yyyy'); }
  return 'New print order ' + o.order_no + ' from ' + who + (what ? ': ' + what : '') + (due ? ', due ' + due : '') + '.';
}

function teamEmail_(o, test) {
  var s = printSettings_();
  var at = new Date().toISOString();
  var to = String(s.teamEmails || '').trim();
  if (!to) return { event: 'team', ok: false, at: at, detail: 'No team email addresses saved.' };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var rows = (o.answers || []).filter(function (a) { return !a.hidden && a.value !== null && a.value !== ''; }).map(function (a) {
    var v = a.value;
    if (a.type === 'file') v = v.map(function (f) { return f.name; }).join(', ');
    else if (a.type === 'voice_text') v = [v.text, (v.files || []).length ? '(voice note attached)' : ''].filter(String).join(' ');
    else if (Array.isArray(v)) v = v.join(', ');
    return '<tr><td style="color:#777;padding:4px 12px 4px 0;vertical-align:top">' + esc(a.label) + '</td><td style="padding:4px 0"><b>' + esc(v) + '</b></td></tr>';
  }).join('');
  var link = s.siteUrl && o.id ? s.siteUrl + '#/order/' + o.id : '';
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d1033">' +
    '<p style="font-size:16px"><b>' + esc(teamMessage_(o)) + '</b></p>' +
    (test ? '<p style="color:#b00">This is a test email from GIG Print Hub.</p>' : '') +
    (rows ? '<table style="border-collapse:collapse;margin:8px 0 16px">' + rows + '</table>' : '') +
    (link ? '<p><a href="' + esc(link) + '" style="background:#ff3d7f;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none">Open the order</a></p>' : '') +
    '</div>';
  try {
    if (MailApp.getRemainingDailyQuota() < 1) return { event: 'team', ok: false, at: at, detail: 'Daily email limit reached — team not emailed.' };
    MailApp.sendEmail({ to: to, subject: (test ? '[TEST] ' : '') + teamMessage_(o), htmlBody: html, body: teamMessage_(o) + (link ? '\n\n' + link : ''), name: 'GIG Print Hub' });
    return { event: 'team', ok: true, at: at, detail: 'Emailed ' + to + '.' };
  } catch (e) {
    return { event: 'team', ok: false, at: at, detail: 'Could not send the team email: ' + String(e.message || e).slice(0, 150) };
  }
}
