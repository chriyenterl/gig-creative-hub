// Webstore tests for cloudflare/worker.js — run against `wrangler dev` (local D1 + R2). See run.sh.
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
let pass = 0, failN = 0;
const ok = (cond, label, extra) => { if (cond) { pass++; console.log('  ✓', label); } else { failN++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };

async function api(action, args = {}) {
  const r = await fetch(BASE + '/api', { method: 'POST', body: JSON.stringify({ action, ...args }) });
  return r.json();
}
async function data(action, args) {
  const j = await api(action, args);
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
}
async function upload(start, args, bytes, type, name) {
  const { uploadUrl } = await data(start, { ...args, name, mimeType: type, size: bytes.length });
  const r = await (await fetch(uploadUrl, { method: 'PUT', body: bytes })).json();
  if (!r.ok) throw new Error('put: ' + r.error);
  return r.data.fileId;
}
const fileUrl = (key) => `${BASE}/f/${key.split('/').map(encodeURIComponent).join('/')}`;
const bytes = (n) => crypto.getRandomValues(new Uint8Array(n));
// Tomorrow in the store's time zone (Malaysia) — always bookable with the hours set below.
const tomorrow = (() => {
  const d = new Date(Date.now() + 8 * 3600e3 + 86400e3);
  return d.toISOString().slice(0, 10);
})();

console.log('Setup');
const admin = await data('setupAdmin', { email: 'owner@example.com', name: 'Owner', password: 'correct-horse' });
const T = admin.token;

console.log('Store info (no login)');
let info = await data('shopInfo');
ok(info.settings.name === 'Noms' && info.settings.open === true && info.products.length === 0, 'a fresh store has default settings and no products', info.settings);
ok(info.settings.messages === undefined, "the team's WhatsApp templates aren't sent to customers");
ok((await api('shopAdmin', {})).code === 'AUTH', 'the webstore admin needs a login');

console.log('Settings');
let st = (await data('shopAdmin', { token: T })).settings;
ok(st.messages && st.hours.length === 7 && st.owner === undefined, 'admin gets the full settings');
ok((await api('shopSaveSettings', { token: T, settings: { delivery: { enabled: false }, pickup: { enabled: false } } })).ok === false, 'delivery and pickup can’t both be off');
ok((await api('shopSaveSettings', { token: T, settings: { payments: { duitnow: { enabled: false }, bank: { enabled: false }, cash: { enabled: false } } } })).ok === false, 'at least one way to pay is needed');
ok((await api('shopSaveSettings', { token: T, settings: { payments: { bank: { enabled: true } } } })).ok === false, 'bank transfer needs an account number');
ok((await api('shopSaveSettings', { token: T, settings: { accent: 'red; x' } })).ok === false, 'brand colour must be a colour code');
ok((await api('shopSaveSettings', { token: T, settings: { hours: [{ open: '18:00', close: '09:00' }] } })).ok === false, 'closing must be after opening');
st = await data('shopSaveSettings', { token: T, settings: {
  name: '  Noms Sabah ', instagram: 'https://instagram.com/noms.sabah/', accent: '#7a3e1d',
  hours: Array.from({ length: 7 }, () => ({ open: '00:00', close: '23:30', closed: false })), leadMinutes: 0, slotMinutes: 30, daysAhead: 5,
  delivery: { enabled: true, fee: 8, freeOver: 100, minOrder: 20, note: 'Within KK' },
  payments: { duitnow: { enabled: true }, bank: { enabled: true, bank: 'Maybank', account_name: 'Noms Sdn Bhd', account_no: '5123 4567 8901' }, cash: { enabled: false } },
  categories: ['Cookies', 'Cookies', '  Boxes '], messages: { confirmed: '' },
} });
ok(st.name === 'Noms Sabah' && st.instagram === 'noms.sabah' && st.categories.join() === 'Cookies,Boxes', 'settings are tidied (name, Instagram handle, categories)', st);
ok(st.messages.confirmed.includes('{order_no}'), 'an empty message goes back to the default');
ok(st.payments.bank.account_no === '5123 4567 8901' && st.payments.cash.enabled === false, 'payment settings saved');

console.log('Products & photos');
ok((await api('shopImageUpload', { token: T, name: 'x.html', mimeType: 'text/html', size: 10 })).ok === false, 'only photos can be uploaded for products');
const img = await upload('shopImageUpload', { token: T }, bytes(2000), 'image/jpeg', 'cookie.jpg');
ok(img.startsWith('shop/images/'), 'product photo stored under shop/images/', img);
ok((await api('shopSaveProduct', { token: T, product: { name: '', price: 5 } })).ok === false, 'a product needs a name');
ok((await api('shopSaveProduct', { token: T, product: { name: 'X', price: -1 } })).ok === false, 'a price can’t be negative');
ok((await api('shopSaveProduct', { token: T, product: { name: 'X', price: 5, options: [{ name: 'Size', choices: [] }] } })).ok === false, 'an option group needs choices');
ok((await api('shopSaveProduct', { token: T, product: { name: 'X', price: 5, image_path: 'final/abc/x.jpg' } })).ok === false, 'the photo must be a webstore upload');
const box = await data('shopSaveProduct', { token: T, product: {
  name: 'Mixed Cookie Box', category: 'Boxes', price: 30, compare_price: 25, image_path: img, badge: 'Best seller',
  options: [
    { id: 'size', name: 'Box size', min: 1, max: 1, choices: [{ id: 'b4', name: 'Box of 4', price: 0 }, { id: 'b6', name: 'Box of 6', price: 14 }] },
    { id: 'add', name: 'Add-ons', min: 0, max: 5, choices: [{ id: 'card', name: 'Card', price: 5 }, { id: 'card', name: 'Ribbon', price: '1.5' }] },
  ] } });
ok(box.id && box.price === 30 && box.compare_price === null, 'product saved (an "original price" lower than the price is dropped)', box);
ok(box.options[1].max === 2 && box.options[1].choices[1].id !== 'card' && box.options[1].choices[1].price === 1.5, 'options tidied: max ≤ choices, unique choice ids, prices as numbers', box.options);
const chip = await data('shopSaveProduct', { token: T, product: { name: 'Chocolate Chip', category: 'Cookies', price: 7.9 } });
const gone = await data('shopSaveProduct', { token: T, product: { name: 'Secret menu', price: 5, is_hidden: true } });
const soldOut = await data('shopSaveProduct', { token: T, product: { name: 'Red Velvet', price: 9.9, is_available: false } });
ok(chip.sort_order > box.sort_order, 'new products go to the end');
info = await data('shopInfo');
ok(info.products.length === 3 && !info.products.some((p) => p.id === gone.id), 'hidden products are not shown to customers');
const sorted = await data('shopSortProducts', { token: T, ids: [chip.id, box.id] });
ok(sorted[0].id === chip.id && sorted[1].id === box.id, 'products can be re-ordered');

console.log('Placing orders');
const order = (extra = {}) => ({
  fulfilment: 'pickup', slot_date: tomorrow, slot_time: '12:00', customer_name: 'Aina Rahman', phone: '012-345 6789',
  items: [{ product_id: box.id, qty: 2, choices: { size: ['b6'], add: ['card'] }, note: 'Happy birthday!' }, { product_id: chip.id, qty: 3 }],
  payment_method: 'duitnow', ...extra,
});
let j = await api('shopPlaceOrder', order({ items: [{ product_id: box.id, qty: 1, choices: {} }] }));
ok(!j.ok && j.code === 'CART' && /box size/i.test(j.error), 'a required option must be chosen', j);
ok((await api('shopPlaceOrder', order({ items: [{ product_id: soldOut.id, qty: 1 }] }))).code === 'CART', 'sold-out products can’t be ordered');
ok((await api('shopPlaceOrder', order({ items: [{ product_id: gone.id, qty: 1 }] }))).code === 'CART', 'hidden products can’t be ordered');
ok((await api('shopPlaceOrder', order({ items: [{ product_id: chip.id, qty: 0 }] }))).code === 'CART', 'quantity must be at least 1');
ok((await api('shopPlaceOrder', order({ slot_time: '23:45' }))).code === 'SLOT', 'only offered times can be chosen');
ok((await api('shopPlaceOrder', order({ slot_date: '2020-01-01' }))).code === 'SLOT', 'past dates are refused');
ok((await api('shopPlaceOrder', order({ phone: '123' }))).ok === false, 'a phone number is needed');
ok((await api('shopPlaceOrder', order({ payment_method: 'cash' }))).ok === false, 'a payment method that is turned off is refused');
ok((await api('shopPlaceOrder', order({ fulfilment: 'delivery' }))).ok === false, 'delivery needs an address');
j = await api('shopPlaceOrder', order({ fulfilment: 'delivery', address: '12 Jalan Gaya, Kota Kinabalu', items: [{ product_id: chip.id, qty: 1 }] }));
ok(j.code === 'MIN', 'delivery has a minimum order', j);
j = await api('shopPlaceOrder', order({ expectedTotal: 10 }));
ok(j.code === 'PRICE_CHANGED', 'a total that doesn’t match the menu is refused', j);
const o1 = await data('shopPlaceOrder', order({ expectedTotal: 2 * (30 + 14 + 5) + 3 * 7.9, unit_price: 0.01, total: 0.01 }));
ok(o1.order_no === 'W-1001' && o1.total === 121.7 && o1.subtotal === 121.7 && o1.delivery_fee === 0, 'order priced by the server (2 × RM 49 + 3 × RM 7.90)', o1);
ok(o1.items[0].options.map((x) => x.choice).join() === 'Box of 6,Card' && o1.items[0].note === 'Happy birthday!', 'chosen options and the note are kept', o1.items[0]);
ok(o1.status === 'new' && o1.payment_status === 'unpaid' && o1.secret && o1.internal_notes === undefined, 'new, unpaid, with a private link and no team notes');
const o2 = await data('shopPlaceOrder', order({ fulfilment: 'delivery', address: '12 Jalan Gaya, Kota Kinabalu', items: [{ product_id: chip.id, qty: 3 }], payment_method: 'bank' }));
ok(o2.order_no === 'W-1002' && o2.delivery_fee === 8 && o2.total === 31.7, 'delivery fee added (RM 23.70 + RM 8)', o2);
const o3 = await data('shopPlaceOrder', order({ fulfilment: 'delivery', address: '12 Jalan Gaya, Kota Kinabalu' }));
ok(o3.delivery_fee === 0, 'free delivery over RM 100');

console.log('Order page & receipts (customer)');
ok((await data('shopOrder', { ref: o1.id + '.' + o1.secret })).order_no === 'W-1001', 'customer opens their order with the private link');
ok((await api('shopOrder', { ref: o1.id + '.wrong' })).code === 'NOT_FOUND', 'a wrong link shows nothing');
ok((await api('shopReceiptUpload', { name: 'r.html', mimeType: 'text/html', size: 10 })).ok === false, 'only photos / PDFs as receipts');
const rc = await upload('shopReceiptUpload', {}, bytes(5000), 'application/pdf', 'receipt.pdf');
ok(rc.startsWith('shop/receipts/'), 'receipt stored under shop/receipts/');
ok((await api('shopAttachReceipt', { ref: o1.id + '.nope', receipt: rc })).ok === false, 'a receipt needs the private link');
const withRc = await data('shopAttachReceipt', { ref: o1.id + '.' + o1.secret, receipt: rc });
ok(withRc.payment_status === 'submitted' && withRc.has_receipt === true, 'receipt attached → “Receipt sent”');
ok((await api('shopAttachReceipt', { ref: o2.id + '.' + o2.secret, receipt: rc })).ok === false, 'one receipt can’t be used for two orders');
const rc2 = await upload('shopReceiptUpload', {}, bytes(3000), 'image/png', 'pay.png');
const o4 = await data('shopPlaceOrder', order({ receipt: rc2 }));
ok(o4.payment_status === 'submitted', 'a receipt can be attached at checkout');

console.log('Running orders (team)');
let admin2 = await data('shopAdmin', { token: T });
ok(admin2.orders.length === 4 && admin2.orders[0].order_no === 'W-1004' && admin2.owner === true, 'team sees every order, newest first');
let up = await data('shopUpdateOrder', { token: T, id: o1.id, patch: { status: 'preparing' } });
up = await data('shopUpdateOrder', { token: T, id: o1.id, patch: { payment_status: 'paid', internal_notes: 'Paid via DuitNow', whatsapp: 'confirmed' } });
ok(up.status === 'preparing' && up.payment_status === 'paid' && up.internal_notes === 'Paid via DuitNow', 'status, payment and notes updated');
ok(up.history.map((h) => h.status || h.event).join() === 'new,receipt,preparing,payment,whatsapp' && up.history[2].by === 'Owner', 'each change is in the history', up.history);
ok((await api('shopUpdateOrder', { token: T, id: o1.id, patch: { status: 'shipped' } })).ok === false, 'unknown status refused');
const seen = await data('shopOrder', { ref: o1.id + '.' + o1.secret });
ok(seen.status === 'preparing' && seen.times.preparing && seen.internal_notes === undefined, 'customer sees the new status (not the notes)');
const rc3 = await upload('shopReceiptUpload', {}, bytes(1000), 'image/jpeg', 'late.jpg');
j = await api('shopAttachReceipt', { ref: o1.id + '.' + o1.secret, receipt: rc3 });
ok(!j.ok && /already paid/.test(j.error), 'no new receipt once paid', j);

console.log('Clean-up');
await data('shopDeleteOrder', { token: T, id: o1.id });
ok((await fetch(fileUrl(rc))).status === 404, 'deleting an order deletes its receipt');
await data('shopDeleteProduct', { token: T, id: box.id });
ok((await fetch(fileUrl(img))).status === 404, 'deleting a product deletes its photo');
const logo = await upload('shopImageUpload', { token: T }, bytes(1000), 'image/png', 'logo.png');
await data('shopSaveSettings', { token: T, settings: { logo_path: logo } });
const logo2 = await upload('shopImageUpload', { token: T }, bytes(1000), 'image/png', 'logo2.png');
st = await data('shopSaveSettings', { token: T, settings: { logo_path: logo2 } });
ok(st.logo_path === logo2 && (await fetch(fileUrl(logo))).status === 404, 'a replaced logo is deleted');

console.log('Closed store');
await data('shopSaveSettings', { token: T, settings: { open: false, closedMessage: 'Back on Monday!' } });
j = await api('shopPlaceOrder', order());
ok(j.code === 'SHOP_CLOSED' && j.error === 'Back on Monday!', 'no orders while the store is closed', j);

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
