// GIG POS: stores, menu, team roles, shifts, selling (cash rounding, retries), open orders, kitchen,
// customers + cashback, refunds with a manager's approval, stock and reports. Runs against `wrangler dev` — see run.sh.
import * as POS from '../../js/pos/model.js';
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
let pass = 0, failN = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('  ✓', label); } else { failN++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const api = async (action, args = {}) => (await fetch(BASE + '/api', { method: 'POST', body: JSON.stringify({ action, ...args }) })).json();
const data = async (action, args) => { const j = await api(action, args); if (!j.ok) throw new Error(action + ': ' + j.error); return j.data; };
const uuid = () => crypto.randomUUID();
const today = POS.localParts(new Date()).date;

console.log('Setup');
await data('setupAdmin', { email: 'owner@example.test', name: 'Owner', password: 'pos-test-pass' });
const T = (await data('login', { email: 'owner@example.test', password: 'pos-test-pass' })).token;
let me = await data('posMe', { token: T });
ok(me.role === 'owner' && me.stores.length === 0 && me.allStores, 'owner sees the POS, no stores yet', me);
ok((await api('posMe', {})).code === 'AUTH', 'the POS needs a sign-in');

console.log('Stores');
const chajo = await data('posSaveStore', { token: T, store: { name: 'Chajo SS15', brand: 'Chajo', code: 'chj', settings: {
  tax: { name: 'SST', rate: 6 }, service: { rate: 10, types: ['dine_in'] }, cashback: { rate: 5 }, kitchen: true, orderTypes: ['takeaway', 'dine_in'] } } });
ok(chajo.code === 'CHJ' && chajo.settings.tax.rate === 6 && chajo.settings.methods[0] === 'Cash' && chajo.settings.rounding === true, 'store saved with SST, service charge, cashback', chajo);
ok((await api('posSaveStore', { token: T, store: { name: 'Other', code: 'CHJ' } })).ok === false, 'two stores can\'t share a receipt code');
const walnut = await data('posSaveStore', { token: T, store: { name: 'Walnut Bakery Bangsar', brand: 'Walnut Bakery' } });
ok(walnut.code === 'WBB' && walnut.settings.tax.rate === 0, 'receipt code made from the name when left empty', walnut.code);
const chajo2 = await data('posSaveStore', { token: T, store: { name: 'Chajo Subang', brand: 'Chajo', settings: chajo.settings } });
ok(chajo2.code === 'CS', 'second Chajo outlet', chajo2.code);

console.log('Menu');
const cat = await data('posSaveItem', { token: T, kind: 'category', row: { store_id: chajo.id, name: 'Milk tea', color: '#c58b4b' } });
const size = await data('posSaveItem', { token: T, kind: 'modifier', row: { store_id: chajo.id, name: 'Size', min_select: 1, max_select: 1,
  options: [{ name: 'Regular', price: 0 }, { name: 'Large', price: 100 }] } });
const tops = await data('posSaveItem', { token: T, kind: 'modifier', row: { store_id: chajo.id, name: 'Toppings', min_select: 0, max_select: 5,
  options: [{ name: 'Pearl', price: 150 }, { name: 'Pudding', price: 200 }] } });
ok(size.options.length === 2 && size.options.every((o) => o.id) && tops.max_select === 2, 'modifier groups (max is capped to the number of choices)', tops);
const boba = await data('posSaveItem', { token: T, kind: 'product', row: { store_id: chajo.id, name: 'Brown Sugar Boba', price: 990, cost: 320, category_id: cat.id,
  modifier_ids: [size.id, tops.id, 'not-a-real-group'], sku: 'BSB' } });
ok(boba.price === 990 && boba.modifier_ids.join() === [size.id, tops.id].join() && boba.is_active, 'product with its modifier groups', boba);
const water = await data('posSaveItem', { token: T, kind: 'product', row: { store_id: chajo.id, name: 'Mineral water', price: 250, cost: 80, track_stock: true, stock: 24, low_stock: 6 } });
ok(water.track_stock && water.stock === 24, 'a product with stock tracking');
ok((await api('posSaveItem', { token: T, kind: 'product', row: { store_id: chajo.id, name: 'Dup', price: 1, sku: 'BSB' } })).ok === false, 'product codes are unique in a store');
ok((await api('posSaveItem', { token: T, kind: 'product', row: { store_id: walnut.id, name: 'X', price: 1, category_id: cat.id } })).ok === false, "can't use another store's category");
let catalog = await data('posCatalog', { token: T, storeId: chajo.id });
ok(catalog.products.length === 2 && catalog.categories.length === 1 && catalog.modifiers.length === 2, 'catalog for the store');

console.log('Team: a POS-only cashier and a manager');
const SET = (await data('printMe', { token: T })).settings;
await data('joinRequest', { joinKey: SET.joinKey, name: 'Aina', passcode: '111222', email: 'aina@example.test' });
await data('joinRequest', { joinKey: SET.joinKey, name: 'Mei Ling', passcode: '333444', email: 'mei@example.test' });
let staff = (await data('printMe', { token: T })).staff;
const AINA = staff.find((x) => x.name === 'Aina'), MEI = staff.find((x) => x.name === 'Mei Ling');
staff = await data('printStaffApprove', { token: T, id: AINA.id, hub: false, pos: true });
ok(staff.find((x) => x.id === AINA.id).posOnly && staff.find((x) => x.id === AINA.id).pos === 'cashier', 'approved as POS only (cashier)');
await data('printStaffApprove', { token: T, id: MEI.id, hub: false });
let team = await data('posTeam', { token: T });
ok(team.find((x) => x.id === MEI.id).pos === null, 'approved for the Print Hub: no POS role yet');
team = await data('posTeamSet', { token: T, id: MEI.id, patch: { pos: 'manager', stores: [chajo.id, 'nope'] } });
ok(team.find((x) => x.id === MEI.id).pos === 'manager' && team.find((x) => x.id === MEI.id).stores.join() === chajo.id, 'Mei is a manager at Chajo SS15 only');
const AT = (await data('passcodeLogin', { name: 'Aina', passcode: '111222' })).token;
const MT = (await data('passcodeLogin', { name: 'Mei Ling', passcode: '333444' })).token;
const aMe = await data('posMe', { token: AT });
ok(aMe.role === 'cashier' && aMe.stores.length === 3, 'Aina: cashier at every store', aMe.stores.map((s) => s.name));
const mMe = await data('posMe', { token: MT });
ok(mMe.role === 'manager' && mMe.stores.length === 1 && !mMe.allStores, 'Mei only sees Chajo SS15');
ok((await api('posCatalog', { token: MT, storeId: walnut.id })).ok === false, "Mei can't open Walnut Bakery");
ok((await api('printMe', { token: AT })).code === 'POS_ONLY', 'POS-only people are kept out of the Print Hub');
ok((await api('bootstrap', { token: AT })).code === 'POS_ONLY' && (await data('me', { token: AT })).posOnly === true, '...and the Creative Hub (the app sends them to the POS)');
ok((await api('printOrders', { printKey: staff.find((x) => x.id === AINA.id).key })).code === 'POS_ONLY', '...even with their personal link');
ok((await api('linkLogin', { linkKey: staff.find((x) => x.id === AINA.id).key })).code === 'POS_ONLY', 'her link opened in the Creative Hub says POS only');
ok(!!(await data('linkLogin', { linkKey: staff.find((x) => x.id === AINA.id).key, app: 'pos' })).token, 'her link signs her in to the POS (e.g. the shop tablet)');
ok((await api('posSaveItem', { token: AT, kind: 'product', row: { store_id: chajo.id, name: 'Sneaky', price: 1 } })).ok === false, 'cashiers can\'t change the menu');
ok((await api('posReport', { token: AT, from: today, to: today })).ok === false, '...or see reports');
ok((await api('posSaveStore', { token: MT, store: { name: 'Nope' } })).ok === false, 'managers can\'t add stores');
ok((await api('posMe', { token: (await data('passcodeLogin', { name: 'Mei Ling', passcode: '333444' })).token })).ok, 'manager signs in');

console.log('Shifts');
const cart = (extra = {}) => ({
  id: uuid(), store_id: chajo.id, order_type: 'takeaway', items: [
    { key: 'a', product_id: boba.id, name: boba.name, price: 990, qty: 2, mods: [{ group: 'Size', name: 'Large', price: 100 }, { group: 'Toppings', name: 'Pearl', price: 150 }] },
    { key: 'b', product_id: water.id, name: water.name, price: 250, qty: 1, mods: [] },
  ], ...extra });
let j = await api('posCheckout', { token: AT, sale: { ...cart(), payments: [{ method: 'Cash', amount: 2895, tendered: 5000 }] } });
ok(j.ok === false && j.code === 'NO_SHIFT', 'no sales before a shift is open', j);
let shift = await data('posOpenShift', { token: AT, storeId: chajo.id, float: 20000 });
ok(shift.status === 'open' && shift.opening_float === 20000 && shift.opened_by === 'Aina' && shift.totals.expected === 20000, 'shift opened with RM 200 float', shift);
ok((await api('posOpenShift', { token: MT, storeId: chajo.id, float: 0 })).ok === false, 'only one open shift per store');

console.log('Selling');
// 2 × (9.90 + 1.00 + 1.50) + 2.50 = 27.30 · SST 6% = 1.64 · total 28.94 → cash 28.95
const s1in = cart();
const priced = POS.priceCart({ ...s1in, discount: null }, chajo.settings);
ok(priced.total === 2894 && priced.tax === 164 && priced.service === 0, 'till maths: RM 28.94 with SST, no service charge on takeaway', priced);
j = await api('posCheckout', { token: AT, sale: { ...s1in, payments: [{ method: 'Cash', amount: 2894, tendered: 5000 }] } });
ok(j.ok === false && /28\.95/.test(j.error), 'cash must be rounded to 5 sen', j.error);
const s1 = await data('posCheckout', { token: AT, sale: { ...s1in, client_total: 2894, payments: [{ method: 'Cash', amount: 2895, tendered: 5000 }] } });
ok(s1.status === 'paid' && s1.receipt_no === 'CHJ-000001' && s1.order_no === 1 && s1.total === 2894 && s1.rounding === 1 && s1.change_due === 2105, 'sale saved: receipt CHJ-000001, order #1, rounding +0.01, change RM 21.05', s1);
ok(s1.cashier === 'Aina' && s1.kitchen === 'new' && s1.local_date === today && s1.items[0].sent_at, 'cashier recorded; the kitchen gets it', s1);
const again = await data('posCheckout', { token: AT, sale: { ...s1in, payments: [{ method: 'Cash', amount: 2895, tendered: 5000 }] } });
ok(again.id === s1.id && again.receipt_no === s1.receipt_no, 'sending the same sale again (a retry) doesn\'t charge twice');
ok((await data('posCatalog', { token: AT, storeId: chajo.id })).products.find((p) => p.id === water.id).stock === 23, 'stock went down by one');
j = await api('posCheckout', { token: AT, sale: { ...cart(), client_total: 2000, payments: [{ method: 'Card', amount: 2894 }] } });
ok(j.ok === false && j.code === 'PRICE_CHANGED', 'a till with old totals is stopped', j);
j = await api('posCheckout', { token: AT, sale: { ...cart(), payments: [{ method: 'Card', amount: 2000 }] } });
ok(j.ok === false, 'underpaid sale refused');
j = await api('posCheckout', { token: AT, sale: { ...cart(), payments: [{ method: 'Bitcoin', amount: 2894 }] } });
ok(j.ok === false, 'unknown payment method refused');
// Two tills send the same sale at the same moment: one sale.
const twin = { ...cart(), payments: [{ method: 'Card', amount: 2894 }] };
const [t1, t2] = await Promise.all([api('posCheckout', { token: AT, sale: twin }), api('posCheckout', { token: AT, sale: twin })]);
ok(t1.ok && t2.ok && t1.data.id === t2.data.id && t1.data.receipt_no === t2.data.receipt_no, 'same sale sent twice at once → saved once', [t1, t2]);
// Split bill: card first, cash for the rest
const s3 = await data('posCheckout', { token: AT, sale: { ...cart({ discount: { type: 'percent', value: 10, reason: 'Staff' } }),
  payments: [{ method: 'Card', amount: 1000 }, { method: 'Cash', amount: 1605, tendered: 2000 }] } });
// 27.30 − 10% (2.73) = 24.57 · SST 1.47 → 26.04 · card 10.00 · cash 16.04 → 16.05
ok(s3.discount === 273 && s3.total === 2604 && s3.rounding === 1 && s3.change_due === 395, 'split bill with a 10% discount', s3);

console.log('Customers & cashback');
j = await api('posSaveCustomer', { token: AT, customer: { phone: '12', name: 'X' } });
ok(j.ok === false, 'a phone number is needed');
const cust = await data('posSaveCustomer', { token: AT, customer: { phone: '012-345 6789', name: 'Nurul', birthday: '1998-04-12' } });
ok(cust.phone === '60123456789' && cust.name === 'Nurul', 'customer saved with the country code', cust);
j = await api('posSaveCustomer', { token: AT, customer: { phone: '+60 12 345 6789', name: 'Copy' } });
ok(j.ok === false && j.code === 'EXISTS', 'one customer per phone number', j);
let found = await data('posFindCustomers', { token: AT, q: '0123456', storeId: chajo.id });
ok(found.length === 1 && found[0].id === cust.id && found[0].cashback === 0, 'found by phone digits (with a leading 0)');
ok((await data('posFindCustomers', { token: AT, q: 'nur', storeId: chajo.id }))[0]?.id === cust.id, 'found by name');
const s4 = await data('posCheckout', { token: AT, sale: { ...cart(), customer_id: cust.id, payments: [{ method: 'Card', amount: 2894 }] } });
ok(s4.cashback_earned === 144 && s4.customer_name === 'Nurul', '5% cashback earned (RM 1.44)', s4.cashback_earned);
found = await data('posFindCustomers', { token: AT, q: '0123456789', storeId: chajo2.id });
ok(found[0].cashback === 144, 'cashback is shared by outlets of the same brand (Chajo Subang)');
ok((await data('posFindCustomers', { token: AT, q: '0123456789', storeId: walnut.id }))[0].cashback === 0, '...but not with another brand');
j = await api('posCheckout', { token: AT, sale: { ...cart(), customer_id: cust.id, payments: [{ method: 'Cashback', amount: 500 }, { method: 'Card', amount: 2394 }] } });
ok(j.ok === false, "can't use more cashback than they have");
const s5 = await data('posCheckout', { token: AT, sale: { ...cart(), customer_id: cust.id, payments: [{ method: 'Cashback', amount: 144 }, { method: 'Card', amount: 2750 }] } });
// paid 28.94 − 1.44 cashback = 27.50 eligible → 1.37 earned
ok(s5.cashback_used === 144 && s5.cashback_earned === 137, 'paid partly with cashback; earns only on the rest', s5);
let profile = await data('posCustomer', { token: AT, id: cust.id, storeId: chajo.id });
ok(profile.cashback === 137 && profile.visits === 2 && profile.spent === 5788 && profile.sales.length === 2, 'customer profile: balance, visits, spent, purchases', profile);

console.log('Open orders & kitchen');
const tableOrder = { id: uuid(), store_id: chajo.id, order_type: 'dine_in', table_no: '5', items: [{ key: 'x', product_id: boba.id, name: boba.name, price: 990, qty: 1, mods: [] }] };
let open = await data('posSaveOpen', { token: AT, order: tableOrder });
ok(open.status === 'open' && open.order_no === s5.order_no + 1 && open.kitchen === 'new' && open.items[0].sent_at && !open.receipt_no, 'table 5 saved as an open order, sent to the kitchen', open);
ok(open.service === 99 && open.total === 1154, 'dine-in: service charge 10% + SST on it', open);
let kitchen = await data('posKitchen', { token: AT, storeId: chajo.id });
ok(kitchen.some((k) => k.id === open.id) && kitchen.some((k) => k.id === s1.id), 'kitchen shows paid takeaways and the open table');
await data('posKitchenSet', { token: AT, id: open.id, status: 'ready' });
const firstSent = open.items[0].sent_at;
open = await data('posSaveOpen', { token: AT, order: { ...tableOrder, items: [...open.items, { key: 'y', product_id: water.id, name: water.name, price: 250, qty: 2, mods: [] }] } });
ok(open.items.length === 2 && open.items[0].sent_at === firstSent && open.items[1].sent_at && open.kitchen === 'new', 'more items added later go to the kitchen as new');
ok((await data('posOpenOrders', { token: AT, storeId: chajo.id })).length === 1, 'listed under open orders');
const paidOpen = await data('posCheckout', { token: MT, sale: { ...tableOrder, items: open.items, payments: [{ method: 'DuitNow QR', amount: open.total }] } });
ok(paidOpen.status === 'paid' && paidOpen.order_no === open.order_no && paidOpen.receipt_no && paidOpen.cashier === 'Mei Ling' && paidOpen.created_at === open.created_at, 'paid later: same order number, now has a receipt', paidOpen);
ok((await data('posOpenOrders', { token: AT, storeId: chajo.id })).length === 0, 'no longer open');
ok((await api('posSaveOpen', { token: AT, order: tableOrder })).ok === false, "a paid order can't be changed");
const toCancel = await data('posSaveOpen', { token: AT, order: { id: uuid(), store_id: chajo.id, items: [{ name: 'Mistake', price: 100, qty: 1 }] } });
const cancelled = await data('posCancelOpen', { token: AT, id: toCancel.id, reason: 'Customer left' });
ok(cancelled.status === 'cancelled' && /Customer left/.test(cancelled.note) && cancelled.kitchen === null, 'open order cancelled with a reason');
ok((await api('posCheckout', { token: AT, sale: { id: toCancel.id, store_id: chajo.id, items: [{ name: 'x', price: 100, qty: 1 }], payments: [{ method: 'Card', amount: 106 }] } })).ok === false, "a cancelled order can't be paid");
await data('posKitchenSet', { token: AT, id: s1.id, status: 'done' });
ok(!(await data('posKitchen', { token: AT, storeId: chajo.id })).some((k) => k.id === s1.id), 'collected orders leave the kitchen screen');

console.log('Refunds');
j = await api('posRefund', { token: AT, id: s1.id, lines: [{ index: 1, qty: 1 }], method: 'Cash', reason: 'Wrong item', restock: true });
ok(j.ok === false && j.code === 'NEED_MANAGER', "a cashier's refund needs a manager", j);
j = await api('posRefund', { token: AT, id: s1.id, lines: [{ index: 1, qty: 1 }], method: 'Cash', reason: 'Wrong item', restock: true, approver: { name: 'Mei Ling', passcode: '000000' } });
ok(j.ok === false && j.code === 'NEED_MANAGER', 'wrong manager passcode refused');
let r1 = await data('posRefund', { token: AT, id: s1.id, lines: [{ index: 1, qty: 1 }], method: 'Cash', reason: 'Wrong item', restock: true, approver: { name: 'mei ling', passcode: '333444' } });
// water 2.50 + SST 0.15 = 2.65 → cash 2.65
ok(r1.status === 'partially_refunded' && r1.refunds[0].amount === 265 && r1.refunds[0].approved_by === 'Mei Ling' && r1.refunds[0].by === 'Aina', 'part refund approved by Mei (RM 2.65 cash)', r1.refunds);
ok((await data('posCatalog', { token: AT, storeId: chajo.id })).products.find((p) => p.id === water.id).stock === 18, 'refunded water put back in stock (24 − 7 sold + 1)');
ok((await api('posRefund', { token: MT, id: s1.id, lines: [{ index: 1, qty: 1 }], method: 'Cash', reason: 'Again' })).ok === false, "can't refund more than was bought");
r1 = await data('posRefund', { token: MT, id: s1.id, lines: [{ index: 0, qty: 2 }], method: 'Cash', reason: 'Customer changed mind' });
ok(r1.status === 'refunded' && r1.refunds[0].amount + r1.refunds[1].amount === 2895 && r1.refunded === 2895, 'rest refunded: altogether exactly what was paid (RM 28.95)', r1.refunds.map((x) => x.amount));
const r4 = await data('posRefund', { token: MT, id: s4.id, lines: [{ index: 0, qty: 2 }, { index: 1, qty: 1 }], method: 'Card', reason: 'Spilt' });
profile = await data('posCustomer', { token: MT, id: cust.id, storeId: chajo.id });
ok(r4.status === 'refunded' && r4.refunds[0].cashback_reversed === 144 && profile.cashback === 0 && profile.spent === 2894, 'refund takes back the cashback earned (never below 0)', { refunds: r4.refunds, cb: profile.cashback });

console.log('Shift: pay in / pay out / close');
shift = await data('posCashMove', { token: AT, shiftId: shift.id, move: { type: 'in', amount: 5000, reason: 'Top up change' } });
shift = await data('posCashMove', { token: AT, shiftId: shift.id, move: { type: 'out', amount: 1250, reason: 'Buy supplies', note: 'Ice' } });
const t = shift.totals;
// float 200 + cash in sales (28.95 + 16.05) − cash refunds (2.65 + 26.30) + pay in 50 − pay out 12.50
ok(t.cashSales === 4500 && t.cashRefunds === 2895 && t.payIn === 5000 && t.payOut === 1250 && t.expected === 20000 + 4500 - 2895 + 5000 - 1250, 'drawer: float + cash sales − cash refunds + pay in − pay out', t);
ok(t.salesCount === 6 && t.methods.find((m) => m.method === 'Card').sales === 1000 + 2894 + 2894 + 2750, 'sales by payment method', t.methods);
ok((await api('posShifts', { token: AT, storeId: chajo.id })).ok === false, 'cashiers can\'t see past shift reports');
const closed = await data('posCloseShift', { token: AT, shiftId: shift.id, counted: t.expected - 50, note: 'Short 50 sen' });
ok(closed.status === 'closed' && closed.summary.difference === -50 && closed.closed_by === 'Aina' && closed.counted === t.expected - 50, 'closed: counted RM 0.50 short', closed.summary);
ok((await api('posCloseShift', { token: AT, shiftId: shift.id, counted: 0 })).ok === false, "can't close it twice");
const past = await data('posShifts', { token: MT, storeId: chajo.id });
ok(past.length === 1 && past[0].summary.expected === t.expected, 'manager sees the closed shift report');
ok((await api('posRefund', { token: MT, id: s3.id, lines: [{ index: 1, qty: 1 }], method: 'Cash', reason: 'x' })).code === 'NO_SHIFT', 'refunds need an open shift');

console.log('Stock');
let w = await data('posStockAdjust', { token: MT, productId: water.id, mode: 'add', qty: 24, note: 'Supplier delivery' });
ok(w.stock === 42, 'stock received (+24)');
w = await data('posStockAdjust', { token: MT, productId: water.id, mode: 'set', qty: 40 });
ok(w.stock === 40, 'stock count sets the number');
const moves = await data('posStockMoves', { token: MT, storeId: chajo.id, productId: water.id });
ok(moves[0].reason === 'count' && moves[0].qty_change === -2 && moves[0].stock_after === 40 && moves.some((m) => m.reason === 'sale') && moves.some((m) => m.reason === 'refund'), 'stock history: sales, refunds, deliveries, counts', moves.map((m) => [m.reason, m.qty_change, m.stock_after]));

console.log('Reports');
const rep = await data('posReport', { token: T, storeId: chajo.id, from: today, to: today });
const sold = [s1, t1.data, s3, s4, s5, paidOpen];
const soldNet = sold.reduce((x, s) => x + s.items.reduce((a, l) => a + l.net, 0), 0);
const refundedNet = 250 + 2480 + (2480 + 250);
ok(rep.totals.sales === 6 && rep.totals.net === soldNet - refundedNet, 'net sales = sold − refunded (after discounts)', { got: rep.totals, soldNet, refundedNet });
const paidIn = sold.reduce((x, s) => x + s.total + s.rounding, 0);
ok(rep.totals.collected === paidIn - 2895 - 2894 && rep.totals.refunds === 2895 + 2894, 'collected = payments − refunds paid out', rep.totals);
ok(rep.methods.find((m) => m.method === 'Cashback').net === 144 && rep.totals.cashbackEarned === 144 + 137, 'cashback shows as a payment method + cashback given');
ok(rep.products[0].name === 'Brown Sugar Boba' && rep.categories.find((c) => c.name === 'Milk tea') && rep.days.length === 1 && rep.hours.length === 24, 'top products, categories, by day and hour', rep.products);
ok(rep.cashiers.find((c) => c.name === 'Aina').sales === 5 && rep.cashiers.find((c) => c.name === 'Mei Ling').sales === 1, 'sales by cashier');
const all = await data('posReport', { token: T, from: today, to: today });
ok(all.stores.length === 1 && all.stores[0].name === 'Chajo SS15', 'all stores report');
ok((await api('posReport', { token: MT, storeId: walnut.id, from: today, to: today })).ok === false, 'managers only see their stores');

console.log('Import & copy menu');
const imp = await data('posImport', { token: T, storeId: walnut.id, rows: [
  { name: 'Walnut Brownie', category: 'Cakes', price: 850, cost: 300, stock: 30 },
  { name: 'Banana Loaf', category: 'Breads', price: 1200 },
  { name: 'Bad row', price: 'abc' },
  { name: 'walnut brownie', category: 'Cakes', price: 1 } ] });
ok(imp.added === 2 && imp.skipped === 2 && imp.catalog.categories.length === 2 && imp.catalog.products.find((p) => p.name === 'Walnut Brownie').track_stock, 'products imported from a spreadsheet', imp);
const cp = await data('posCopyMenu', { token: T, fromId: chajo.id, toId: chajo2.id });
const c2 = cp.catalog;
ok(cp.added === 2 && c2.modifiers.length === 2 && c2.products.find((p) => p.name === 'Brown Sugar Boba').modifier_ids.every((id) => c2.modifiers.some((m) => m.id === id)), 'menu copied to Chajo Subang with its modifier groups');
ok((await data('posCopyMenu', { token: T, fromId: chajo.id, toId: chajo2.id })).added === 0, 'copying again skips what is already there');
const delMod = await data('posDeleteItem', { token: T, kind: 'modifier', id: tops.id });
ok(!delMod.products.find((p) => p.id === boba.id).modifier_ids.includes(tops.id), 'deleting a modifier group takes it off the products');

console.log('Access changes');
team = await data('posTeamSet', { token: T, id: AINA.id, patch: { pos: null } });
ok((await api('posMe', { token: AT })).code === 'POS_AUTH' && team.find((x) => x.id === AINA.id).posOnly === false, 'POS role removed: straight out of the POS (and back to Print Hub access)');
ok((await api('posTeamSet', { token: MT, id: AINA.id, patch: { pos: 'manager' } })).ok === false, 'only owners give POS roles');

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
