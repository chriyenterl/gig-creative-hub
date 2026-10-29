// GIG POS in demo mode: three sample stores (Chajo, Walnut Bakery, Ombak Paddle Club) with a menu,
// customers and a week of sales, all saved in this browser. Same calls as the Cloudflare version
// and the same price maths (model.js), so the till behaves exactly as it will live.
import * as POS from './model.js';

const KEY = 'gig-pos-demo-v1';
const SOLD = ['paid', 'partially_refunded', 'refunded'];
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const clone = (x) => JSON.parse(JSON.stringify(x));
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const fail = (message, code) => { throw Object.assign(new Error(message), { code: code || null }); };
const OWNER = 'Demo owner';

// ── Sample data ─────────────────────────────────────────────────────────────
function seed() {
  const db = { stores: [], categories: [], products: [], modifiers: [], sales: [], lines: [], payments: [], shifts: [], customers: [], wallets: [],
    moves: [], counters: {}, team: [] };
  const at = (daysAgo = 30) => new Date(Date.now() - daysAgo * 86400e3).toISOString();
  const store = (name, brand, code, settings, sort) => {
    const s = { id: uid(), name, brand, code, address: null, phone: null, settings: POS.cleanSettings(settings), is_active: true, sort_order: sort, created_at: at(), updated_at: at() };
    db.stores.push(s);
    return s;
  };
  const cat = (s, name, color, sort) => { const c = { id: uid(), store_id: s.id, name, color, sort_order: sort, created_at: at() }; db.categories.push(c); return c; };
  const mod = (s, name, min, max, options, sort) => {
    const m = { id: uid(), store_id: s.id, name, min_select: min, max_select: max, sort_order: sort, created_at: at(),
      options: options.map(([n, p], i) => ({ id: 'o' + i, name: n, price: p })) };
    db.modifiers.push(m);
    return m;
  };
  const prod = (s, c, name, price, cost, mods = [], extra = {}) => {
    const p = { id: uid(), store_id: s.id, category_id: c?.id || null, name, sku: null, price, cost, color: null, modifier_ids: mods.map((m) => m.id),
      track_stock: false, stock: 0, low_stock: null, is_active: true, sort_order: 0, created_at: at(), updated_at: at(), ...extra };
    db.products.push(p);
    return p;
  };

  const chajo = store('Chajo SS15', 'Chajo', 'CHJ', { tax: { name: 'SST', rate: 6 }, cashback: { rate: 5 }, kitchen: true,
    orderTypes: ['takeaway', 'dine_in', 'delivery'], receipt: { header: 'Jalan SS15/4, Subang Jaya', footer: 'Terima kasih! Scan, sip, smile 🧋' } }, 1);
  const milk = cat(chajo, 'Milk Tea', '#b07a4f', 1), fruit = cat(chajo, 'Fruit Tea', '#e2557a', 2), snack = cat(chajo, 'Snacks', '#eda100', 3);
  const size = mod(chajo, 'Size', 1, 1, [['Regular', 0], ['Large', 100]], 1);
  const sugar = mod(chajo, 'Sugar level', 1, 1, [['100%', 0], ['75%', 0], ['50%', 0], ['25%', 0], ['0%', 0]], 2);
  const ice = mod(chajo, 'Ice', 1, 1, [['Normal ice', 0], ['Less ice', 0], ['No ice', 0]], 3);
  const tops = mod(chajo, 'Toppings', 0, 3, [['Pearl', 150], ['Pudding', 200], ['Grass jelly', 150], ['Cheese foam', 250]], 4);
  prod(chajo, milk, 'Brown Sugar Boba', 990, 310, [size, ice, tops]);
  prod(chajo, milk, 'Classic Milk Tea', 790, 220, [size, sugar, ice, tops]);
  prod(chajo, milk, 'Thai Milk Tea', 850, 240, [size, sugar, ice, tops]);
  prod(chajo, milk, 'Matcha Latte', 1090, 380, [size, sugar, ice, tops]);
  prod(chajo, fruit, 'Mango Yakult', 890, 290, [size, sugar, ice, tops]);
  prod(chajo, fruit, 'Passion Fruit Green Tea', 750, 200, [size, sugar, ice, tops]);
  prod(chajo, fruit, 'Strawberry Fresh Milk', 1050, 360, [size, sugar, ice]);
  prod(chajo, snack, 'Popcorn Chicken', 990, 350);
  prod(chajo, snack, 'Fries', 690, 180);
  prod(chajo, snack, 'Mineral water', 250, 80, [], { track_stock: true, stock: 18, low_stock: 6, sku: '9556001000017' });

  const walnut = store('Walnut Bakery Bangsar', 'Walnut Bakery', 'WB', { cashback: { rate: 3, minSpend: 1000 }, orderTypes: ['takeaway', 'dine_in'],
    receipt: { header: 'Bangsar Village · Baked fresh every morning', footer: 'Thank you for supporting a family bakery since 1998.' } }, 2);
  const bread = cat(walnut, 'Breads', '#a8743a', 1), cake = cat(walnut, 'Cakes', '#d1477a', 2), pastry = cat(walnut, 'Pastries', '#e08a2e', 3), drink = cat(walnut, 'Drinks', '#3f6fb5', 4);
  const milkMod = mod(walnut, 'Milk', 1, 1, [['Full cream', 0], ['Oat milk', 200]], 1);
  const temp = mod(walnut, 'Hot or iced', 1, 1, [['Hot', 0], ['Iced', 100]], 2);
  prod(walnut, bread, 'Walnut Banana Loaf', 1200, 420);
  prod(walnut, bread, 'Sourdough', 1400, 450);
  prod(walnut, bread, 'Milk Bun (4 pcs)', 900, 260);
  prod(walnut, pastry, 'Butter Croissant', 650, 230);
  prod(walnut, pastry, 'Pain au Chocolat', 750, 280);
  prod(walnut, pastry, 'Walnut Brownie', 850, 300);
  prod(walnut, cake, 'Burnt Cheesecake (slice)', 1390, 520);
  prod(walnut, cake, 'Carrot Walnut Cake (slice)', 1290, 450);
  prod(walnut, cake, 'Burnt Cheesecake 8" (whole)', 9800, 3600, [], { track_stock: true, stock: 3, low_stock: 2 });
  prod(walnut, drink, 'Americano', 800, 150, [temp]);
  prod(walnut, drink, 'Latte', 1000, 230, [milkMod, temp]);

  const ombak = store('Ombak Paddle Club', 'Ombak', 'OPC', { orderTypes: ['takeaway'], cashback: { rate: 5 }, methods: ['Cash', 'Card', 'DuitNow QR'],
    receipt: { footer: 'See you on the water! 🌊 Tag us @ombakpaddleclub' } }, 3);
  const rent = cat(ombak, 'Rentals', '#1f8fb5', 1), cls = cat(ombak, 'Classes & tours', '#14a37f', 2), shop = cat(ombak, 'Shop', '#6b5bd6', 3);
  const dur = mod(ombak, 'Duration', 1, 1, [['1 hour', 0], ['2 hours', 4000], ['Half day', 10000]], 1);
  prod(ombak, rent, 'SUP board rental', 5000, 0, [dur]);
  prod(ombak, rent, 'Kayak rental', 4000, 0, [dur]);
  prod(ombak, cls, 'Intro to SUP class', 12000, 3000);
  prod(ombak, cls, 'Sunrise paddle tour', 15000, 4000);
  prod(ombak, shop, 'Dry bag 10L', 3500, 1400, [], { track_stock: true, stock: 9, low_stock: 3 });
  prod(ombak, shop, 'Rash guard', 7900, 3000, [], { track_stock: true, stock: 2, low_stock: 3 });
  prod(ombak, shop, 'Reef-safe sunscreen', 2900, 1100, [], { track_stock: true, stock: 12, low_stock: 4 });

  const people = [['Nurul Aina', '60123456789', '1998-04-12'], ['Jason Lim', '60172223344', null], ['Priya Nair', '60196667788', '1995-11-03'],
    ['Hafiz Rahman', '60135550199', null], ['Mei Chen', '60168881234', '2001-07-21'], ['Daniel Ong', '60124449900', null]];
  for (const [name, phone, birthday] of people) {
    db.customers.push({ id: uid(), phone, name, email: null, birthday, notes: null, visits: 0, spent: 0, last_visit_at: null, last_store_id: null, created_at: at(40), updated_at: at(40) });
  }
  db.team = [
    { id: uid(), name: 'Aina', active: true, hub: false, pos: 'cashier', posOnly: true, stores: [chajo.id], key: 'demo-aina', last_used_at: at(0.2) },
    { id: uid(), name: 'Mei Ling', active: true, hub: false, pos: 'manager', posOnly: false, stores: [], key: 'demo-mei', last_used_at: at(1) },
    { id: uid(), name: 'Ali', active: true, hub: false, pos: null, posOnly: false, stores: [], key: 'demo-ali', last_used_at: at(3) },
  ];

  // A week of sales, so the reports have something to show.
  let r = 7;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const shapes = { [chajo.id]: [14, 15, 16, 17, 18, 19, 20, 21], [walnut.id]: [8, 9, 9, 10, 11, 12, 15, 16], [ombak.id]: [7, 7, 8, 9, 16, 17] };
  const counts = { [chajo.id]: 24, [walnut.id]: 18, [ombak.id]: 1 };
  const today = POS.localParts(new Date()).date;
  for (let d = 7; d >= 1; d--) {
    const date = POS.addDays(today, -d);
    for (const s of db.stores) {
      const menu = db.products.filter((p) => p.store_id === s.id && !p.track_stock);
      const shift = { id: uid(), store_id: s.id, status: 'closed', opened_by: pick(['Aina', 'Mei Ling']), opening_float: 20000, moves: [], created_at: date + 'T00:30:00.000Z' };
      const n = counts[s.id] + Math.floor(rand() * 8) - (d % 7 === 2 ? 6 : 0);
      for (let i = 0; i < n; i++) {
        const hour = pick(shapes[s.id]);
        const when = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00+08:00`).toISOString();
        const items = Array.from({ length: 1 + Math.floor(rand() * 2.4) }, () => {
          const p = pick(menu);
          const mods = p.modifier_ids.map((id) => db.modifiers.find((m) => m.id === id)).flatMap((m) => (m.min_select || rand() < 0.4 ? [m.options[Math.floor(rand() * Math.min(2, m.options.length))]].map((o) => ({ group: m.name, name: o.name, price: o.price })) : []));
          return { key: uid().slice(0, 8), product_id: p.id, name: p.name, price: p.price, qty: rand() < 0.2 ? 2 : 1, mods };
        });
        const cust = rand() < 0.3 ? pick(db.customers) : null;
        const method = pick(['Cash', 'Cash', 'Card', 'DuitNow QR', "Touch 'n Go", 'GrabPay']);
        const st = s.settings;
        const m = st.methods.includes(method) ? method : 'Cash';
        writeSale(db, s, { items, order_type: pick(st.orderTypes), customer: cust, method: m, at: when, shift, cashier: shift.opened_by });
      }
      const pays = db.payments.filter((p) => p.shift_id === shift.id);
      const totals = shiftGroups(db, shift);
      const counted = totals.expected + pick([0, 0, 0, -50, 100, -20]);
      Object.assign(shift, { closed_by: shift.opened_by, opened_at: date + 'T00:30:00.000Z', closed_at: date + 'T14:00:00.000Z', counted,
        summary: shiftGroups(db, shift, counted), note: null, updated_at: date + 'T14:00:00.000Z' });
      if (pays.length) db.shifts.push(shift);
    }
  }
  return db;
}

// A paid sale in the sample history (same shape as a real one).
function writeSale(db, store, { items, order_type, customer, method, at, shift, cashier }) {
  const st = store.settings;
  const priced = POS.priceCart({ items, order_type }, st);
  const due = method === POS.CASH ? POS.cashDue(priced.total, st) : priced.total;
  const pay = POS.checkPayments(priced.total, [{ method, amount: due, tendered: method === POS.CASH ? Math.ceil(due / 1000) * 1000 : null }], st);
  const local = POS.localParts(at);
  const id = uid();
  const earned = customer ? POS.cashbackEarned(pay.paid, 0, st) : 0;
  const sale = baseSale(db, store, { id, status: 'paid', shift_id: shift.id, receipt_no: nextReceipt(db, store), order_no: nextOrderNo(db, store, local.date),
    order_type, priced, pay, customer, earned, cashier, at, local });
  db.sales.push(sale);
  addRows(db, sale, sale.items, pay.payments, 'sale', at, local, cashier);
  if (customer) {
    customer.visits++; customer.spent += pay.paid; customer.last_visit_at = at; customer.last_store_id = store.id;
    if (earned) wallet(db, customer.id, POS.brandKey(store), earned, earned, 0);
  }
  return sale;
}

function baseSale(db, store, { id, status, shift_id, receipt_no, order_no, order_type, priced, pay, customer, earned = 0, cashier, at, local, table_no = null, note = null, discount = null, created_at }) {
  return {
    id, store_id: store.id, shift_id, status, receipt_no, order_no, order_type, table_no, note,
    customer_id: customer?.id || null, customer_name: customer?.name || null, customer_phone: customer?.phone || null,
    items: priced.lines.map((l) => ({ key: l.key, product_id: l.product_id || null, name: l.name, price: l.price, qty: l.qty, mods: l.mods || [], note: l.note || null,
      disc: l.disc, unit: l.unit, gross: l.gross, discount: l.discount, net: l.net, sent_at: l.sent_at || null })),
    subtotal: priced.subtotal, discount: priced.discount, discount_info: discount, service: priced.service, tax: priced.tax, tax_included: priced.tax_included,
    rounding: pay ? pay.rounding : 0, total: priced.total, payments: pay ? pay.payments : [], change_due: pay ? pay.change : 0,
    cashback_earned: earned, cashback_used: pay ? pay.cashbackUsed || 0 : 0, refunds: [], refunded: 0, kitchen: null,
    cashier, cashier_id: null, local_date: local.date, local_hour: local.hour, paid_at: status === 'open' ? null : at, offline_at: null,
    created_at: created_at || at, updated_at: at,
  };
}

const productInfo = (db, id) => {
  const p = db.products.find((x) => x.id === id);
  return p ? { category: db.categories.find((c) => c.id === p.category_id)?.name || null, cost: p.cost || 0, track: p.track_stock, product: p } : null;
};
function addRows(db, sale, lines, payments, kind, at, local, cashier) {
  const sign = kind === 'refund' ? -1 : 1;
  for (const l of lines) {
    const pi = productInfo(db, l.product_id);
    db.lines.push({ id: uid(), sale_id: sale.id, store_id: sale.store_id, shift_id: sale.shift_id, kind, product_id: l.product_id || null, name: l.name,
      category: pi?.category || null, qty: sign * l.qty, net: sign * l.net, cost: sign * (pi?.cost || 0) * l.qty, cashier, local_date: local.date, local_hour: local.hour, created_at: at });
  }
  for (const p of payments) {
    db.payments.push({ id: uid(), sale_id: sale.id, store_id: sale.store_id, shift_id: sale.shift_id, kind, method: p.method, amount: sign * p.amount, cashier, local_date: local.date, created_at: at });
  }
}
function wallet(db, customerId, brand, delta, earned, used) {
  let w = db.wallets.find((x) => x.customer_id === customerId && x.brand === brand);
  if (!w) db.wallets.push(w = { id: uid(), customer_id: customerId, brand, balance: 0, earned: 0, used: 0 });
  w.balance = Math.max(0, w.balance + delta); w.earned += earned; w.used += used;
}
const nextReceipt = (db, s) => { db.counters['no:' + s.code] = (db.counters['no:' + s.code] || 0) + 1; return `${s.code}-${String(db.counters['no:' + s.code]).padStart(6, '0')}`; };
function nextOrderNo(db, s, date) {
  const k = 'q:' + s.id;
  const [d, n] = String(db.counters[k] || '').split('|');
  const next = d === date ? Number(n) + 1 : 1;
  db.counters[k] = date + '|' + next;
  return next;
}
function shiftGroups(db, sh, counted = null) {
  const pays = {};
  const ids = {};
  for (const p of db.payments.filter((x) => x.shift_id === sh.id)) {
    const k = p.method + '|' + p.kind;
    pays[k] = pays[k] || { method: p.method, kind: p.kind, amount: 0, count: 0 };
    pays[k].amount += p.amount;
    (ids[k] ||= new Set()).add(p.sale_id);
  }
  Object.entries(ids).forEach(([k, set]) => { pays[k].count = set.size; });
  const sales = db.sales.filter((s) => s.shift_id === sh.id && SOLD.includes(s.status));
  const lines = db.lines.filter((l) => l.shift_id === sh.id);
  const sum = (arr, f) => arr.reduce((t, x) => t + (f(x) || 0), 0);
  return POS.shiftTotals({ float: sh.opening_float, moves: sh.moves || [], counted, pays: Object.values(pays), sales: {
    count: sales.length, discount: sum(sales, (s) => s.discount), service: sum(sales, (s) => s.service), tax: sum(sales, (s) => s.tax), rounding: sum(sales, (s) => s.rounding),
    net: sum(lines, (l) => l.net), items: sum(lines.filter((l) => l.kind === 'sale'), (l) => l.qty),
    refundCount: new Set(db.payments.filter((p) => p.shift_id === sh.id && p.kind === 'refund').map((p) => p.sale_id)).size } });
}

// ── The demo POS backend ────────────────────────────────────────────────────
export function createDemoPos() {
  let db = null;
  const load = () => {
    try { const x = JSON.parse(localStorage.getItem(KEY)); if (x && x.stores) return (db = x); } catch {}
    db = seed();
    save();
    return db;
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const store = (id, { active = true } = {}) => {
    const s = db.stores.find((x) => x.id === id);
    if (!s) fail('That store no longer exists.');
    if (active && !s.is_active) fail('That store is switched off. An owner can switch it on in POS → Stores.');
    return { ...s, settings: POS.cleanSettings(s.settings) };
  };
  const byOrder = (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name));
  const catalog = (storeId) => {
    store(storeId, { active: false });
    const of = (arr) => clone(arr.filter((x) => x.store_id === storeId).sort(byOrder));
    return { store_id: storeId, categories: of(db.categories), products: of(db.products), modifiers: of(db.modifiers) };
  };
  const openShift = (storeId) => db.shifts.find((s) => s.store_id === storeId && s.status === 'open') || null;
  const withTotals = (sh) => (sh ? { ...clone(sh), totals: sh.status === 'open' ? shiftGroups(db, sh) : sh.summary } : null);
  const cleanItems = (items) => {
    if (!items?.length) fail('The order is empty — add something first.');
    return items.map((it) => ({ key: it.key || uid().slice(0, 8), product_id: it.product_id || null, name: String(it.name || '').trim(), price: Math.round(it.price) || 0,
      qty: Math.max(1, Math.round(it.qty) || 1), mods: (it.mods || []).map((m) => ({ group: m.group || null, name: m.name, price: Math.round(m.price) || 0 })),
      note: it.note || null, discount: it.discount && typeof it.discount === 'object' && it.discount.value > 0 ? it.discount : null, sent_at: it.sent_at || null }));
  };
  const cleanDiscount = (d) => (d && d.value > 0 ? { type: d.type === 'percent' ? 'percent' : 'amount', value: Number(d.value), reason: d.reason || null } : null);
  const stockMove = (s, p, change, reason, note, saleId, at) => {
    p.stock = (p.stock || 0) + change;
    db.moves.push({ id: uid(), store_id: s.id, product_id: p.id, product_name: p.name, qty_change: change, reason, note: note || null, sale_id: saleId || null,
      stock_after: p.stock, who: OWNER, created_at: at });
  };

  const methods = {
    async me() {
      return { role: 'owner', name: OWNER, staffId: null, stores: clone(db.stores.sort(byOrder).map((s) => ({ ...s, settings: POS.cleanSettings(s.settings) }))),
        timeZone: POS.TIME_ZONE, allStores: true, countryCode: '60', hub: true };
    },
    async saveStore(input) {
      const name = String(input.name || '').trim();
      if (!name) fail('Give the store a name.');
      const ex = input.id ? db.stores.find((s) => s.id === input.id) : null;
      let code = String(input.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      const taken = (c) => db.stores.some((s) => s.code === c && s.id !== input.id);
      if (code && taken(code)) fail(`Another store already uses the receipt code ${code} — pick a different one.`);
      if (!code) { const b = (name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'S').slice(0, 4); code = b; for (let i = 2; taken(code); i++) code = b + i; }
      const row = { name, code, brand: String(input.brand || '').trim() || null, address: input.address || null, phone: input.phone || null,
        settings: POS.cleanSettings(input.settings), is_active: input.is_active !== false, sort_order: Number(input.sort_order) || 0, updated_at: now() };
      if (ex) Object.assign(ex, row); else db.stores.push({ id: uid(), created_at: now(), ...row });
      save();
      return clone(ex || db.stores[db.stores.length - 1]);
    },
    async team() { return clone(db.team); },
    async teamSet(id, patch) {
      const t = db.team.find((x) => x.id === id);
      if (!t) fail('That person is no longer on the team.');
      if (patch.pos !== undefined) t.pos = ['cashier', 'manager'].includes(patch.pos) ? patch.pos : null;
      if (patch.stores !== undefined) t.stores = patch.stores.filter((x) => db.stores.some((s) => s.id === x));
      if (patch.posOnly !== undefined) { if (patch.posOnly && !t.pos) fail('Give them a POS role first.'); t.posOnly = !!patch.posOnly; }
      if (!t.pos) t.posOnly = false;
      save();
      return clone(db.team);
    },
    async catalog(storeId) { return catalog(storeId); },
    async saveItem(kind, row) {
      const arr = { category: db.categories, product: db.products, modifier: db.modifiers }[kind];
      if (!arr) fail('Unknown menu item.');
      const ex = row.id ? arr.find((x) => x.id === row.id) : null;
      const s = store(ex ? ex.store_id : row.store_id, { active: false });
      const p = { store_id: s.id, sort_order: Number(row.sort_order) || 0 };
      const name = String(row.name || '').trim();
      if (!name) fail(kind === 'modifier' ? 'Give the group a name (e.g. Sugar level).' : `Give the ${kind} a name.`);
      p.name = name;
      if (kind === 'category') p.color = row.color || null;
      if (kind === 'modifier') {
        p.options = (row.options || []).filter((o) => String(o.name || '').trim()).map((o, i) => ({ id: o.id || 'o' + Date.now().toString(36) + i, name: String(o.name).trim(), price: Math.max(0, Math.round(o.price) || 0) }));
        if (!p.options.length) fail('Add at least one choice.');
        p.min_select = Math.min(p.options.length, Math.max(0, Math.round(row.min_select) || 0));
        p.max_select = Math.min(p.options.length, Math.max(1, p.min_select, Math.round(row.max_select) || 1));
      }
      if (kind === 'product') {
        if (row.price == null || row.price === '' || !(row.price >= 0)) fail('Give it a price (0 is fine for something free).');
        if (row.sku && db.products.some((x) => x.store_id === s.id && x.sku === row.sku && x.id !== row.id)) fail(`Another product already has the code ${row.sku}.`);
        Object.assign(p, { category_id: row.category_id || null, price: Math.round(row.price), cost: row.cost == null || row.cost === '' ? null : Math.round(row.cost),
          sku: row.sku || null, color: row.color || null, modifier_ids: (row.modifier_ids || []).filter((x) => db.modifiers.some((m) => m.id === x && m.store_id === s.id)),
          track_stock: !!row.track_stock, low_stock: row.low_stock === '' || row.low_stock == null ? null : Math.max(0, Math.round(row.low_stock)),
          is_active: row.is_active !== false, updated_at: now() });
        if (!ex) p.stock = Math.round(row.stock) || 0;
      }
      if (ex) Object.assign(ex, p); else arr.push({ id: uid(), created_at: now(), ...p });
      save();
      return clone(ex || arr[arr.length - 1]);
    },
    async deleteItem(kind, id) {
      const key = { category: 'categories', product: 'products', modifier: 'modifiers' }[kind];
      const ex = db[key].find((x) => x.id === id);
      if (!ex) fail('That item no longer exists.');
      if (kind === 'category') db.products.forEach((p) => { if (p.category_id === id) p.category_id = null; });
      if (kind === 'modifier') db.products.forEach((p) => { p.modifier_ids = (p.modifier_ids || []).filter((x) => x !== id); });
      db[key] = db[key].filter((x) => x.id !== id);
      save();
      return catalog(ex.store_id);
    },
    async importProducts(storeId, rows) {
      const s = store(storeId, { active: false });
      let added = 0, skipped = 0;
      const have = new Set(db.products.filter((p) => p.store_id === s.id).map((p) => p.name.toLowerCase()));
      for (const r of rows || []) {
        const name = String(r.name || '').trim();
        const price = Math.round(Number(r.price));
        if (!name || !Number.isFinite(price) || price < 0 || have.has(name.toLowerCase())) { skipped++; continue; }
        have.add(name.toLowerCase());
        let catId = null;
        const cn = String(r.category || '').trim();
        if (cn) {
          let c = db.categories.find((x) => x.store_id === s.id && x.name.toLowerCase() === cn.toLowerCase());
          if (!c) db.categories.push(c = { id: uid(), store_id: s.id, name: cn, color: null, sort_order: db.categories.length + 1, created_at: now() });
          catId = c.id;
        }
        const stock = r.stock === '' || r.stock == null ? null : Math.round(Number(r.stock));
        db.products.push({ id: uid(), store_id: s.id, category_id: catId, name, price, cost: r.cost === '' || r.cost == null ? null : Math.round(Number(r.cost)) || null,
          sku: r.sku || null, color: null, modifier_ids: [], track_stock: Number.isFinite(stock), stock: Number.isFinite(stock) ? stock : 0, low_stock: null,
          is_active: true, sort_order: 0, created_at: now(), updated_at: now() });
        added++;
      }
      save();
      return { added, skipped, catalog: catalog(s.id) };
    },
    async copyMenu(fromId, toId) {
      if (fromId === toId) fail('Pick a different store to copy from.');
      const from = catalog(fromId), to = catalog(toId);
      const catMap = new Map(), modMap = new Map();
      for (const c of from.categories) {
        const have = to.categories.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
        if (have) catMap.set(c.id, have.id); else { const n = { ...clone(c), id: uid(), store_id: toId }; db.categories.push(n); catMap.set(c.id, n.id); }
      }
      for (const m of from.modifiers) {
        const have = to.modifiers.find((x) => x.name.toLowerCase() === m.name.toLowerCase());
        if (have) modMap.set(m.id, have.id); else { const n = { ...clone(m), id: uid(), store_id: toId }; db.modifiers.push(n); modMap.set(m.id, n.id); }
      }
      const names = new Set(to.products.map((p) => p.name.toLowerCase()));
      let added = 0;
      for (const p of from.products) {
        if (names.has(p.name.toLowerCase())) continue;
        db.products.push({ ...clone(p), id: uid(), store_id: toId, stock: 0, category_id: catMap.get(p.category_id) || null,
          modifier_ids: (p.modifier_ids || []).map((x) => modMap.get(x)).filter(Boolean) });
        added++;
      }
      save();
      return { added, catalog: catalog(toId) };
    },

    async checkout(input) {
      const ex = db.sales.find((x) => x.id === input.id);
      if (ex && ex.status !== 'open') { if (ex.status === 'cancelled') fail('This order was cancelled.'); return clone(ex); }
      const s = store(ex ? ex.store_id : input.store_id);
      const st = s.settings;
      const shift = openShift(s.id);
      if (!shift) fail('Open a shift before taking payments (menu → Shift).', 'NO_SHIFT');
      const order_type = st.orderTypes.includes(input.order_type) ? input.order_type : st.orderTypes[0];
      const discount = cleanDiscount(input.discount);
      const priced = POS.priceCart({ items: cleanItems(input.items), discount, order_type }, st);
      if (input.client_total != null && Math.round(input.client_total) !== priced.total) fail('The total on the till is out of date — please refresh the page and try again.', 'PRICE_CHANGED');
      const customer = input.customer_id ? db.customers.find((c) => c.id === input.customer_id) : null;
      if (input.customer_id && !customer) fail('That customer no longer exists — remove them from the sale.');
      const brand = POS.brandKey(s);
      const w = customer && db.wallets.find((x) => x.customer_id === customer.id && x.brand === brand);
      const pay = POS.checkPayments(priced.total, input.payments, st, { cashback: w ? w.balance : 0 });
      if (pay.cashbackUsed && !customer) fail('Add the customer to pay with their cashback.');
      const earned = customer ? POS.cashbackEarned(pay.paid, pay.cashbackUsed, st) : 0;
      const at = now();
      const local = POS.localParts(at);
      const sale = baseSale(db, s, { id: input.id || uid(), status: 'paid', shift_id: shift.id, receipt_no: nextReceipt(db, s),
        order_no: ex?.order_no || nextOrderNo(db, s, local.date), order_type, priced, pay, customer, earned, cashier: OWNER, at, local,
        table_no: input.table_no || null, note: input.note || null, discount, created_at: ex?.created_at });
      sale.kitchen = ex?.kitchen || null;
      if (st.kitchen) { let fresh = false; sale.items.forEach((l) => { if (!l.sent_at) { l.sent_at = at; fresh = true; } }); if (fresh || !sale.kitchen) sale.kitchen = 'new'; }
      sale.offline_at = input.offline_at || null;
      if (ex) db.sales = db.sales.filter((x) => x.id !== ex.id);
      db.sales.push(sale);
      addRows(db, sale, sale.items, pay.payments, 'sale', at, local, OWNER);
      for (const l of sale.items) {
        const pi = productInfo(db, l.product_id);
        if (pi?.track) stockMove(s, pi.product, -l.qty, 'sale', sale.receipt_no, sale.id, at);
      }
      if (customer) {
        customer.visits++; customer.spent += pay.paid; customer.last_visit_at = at; customer.last_store_id = s.id;
        if (earned || pay.cashbackUsed) wallet(db, customer.id, brand, earned - pay.cashbackUsed, earned, pay.cashbackUsed);
      }
      save();
      return clone(sale);
    },
    async saveOpen(input) {
      const ex = db.sales.find((x) => x.id === input.id);
      if (ex && ex.status !== 'open') fail(ex.status === 'cancelled' ? 'This order was cancelled.' : 'This order was already paid.');
      const s = store(ex ? ex.store_id : input.store_id);
      const st = s.settings;
      const order_type = st.orderTypes.includes(input.order_type) ? input.order_type : st.orderTypes[0];
      const discount = cleanDiscount(input.discount);
      const priced = POS.priceCart({ items: cleanItems(input.items), discount, order_type }, st);
      const customer = input.customer_id ? db.customers.find((c) => c.id === input.customer_id) : null;
      const at = now();
      const local = POS.localParts(at);
      const o = baseSale(db, s, { id: input.id || uid(), status: 'open', shift_id: null, receipt_no: null, order_no: ex?.order_no || nextOrderNo(db, s, local.date),
        order_type, priced, pay: null, customer, cashier: ex?.cashier || OWNER, at, local, table_no: input.table_no || null, note: input.note || null, discount, created_at: ex?.created_at });
      o.kitchen = ex?.kitchen || null;
      if (st.kitchen && input.send !== false) { let fresh = false; o.items.forEach((l) => { if (!l.sent_at) { l.sent_at = at; fresh = true; } }); if (fresh) o.kitchen = 'new'; }
      if (ex) db.sales = db.sales.filter((x) => x.id !== ex.id);
      db.sales.push(o);
      save();
      return clone(o);
    },
    async openOrders(storeId) { return clone(db.sales.filter((s) => s.store_id === storeId && s.status === 'open').sort((a, b) => (a.created_at > b.created_at ? 1 : -1))); },
    async cancelOpen(id, reason) {
      const o = db.sales.find((x) => x.id === id);
      if (!o || o.status !== 'open') fail('Only open orders can be cancelled — use Refund for paid sales.');
      Object.assign(o, { status: 'cancelled', kitchen: null, note: [o.note, `Cancelled by ${OWNER}${reason ? ': ' + reason : ''}`].filter(Boolean).join(' · '), updated_at: now() });
      save();
      return clone(o);
    },
    async kitchen(storeId) {
      const since = new Date(Date.now() - 86400e3).toISOString();
      return clone(db.sales.filter((s) => s.store_id === storeId && ['new', 'ready'].includes(s.kitchen) && ['open', 'paid', 'partially_refunded'].includes(s.status) && s.created_at > since)
        .sort((a, b) => (a.created_at > b.created_at ? 1 : -1)));
    },
    async kitchenSet(id, status) {
      const o = db.sales.find((x) => x.id === id);
      if (!o) fail('That order no longer exists.');
      o.kitchen = status;
      save();
      return clone(o);
    },
    async sales({ storeId, from, to, q, status } = {}) {
      const statuses = { sold: SOLD, open: ['open'], cancelled: ['cancelled'], refunds: ['partially_refunded', 'refunded'] }[status] || SOLD;
      const t = from || POS.localParts(new Date()).date;
      const qq = String(q || '').trim().toLowerCase();
      const digits = qq.replace(/\D/g, '');
      return clone(db.sales.filter((s) => (!storeId || s.store_id === storeId) && statuses.includes(s.status) && s.local_date >= t && s.local_date <= (to || t)
        && (!qq || (s.receipt_no || '').toLowerCase().includes(qq) || (s.customer_name || '').toLowerCase().includes(qq)
          || (digits && (s.customer_phone || '').includes(digits.replace(/^0/, ''))) || String(s.order_no) === digits))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 500));
    },
    async sale(id) { const s = db.sales.find((x) => x.id === id); if (!s) fail('That sale no longer exists.'); return clone(s); },
    async refund({ id, lines, method, reason, restock }) {
      const sale = db.sales.find((x) => x.id === id);
      if (!sale || !['paid', 'partially_refunded'].includes(sale.status)) fail('Only paid sales can be refunded.');
      if (!String(reason || '').trim()) fail('Add a reason for the refund.');
      const s = store(sale.store_id, { active: false });
      const shift = openShift(s.id);
      if (!shift) fail('Open a shift first — refunds are paid out of the drawer.', 'NO_SHIFT');
      if (method === POS.CASHBACK ? !sale.customer_id : !s.settings.methods.includes(method)) fail('Choose how the money goes back to the customer.');
      const q = POS.refundQuote(sale, lines, { method, settings: s.settings });
      const at = now();
      const local = POS.localParts(at);
      const paid = sale.total + (sale.rounding || 0);
      const left = (sale.cashback_earned || 0) - (sale.refunds || []).reduce((t, r) => t + (r.cashback_reversed || 0), 0);
      const reverse = !left ? 0 : q.full ? left : Math.min(left, Math.round((sale.cashback_earned * q.amount) / (paid || 1)));
      for (const l of q.lines) {
        const it = sale.items[l.index];
        it.refunded_qty = (it.refunded_qty || 0) + l.qty;
        it.refunded_net = (it.refunded_net || 0) + l.net;
      }
      sale.refunds = [...(sale.refunds || []), { id: uid(), at, by: OWNER, approved_by: null, method, amount: q.amount, net: q.net, service: q.service, tax: q.tax,
        lines: q.lines, reason, restock: !!restock, cashback_reversed: reverse }];
      sale.refunded = (sale.refunded || 0) + q.amount;
      sale.status = q.full ? 'refunded' : 'partially_refunded';
      sale.updated_at = at;
      addRows(db, { ...sale, shift_id: shift.id }, q.lines, q.amount ? [{ method, amount: q.amount }] : [], 'refund', at, local, OWNER);
      if (restock) for (const l of q.lines) { const pi = productInfo(db, l.product_id); if (pi?.track) stockMove(s, pi.product, l.qty, 'refund', sale.receipt_no, sale.id, at); }
      const c = sale.customer_id && db.customers.find((x) => x.id === sale.customer_id);
      if (c) {
        c.spent = Math.max(0, c.spent - q.amount);
        const back = method === POS.CASHBACK ? q.amount : 0;
        if (back || reverse) wallet(db, c.id, POS.brandKey(s), back - reverse, -reverse, -back);
      }
      save();
      return clone(sale);
    },

    async shift(storeId) { return withTotals(openShift(storeId)); },
    async openShift(storeId, float) {
      const s = store(storeId);
      if (openShift(s.id)) fail(`A shift is already open at ${s.name}.`);
      const at = now();
      db.shifts.push({ id: uid(), store_id: s.id, status: 'open', opened_by: OWNER, opened_at: at, opening_float: Math.max(0, Math.round(float) || 0), moves: [],
        closed_by: null, closed_at: null, counted: null, summary: null, note: null, created_at: at, updated_at: at });
      save();
      return withTotals(openShift(s.id));
    },
    async cashMove(shiftId, move) {
      const sh = db.shifts.find((x) => x.id === shiftId && x.status === 'open');
      if (!sh) fail('That shift is already closed.');
      if (!(move.amount > 0)) fail('Enter the amount.');
      if (!move.reason) fail('Choose a reason.');
      sh.moves.push({ id: uid().slice(0, 8), type: move.type === 'out' ? 'out' : 'in', amount: Math.round(move.amount), reason: move.reason, note: move.note || null, by: OWNER, at: now() });
      save();
      return withTotals(sh);
    },
    async closeShift(shiftId, counted, note) {
      const sh = db.shifts.find((x) => x.id === shiftId && x.status === 'open');
      if (!sh) fail('That shift is already closed.');
      if (counted == null || counted === '' || !(counted >= 0)) fail('Count the cash in the drawer and enter the total.');
      Object.assign(sh, { status: 'closed', closed_by: OWNER, closed_at: now(), counted: Math.round(counted), summary: shiftGroups(db, sh, Math.round(counted)), note: note || null, updated_at: now() });
      save();
      return clone(sh);
    },
    async shifts(storeId) { return clone(db.shifts.filter((s) => s.store_id === storeId).sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1)).slice(0, 60)); },
    async shiftReport(id) { const sh = db.shifts.find((x) => x.id === id); if (!sh) fail('That shift no longer exists.'); return withTotals(sh); },

    async findCustomers(q, storeId) {
      q = String(q || '').trim().toLowerCase();
      if (q.length < 2) return [];
      const digits = q.replace(/\D/g, '');
      const brand = storeId ? POS.brandKey(store(storeId, { active: false })) : null;
      return clone(db.customers.filter((c) => (digits.length >= 3 && !/[a-z]/.test(q) ? c.phone.includes(digits.replace(/^0/, '')) : (c.name || '').toLowerCase().includes(q)))
        .slice(0, 20).map((c) => ({ ...c, cashback: brand ? db.wallets.find((w) => w.customer_id === c.id && w.brand === brand)?.balance || 0 : null })));
    },
    async customer(id, storeId) {
      const c = db.customers.find((x) => x.id === id);
      if (!c) fail('That customer no longer exists.');
      const brand = storeId ? POS.brandKey(store(storeId, { active: false })) : null;
      return clone({ ...c, cashback: brand ? db.wallets.find((w) => w.customer_id === c.id && w.brand === brand)?.balance || 0 : null,
        wallets: db.wallets.filter((w) => w.customer_id === c.id).map((w) => ({ brand: w.brand, balance: w.balance })),
        sales: db.sales.filter((s) => s.customer_id === c.id && SOLD.includes(s.status)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 30) });
    },
    async saveCustomer(input) {
      const phone = POS.normPhone(input.phone);
      if (phone.length < 8 || phone.length > 15) fail('Enter the customer\'s phone number (e.g. 012-345 6789).');
      const other = db.customers.find((c) => c.phone === phone && c.id !== input.id);
      if (other) fail(`That phone number already belongs to ${other.name || 'another customer'}.`, 'EXISTS');
      const p = { phone, name: String(input.name || '').trim() || null, email: input.email || null, birthday: input.birthday || null, notes: input.notes || null, updated_at: now() };
      const ex = input.id && db.customers.find((c) => c.id === input.id);
      if (ex) Object.assign(ex, p); else db.customers.push({ id: uid(), visits: 0, spent: 0, last_visit_at: null, last_store_id: null, created_at: now(), ...p });
      save();
      return clone(ex || db.customers[db.customers.length - 1]);
    },
    async customers() {
      return clone(db.customers.map((c) => ({ ...c, wallets: db.wallets.filter((w) => w.customer_id === c.id && w.balance > 0).map((w) => ({ brand: w.brand, balance: w.balance })) }))
        .sort((a, b) => ((a.last_visit_at || '') < (b.last_visit_at || '') ? 1 : -1)));
    },

    async stockAdjust({ productId, mode, qty, reason, note }) {
      const p = db.products.find((x) => x.id === productId);
      if (!p) fail('That product no longer exists.');
      qty = Math.round(Number(qty));
      if (!Number.isFinite(qty) || qty < 0 || (mode !== 'set' && !qty)) fail('Enter how many.');
      const change = mode === 'set' ? qty - (p.stock || 0) : mode === 'add' ? qty : -qty;
      p.track_stock = true;
      stockMove(store(p.store_id, { active: false }), p, change, reason || { add: 'received', remove: 'wastage', set: 'count' }[mode], note, null, now());
      save();
      return clone(p);
    },
    async stockMoves(storeId, productId) {
      return clone(db.moves.filter((m) => m.store_id === storeId && (!productId || m.product_id === productId)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 200));
    },

    async report(storeId, from, to) {
      const inRange = (r) => r.local_date >= from && r.local_date <= to && (!storeId || r.store_id === storeId);
      const sales = db.sales.filter((s) => SOLD.includes(s.status) && inRange(s));
      const lines = db.lines.filter(inRange);
      const pays = db.payments.filter(inRange);
      const sum = (arr, f) => arr.reduce((t, x) => t + (f(x) || 0), 0);
      const group = (arr, key, fold) => { const m = new Map(); for (const x of arr) { const k = key(x); m.set(k, fold(m.get(k), x)); } return m; };
      const byNet = (arr, key) => [...group(arr, key, (a = { net: 0, qty: 0 }, l) => ({ ...a, name: l.name, product_id: l.product_id, net: a.net + l.net, qty: a.qty + l.qty }))];
      const count = (arr, key) => [...group(arr, key, (a = 0) => a + 1)];
      const methodRows = [...group(pays, (p) => p.method, (a = { method: '', sales: 0, refunds: 0, ids: new Set() }, p) => {
        a.method = p.method;
        if (p.kind === 'sale') { a.sales += p.amount; a.ids.add(p.sale_id); } else a.refunds += -p.amount;
        return a;
      }).values()].map((a) => ({ method: a.method, sales: a.sales, refunds: a.refunds, count: a.ids.size }));
      return POS.buildReport({
        from, to,
        sales: { count: sales.length, gross: sum(sales, (s) => s.subtotal), discount: sum(sales, (s) => s.discount), service: sum(sales, (s) => s.service),
          tax: sum(sales, (s) => s.tax), rounding: sum(sales, (s) => s.rounding), paid: sum(sales, (s) => s.total + s.rounding),
          cb_earned: sum(sales, (s) => s.cashback_earned), cb_used: sum(sales, (s) => s.cashback_used) },
        lines: { net: sum(lines, (l) => l.net), items: sum(lines.filter((l) => l.kind === 'sale'), (l) => l.qty),
          refunded_net: sum(lines.filter((l) => l.kind === 'refund'), (l) => -l.net), cost: sum(lines, (l) => l.cost) },
        days: byNet(lines, (l) => l.local_date).map(([date, v]) => ({ date, net: v.net })),
        daySales: count(sales, (s) => s.local_date).map(([date, n]) => ({ date, sales: n })),
        hours: byNet(lines, (l) => l.local_hour).map(([hour, v]) => ({ hour, net: v.net })),
        hourSales: count(sales, (s) => s.local_hour).map(([hour, n]) => ({ hour, sales: n })),
        methods: methodRows,
        products: byNet(lines, (l) => l.product_id || l.name).map(([, v]) => v).sort((a, b) => b.net - a.net).slice(0, 100),
        categories: byNet(lines, (l) => l.category || '').map(([name, v]) => ({ name, qty: v.qty, net: v.net })).sort((a, b) => b.net - a.net),
        stores: byNet(lines, (l) => l.store_id).map(([store_id, v]) => ({ store_id, net: v.net })),
        storeSales: count(sales, (s) => s.store_id).map(([store_id, n]) => ({ store_id, sales: n })),
        cashiers: [...group(sales, (s) => s.cashier, (a = { sales: 0, paid: 0 }, s) => ({ sales: a.sales + 1, paid: a.paid + s.total + s.rounding }))]
          .map(([name, v]) => ({ name, ...v })).sort((a, b) => b.paid - a.paid),
        storeNames: Object.fromEntries(db.stores.map((s) => [s.id, s.name])),
      });
    },
    async reset() { try { localStorage.removeItem(KEY); } catch {} db = null; load(); return true; },
  };
  // Re-read the saved data on every call, so two open tabs (e.g. the till and the kitchen screen) see each other's changes.
  return Object.fromEntries(Object.entries(methods).map(([k, f]) => [k, async (...a) => { await wait(); load(); return f(...a); }]));
}
