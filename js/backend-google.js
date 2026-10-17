// Free backend: Google Drive (files) + Google Sheets (data), via the Apps Script
// in google-apps-script/Code.gs. Same interface as the other backends.

const TOKEN_KEY = 'mediahub-google-token';
const DIRECT_CHUNK = 8 * 1024 * 1024; // browser → Drive directly (must be a multiple of 256 KB)
const RELAY_CHUNK = 4 * 1024 * 1024;  // browser → Apps Script → Drive (fallback)

const readToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const saveToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// PUT one chunk straight to Drive's upload URL. Resolves {done, fileId} or {done:false, next}.
function putChunk(url, blob, start, total, onBytes) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Range', `bytes ${start}-${start + blob.size - 1}/${total}`);
    x.upload.onprogress = (e) => onBytes?.(e.loaded);
    x.onerror = () => reject(new Error('direct-upload-blocked'));
    x.onload = () => {
      if (x.status === 200 || x.status === 201) {
        try { return resolve({ done: true, fileId: JSON.parse(x.responseText).id }); } catch { return reject(new Error('direct-upload-blocked')); }
      }
      if (x.status === 308) {
        let range = null;
        try { range = x.getResponseHeader('Range'); } catch {}
        return resolve({ done: false, next: range ? Number(range.split('-')[1]) + 1 : start + blob.size });
      }
      reject(new Error('direct-upload-blocked'));
    };
    x.send(blob);
  });
}

export function createGoogleBackend(cfg, { portal = false } = {}) {
  const url = cfg.GOOGLE_SCRIPT_URL.trim();
  let token = portal ? null : readToken();
  let user = null;
  let directWorks = true; // flips to false the first time the browser can't upload straight to Drive
  const listeners = new Set();
  const emit = () => listeners.forEach((cb) => cb(user));

  async function call(action, args = {}) {
    let res;
    try {
      // text/plain body = no CORS preflight, which Apps Script can't answer.
      res = await fetch(url, { method: 'POST', body: JSON.stringify({ action, token, ...args }) });
    } catch {
      throw new Error('Can\'t reach your Google backend. Check your internet connection, the GOOGLE_SCRIPT_URL in config.js, and that the web app\'s access is set to "Anyone".');
    }
    let j;
    try { j = JSON.parse(await res.text()); } catch {
      throw new Error('Unexpected reply from Google. Make sure the web app is deployed with access "Anyone" and the URL ends in /exec.');
    }
    if (!j.ok) {
      if (j.code === 'AUTH' && token) { token = null; saveToken(null); user = null; emit(); }
      throw new Error(j.error || 'Something went wrong.');
    }
    return j.data;
  }

  // auth = { linkToken } for creator links, { orderKey } for print customers, {} for the team.
  async function relay(uploadUrl, total, blob, start, auth = {}) {
    const args = { uploadUrl, total, ...auth };
    if (blob) Object.assign(args, { start, data: await toBase64(blob) });
    for (let attempt = 0; ; attempt++) {
      try { return await call('relay', args); }
      catch (e) {
        if (attempt >= 3) throw e;
        await wait(1500 * (attempt + 1));
        if (blob) { // find out what Drive already has, then resend from there
          const st = await call('relay', { uploadUrl, total, ...auth });
          if (st.done || st.next !== start) return st;
        }
      }
    }
  }

  // Uploads a file into Drive in chunks. Resolves to the Drive file id.
  async function sendFile(startAction, startArgs, auth, file, onProgress) {
    const total = file.size;
    const { uploadUrl } = await call(startAction, {
      ...startArgs, ...auth, name: file.name, mimeType: file.type || 'application/octet-stream', size: total, origin: location.origin,
    });
    if (total === 0) return (await relay(uploadUrl, 0, null, 0, auth)).fileId;
    let offset = 0;
    onProgress?.(0);
    while (true) {
      let r;
      if (directWorks) {
        const blob = file.slice(offset, Math.min(offset + DIRECT_CHUNK, total));
        try {
          r = await putChunk(uploadUrl, blob, offset, total, (n) => onProgress?.(total ? (offset + n) / total : 0));
        } catch {
          directWorks = false; // use the Apps Script relay from now on
          r = await relay(uploadUrl, total, null, 0, auth);
        }
      } else {
        const blob = file.slice(offset, Math.min(offset + RELAY_CHUNK, total));
        r = await relay(uploadUrl, total, blob, offset, auth);
      }
      if (r.done) { onProgress?.(1); return r.fileId; }
      offset = r.next;
      onProgress?.(total ? offset / total : 0);
    }
  }

  const sortRows = (rows, order) => {
    if (!order) return rows;
    const [col, asc] = order;
    return [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
  };

  return {
    mode: 'google',

    auth: {
      async getUser() {
        if (!token) return null;
        try { user = await call('me'); } catch { user = null; }
        return user;
      },
      onChange(cb) {
        listeners.add(cb);
        this.getUser().then(cb);
        return () => listeners.delete(cb);
      },
      async needsSetup() { return (await call('status')).needsSetup; },
      async createAdmin(email, name, password) {
        const r = await call('setupAdmin', { email, name, password });
        token = r.token; saveToken(token); user = r.user; emit();
      },
      async signIn(email, password) {
        const r = await call('login', { email, password });
        token = r.token; saveToken(token); user = r.user; emit();
      },
      async signOut() { token = null; saveToken(null); user = null; emit(); },
      async changePassword(password) {
        const r = await call('changePassword', { password });
        token = r.token; saveToken(token);
      },
      async isTeam() { return !!user; },
    },

    // One request for everything (Apps Script calls take ~1 s each).
    async loadAll() { return call('bootstrap'); },
    async list(table, { eq, order } = {}) { return sortRows(await call('list', { table, eq }), order); },
    insert(table, row) { return call('insert', { table, row }); },
    insertMany(table, rows) { return call('insertMany', { table, rows }); },
    update(table, id, patch) { return call('update', { table, id, patch }); },
    updateMany(table, ids, patch) { return call('updateMany', { table, ids, patch }); },
    async remove(table, id) { await call('remove', { table, id }); },
    async removeMany(table, ids) { await call('removeMany', { table, ids }); },

    // Uploads into Drive. Resolves to the Drive file id (stored as storage_path).
    uploadFile(_path, file, { onProgress, category, linkToken } = {}) {
      return linkToken
        ? sendFile('linkStartUpload', {}, { linkToken }, file, onProgress)
        : sendFile('startUpload', { category }, {}, file, onProgress);
    },

    // Drive links (files are shared "anyone with the link" by the script).
    media(asset) {
      const id = asset.storage_path;
      if (!id) return null;
      return {
        thumb: `https://drive.google.com/thumbnail?id=${id}&sz=w640`,
        full: `https://drive.google.com/thumbnail?id=${id}&sz=w2000`,
        embed: `https://drive.google.com/file/d/${id}/preview`,
        open: `https://drive.google.com/file/d/${id}/view`,
      };
    },
    async signedUrls() { return {}; },
    async downloadUrl(id) { return `https://drive.google.com/uc?export=download&id=${id}`; },
    async shareUrl(id) { return `https://drive.google.com/file/d/${id}/view?usp=sharing`; },
    shareNote: 'Share link copied.',
    async removeFiles(ids) { if (ids.length) await call('removeFiles', { ids }); },

    // ── Print Hub ────────────────────────────────────────────────────────
    print: {
      form(orderKey) { return call('printForm', { orderKey }); },
      async uploadFile(file, { orderKey, onProgress } = {}) {
        const id = await sendFile('printStartUpload', {}, { orderKey }, file, onProgress);
        return { id, name: file.name, size: file.size, mime: file.type || null };
      },
      submit(orderKey, answers, files) { return call('printSubmit', { orderKey, answers, files }); },
      me(printKey) { return call('printMe', { printKey }); },
      orders(printKey) { return call('printOrders', { printKey }); },
      update(printKey, id, patch) { return call('printUpdate', { printKey, id, patch }); },
      notify(printKey, id, kind) { return call('printNotify', { printKey, id, kind }); },
      remove(printKey, id) { return call('printDelete', { printKey, id }); },
      saveQuestions(printKey, questions) { return call('printSaveQuestions', { printKey, questions }); },
      saveSettings(printKey, settings) { return call('printSaveSettings', { printKey, settings }); },
      regenerate(printKey, which) { return call('printRegenerate', { printKey, which }); },
      setActive(printKey, which, active) { return call('printSetActive', { printKey, which, active }); },
      // One private admin link per staff member.
      staffAdd(printKey, name) { return call('printStaffAdd', { printKey, name }); }, // Print Hub only on Google
      staffUpdate(printKey, id, patch) { return call('printStaffUpdate', { printKey, id, patch }); },
      staffRegenerate(printKey, id) { return call('printStaffRegenerate', { printKey, id }); },
      staffDelete(printKey, id) { return call('printStaffDelete', { printKey, id }); },
      testNotify(printKey, kind) { return call('printTestNotify', { printKey, kind }); },
      async fileLinks(id) {
        return {
          thumb: `https://drive.google.com/thumbnail?id=${id}&sz=w400`,
          open: `https://drive.google.com/file/d/${id}/view`,
          download: `https://drive.google.com/uc?export=download&id=${id}`,
          preview: `https://drive.google.com/file/d/${id}/preview`,
        };
      },
    },

    portal: {
      linkInfo(linkToken) { return call('linkInfo', { linkToken }); },
      submit(linkToken, m) {
        return call('linkSubmit', {
          linkToken, fileId: m.path, title: m.title, description: m.description,
          file_name: m.file_name, mime_type: m.mime_type, size_bytes: m.size_bytes, coverId: m.cover || null, caption: m.caption || null,
        });
      },
      submissions(linkToken) { return call('linkSubmissions', { linkToken }); },
    },
  };
}
