// Webstore in demo mode: the same rules as the server (cloudflare/worker.js), saved in this browser.
// Product photos and receipts go into the demo's IndexedDB file store.
import { uid, newToken, safeName } from '../util.js';
import { withDefaults, priceItem, cartTotals, daySlots, toMin, fromMin, money, storeNow, addDays, SAMPLE_PRODUCTS, SAMPLE_CATEGORIES } from './model.js';

const KEY = 'gig-shop-demo-v1';
const WHO = 'You (demo)';

const RECEIPT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420"><rect width="300" height="420" fill="#f6f6f6"/>
<rect x="20" y="20" width="260" height="380" rx="14" fill="#fff" stroke="#e5e5e5"/><circle cx="150" cy="80" r="26" fill="#e4f6ea"/>
<path d="m138 80 8 8 16-16" stroke="#1a9a4b" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<text x="150" y="140" text-anchor="middle" font-family="Arial" font-size="17" font-weight="700" fill="#222">Payment successful</text>
<text x="150" y="185" text-anchor="middle" font-family="Arial" font-size="30" font-weight="800" fill="#111">RM 59.80</text>
<g font-family="Arial" font-size="13" fill="#666"><text x="44" y="240">To</text><text x="44" y="272">Reference</text><text x="44" y="304">Method</text></g>
<g font-family="Arial" font-size="13" fill="#222" text-anchor="end"><text x="256" y="240">Noms</text><text x="256" y="272">W-1004</text><text x="256" y="304">DuitNow QR</text></g>
<text x="150" y="370" text-anchor="middle" font-family="Arial" font-size="11" fill="#999">Sample receipt (demo mode)</text></svg>`;

function seed() {
  const now = Date.now();
  const ago = (h) => new Date(now - h * 3600e3).toISOString();
  const today = storeNow().ymd;
  const settings = withDefaults({
    categories: SAMPLE_CATEGORIES,
    about: 'Small-batch cookies baked fresh every day in Kota Kinabalu. Perfect for treating yourself, sharing with family, or sending as a gift.',
    phone: '+60 12-345 6789', instagram: 'noms', address: 'Kota Kinabalu, Sabah',
    hours: Array.from({ length: 7 }, () => ({ open: '09:00', close: '21:00', closed: false })),
    delivery: { enabled: true, fee: 8, freeOver: 120, minOrder: 25, note: 'We deliver within Kota Kinabalu.' },
    pickup: { enabled: true, address: 'Noms kitchen, Kota Kinabalu — we’ll WhatsApp you the exact spot.', note: '' },
    payments: { duitnow: { enabled: true, qr_path: null, name: 'Noms' }, bank: { enabled: true, bank: 'Maybank', account_name: 'Noms Enterprise', account_no: '5123 4567 8901' }, cash: { enabled: true } },
  });
  const products = SAMPLE_PRODUCTS.map((p, i) => ({
    id: uid(), description: null, compare_price: null, image_path: null, options: [], badge: null, is_available: true, is_hidden: false,
    ...JSON.parse(JSON.stringify(p)), sort_order: i + 1, created_at: ago(400 - i), updated_at: ago(400 - i),
  }));
  const byName = (n) => products.find((p) => p.name === n);
  const line = (name, qty, choices = {}, note = null) => {
    const p = byName(name), r = priceItem({ ...p, is_available: true }, { qty, choices });
    return { product_id: p.id, name: p.name, qty, unit_price: r.unit, total: r.total, options: r.options, note };
  };
  const order = (no, status, payment, hoursAgo, fulfilment, day, time, [name, phone], items, method, extra = {}) => {
    const t = cartTotals(items, settings, fulfilment);
    const history = [{ status: 'new', at: ago(hoursAgo), by: 'customer' }];
    const steps = ['preparing', 'ready', 'completed'].slice(0, Math.max(0, ['new', 'preparing', 'ready', 'completed'].indexOf(status)));
    steps.forEach((s, i) => history.push({ status: s, at: ago(hoursAgo - (i + 1) * 0.5), by: WHO }));
    if (payment === 'paid') history.push({ event: 'payment', payment: 'paid', at: ago(hoursAgo - 0.2), by: WHO });
    return { id: uid(), order_no: no, secret: newToken().slice(0, 24), status, fulfilment, slot_date: addDays(today, day), slot_time: time,
      customer_name: name, phone, email: null, address: null, notes: null, items, subtotal: t.subtotal, delivery_fee: t.delivery_fee, total: t.total,
      payment_method: method, payment_status: payment, receipt_path: null, history, internal_notes: null, created_at: ago(hoursAgo), updated_at: ago(hoursAgo), ...extra };
  };
  const orders = [
    order('W-1004', 'new', 'submitted', 0.4, 'pickup', 0, '18:00', ['Aina Rahman', '+60 12-555 0110'],
      [line('Mixed Cookie Box', 1, { size: ['b4'], mix: ['chef'] }), line('Classic Chocolate Chip', 2, { addons: ['drizzle'] }, 'Extra crispy please!')], 'duitnow',
      { receipt_path: 'demo-receipt', history: [{ status: 'new', at: ago(0.4), by: 'customer' }] }),
    order('W-1003', 'preparing', 'paid', 20, 'delivery', 1, '11:00', ['Jason Lim', '+60 16-555 0142'],
      [line('Festive Gift Box', 2, { ribbon: ['gold'], card: ['msg'] }, 'Card: “Thank you for a great year — the GIG team”')], 'bank',
      { address: 'Level 3, Wisma Merdeka, Jalan Tun Razak, 88000 Kota Kinabalu', notes: 'Please call when you arrive at the lobby.' }),
    order('W-1002', 'ready', 'unpaid', 5, 'pickup', 0, '15:00', ['Farah Hassan', '+60 19-555 0177'], [line('Mini Cookie Tub', 1, { flavour: ['mix'] })], 'cash'),
    order('W-1001', 'completed', 'paid', 30, 'delivery', -1, '14:00', ['Kevin Wong', '+60 11-555 0123'], [line('Double Chocolate', 6)], 'duitnow',
      { address: '18 Lorong Bunga Raya, Taman Fortuna, 88300 Kota Kinabalu' }),
  ];
  return { v: 1, settings, products, orders, nextNo: 1005 };
}

const fail = (message, code) => { throw Object.assign(new Error(message), { code: code || null }); };
const bySort = (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.created_at).localeCompare(String(b.created_at));
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

export function demoShop(idb) {
  let db = null;
  const read = () => { try { const x = JSON.parse(localStorage.getItem(KEY)); return x && x.v === 1 ? x : null; } catch { return null; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  // Re-read on every call, so the storefront and the Hub (two tabs) see each other's changes.
  const load = () => { db = read(); if (!db) { db = seed(); save(); } return db; };
  const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const urlCache = new Map();
  const findOrder = (ref) => {
    const [id, secret] = String(ref || '').split('.');
    const o = load().orders.find((x) => x.id === id);
    if (!o || !secret || o.secret !== secret) fail("We couldn't find that order. Please check the link, or contact us.", 'NOT_FOUND');
    return o;
  };
  const publicOrder = (o) => {
    const { internal_notes, receipt_path, history, ...out } = clone(o);
    out.has_receipt = !!receipt_path;
    out.times = Object.fromEntries((history || []).filter((h) => h.status).map((h) => [h.status, h.at]));
    return out;
  };
  const storeFile = async (prefix, file, onProgress) => {
    const key = `${prefix}${uid()}/${safeName(file.name)}`;
    for (let p = 0; p <= 1; p += 0.25) { onProgress?.(p); await wait(60); }
    await idb.put(key, file);
    onProgress?.(1);
    return key;
  };
  const dropFiles = async (keys) => { for (const k of keys) if (k && k !== 'demo-receipt') { await idb.del(k).catch(() => {}); urlCache.delete(k); } };
  const usedReceipt = (key) => db.orders.some((o) => o.receipt_path === key);

  return {
    async info() {
      await wait();
      const d = load();
      const { messages, ...settings } = d.settings;
      return clone({ settings, products: d.products.filter((p) => !p.is_hidden).sort(bySort) });
    },
    async uploadReceipt(file, { onProgress } = {}) {
      if (!/^image\//.test(file.type) && file.type !== 'application/pdf') fail('Please attach a screenshot or photo of your receipt (or a PDF).');
      if (file.size > 10e6) fail('That file is too big — please attach a screenshot under 10 MB.');
      return storeFile('shop/receipts/', file, onProgress);
    },
    async placeOrder(req) {
      await wait(400);
      const s = load().settings;
      if (!s.open) fail(s.closedMessage, 'SHOP_CLOSED');
      const fulfilment = req.fulfilment === 'delivery' ? 'delivery' : 'pickup';
      if (!s[fulfilment].enabled) fail(fulfilment === 'delivery' ? "Sorry, we're not delivering right now — please choose pickup." : "Sorry, pickup isn't available right now — please choose delivery.");
      const time = toMin(req.slot_time);
      if (!req.slot_date || time == null) fail(`Please choose a ${fulfilment} time.`, 'SLOT');
      if (!daySlots(s, req.slot_date, new Date(Date.now() - 30 * 60e3)).includes(time)) fail('That time is no longer available. Please choose another time.', 'SLOT');
      const name = text(req.customer_name, 80), phone = text(req.phone, 40), address = fulfilment === 'delivery' ? text(req.address, 500) : '';
      if (!name) fail('Please enter your name.');
      if (phone.replace(/\D/g, '').length < 8) fail('Please enter your phone number, so we can reach you about your order.');
      if (req.email && !/^\S+@\S+\.\S+$/.test(req.email)) fail("That email doesn't look right.");
      if (fulfilment === 'delivery' && address.length < 8) fail('Please enter your full delivery address.');
      if (!req.items?.length) fail('Your cart is empty.');
      const lines = req.items.map((it) => {
        const p = db.products.find((x) => x.id === it.product_id);
        const r = priceItem(p, it);
        if (!r.ok) fail(r.error, 'CART');
        return { product_id: p.id, name: p.name, qty: Number(it.qty), unit_price: r.unit, total: r.total, options: r.options, note: text(it.note, 300) || null };
      });
      const t = cartTotals(lines, s, fulfilment);
      if (t.short > 0) fail(`The minimum order for delivery is ${money(s.delivery.minOrder)} — add ${money(t.short)} more.`, 'MIN');
      if (req.expectedTotal != null && Math.round(req.expectedTotal * 100) !== Math.round(t.total * 100)) {
        fail(`Some prices have changed — your total is now ${money(t.total)}. Please check your cart and place the order again.`, 'PRICE_CHANGED');
      }
      const method = req.payment_method;
      if (!s.payments[method]?.enabled) fail("Please choose how you'll pay.");
      const receipt = req.receipt && method !== 'cash' ? req.receipt : null;
      if (receipt && usedReceipt(receipt)) fail('Please attach your receipt again.');
      if (s.receiptRequired && method !== 'cash' && !receipt) fail('Please attach your payment receipt.', 'RECEIPT');
      const now = new Date().toISOString();
      const o = { id: uid(), order_no: 'W-' + db.nextNo++, secret: newToken().slice(0, 24), status: 'new', fulfilment, slot_date: req.slot_date, slot_time: fromMin(time),
        customer_name: name, phone, email: text(req.email, 120) || null, address: address || null, notes: text(req.notes, 1000) || null,
        items: lines, subtotal: t.subtotal, delivery_fee: t.delivery_fee, total: t.total, payment_method: method,
        payment_status: receipt ? 'submitted' : 'unpaid', receipt_path: receipt, history: [{ status: 'new', at: now, by: 'customer' }],
        internal_notes: null, created_at: now, updated_at: now };
      db.orders.push(o);
      save();
      return publicOrder(o);
    },
    async order(ref) { await wait(); return publicOrder(findOrder(ref)); },
    async attachReceipt(ref, key) {
      await wait();
      const o = findOrder(ref);
      if (o.payment_method === 'cash') fail('This order is paid at pickup / on delivery.');
      if (o.payment_status === 'paid') fail('This order is already paid. Thank you!');
      if (usedReceipt(key)) fail('Please attach your receipt again.');
      if (o.receipt_path) await dropFiles([o.receipt_path]);
      Object.assign(o, { receipt_path: key, payment_status: 'submitted', updated_at: new Date().toISOString() });
      o.history.push({ event: 'receipt', at: o.updated_at, by: 'customer' });
      save();
      return publicOrder(o);
    },

    // ── The team ──
    async admin() {
      await wait();
      const d = load();
      return clone({ settings: withDefaults(d.settings), products: [...d.products].sort(bySort), orders: [...d.orders].reverse(), owner: true });
    },
    async saveSettings(input) {
      await wait();
      const cur = load().settings;
      const s = withDefaults({ ...cur, ...clone(input) });
      s.name = text(s.name, 80);
      if (!s.name) fail('Give your store a name.');
      if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s.accent)) fail('Pick a colour, or type a colour code like #9c4a1f.');
      s.hours.forEach((h, i) => { if (!h.closed && !(toMin(h.close) > toMin(h.open))) fail(`Check the opening hours for ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]} — closing must be after opening.`); });
      if (!s.delivery.enabled && !s.pickup.enabled) fail('Turn on delivery, pickup, or both.');
      if (!['duitnow', 'bank', 'cash'].some((m) => s.payments[m].enabled)) fail('Turn on at least one way to pay.');
      if (s.payments.bank.enabled && !text(s.payments.bank.account_no, 40)) fail('Add your bank account number, or turn bank transfer off.');
      s.instagram = text(s.instagram, 100).replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '');
      s.categories = [...new Set(s.categories.map((c) => text(c, 60)).filter(Boolean))];
      for (const k of Object.keys(s.messages)) s.messages[k] = text(s.messages[k], 1000) || withDefaults({}).messages[k];
      for (const k of ['fee', 'freeOver', 'minOrder']) s.delivery[k] = Math.max(0, Number(s.delivery[k]) || 0);
      const keep = [s.logo_path, s.cover_path, s.payments.duitnow.qr_path];
      await dropFiles([cur.logo_path, cur.cover_path, cur.payments?.duitnow?.qr_path].filter((k) => k && !keep.includes(k)));
      db.settings = s;
      save();
      return clone(s);
    },
    async uploadImage(file, { onProgress } = {}) {
      if (!/^image\//.test(file.type)) fail('Please choose a photo (JPG, PNG or WebP).');
      return storeFile('shop/images/', file, onProgress);
    },
    async saveProduct(input) {
      await wait();
      load();
      const name = text(input.name, 120);
      if (!name) fail('Give the product a name.');
      const price = Number(input.price);
      if (!Number.isFinite(price) || price < 0) fail(`Enter a price for ${name}.`);
      const options = (input.options || []).map((g) => {
        if (!text(g.name, 60)) fail('Every option group needs a name (e.g. “Box size”).');
        if (!g.choices?.length) fail(`Add at least one choice to “${g.name}”.`);
        g.choices.forEach((c) => { if (!text(c.name, 80)) fail(`Every choice in “${g.name}” needs a name.`); });
        const max = Math.min(g.choices.length, Math.max(1, Math.round(Number(g.max) || 1)));
        return { id: g.id || uid(), name: text(g.name, 60), min: Math.min(max, Math.max(0, Number(g.min) || 0)), max,
          choices: g.choices.map((c) => ({ id: c.id || uid(), name: text(c.name, 80), price: Math.round((Number(c.price) || 0) * 100) / 100 })) };
      });
      const compare = Number(input.compare_price) > price ? Number(input.compare_price) : null;
      const row = { name, description: text(input.description, 2000) || null, category: text(input.category, 60) || null, price, compare_price: compare,
        image_path: input.image_path || null, options, badge: text(input.badge, 30) || null, is_available: input.is_available !== false, is_hidden: !!input.is_hidden,
        updated_at: new Date().toISOString() };
      if (input.id) {
        const cur = db.products.find((p) => p.id === input.id);
        if (!cur) fail('That product no longer exists.');
        if (cur.image_path && cur.image_path !== row.image_path) await dropFiles([cur.image_path]);
        Object.assign(cur, row);
        save();
        return clone(cur);
      }
      const p = { id: uid(), ...row, sort_order: Math.max(0, ...db.products.map((x) => x.sort_order || 0)) + 1, created_at: row.updated_at };
      db.products.push(p);
      save();
      return clone(p);
    },
    async deleteProduct(id) {
      await wait();
      const p = load().products.find((x) => x.id === id);
      if (p?.image_path) await dropFiles([p.image_path]);
      db.products = db.products.filter((x) => x.id !== id);
      save();
      return true;
    },
    async sortProducts(ids) {
      await wait();
      load();
      ids.forEach((id, i) => { const p = db.products.find((x) => x.id === id); if (p) p.sort_order = i + 1; });
      save();
      return clone([...db.products].sort(bySort));
    },
    async updateOrder(id, patch) {
      await wait();
      const o = load().orders.find((x) => x.id === id);
      if (!o) fail('That order no longer exists.');
      const at = new Date().toISOString();
      if (patch.status && patch.status !== o.status) { o.status = patch.status; o.history.push({ status: patch.status, at, by: WHO }); }
      if (patch.payment_status && patch.payment_status !== o.payment_status) {
        o.payment_status = patch.payment_status;
        o.history.push({ event: 'payment', payment: patch.payment_status, at, by: WHO });
      }
      if (patch.whatsapp) o.history.push({ event: 'whatsapp', kind: patch.whatsapp, at, by: WHO });
      if (patch.internal_notes !== undefined) o.internal_notes = text(patch.internal_notes, 20000) || null;
      o.updated_at = at;
      save();
      return clone(o);
    },
    async deleteOrder(id) {
      await wait();
      const o = load().orders.find((x) => x.id === id);
      if (o?.receipt_path) await dropFiles([o.receipt_path]);
      db.orders = db.orders.filter((x) => x.id !== id);
      save();
      return true;
    },
    async fileUrls(keys) {
      const out = {};
      for (const k of keys.filter(Boolean)) {
        if (!urlCache.has(k)) {
          let url = null;
          if (k === 'demo-receipt') url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(RECEIPT_SVG);
          else { const blob = await idb.get(k).catch(() => null); if (blob) url = URL.createObjectURL(blob); }
          if (url) urlCache.set(k, url);
        }
        if (urlCache.has(k)) out[k] = urlCache.get(k);
      }
      return out;
    },
    resetDemo() { try { localStorage.removeItem(KEY); } catch {} },
  };
}
