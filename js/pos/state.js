// GIG POS state: who is signed in, their stores, the store this till is at, its menu, the shift,
// the cart (kept if the page reloads) and sales made while offline (sent as soon as the internet is back).
import { useState, useEffect } from '../lib.js';
import { uid } from '../util.js';
import * as POS from './model.js';

export let api = null;
export const setPosApi = (a) => { api = a; };

// ── Saved on this device ────────────────────────────────────────────────────
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const K = { store: 'gig-pos-store', cart: 'gig-pos-cart', outbox: 'gig-pos-outbox', me: 'gig-pos-me', names: 'gig-pos-names',
  catalog: (id) => 'gig-pos-catalog:' + id, shift: (id) => 'gig-pos-shift:' + id };

let S = { me: null, stores: [], storeId: null, catalog: null, shift: undefined, openOrders: [], cart: null, outbox: LS.get(K.outbox, []),
  online: typeof navigator === 'undefined' || navigator.onLine !== false, syncing: false };
const subs = new Set();
export const getS = () => S;
export function setS(patch) { S = { ...S, ...patch }; subs.forEach((f) => f(S)); }
export function usePos() {
  const [s, set] = useState(S);
  useEffect(() => { subs.add(set); set(S); return () => subs.delete(set); }, []);
  return s;
}
export const currentStore = () => S.stores.find((s) => s.id === S.storeId) || null;
export const role = () => S.me?.role || null;
export const isManager = () => role() === 'owner' || role() === 'manager';
export const isOwner = () => role() === 'owner';
export const money = (sen) => POS.fmtMoney(sen, currentStore()?.settings.currency || 'RM');

// Names that signed in on this device (shown as quick buttons on the sign-in screen).
export const recentNames = () => LS.get(K.names, []);
export const rememberName = (n) => LS.set(K.names, [n, ...recentNames().filter((x) => x.toLowerCase() !== n.toLowerCase())].slice(0, 8));
export const forgetName = (n) => LS.set(K.names, recentNames().filter((x) => x !== n));

// ── Loading ─────────────────────────────────────────────────────────────────
export async function boot() {
  let me;
  try { me = await api.pos.me(); LS.set(K.me, me); } catch (e) { me = e.offline ? LS.get(K.me) : null; if (!me) throw e; }
  POS.setTimeZone(me.timeZone);
  const usable = me.stores.filter((s) => s.is_active);
  let storeId = LS.get(K.store);
  if (!usable.some((s) => s.id === storeId)) storeId = usable[0]?.id || null;
  setS({ me, stores: me.stores, storeId, cart: loadCart(storeId, me.stores) });
  if (storeId) await loadStore(storeId);
}
export async function refreshMe() {
  const me = await api.pos.me();
  LS.set(K.me, me);
  setS({ me, stores: me.stores });
  if (!me.stores.some((s) => s.id === S.storeId && s.is_active)) {
    const first = me.stores.find((s) => s.is_active);
    if (first) await chooseStore(first.id); else setS({ storeId: null, catalog: null });
  }
}
export async function chooseStore(id) {
  LS.set(K.store, id);
  setS({ storeId: id, catalog: LS.get(K.catalog(id)), shift: undefined, openOrders: [], cart: loadCart(id, S.stores) });
  await loadStore(id);
}
export async function loadStore(id) {
  if (!S.catalog) setS({ catalog: LS.get(K.catalog(id)) });
  await Promise.all([refreshCatalog(id), refreshShift(id), refreshOpenOrders(id)].map((p) => p.catch(() => {})));
  if (S.shift === undefined) setS({ shift: LS.get(K.shift(id)) }); // offline: the shift as it was last seen
}
export async function refreshCatalog(id = S.storeId) {
  const c = await api.pos.catalog(id);
  LS.set(K.catalog(id), c);
  if (id === S.storeId) setS({ catalog: c });
  return c;
}
export async function refreshShift(id = S.storeId) {
  const sh = await api.pos.shift(id);
  LS.set(K.shift(id), sh ? { ...sh, totals: null } : null);
  if (id === S.storeId) setS({ shift: sh });
  return sh;
}
export async function refreshOpenOrders(id = S.storeId) {
  const list = await api.pos.openOrders(id);
  if (id === S.storeId) setS({ openOrders: list });
  return list;
}

// ── The cart ────────────────────────────────────────────────────────────────
// items: { key, product_id, name, price, qty, mods: [{ group, name, price }], note, discount: { type, value }, sent_at }
export function emptyCart(storeId = S.storeId, stores = S.stores) {
  const st = stores.find((s) => s.id === storeId)?.settings || POS.DEFAULT_STORE_SETTINGS;
  return { id: uid(), store_id: storeId, open: false, order_no: null, order_type: st.orderTypes[0] || 'takeaway', table_no: '', note: '', customer: null, discount: null, items: [] };
}
function loadCart(storeId, stores) {
  const c = LS.get(K.cart);
  return c && c.store_id === storeId && Array.isArray(c.items) ? c : emptyCart(storeId, stores);
}
export function setCart(patch) {
  const cart = typeof patch === 'function' ? patch(S.cart) : { ...S.cart, ...patch };
  LS.set(K.cart, cart);
  setS({ cart });
}
export const newCart = () => setCart(() => emptyCart());
export const priceOf = (cart = S.cart) => POS.priceCart({ items: cart.items, discount: cart.discount, order_type: cart.order_type }, currentStore()?.settings);

const sameLine = (a, b) => a.product_id && a.product_id === b.product_id && !a.sent_at && !a.discount && !a.note && !b.note
  && JSON.stringify(a.mods.map((m) => m.name)) === JSON.stringify(b.mods.map((m) => m.name)) && a.price === b.price;
export function addToCart(line) {
  setCart((c) => {
    const item = { key: uid().slice(0, 8), mods: [], note: null, discount: null, sent_at: null, qty: 1, ...line };
    const same = c.items.find((x) => sameLine(x, item));
    return { ...c, items: same ? c.items.map((x) => (x === same ? { ...x, qty: x.qty + item.qty } : x)) : [...c.items, item] };
  });
}
export const updateLine = (key, patch) => setCart((c) => ({ ...c, items: c.items.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
export const removeLine = (key) => setCart((c) => ({ ...c, items: c.items.filter((x) => x.key !== key) }));

// An open order (saved bill) back into the cart, to add items or take payment.
export function cartFromOrder(o) {
  setCart(() => ({ id: o.id, store_id: o.store_id, open: true, order_no: o.order_no, order_type: o.order_type, table_no: o.table_no || '', note: o.note || '',
    customer: o.customer_id ? { id: o.customer_id, name: o.customer_name, phone: o.customer_phone, cashback: null } : null,
    discount: o.discount_info || null,
    items: o.items.map((l) => ({ key: l.key, product_id: l.product_id, name: l.name, price: l.price, qty: l.qty, mods: l.mods || [], note: l.note || null,
      discount: l.disc || null, sent_at: l.sent_at || null })) }));
}

export function orderPayload(cart = S.cart) {
  return { id: cart.id, store_id: cart.store_id, order_type: cart.order_type, table_no: cart.table_no || null, note: cart.note || null,
    customer_id: cart.customer?.id || null, discount: cart.discount,
    items: cart.items.map((l) => ({ key: l.key, product_id: l.product_id || null, name: l.name, price: l.price, qty: l.qty,
      mods: (l.mods || []).map((m) => ({ group: m.group || null, name: m.name, price: m.price })), note: l.note || null, discount: l.discount || null, sent_at: l.sent_at || null })) };
}

// ── Taking payment (works offline: the sale waits on this device and is sent later) ──
export async function checkout(payments) {
  const store = currentStore();
  const priced = priceOf();
  const sale = { ...orderPayload(), payments, client_total: priced.total };
  try {
    const saved = await api.pos.checkout(sale);
    afterSale();
    return { sale: saved };
  } catch (e) {
    if (!e.offline) throw e;
    if (payments.some((p) => p.method === POS.CASHBACK)) throw new Error("You're offline — cashback needs the internet. Please take another payment method.");
    if (S.cart.open) throw new Error("You're offline — open orders can only be paid when the internet is back. Take payment as a new sale instead, or wait a moment.");
    const offline_at = new Date().toISOString();
    setOutbox([...S.outbox, { sale: { ...sale, offline_at }, error: null }]);
    const pay = POS.checkPayments(priced.total, payments, store.settings, { cashback: 0 });
    afterSale();
    return { offline: true, sale: { ...sale, ...priced, items: priced.lines, status: 'paid', receipt_no: null, order_no: null, rounding: pay.rounding, payments: pay.payments,
      change_due: pay.change, cashback_earned: 0, cashback_used: 0, customer_name: sale.customer_id ? S.cart.customer?.name : null,
      customer_phone: S.cart.customer?.phone || null, cashier: S.me?.name, paid_at: offline_at, created_at: offline_at, offline: true } };
  }
}
function afterSale() {
  newCart();
  refreshShift().catch(() => {});
  refreshOpenOrders().catch(() => {});
}

const setOutbox = (outbox) => { LS.set(K.outbox, outbox); setS({ outbox }); };
let syncing = false;
export async function syncOutbox() {
  if (syncing || !S.outbox.length) return;
  syncing = true;
  setS({ syncing: true });
  let sent = 0;
  try {
    for (const item of [...S.outbox]) {
      try {
        await api.pos.checkout(item.sale);
        setOutbox(S.outbox.filter((x) => x.sale.id !== item.sale.id));
        sent++;
      } catch (e) {
        if (e.offline) break;
        setOutbox(S.outbox.map((x) => (x.sale.id === item.sale.id ? { ...x, error: e.message } : x))); // kept for a manager to look at
      }
    }
  } finally {
    syncing = false;
    setS({ syncing: false, online: true });
    if (sent) refreshShift().catch(() => {});
  }
  return sent;
}
export const dropFromOutbox = (id) => setOutbox(S.outbox.filter((x) => x.sale.id !== id));
export const retryOutbox = () => { setOutbox(S.outbox.map((x) => ({ ...x, error: null }))); return syncOutbox(); };

if (typeof window !== 'undefined') {
  addEventListener('online', () => { setS({ online: true }); syncOutbox(); });
  addEventListener('offline', () => setS({ online: false }));
  setInterval(() => { if (S.outbox.some((x) => !x.error)) syncOutbox(); }, 15000);
}
