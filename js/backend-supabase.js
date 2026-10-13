// Live backend: Supabase (Postgres database + file storage + logins).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { Upload } from 'https://cdn.jsdelivr.net/npm/tus-js-client@4.3.1/+esm';

const PAGE = 1000;   // Supabase returns at most 1000 rows per request
const CHUNK = 100;   // ids per bulk request, keeps URLs short

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function friendly(error) {
  const msg = error?.message || String(error);
  if (/Invalid login credentials/i.test(msg)) return new Error('That email and password don\'t match.');
  if (/Email not confirmed/i.test(msg)) return new Error('Please confirm your email first (check your inbox).');
  if (/Signups not allowed|User not found/i.test(msg)) return new Error('There\'s no account with that email yet. Ask the team to add you.');
  if (/row-level security/i.test(msg)) return new Error('You don\'t have permission to do that.');
  if (/duplicate key/i.test(msg)) return new Error('That already exists.');
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return new Error('Can\'t reach the server. Check your internet connection (and the Supabase URL in config.js).');
  return new Error(msg);
}

function uploadError(err) {
  const res = err?.originalResponse;
  const status = res?.getStatus?.();
  let body = '';
  try { body = res?.getBody?.() || ''; } catch {}
  let msg = '';
  try { const j = JSON.parse(body); msg = j.message || j.error || ''; } catch { msg = body; }
  if (status === 413 || /maximum allowed size|too large/i.test(msg)) {
    return new Error('This file is bigger than your storage plan allows. (Supabase free plan: 50 MB per file — upgrade or raise the limit in Storage settings.)');
  }
  if (status === 403 || /row-level security|unauthorized/i.test(msg)) {
    return new Error('Upload not allowed — the link may have been disabled, or you are not signed in.');
  }
  return new Error(msg || err?.message || 'Upload failed. Please check your connection and try again.');
}

export function createSupabaseBackend(cfg, { portal = false } = {}) {
  const url = cfg.SUPABASE_URL.replace(/\/+$/, '');
  const key = cfg.SUPABASE_KEY;
  const bucketName = cfg.BUCKET || 'media';
  const sb = createClient(url, key, portal
    ? { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    : {});
  const bucket = () => sb.storage.from(bucketName);
  const check = ({ data, error }) => { if (error) throw friendly(error); return data; };

  const accessToken = async () => (await sb.auth.getSession()).data.session?.access_token || key;

  return {
    mode: 'supabase',

    auth: {
      async getUser() { return (await sb.auth.getSession()).data.session?.user ?? null; },
      onChange(cb) {
        const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
        return () => data.subscription.unsubscribe();
      },
      async signIn(email, password) { check(await sb.auth.signInWithPassword({ email, password })); },
      async magicLink(email) {
        check(await sb.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
        }));
      },
      async signOut() { await sb.auth.signOut(); },
      async changePassword(password) { check(await sb.auth.updateUser({ password })); },
      async isTeam() { return !!check(await sb.rpc('is_team')); },
    },

    // ── Table access (team only — enforced by the database) ──────────────
    async list(table, { eq, order = ['created_at', false] } = {}) {
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        let q = sb.from(table).select('*')
          .order(order[0], { ascending: order[1] })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (eq) for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
        const data = check(await q);
        rows.push(...data);
        if (data.length < PAGE) break;
      }
      return rows;
    },
    async insert(table, row) { return check(await sb.from(table).insert(row).select().single()); },
    async insertMany(table, rows) {
      const out = [];
      for (const part of chunks(rows, CHUNK)) out.push(...check(await sb.from(table).insert(part).select()));
      return out;
    },
    async update(table, id, patch) { return check(await sb.from(table).update(patch).eq('id', id).select().single()); },
    async updateMany(table, ids, patch) {
      const out = [];
      for (const part of chunks(ids, CHUNK)) out.push(...check(await sb.from(table).update(patch).in('id', part).select()));
      return out;
    },
    async remove(table, id) { check(await sb.from(table).delete().eq('id', id)); },
    async removeMany(table, ids) {
      for (const part of chunks(ids, CHUNK)) check(await sb.from(table).delete().in('id', part));
    },

    // ── Files ─────────────────────────────────────────────────────────────
    // Resumable upload (handles big videos and flaky connections), with progress 0..1.
    uploadFile(path, file, { onProgress } = {}) {
      return new Promise((resolve, reject) => {
        const upload = new Upload(file, {
          endpoint: `${url}/storage/v1/upload/resumable`,
          retryDelays: [0, 2000, 5000, 10000, 20000],
          headers: { apikey: key, 'x-upsert': 'false' },
          onBeforeRequest: async (req) => { req.setHeader('authorization', `Bearer ${await accessToken()}`); },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6 MB chunks
          metadata: {
            bucketName,
            objectName: path,
            contentType: file.type || 'application/octet-stream',
            cacheControl: '3600',
          },
          onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
          onSuccess: () => resolve(path),
          onError: (err) => reject(uploadError(err)),
        });
        upload.start();
      });
    },
    async signedUrls(paths, expiresIn = 3600) {
      const out = {};
      for (const part of chunks(paths, CHUNK)) {
        const data = check(await bucket().createSignedUrls(part, expiresIn));
        for (const d of data) if (d.signedUrl) out[d.path] = d.signedUrl;
      }
      return out;
    },
    async downloadUrl(path, fileName) {
      return check(await bucket().createSignedUrl(path, 3600, { download: fileName || true })).signedUrl;
    },
    async shareUrl(path, days = 7) {
      return check(await bucket().createSignedUrl(path, days * 86400)).signedUrl;
    },
    async removeFiles(paths) {
      for (const part of chunks(paths, CHUNK)) check(await bucket().remove(part));
    },

    // ── Upload-link portal (works without logging in) ─────────────────────
    portal: {
      async linkInfo(token) {
        const data = check(await sb.rpc('upload_link_info', { p_token: token }));
        return data?.[0] ?? null;
      },
      async submit(token, m) {
        return check(await sb.rpc('submit_content', {
          p_token: token, p_path: m.path, p_title: m.title, p_description: m.description,
          p_file_name: m.file_name, p_mime_type: m.mime_type, p_size_bytes: m.size_bytes,
        }));
      },
      async submissions(token) { return check(await sb.rpc('link_submissions', { p_token: token })) || []; },
    },
  };
}
