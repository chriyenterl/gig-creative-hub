// GIG POS — the maths and rules shared by the till (browser), the demo and the server
// (cloudflare/worker.js imports this file, so a total on screen is always the total that gets saved).
// Money is always whole sen: RM 4.50 is 450. That way totals never pick up floating-point cents.

export const CASH = 'Cash';
export const CASHBACK = 'Cashback'; // paying with a customer's cashback balance (not a method you add yourself)
export const DEFAULT_METHODS = [CASH, 'Card', 'DuitNow QR', "Touch 'n Go", 'GrabPay', 'ShopeePay'];
export const ORDER_TYPES = { takeaway: 'Takeaway', dine_in: 'Dine-in', delivery: 'Delivery' };
export const ROLES = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier' };
export const STOCK_REASONS = { received: 'Stock received', wastage: 'Wastage / spoilt', count: 'Stock count', adjust: 'Correction', sale: 'Sold', refund: 'Refund (back in stock)' };
export const PAY_REASONS = { in: ['Top up change', 'Owner added cash', 'Other'], out: ['Buy supplies', 'Petty cash', 'Bank in', 'Owner took cash', 'Other'] };
export const SALE_STATUS = {
  open: { label: 'Open order', tone: 'info' },
  paid: { label: 'Paid', tone: 'good' },
  partially_refunded: { label: 'Part refunded', tone: 'warn' },
  refunded: { label: 'Refunded', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const KITCHEN_STATUS = { new: 'Preparing', ready: 'Ready', done: 'Collected' };

export const DEFAULT_STORE_SETTINGS = {
  currency: 'RM',
  tax: { name: 'SST', rate: 0, inclusive: false, regNo: '' },
  service: { rate: 0, types: ['dine_in'] },
  rounding: true, // Malaysian 5-sen rounding on cash payments
  methods: DEFAULT_METHODS,
  orderTypes: ['takeaway', 'dine_in'],
  cashback: { rate: 0, minSpend: 0 },
  receipt: { header: '', footer: 'Thank you! See you again soon.', width: 80, autoPrint: false },
  kitchen: false,
};

// ── Money ───────────────────────────────────────────────────────────────────
// "4.5", "RM 4.50", 4.5 → 450. Empty or not a number → null.
export function parseMoney(v) {
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  // Read the digits (not v * 100, which turns 1.005 into 100.4999…).
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(String(v ?? '').replace(/[^\d.-]/g, ''));
  if (!m || (!m[2] && !m[3])) return null;
  const frac = (m[3] || '') + '000';
  const s = Number(m[2] || 0) * 100 + Number(frac.slice(0, 2)) + (frac[2] >= '5' ? 1 : 0);
  return m[1] ? -s : s;
}
export const toRM = (s) => (Number(s) || 0) / 100;
export const moneyInput = (s) => (s == null || s === '' ? '' : (Number(s) / 100).toFixed(2));
export function fmtMoney(s, currency = 'RM') {
  const n = Math.round(Number(s) || 0);
  const abs = (Math.abs(n) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-' : '') + (currency ? currency + ' ' : '') + abs;
}
// Bank Negara's rounding for cash: totals end in 0 or 5 sen (…1,2 → 0 · …3,4,6,7 → 5 · …8,9 → 10).
export const round5 = (s) => Math.round(s / 5) * 5;
const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
const pct = (n) => Math.min(100, Math.max(0, Math.round((Number(n) || 0) * 100) / 100));

// ── Store settings ──────────────────────────────────────────────────────────
// Fills in anything missing and keeps every value in range (the server runs this on save).
export function cleanSettings(input = {}) {
  const d = DEFAULT_STORE_SETTINGS;
  const s = input && typeof input === 'object' ? input : {};
  const tax = s.tax || {}, service = s.service || {}, cashback = s.cashback || {}, receipt = s.receipt || {};
  const methods = [...new Set([CASH, ...(Array.isArray(s.methods) ? s.methods : d.methods)
    .map((m) => String(m || '').trim().slice(0, 30)).filter((m) => m && m.toLowerCase() !== CASHBACK.toLowerCase())])].slice(0, 12);
  const orderTypes = (Array.isArray(s.orderTypes) ? s.orderTypes : d.orderTypes).filter((t) => ORDER_TYPES[t]);
  return {
    currency: String(s.currency || d.currency).trim().slice(0, 6) || 'RM',
    tax: { name: String(tax.name || d.tax.name).trim().slice(0, 20) || 'Tax', rate: pct(tax.rate), inclusive: !!tax.inclusive, regNo: String(tax.regNo || '').trim().slice(0, 40) },
    service: { rate: pct(service.rate), types: (Array.isArray(service.types) ? service.types : d.service.types).filter((t) => ORDER_TYPES[t]) },
    rounding: s.rounding === undefined ? d.rounding : !!s.rounding,
    methods,
    orderTypes: orderTypes.length ? [...new Set(orderTypes)] : ['takeaway'],
    cashback: { rate: Math.min(50, pct(cashback.rate)), minSpend: clampInt(cashback.minSpend, 0, 1e9) },
    receipt: { header: String(receipt.header || '').slice(0, 500), footer: String(receipt.footer ?? d.receipt.footer).slice(0, 500),
      width: Number(receipt.width) === 58 ? 58 : 80, autoPrint: !!receipt.autoPrint },
    kitchen: !!s.kitchen,
  };
}

// Cashback wallets are per brand: two outlets of the same brand share one, different brands don't.
export const brandKey = (store) => (String(store?.brand || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'store-' + store?.id);

// Phone numbers are kept as digits with the country code: 012-345 6789 → 60123456789.
export function normPhone(phone, countryCode = '60') {
  const raw = String(phone || '').trim();
  const d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (raw.startsWith('+')) return d;
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('0')) return countryCode + d.slice(1);
  return d.startsWith(countryCode) ? d : countryCode + d;
}
export const fmtPhone = (p) => (p ? '+' + p : '');

// ── Pricing a cart ──────────────────────────────────────────────────────────
// item: { name, price, qty, mods: [{ name, price }], discount: { type: 'amount' | 'percent', value } }
// order: { items, discount, order_type }. Returns the priced lines and every total, all in sen.
const discountOf = (d, base) => {
  if (!d || !d.value || base <= 0) return 0;
  const v = d.type === 'percent' ? Math.round((base * Math.min(100, Math.max(0, Number(d.value) || 0))) / 100) : Math.round(Number(d.value) || 0);
  return Math.min(base, Math.max(0, v));
};
// Splits `amount` over `weights` so the parts add up exactly (largest remainder).
function allocate(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!amount || !total) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const out = raw.map(Math.floor);
  let left = amount - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out;
}

export function priceCart(order, settingsIn) {
  const st = cleanSettings(settingsIn);
  const lines = (order?.items || []).map((it) => {
    const qty = Math.max(0, Math.round(Number(it.qty) || 0));
    const unit = Math.round(Number(it.price) || 0) + (it.mods || []).reduce((t, m) => t + Math.round(Number(m.price) || 0), 0);
    const gross = unit * qty;
    const disc = it.discount && typeof it.discount === 'object' ? it.discount : null;
    const lineDiscount = discountOf(disc, gross);
    // disc = the line's own discount setting (kept so a saved order can be edited); discount = sen taken off in total
    return { ...it, disc, qty, unit, gross, line_discount: lineDiscount, after: gross - lineDiscount };
  });
  const subtotal = lines.reduce((t, l) => t + l.gross, 0);
  const base = lines.reduce((t, l) => t + l.after, 0);
  const orderDiscount = discountOf(order?.discount, base);
  const shares = allocate(orderDiscount, lines.map((l) => l.after));
  lines.forEach((l, i) => { l.discount = l.line_discount + shares[i]; l.net = l.after - shares[i]; delete l.after; });
  const net = base - orderDiscount;
  const service = st.service.rate && st.service.types.includes(order?.order_type) ? Math.round((net * st.service.rate) / 100) : 0;
  const r = st.tax.rate;
  const tax = !r ? 0 : st.tax.inclusive ? Math.round(((net + service) * r) / (100 + r)) : Math.round(((net + service) * r) / 100);
  const total = net + service + (st.tax.inclusive ? 0 : tax);
  return { lines, subtotal, discount: subtotal - net, order_discount: orderDiscount, net, service, tax, tax_included: st.tax.inclusive, total,
    items: lines.reduce((t, l) => t + l.qty, 0) };
}

// What is still owed. Split bills take card / e-wallet parts first; a cash payment always settles the rest
// (rounded to 5 sen when rounding is on), so once cash is in, nothing is left to pay.
export function remaining(total, payments = []) {
  if (payments.some((p) => p.method === CASH)) return 0;
  return Math.max(0, total - payments.reduce((t, p) => t + p.amount, 0));
}
export const cashDue = (left, settings) => (cleanSettings(settings).rounding ? round5(left) : left);

// Checks the payments cover the bill exactly. Returns { rounding, paid, change } or throws a message.
export function checkPayments(total, payments, settingsIn, { cashback = 0 } = {}) {
  const st = cleanSettings(settingsIn);
  const list = (payments || []).map((p) => ({ method: String(p.method || ''), amount: Math.round(Number(p.amount) || 0), tendered: p.tendered == null ? null : Math.round(Number(p.tendered) || 0) }));
  for (const p of list) {
    if (!p.method) throw new Error('Choose how the customer paid.');
    if (p.amount <= 0) throw new Error('Every payment needs an amount.');
    if (p.method !== CASHBACK && !st.methods.includes(p.method)) throw new Error(`“${p.method}” isn't a payment method at this store.`);
    if (p.method === CASH && p.tendered != null && p.tendered < p.amount) throw new Error('The cash given is less than the amount paid in cash.');
  }
  const other = list.filter((p) => p.method !== CASH).reduce((t, p) => t + p.amount, 0);
  const cash = list.filter((p) => p.method === CASH).reduce((t, p) => t + p.amount, 0);
  const used = list.filter((p) => p.method === CASHBACK).reduce((t, p) => t + p.amount, 0);
  if (used > cashback) throw new Error('That is more than the customer\'s cashback balance.');
  if (other > total) throw new Error('Card and e-wallet payments can\'t be more than the bill.');
  let rounding = 0;
  if (cash) {
    const part = total - other;
    const due = st.rounding ? round5(part) : part;
    if (cash !== due) throw new Error(`Cash should be ${fmtMoney(due, st.currency)}.`);
    rounding = due - part;
  } else if (other !== total) throw new Error(`The payments (${fmtMoney(other, st.currency)}) don't add up to the bill (${fmtMoney(total, st.currency)}).`);
  const change = list.filter((p) => p.method === CASH).reduce((t, p) => t + Math.max(0, (p.tendered ?? p.amount) - p.amount), 0);
  return { payments: list, rounding, paid: total + rounding, change, cashbackUsed: used };
}

export function cashbackEarned(paid, cashbackUsed, settingsIn) {
  const cb = cleanSettings(settingsIn).cashback;
  const eligible = paid - cashbackUsed;
  if (!cb.rate || eligible <= 0 || eligible < cb.minSpend) return 0;
  return Math.floor((eligible * cb.rate) / 100);
}

// Quick-cash buttons: exact, then the next round notes above it.
export function quickCash(due) {
  const out = [due];
  for (const step of [100, 500, 1000, 2000, 5000, 10000]) {
    const v = Math.ceil(due / step) * step;
    if (v > due && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 6);
}

// ── Refunds ─────────────────────────────────────────────────────────────────
// picks: [{ index, qty }] — which lines of the sale (and how many) go back. The last refund of a
// sale always returns exactly what's left, so a full refund equals what the customer paid to the sen.
export function refundQuote(sale, picks, { method = null, settings } = {}) {
  const st = cleanSettings(settings);
  const items = sale.items || [];
  const lines = [];
  for (const p of picks || []) {
    const it = items[p.index];
    const qty = Math.round(Number(p.qty) || 0);
    if (!it || qty <= 0) continue;
    const left = it.qty - (it.refunded_qty || 0);
    if (qty > left) throw new Error(`Only ${left} × ${it.name} can still be refunded.`);
    const net = qty === left ? it.net - (it.refunded_net || 0) : Math.round((it.net * qty) / it.qty);
    lines.push({ index: p.index, product_id: it.product_id || null, name: it.name, qty, net });
  }
  if (!lines.length) throw new Error('Pick at least one item to refund.');
  const done = (sale.refunds || []);
  const sum = (k) => done.reduce((t, r) => t + (r[k] || 0), 0);
  const all = items.every((it, i) => (it.refunded_qty || 0) + lines.filter((l) => l.index === i).reduce((t, l) => t + l.qty, 0) >= it.qty);
  const net = lines.reduce((t, l) => t + l.net, 0);
  let service, tax, amount;
  if (all) {
    service = (sale.service || 0) - sum('service');
    tax = (sale.tax || 0) - sum('tax');
    amount = (sale.total + (sale.rounding || 0)) - sum('amount');
  } else {
    const saleNet = items.reduce((t, it) => t + (it.net || 0), 0); // saved sales keep net per line, not in total
    const ratio = saleNet ? net / saleNet : 0;
    service = Math.round((sale.service || 0) * ratio);
    tax = Math.round((sale.tax || 0) * ratio);
    amount = net + service + (sale.tax_included ? 0 : tax);
    if (method === CASH && st.rounding) amount = round5(amount);
  }
  return { lines, net, service, tax, amount: Math.max(0, amount), rounding: all ? 0 : amount - (net + service + (sale.tax_included ? 0 : tax)), full: all };
}

// ── Shifts ──────────────────────────────────────────────────────────────────
// What should be in the drawer: float + cash sales − cash refunds + pay ins − pay outs.
// pays: [{ method, kind: 'sale' | 'refund', amount (refunds negative), count }]
export function shiftTotals({ float = 0, moves = [], pays = [], sales = {}, counted = null }) {
  const cashSales = pays.filter((p) => p.method === CASH && p.kind === 'sale').reduce((t, p) => t + p.amount, 0);
  const cashRefunds = -pays.filter((p) => p.method === CASH && p.kind === 'refund').reduce((t, p) => t + p.amount, 0);
  const payIn = moves.filter((m) => m.type === 'in').reduce((t, m) => t + m.amount, 0);
  const payOut = moves.filter((m) => m.type === 'out').reduce((t, m) => t + m.amount, 0);
  const expected = float + cashSales - cashRefunds + payIn - payOut;
  const byMethod = {};
  for (const p of pays) {
    const m = (byMethod[p.method] ||= { method: p.method, sales: 0, refunds: 0, count: 0 });
    if (p.kind === 'refund') m.refunds += -p.amount; else { m.sales += p.amount; m.count += p.count || 0; }
  }
  const methods = Object.values(byMethod).map((m) => ({ ...m, net: m.sales - m.refunds })).sort((a, b) => b.net - a.net);
  return {
    float, cashSales, cashRefunds, payIn, payOut, expected, counted, difference: counted == null ? null : counted - expected,
    methods, collected: methods.reduce((t, m) => t + m.net, 0), refunds: methods.reduce((t, m) => t + m.refunds, 0),
    salesCount: sales.count || 0, refundCount: sales.refundCount || 0, net: sales.net || 0, discount: sales.discount || 0,
    service: sales.service || 0, tax: sales.tax || 0, rounding: sales.rounding || 0, items: sales.items || 0,
  };
}

// ── Reports ─────────────────────────────────────────────────────────────────
// Turns the grouped totals (from SQL on the server, or from the demo's own rows) into the report the app shows.
// "Net sales" = what was sold after discounts, minus refunds (before service charge and tax).
// "Collected" = the money that actually came in (every payment method, minus refunds paid out).
export function buildReport(g) {
  const n = (v) => Number(v) || 0;
  const s = g.sales || {}, l = g.lines || {};
  const daySales = new Map((g.daySales || []).map((r) => [r.date, n(r.sales)]));
  const dayNet = new Map((g.days || []).map((r) => [r.date, n(r.net)]));
  const days = [];
  for (let d = g.from; d <= g.to && days.length < 400; d = addDays(d, 1)) days.push({ date: d, net: dayNet.get(d) || 0, sales: daySales.get(d) || 0 });
  const hourSales = new Map((g.hourSales || []).map((r) => [n(r.hour), n(r.sales)]));
  const hourNet = new Map((g.hours || []).map((r) => [n(r.hour), n(r.net)]));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, net: hourNet.get(h) || 0, sales: hourSales.get(h) || 0 }));
  const methods = (g.methods || []).map((r) => ({ method: r.method, sales: n(r.sales), refunds: n(r.refunds), net: n(r.sales) - n(r.refunds), count: n(r.count) }))
    .sort((a, b) => b.net - a.net);
  const storeSales = new Map((g.storeSales || []).map((r) => [r.store_id, n(r.sales)]));
  const names = g.storeNames || {};
  const stores = (g.stores || []).map((r) => ({ store_id: r.store_id, name: names[r.store_id] || 'Store', net: n(r.net), sales: storeSales.get(r.store_id) || 0 }))
    .sort((a, b) => b.net - a.net);
  const count = n(s.count), paid = n(s.paid);
  return {
    from: g.from, to: g.to,
    totals: {
      sales: count, gross: n(s.gross), discount: n(s.discount), service: n(s.service), tax: n(s.tax), rounding: n(s.rounding), paid,
      net: n(l.net), refunds: methods.reduce((t, m) => t + m.refunds, 0), refundedNet: n(l.refunded_net), items: n(l.items), cost: n(l.cost),
      collected: methods.reduce((t, m) => t + m.net, 0), avg: count ? Math.round(paid / count) : 0,
      cashbackEarned: n(s.cb_earned), cashbackUsed: n(s.cb_used),
    },
    days, hours, methods, stores,
    products: (g.products || []).map((r) => ({ product_id: r.product_id || null, name: r.name, qty: n(r.qty), net: n(r.net) })).filter((r) => r.qty || r.net),
    categories: (g.categories || []).map((r) => ({ name: r.name || 'No category', qty: n(r.qty), net: n(r.net) })).filter((r) => r.qty || r.net),
    cashiers: (g.cashiers || []).map((r) => ({ name: r.name || '—', sales: n(r.sales), paid: n(r.paid) })),
  };
}

// ── Time ────────────────────────────────────────────────────────────────────
// The shop's own date and hour (reports and the daily order numbers use the store's time zone).
export let TIME_ZONE = 'Asia/Kuala_Lumpur';
export const setTimeZone = (tz) => { if (tz) TIME_ZONE = tz; }; // the till follows the server's POS_TIME_ZONE
export function localParts(at = new Date(), timeZone = TIME_ZONE) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
export function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Receipts ────────────────────────────────────────────────────────────────
export const modText = (mods) => (mods || []).map((m) => m.name).join(', ');
export function receiptText(sale, store) {
  const st = cleanSettings(store?.settings);
  const m = (s) => fmtMoney(s, st.currency);
  const out = [`*${store?.name || 'Receipt'}*`];
  if (st.receipt.header) out.push(st.receipt.header);
  out.push(`Receipt ${sale.receipt_no || '(not synced yet)'}${sale.order_no ? ' · Order #' + sale.order_no : ''}`,
    new Date(sale.paid_at || sale.created_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' }), '');
  for (const l of sale.items || []) {
    out.push(`${l.qty} × ${l.name}  ${m(l.gross)}`);
    if (l.mods?.length) out.push(`   ${modText(l.mods)}`);
    if (l.discount) out.push(`   Discount -${m(l.discount)}`);
  }
  out.push('', `Subtotal  ${m(sale.subtotal)}`);
  if (sale.discount) out.push(`Discount  -${m(sale.discount)}`);
  if (sale.service) out.push(`Service charge  ${m(sale.service)}`);
  if (sale.tax) out.push(`${st.tax.name}${sale.tax_included ? ' (included)' : ''}  ${m(sale.tax)}`);
  if (sale.rounding) out.push(`Rounding  ${m(sale.rounding)}`);
  out.push(`*Total  ${m(sale.total + (sale.rounding || 0))}*`);
  for (const p of sale.payments || []) out.push(`${p.method}  ${m(p.amount)}`);
  if (sale.change) out.push(`Change  ${m(sale.change)}`);
  if (sale.cashback_earned) out.push('', `You earned ${m(sale.cashback_earned)} cashback — use it on your next visit!`);
  if (st.receipt.footer) out.push('', st.receipt.footer);
  return out.join('\n');
}
