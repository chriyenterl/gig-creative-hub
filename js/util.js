// Shared constants and small helpers.

export const CATEGORIES = [
  { id: 'final', label: 'Final content', hint: 'Finished posts and videos, ready to publish' },
  { id: 'raw',   label: 'Raw footage',   hint: 'Unedited clips, B-roll, photo shoots, project files' },
  { id: 'brand', label: 'Essentials',    hint: 'Logos, mascot, fonts, colours and guidelines — plus the latest menus and price lists' },
];
export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? id;

export const ASSET_STATUS = {
  pending:  { label: 'Awaiting review',   tone: 'warn',    icon: 'clock' },
  approved: { label: 'Approved',          tone: 'good',    icon: 'check' },
  changes:  { label: 'Changes requested', tone: 'serious', icon: 'edit' },
  rejected: { label: 'Rejected',          tone: 'bad',     icon: 'x' },
};

export const TALENT_STATUS = [
  { id: 'prospect',      label: 'Prospect',            tone: 'neutral' },
  { id: 'contacted',     label: 'Contacted',           tone: 'info' },
  { id: 'awaiting',      label: 'Awaiting approval',   tone: 'warn' },
  { id: 'approved',      label: 'Approved – go ahead', tone: 'good' },
  { id: 'in_production', label: 'In production',       tone: 'info' },
  { id: 'delivered',     label: 'Content delivered',   tone: 'good' },
  { id: 'declined',      label: 'Not proceeding',      tone: 'bad' },
];
export const talentStatus = (id) => TALENT_STATUS.find((s) => s.id === id) ?? TALENT_STATUS[0];

export const MEDIA = {
  image:    { label: 'Photo',    plural: 'Photos',    icon: 'image' },
  video:    { label: 'Video',    plural: 'Videos',    icon: 'video' },
  audio:    { label: 'Audio',    plural: 'Audio',     icon: 'music' },
  document: { label: 'Document', plural: 'Documents', icon: 'file' },
  other:    { label: 'File',     plural: 'Other files', icon: 'file' },
};

export const PLATFORMS = ['TikTok', 'Instagram', 'YouTube', 'Facebook', 'Xiaohongshu', 'Lemon8', 'X / Twitter', 'LinkedIn', 'Other'];
export const TIERS = ['Nano UGC', 'Micro KOL', 'Mid KOL', 'Macro KOL', 'Mega KOL', 'Celebrity'];
export const TALENT_TYPES = ['Creator', 'Media', 'Celebrity', 'Agency'];
export const LANGUAGES = ['English', 'BM', 'Chinese', 'Tamil'];

// "TikTok; Instagram" / "English/BM" / "a, b" → ['TikTok', 'Instagram']
export const splitList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[;,/&|]+/)).map((x) => String(x).trim()).filter(Boolean);
export const joinList = (arr) => [...new Set(arr)].join(', ');

const LANG_ALIASES = { eng: 'English', english: 'English', en: 'English', bm: 'BM', malay: 'BM', bahasa: 'BM', 'bahasa melayu': 'BM', ms: 'BM',
  chinese: 'Chinese', mandarin: 'Chinese', cantonese: 'Chinese', cn: 'Chinese', zh: 'Chinese', tamil: 'Tamil' };
export const normalizeLanguages = (v) => [...new Set(splitList(v).map((x) => LANG_ALIASES[x.toLowerCase()] || x))];

const PLATFORM_ALIASES = { tiktok: 'TikTok', 'tik tok': 'TikTok', ig: 'Instagram', instagram: 'Instagram', insta: 'Instagram', youtube: 'YouTube', yt: 'YouTube',
  facebook: 'Facebook', fb: 'Facebook', xiaohongshu: 'Xiaohongshu', xhs: 'Xiaohongshu', rednote: 'Xiaohongshu', lemon8: 'Lemon8',
  x: 'X / Twitter', twitter: 'X / Twitter', 'x / twitter': 'X / Twitter', linkedin: 'LinkedIn' };
export const normalizePlatforms = (v) => [...new Set(splitList(v).map((x) => PLATFORM_ALIASES[x.toLowerCase()] || x))];

export function platformFromUrl(url) {
  const host = String(url || '').toLowerCase();
  return host.includes('tiktok.') ? 'TikTok' : host.includes('instagram.') ? 'Instagram' : host.includes('youtube.') || host.includes('youtu.be') ? 'YouTube'
    : host.includes('facebook.') ? 'Facebook' : host.includes('xiaohongshu.') ? 'Xiaohongshu' : host.includes('lemon8') ? 'Lemon8'
    : host.includes('twitter.') || host.includes('x.com') ? 'X / Twitter' : host.includes('linkedin.') ? 'LinkedIn' : null;
}
// https://www.tiktok.com/@name?lang=en → @name ; https://instagram.com/name/ → @name
export function handleFromUrl(url) {
  try {
    const u = new URL(String(url).trim());
    const first = u.pathname.split('/').filter(Boolean)[0] || '';
    if (!first || ['p', 'reel', 'video', 'watch', 'channel', 'user', 'profile.php'].includes(first)) return null;
    return '@' + decodeURIComponent(first).replace(/^@/, '');
  } catch { return null; }
}
// "12,000" / "12k" / "1.2M" → number
export function parseFollowers(v) {
  const m = String(v || '').replace(/,/g, '').trim().match(/^([\d.]+)\s*([kKmM]?)/);
  if (!m) return null;
  const n = parseFloat(m[1]) * ({ k: 1e3, K: 1e3, m: 1e6, M: 1e6 }[m[2]] || 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Small, forgiving CSV reader (quotes, commas and line breaks inside cells, Excel BOM).
export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = String(text).replace(/^\ufeff/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => x.trim() !== ''));
  const header = (clean.shift() || []).map((h) => h.trim());
  return { header, rows: clean.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}
export const CHANNELS = ['Instagram post', 'Instagram story', 'Instagram reel', 'TikTok', 'YouTube', 'Facebook', 'Website', 'Email / newsletter', 'Paid ads', 'Print / in-store', 'Other'];

export const EVERGREEN = { id: 'none', name: 'Evergreen', color: '#898781' };

// ── Formatting ────────────────────────────────────────────────────────────
export function fmtNum(n) {
  n = Number(n) || 0;
  return new Intl.NumberFormat(undefined, { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
}
// Storage totals are counted the way Cloudflare bills them: 1 GB = 1,000,000,000 bytes.
export function fmtGB(b) {
  if ((b || 0) < 1e9) return `${Math.round((b || 0) / 1e6)} MB`;
  return `${(b / 1e9).toFixed(1).replace(/\.0$/, '')} GB`;
}

export function fmtBytes(b) {
  if (!b && b !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b < 10 && i > 0 ? b.toFixed(1) : Math.round(b)} ${u[i]}`;
}
export function fmtDate(d) {
  if (!d) return '';
  const date = typeof d === 'string' && d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export function timeAgo(d) {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
}
export const today = () => new Date().toISOString().slice(0, 10);

// ── Files ─────────────────────────────────────────────────────────────────
const EXT = {
  image: /\.(jpe?g|png|gif|webp|heic|heif|avif|svg|bmp|tiff?)$/i,
  video: /\.(mp4|mov|m4v|webm|avi|mkv|mts|3gp)$/i,
  audio: /\.(mp3|wav|m4a|aac|ogg|flac)$/i,
  document: /\.(pdf|docx?|pptx?|xlsx?|txt|csv|key|pages|ai|psd|indd|eps)$/i,
};
export function mediaTypeFor(mime = '', name = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  for (const [type, re] of Object.entries(EXT)) if (re.test(name)) return type;
  if (mime === 'application/pdf' || mime.startsWith('text/') || mime.startsWith('application/vnd.')) return 'document';
  return 'other';
}
export const stripExt = (name) => String(name || '').replace(/\.[^.]+$/, '');
export function safeName(name) {
  const clean = String(name || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return (clean || 'file').slice(-80);
}
export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function newToken() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function uploadUrlFor(token) {
  return new URL('upload.html#' + token, location.href.split('#')[0]).href;
}
export function parseTags(s) {
  return [...new Set(String(s || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

// ── Links ─────────────────────────────────────────────────────────────────
export function linkState(l) {
  if (!l.is_active) return { id: 'disabled', label: 'Disabled', tone: 'neutral' };
  if (l.expires_at && new Date(l.expires_at) <= new Date()) return { id: 'expired', label: 'Expired', tone: 'bad' };
  return { id: 'active', label: 'Active', tone: 'good' };
}

// ── CSV export (so the team can still open things in Sheets/Excel) ────────
export function downloadCSV(filename, rows, columns) {
  const esc = (v) => {
    if (v == null) return '';
    const s = Array.isArray(v) ? v.join(', ') : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    return ok;
  }
}

// ── Hash router ───────────────────────────────────────────────────────────
export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = h.split('?');
  return { parts: p.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(q)) };
}
export function hrefFor(path, query = {}) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString();
  return '#/' + path + (q ? '?' + q : '');
}
export function go(path, query, { replace = false } = {}) {
  const href = hrefFor(path, query);
  if (replace) location.replace(href); else location.hash = href.slice(1);
}
