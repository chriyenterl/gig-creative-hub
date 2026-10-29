// Backend on Cloudflare: the Worker in cloudflare/worker.js, with D1 (data) and R2 (files).
// Same interface as the other backends.

const TOKEN_KEY = 'gig-cloudflare-token';

const readToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const saveToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends a body to the Worker with upload progress. Resolves to the reply's data.
function send(method, url, body, onBytes) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    if (onBytes) x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onerror = () => reject(Object.assign(new Error('Upload interrupted — check your internet connection.'), { retry: true }));
    x.onload = () => {
      let j = null;
      try { j = JSON.parse(x.responseText); } catch {}
      if (j && j.ok) return resolve(j.data);
      reject(Object.assign(new Error((j && j.error) || `Upload failed (${x.status}).`), { retry: !j || x.status >= 500 }));
    };
    x.send(body);
  });
}

async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (!e.retry || attempt >= 3) throw e;
      await wait(1500 * (attempt + 1));
    }
  }
}

export function createCloudflareBackend(cfg, { portal = false } = {}) {
  const base = cfg.CLOUDFLARE_API_URL.trim().replace(/\/+$/, '');
  let token = portal ? null : readToken();
  let user = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((cb) => cb(user));

  async function call(action, args = {}) {
    let res;
    try {
      // A plain-text body keeps this a "simple" request (no extra CORS round trip).
      res = await fetch(base + '/api', { method: 'POST', body: JSON.stringify({ action, token, ...args }) });
    } catch {
      // offline: the POS keeps sales on the device and sends them when the connection is back
      throw Object.assign(new Error("Can't reach the GIG server. Check your internet connection and the CLOUDFLARE_API_URL in config.js."), { offline: true });
    }
    let j;
    try { j = JSON.parse(await res.text()); } catch {
      throw new Error('Unexpected reply from the server. Check the CLOUDFLARE_API_URL in config.js.');
    }
    if (!j.ok) {
      if (j.code === 'AUTH' && token) { token = null; saveToken(null); user = null; emit(); }
      throw Object.assign(new Error(j.error || 'Something went wrong.'), { code: j.code || null });
    }
    return j.data;
  }

  // Uploads a file to R2 (in parts for big files). Resolves to the file's key.
  async function sendFile(startAction, startArgs, file, onProgress) {
    const total = file.size;
    const { uploadUrl, chunkSize } = await call(startAction, {
      ...startArgs, name: file.name, mimeType: file.type || 'application/octet-stream', size: total,
    });
    onProgress?.(0);
    if (total <= chunkSize) {
      const r = await withRetry(() => send('PUT', uploadUrl, file, (n) => onProgress?.(total ? n / total : 0)));
      onProgress?.(1);
      return r.fileId;
    }
    const parts = [];
    for (let start = 0, n = 1; start < total; start += chunkSize, n++) {
      const blob = file.slice(start, Math.min(start + chunkSize, total));
      const part = await withRetry(() => send('PUT', `${uploadUrl}?part=${n}`, blob, (b) => onProgress?.((start + b) / total)));
      parts.push({ partNumber: part.partNumber, etag: part.etag });
    }
    const done = await withRetry(() => send('POST', uploadUrl, JSON.stringify({ parts })));
    onProgress?.(1);
    return done.fileId;
  }

  const fileUrl = (key) => `${base}/f/${String(key).split('/').map(encodeURIComponent).join('/')}`;

  const sortRows = (rows, order) => {
    if (!order) return rows;
    const [col, asc] = order;
    return [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
  };

  return {
    mode: 'cloudflare',
    previews: true, // library photos get small copies for fast loading (see js/previews.js)

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
      // A team member's personal sign-in link (Creative Hub access) signs them in without their passcode.
      async signInWithLink(linkKey, app) {
        const r = await call('linkLogin', { linkKey, app });
        token = r.token; saveToken(token); user = r.user; emit();
        return r;
      },
      // The team signs in with their name + 6-digit passcode (owners use email + password).
      async signInWithPasscode(name, passcode) {
        const r = await call('passcodeLogin', { name, passcode });
        token = r.token; saveToken(token); user = r.user; emit();
      },
      async changePasscode(passcode) {
        const r = await call('changePasscode', { passcode });
        token = r.token; saveToken(token);
      },
      // Forgot passcode: emails a one-time link; the link's page sets a new passcode and signs them in.
      async status() { return call('status'); },
      requestPasscodeReset(email) { return call('passcodeResetRequest', { email }); },
      async resetPasscode(resetToken, passcode) {
        const r = await call('passcodeResetConfirm', { token: resetToken, passcode });
        token = r.token; saveToken(token); user = r.user; emit();
        return r.user;
      },
      changeMyEmail(email) { return call('changeMyEmail', { email }); },
      async signOut() { token = null; saveToken(null); user = null; emit(); },
      async changePassword(password) {
        const r = await call('changePassword', { password });
        token = r.token; saveToken(token);
      },
      async isTeam() { return !!user; },
    },

    // Join page: new people ask to join with a name + passcode, and the owner approves them.
    join: {
      info(joinKey) { return call('joinInfo', { joinKey }); },
      request(joinKey, name, passcode, email) { return call('joinRequest', { joinKey, name, passcode, email }); },
    },

    async loadAll() { return call('bootstrap'); },
    async list(table, { eq, order } = {}) { return sortRows(await call('list', { table, eq }), order); },
    insert(table, row) { return call('insert', { table, row }); },
    insertMany(table, rows) { return call('insertMany', { table, rows }); },
    update(table, id, patch) { return call('update', { table, id, patch }); },
    updateMany(table, ids, patch) { return call('updateMany', { table, ids, patch }); },
    async remove(table, id) { await call('remove', { table, id }); },
    async removeMany(table, ids) { await call('removeMany', { table, ids }); },

    // Resolves to the file's key in R2 (stored as storage_path).
    uploadFile(_path, file, { onProgress, category, linkToken } = {}) {
      return linkToken
        ? sendFile('linkStartUpload', { linkToken }, file, onProgress)
        : sendFile('startUpload', { category }, file, onProgress);
    },

    // Files are served by the Worker at long, unguessable addresses.
    async signedUrls(paths) { return Object.fromEntries(paths.filter(Boolean).map((p) => [p, fileUrl(p)])); },
    async downloadUrl(key) { return fileUrl(key) + '?dl=1'; },
    async shareUrl(key) { return fileUrl(key); },
    shareNote: 'Share link copied.',
    async removeFiles(keys) { if (keys.length) await call('removeFiles', { ids: keys }); },

    // Storage used vs the upload limit, in bytes.
    storage() { return call('storage'); },
    setStorageLimit(gb) { return call('setStorageLimit', { gb }); },

    // ── Socmed Hub: what's scheduled in Buffer (owners connect Buffer; the key stays on the server) ──
    socmed: {
      overview(refresh = false) { return call('socmedOverview', { refresh }); },
      setup() { return call('socmedSetup'); },
      connect(label, apiKey) { return call('socmedConnect', { label, apiKey }); },
      remove(id) { return call('socmedRemove', { id }); },
      saveChannels(channels) { return call('socmedSaveChannels', { channels }); },
    },

    // ── Print Hub ────────────────────────────────────────────────────────
    print: {
      form(orderKey) { return call('printForm', { orderKey }); },
      async uploadFile(file, { orderKey, onProgress } = {}) {
        const id = await sendFile('printStartUpload', { orderKey }, file, onProgress);
        return { id, name: file.name, size: file.size, mime: file.type || null };
      },
      submit(orderKey, answers, files) { return call('printSubmit', { orderKey, answers, files }); },
      // Staff adding an order themselves (walk-in, phone, WhatsApp).
      addOrder(printKey, answers, files, { status, notes, notifyBot } = {}) { return call('printAddOrder', { printKey, answers, files, status, notes, notifyBot }); },
      async staffUploadFile(printKey, file, { onProgress } = {}) {
        const id = await sendFile('printStaffStartUpload', { printKey }, file, onProgress);
        return { id, name: file.name, size: file.size, mime: file.type || null };
      },
      me(printKey) { return call('printMe', { printKey }); },
      orders(printKey) { return call('printOrders', { printKey }); },
      update(printKey, id, patch) { return call('printUpdate', { printKey, id, patch }); },
      notify(printKey, id, kind) { return call('printNotify', { printKey, id, kind }); },
      remove(printKey, id) { return call('printDelete', { printKey, id }); },
      saveQuestions(printKey, questions) { return call('printSaveQuestions', { printKey, questions }); },
      saveSettings(printKey, settings) { return call('printSaveSettings', { printKey, settings }); },
      regenerate(printKey, which) { return call('printRegenerate', { printKey, which }); },
      setActive(printKey, which, active) { return call('printSetActive', { printKey, which, active }); },
      // The team (joined with the join link + passcode).
      staffAdd(printKey, name, hub) { return call('printStaffAdd', { printKey, name, hub }); },
      staffUpdate(printKey, id, patch) { return call('printStaffUpdate', { printKey, id, patch }); },
      staffRegenerate(printKey, id) { return call('printStaffRegenerate', { printKey, id }); },
      staffDelete(printKey, id) { return call('printStaffDelete', { printKey, id }); },
      staffApprove(printKey, id, hub, pos) { return call('printStaffApprove', { printKey, id, hub, pos }); },
      staffResetPasscode(printKey, id) { return call('printStaffResetPasscode', { printKey, id }); },
      // Push notifications: new-order alerts on this device, even when the app is closed.
      pushSubscribe(printKey, subscription, device) { return call('printPushSubscribe', { printKey, subscription, device }); },
      pushRemove(printKey, id) { return call('printPushRemove', { printKey, id }); },
      pushUnsubscribe(printKey, endpoint) { return call('printPushUnsubscribe', { printKey, endpoint }); },
      pushTest(printKey, endpoint) { return call('printPushTest', { printKey, endpoint }); },
      testNotify(printKey, kind) { return call('printTestNotify', { printKey, kind }); },
      async fileLinks(key) {
        const url = fileUrl(key);
        return { thumb: url, open: url, download: url + '?dl=1', preview: url };
      },
    },

    // ── GIG POS (money in sen) ───────────────────────────────────────────
    pos: {
      me() { return call('posMe'); },
      saveStore(store) { return call('posSaveStore', { store }); },
      team() { return call('posTeam'); },
      teamSet(id, patch) { return call('posTeamSet', { id, patch }); },
      catalog(storeId) { return call('posCatalog', { storeId }); },
      saveItem(kind, row) { return call('posSaveItem', { kind, row }); },
      deleteItem(kind, id) { return call('posDeleteItem', { kind, id }); },
      importProducts(storeId, rows) { return call('posImport', { storeId, rows }); },
      copyMenu(fromId, toId) { return call('posCopyMenu', { fromId, toId }); },
      checkout(sale) { return call('posCheckout', { sale }); },
      saveOpen(order) { return call('posSaveOpen', { order }); },
      openOrders(storeId) { return call('posOpenOrders', { storeId }); },
      cancelOpen(id, reason) { return call('posCancelOpen', { id, reason }); },
      kitchen(storeId) { return call('posKitchen', { storeId }); },
      kitchenSet(id, status) { return call('posKitchenSet', { id, status }); },
      sales(q) { return call('posSales', q); },
      sale(id) { return call('posSale', { id }); },
      refund(r) { return call('posRefund', r); },
      shift(storeId) { return call('posShift', { storeId }); },
      openShift(storeId, float) { return call('posOpenShift', { storeId, float }); },
      cashMove(shiftId, move) { return call('posCashMove', { shiftId, move }); },
      closeShift(shiftId, counted, note) { return call('posCloseShift', { shiftId, counted, note }); },
      shifts(storeId) { return call('posShifts', { storeId }); },
      shiftReport(id) { return call('posShiftReport', { id }); },
      findCustomers(q, storeId) { return call('posFindCustomers', { q, storeId }); },
      customer(id, storeId) { return call('posCustomer', { id, storeId }); },
      saveCustomer(customer) { return call('posSaveCustomer', { customer }); },
      customers() { return call('posCustomers'); },
      stockAdjust(r) { return call('posStockAdjust', r); },
      stockMoves(storeId, productId) { return call('posStockMoves', { storeId, productId }); },
      report(storeId, from, to) { return call('posReport', { storeId, from, to }); },
    },

    portal: {
      linkInfo(linkToken) { return call('linkInfo', { linkToken }); },
      submit(linkToken, m) {
        return call('linkSubmit', {
          linkToken, fileId: m.path, title: m.title, description: m.description,
          file_name: m.file_name, mime_type: m.mime_type, size_bytes: m.size_bytes, coverId: m.cover || null, caption: m.caption || null,
          externalUrl: m.url || null, mediaType: m.media_type || null, thumbId: m.thumb || null, previewId: m.preview || null,
        });
      },
      submissions(linkToken) { return call('linkSubmissions', { linkToken }); },
    },
  };
}
