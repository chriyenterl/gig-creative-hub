// Webstore rules shared by the storefront, the Hub's Webstore screens and the demo backend (no UI code here).
// The server (cloudflare/worker.js) applies the same rules again — prices are always worked out there.
import { waNumber } from '../print/model.js';

export const TZ = 'Asia/Kuala_Lumpur'; // opening hours and pickup / delivery times are in the store's time
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const ORDER_STATUS = {
  new:       { label: 'New',       tone: 'info',    icon: 'inbox', hint: 'Just came in' },
  preparing: { label: 'Preparing', tone: 'warn',    icon: 'clock', hint: 'Being baked / packed' },
  ready:     { label: 'Ready',     tone: 'good',    icon: 'check', hint: 'Ready for pickup / out for delivery' },
  completed: { label: 'Completed', tone: 'neutral', icon: 'check', hint: 'Collected or delivered' },
  cancelled: { label: 'Cancelled', tone: 'bad',     icon: 'x',     hint: 'Won’t be made' },
};
export const STATUS_FLOW = ['new', 'preparing', 'ready', 'completed'];
export const readyLabel = (o) => (o?.fulfilment === 'delivery' ? 'Out for delivery' : 'Ready for pickup');
export const statusLabel = (o) => (o?.status === 'ready' ? readyLabel(o) : ORDER_STATUS[o?.status]?.label || 'New');
// What the customer sees on their order page.
export const CUSTOMER_STEPS = (o) => [
  { id: 'new', label: 'Order received' },
  { id: 'preparing', label: 'Preparing your order' },
  { id: 'ready', label: readyLabel(o) },
  { id: 'completed', label: o?.fulfilment === 'delivery' ? 'Delivered' : 'Collected' },
];

export const PAYMENT_STATUS = {
  unpaid:    { label: 'Not paid yet',  tone: 'warn' },
  submitted: { label: 'Receipt sent',  tone: 'info' },
  paid:      { label: 'Paid',          tone: 'good' },
};
export const paymentLabel = (method, fulfilment) => ({
  duitnow: 'DuitNow QR', bank: 'Bank transfer',
  cash: fulfilment === 'delivery' ? 'Cash on delivery' : 'Pay at pickup',
}[method] || 'Payment');

export const BADGES = ['Best seller', 'New', 'Limited', 'Seasonal'];

export const DEFAULT_MESSAGES = {
  confirmed: 'Hi {name}! Thank you for ordering from {store}. Your order {order_no} ({total}) is confirmed for {when}. You can follow it here: {link}',
  ready_pickup: 'Hi {name}! Your {store} order {order_no} is ready for pickup. See you soon!',
  ready_delivery: 'Hi {name}! Your {store} order {order_no} is on its way to you. Enjoy!',
};

export const DEFAULT_SETTINGS = {
  name: 'Noms',
  tagline: 'Freshly baked cookies, made in Sabah',
  about: '',
  logo_path: null,
  cover_path: null,
  accent: '#9c4a1f',
  phone: '',
  instagram: '',
  address: '',
  open: true,
  closedMessage: "We're not taking orders right now — please check back soon!",
  hours: DAYS.map(() => ({ open: '10:00', close: '20:00', closed: false })),
  slotMinutes: 30,   // pickup / delivery times every 30 minutes
  leadMinutes: 120,  // the earliest time is at least 2 hours away (time to bake and pack)
  daysAhead: 14,     // how far ahead customers can order
  delivery: { enabled: true, fee: 8, freeOver: 0, minOrder: 0, note: '' },
  pickup: { enabled: true, address: '', note: '' },
  payments: {
    duitnow: { enabled: true, qr_path: null, name: '' },
    bank: { enabled: false, bank: '', account_name: '', account_no: '' },
    cash: { enabled: true },
  },
  receiptRequired: false,
  categories: [],
  messages: DEFAULT_MESSAGES,
};

// Fills in anything missing (older saved settings, or a fresh store) so screens can rely on every field.
export function withDefaults(s) {
  const d = DEFAULT_SETTINGS;
  s = s || {};
  const hours = DAYS.map((_, i) => ({ ...d.hours[i], ...((s.hours || [])[i] || {}) }));
  return {
    ...d, ...s, hours,
    delivery: { ...d.delivery, ...(s.delivery || {}) },
    pickup: { ...d.pickup, ...(s.pickup || {}) },
    payments: {
      duitnow: { ...d.payments.duitnow, ...(s.payments?.duitnow || {}) },
      bank: { ...d.payments.bank, ...(s.payments?.bank || {}) },
      cash: { ...d.payments.cash, ...(s.payments?.cash || {}) },
    },
    categories: Array.isArray(s.categories) ? s.categories : [],
    messages: { ...d.messages, ...(s.messages || {}) },
  };
}

// ── Money (worked out in sen so 0.1 + 0.2 never shows up) ───────────────────
export const toSen = (rm) => Math.round(Number(rm || 0) * 100);
export const fromSen = (sen) => Math.round(sen) / 100;
export const money = (rm) => 'RM ' + (toSen(rm) / 100).toFixed(2);
// "+RM 2.00" for an option's extra price ('' when it's free).
export const plusMoney = (rm) => (toSen(rm) ? (toSen(rm) > 0 ? '+' : '−') + money(Math.abs(rm)) : '');

// ── Product options ("Box size", "Add-ons"…) ────────────────────────────────
// A group: { id, name, min, max, choices: [{ id, name, price }] } — min 1 = the customer must choose.
export const groupRule = (g) => {
  const n = g.choices?.length || 0, max = Math.min(g.max || 1, n || 1);
  if (g.min > 0 && max === 1) return 'Choose 1';
  if (g.min > 0) return `Choose ${g.min === max ? max : `${g.min}–${max}`}`;
  return max === 1 ? 'Optional' : `Optional · up to ${max}`;
};

// Works out one cart line against the current product. item = { product_id, qty, choices: { groupId: [choiceId] }, note }.
// Returns { ok, error, unit, total, options } — options are what the order shows: [{ group, choice, price }].
export function priceItem(product, item) {
  if (!product || product.is_hidden) return { ok: false, error: 'This item is no longer on the menu.' };
  if (!product.is_available) return { ok: false, error: `${product.name} is sold out.` };
  const qty = Number(item.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) return { ok: false, error: 'Choose a quantity between 1 and 99.' };
  let unit = toSen(product.price);
  const options = [];
  for (const g of product.options || []) {
    const ids = [...new Set((item.choices || {})[g.id] || [])];
    const picked = (g.choices || []).filter((c) => ids.includes(c.id));
    const max = Math.max(1, g.max || 1);
    if (picked.length < (g.min || 0)) return { ok: false, error: `Please choose ${g.name.toLowerCase()}.`, group: g.id };
    if (picked.length > max) return { ok: false, error: `Choose up to ${max} for ${g.name.toLowerCase()}.`, group: g.id };
    for (const c of picked) { unit += toSen(c.price); options.push({ group: g.name, choice: c.name, price: fromSen(toSen(c.price)) }); }
  }
  return { ok: true, unit: fromSen(unit), total: fromSen(unit * qty), options };
}

// Subtotal, delivery fee and total for priced lines ([{ total }]).
export function cartTotals(lines, settings, fulfilment) {
  const s = withDefaults(settings);
  const sub = lines.reduce((n, l) => n + toSen(l.total), 0);
  let fee = 0, short = 0;
  if (fulfilment === 'delivery') {
    fee = s.delivery.freeOver > 0 && sub >= toSen(s.delivery.freeOver) ? 0 : toSen(s.delivery.fee);
    if (s.delivery.minOrder > 0 && sub < toSen(s.delivery.minOrder)) short = toSen(s.delivery.minOrder) - sub;
  }
  return { subtotal: fromSen(sub), delivery_fee: fromSen(fee), total: fromSen(sub + fee), short: fromSen(short) };
}

export const optionText = (options) => (options || []).map((o) => o.choice).join(', ');

// ── Opening hours and pickup / delivery times (always in the store's time zone) ──
const pad = (n) => String(n).padStart(2, '0');
export const toMin = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
export const fromMin = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

// Today's date and the minutes since midnight, in the store's time zone.
export function storeNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const ymdUtc = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const addDays = (ymd, n) => new Date(ymdUtc(ymd) + n * 86400e3).toISOString().slice(0, 10);
export const dayDiff = (from, to) => Math.round((ymdUtc(to) - ymdUtc(from)) / 86400e3);
export const weekday = (ymd) => (new Date(ymdUtc(ymd)).getUTCDay() + 6) % 7; // 0 = Monday

// The times (minutes since midnight) customers can choose on a day.
export function daySlots(settings, ymd, now = new Date()) {
  const s = withDefaults(settings);
  const h = s.hours[weekday(ymd)];
  const open = toMin(h?.open), close = toMin(h?.close);
  if (!h || h.closed || open == null || close == null || close <= open) return [];
  const t = storeNow(now);
  const ahead = dayDiff(t.ymd, ymd);
  if (ahead < 0 || ahead >= s.daysAhead) return [];
  const step = Math.max(5, Number(s.slotMinutes) || 30);
  const earliest = t.minutes + Math.max(0, Number(s.leadMinutes) || 0) - ahead * 1440;
  const out = [];
  for (let m = open; m + step <= close || (m === open && m < close); m += step) if (m >= earliest) out.push(m);
  return out;
}

// Every day customers can order for, with its times: [{ ymd, slots }].
export function orderDays(settings, now = new Date()) {
  const s = withDefaults(settings);
  const today = storeNow(now).ymd;
  const out = [];
  for (let i = 0; i < s.daysAhead; i++) {
    const ymd = addDays(today, i);
    const slots = daySlots(s, ymd, now);
    if (slots.length) out.push({ ymd, slots });
  }
  return out;
}

export function fmtTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
export function fmtDay(ymd, now = new Date()) {
  const ahead = dayDiff(storeNow(now).ymd, ymd);
  if (ahead === 0) return 'Today';
  if (ahead === 1) return 'Tomorrow';
  return new Date(ymdUtc(ymd)).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}
export const fmtWhen = (o, now) => (o?.slot_date ? `${fmtDay(o.slot_date, now)}, ${fmtTime(toMin(o.slot_time))}` : '');
export const fmtWhenLong = (o) => (o?.slot_date
  ? new Date(ymdUtc(o.slot_date)).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }) + ', ' + fmtTime(toMin(o.slot_time))
  : '');

// "Open now · until 8:00 PM" / "Closed · opens 10:00 AM tomorrow".
export function openState(settings, now = new Date()) {
  const s = withDefaults(settings);
  if (!s.open) return { open: false, label: 'Not taking orders right now' };
  const t = storeNow(now);
  const h = s.hours[weekday(t.ymd)];
  const o = toMin(h.open), c = toMin(h.close);
  if (!h.closed && o != null && c != null && t.minutes >= o && t.minutes < c) return { open: true, label: `Open now · until ${fmtTime(c)}` };
  for (let i = 0; i < 8; i++) {
    const ymd = addDays(t.ymd, i), d = s.hours[weekday(ymd)], od = toMin(d.open);
    if (d.closed || od == null || toMin(d.close) <= od || (i === 0 && t.minutes >= od)) continue;
    return { open: false, label: `Closed · opens ${fmtTime(od)}${i === 0 ? '' : i === 1 ? ' tomorrow' : ' ' + DAYS[weekday(ymd)]}` };
  }
  return { open: false, label: 'Closed' };
}

// ── Messages ────────────────────────────────────────────────────────────────
export const itemLines = (items) => (items || []).map((it) => `${it.qty}× ${it.name}${it.options?.length ? ` (${optionText(it.options)})` : ''}`);

export const orderLink = (shopUrl, o) => `${shopUrl}#/order/${o.id}.${o.secret}`;

export function fillMessage(template, o, { store, link } = {}) {
  const name = o.customer_name ? String(o.customer_name).trim().split(/\s+/)[0] : 'there';
  return String(template || '')
    .replace(/\{name\}/g, name).replace(/\{full_name\}/g, o.customer_name || '')
    .replace(/\{order_no\}/g, o.order_no || '').replace(/\{total\}/g, money(o.total))
    .replace(/\{when\}/g, (o.fulfilment === 'delivery' ? 'delivery on ' : 'pickup on ') + fmtWhenLong(o))
    .replace(/\{store\}/g, store || '').replace(/\{items\}/g, itemLines(o.items).join(', '))
    .replace(/\{link\}/g, link || '');
}

// What the customer sends the store on WhatsApp after placing an order.
export function customerMessage(o, store) {
  return [`Hi ${store}! I've just placed order ${o.order_no}.`, '', ...itemLines(o.items), '',
    `Total: ${money(o.total)} (${paymentLabel(o.payment_method, o.fulfilment)})`,
    `${o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}: ${fmtWhenLong(o)}`,
    `Name: ${o.customer_name}`].join('\n');
}

export const waTo = (phone, text, cc = '60') => { const n = waNumber(phone, cc); return n ? `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}` : null; };

// ── Sample menu (demo mode, and "Add sample products" on an empty store) ────
const g = (id, name, min, max, choices) => ({ id, name, min, max, choices: choices.map(([cid, cname, price]) => ({ id: cid, name: cname, price })) });
const ADDONS = g('addons', 'Add-ons', 0, 2, [['drizzle', 'Extra chocolate drizzle', 1], ['salt', 'Sea salt flakes', 0.5]]);
export const SAMPLE_CATEGORIES = ['Signature cookies', 'Cookie boxes', 'Gift sets'];
export const SAMPLE_PRODUCTS = [
  { name: 'Classic Chocolate Chip', category: 'Signature cookies', price: 7.9, badge: 'Best seller',
    description: 'Crispy edges, a soft gooey centre and plenty of dark chocolate chunks.', options: [ADDONS] },
  { name: 'Double Chocolate', category: 'Signature cookies', price: 8.9,
    description: 'Rich cocoa dough loaded with milk and dark chocolate.', options: [ADDONS] },
  { name: 'Salted Caramel Crunch', category: 'Signature cookies', price: 8.9,
    description: 'Brown butter dough, caramel bits and a pinch of sea salt.', options: [ADDONS] },
  { name: 'Matcha White Chocolate', category: 'Signature cookies', price: 9.9, badge: 'New',
    description: 'Premium matcha with creamy white chocolate — earthy, sweet and balanced.' },
  { name: 'Red Velvet Cream Cheese', category: 'Signature cookies', price: 9.9, is_available: false,
    description: 'A soft red velvet cookie with a cream cheese centre.' },
  { name: 'Mixed Cookie Box', category: 'Cookie boxes', price: 30, badge: 'Best seller',
    description: 'Our favourite flavours, packed fresh in a gift-ready box.',
    options: [g('size', 'Box size', 1, 1, [['b4', 'Box of 4', 0], ['b6', 'Box of 6', 14], ['b12', 'Box of 12', 54]]),
              g('mix', 'Flavour mix', 1, 1, [['chef', "Chef's mix", 0], ['choc', 'All chocolate', 0], ['new', 'Try the new flavours', 2]])] },
  { name: 'Mini Cookie Tub', category: 'Cookie boxes', price: 22,
    description: 'Bite-sized cookies in a resealable tub — perfect for sharing.',
    options: [g('flavour', 'Flavour', 1, 1, [['cc', 'Chocolate chip', 0], ['dc', 'Double chocolate', 0], ['mix', 'Half & half', 1]])] },
  { name: 'Festive Gift Box', category: 'Gift sets', price: 88, compare_price: 98, badge: 'Seasonal',
    description: '12 cookies, a greeting card and a hand-tied ribbon. Ready to give.',
    options: [g('ribbon', 'Ribbon colour', 1, 1, [['gold', 'Gold', 0], ['red', 'Red', 0], ['green', 'Green', 0]]),
              g('card', 'Greeting card', 0, 1, [['msg', 'Add a personal message', 5]])] },
  { name: 'Corporate Gift Pack', category: 'Gift sets', price: 38,
    description: 'A box of 6 with your company tag. Ordering 20 or more? Message us for bulk pricing.' },
];
