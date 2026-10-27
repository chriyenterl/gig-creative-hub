// Print Hub production steps: posters with lamination go Printing → waiting for lamination → Completed,
// stickers go Printing → waiting for cutting → Completed. See run.sh.
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
let pass = 0, failN = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('  ✓', label); } else { failN++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const api = async (action, args = {}) => (await fetch(BASE + '/api', { method: 'POST', body: JSON.stringify({ action, ...args }) })).json();
const data = async (action, args) => { const j = await api(action, args); if (!j.ok) throw new Error(action + ': ' + j.error); return j.data; };
const ids = (o) => (o.steps || []).map((x) => x.id + (x.at ? '✓' : '')).join(',');

await data('setupAdmin', { email: 'owner@example.test', name: 'Owner', password: 'steps-test-pass' });
const T = (await data('login', { email: 'owner@example.test', password: 'steps-test-pass' })).token;
const S = (await data('printMe', { token: T })).settings;
const M = S.masterKey;
const due = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
const base = { q_name: 'Siti', q_phone: '012-555 0199', q_qty: '20', q_size: 'A2', q_paper: 'Normal paper', q_design: 'No', q_design_brief: 'Raya poster', q_due: due };
const place = async (answers) => {
  const { order_no } = await data('printSubmit', { orderKey: S.orderKey, answers: { ...base, ...answers }, files: {} });
  return (await data('printOrders', { printKey: M })).find((o) => o.order_no === order_no);
};
const update = (o, patch) => data('printUpdate', { printKey: M, id: o.id, patch });

console.log('Which orders get steps');
let poster = await place({ q_item: 'Posters', q_lamination: 'Yes' });
ok(ids(poster) === 'print,laminate' && poster.status === 'new', 'poster with lamination: print → laminate', poster.steps);
let sticker = await place({ q_item: 'Stickers / labels' });
ok(ids(sticker) === 'print,cut', 'stickers: print → cut', sticker.steps);
let flyer = await place({ q_item: 'Flyers', q_lamination: 'No' });
ok(flyer.steps === null, 'flyers without lamination: no extra steps (New → Pending → Completed as before)', flyer.steps);
const walkIn = await data('printAddOrder', { printKey: M, answers: { q_name: 'Walk-in', q_item: 'Posters', q_lamination: 'Yes' } });
ok(ids(walkIn) === 'print,laminate', 'orders the team adds get steps too');

console.log('Poster: printed → laminated → completed');
poster = await update(poster, { step: 'print' });
ok(poster.status === 'pending' && ids(poster) === 'print✓,laminate' && poster.steps[0].by === 'Master', 'printed: moves to Pending, waiting for lamination', poster);
ok(poster.history.some((h) => h.event === 'step' && h.step === 'print') && poster.history.some((h) => h.status === 'pending'), 'history shows "Printed"');
poster = await update(poster, { step: 'laminate' });
ok(poster.status === 'completed' && ids(poster) === 'print✓,laminate✓', 'laminated: the last step completes the order');
poster = await update(poster, { step: 'laminate', done: false });
ok(poster.status === 'pending' && ids(poster) === 'print✓,laminate', 'un-ticking lamination puts it back to waiting for lamination');
ok((await api('printUpdate', { printKey: M, id: poster.id, patch: { step: 'cut' } })).ok === false, "a step the order doesn't have is refused");

console.log('Stickers: moving the status by hand keeps the steps in line');
sticker = await update(sticker, { status: 'pending' });
ok(sticker.status === 'pending' && ids(sticker) === 'print,cut', 'started: printing');
sticker = await update(sticker, { status: 'completed' });
ok(ids(sticker) === 'print✓,cut✓', 'marked completed by hand: every step ticked');
sticker = await update(sticker, { status: 'pending' });
ok(ids(sticker) === 'print✓,cut', 'back to pending: waiting for cutting again');
sticker = await update(sticker, { status: 'new' });
ok(ids(sticker) === 'print,cut', 'back to new: nothing ticked');

console.log('Changing the steps on an order');
flyer = await update(flyer, { finishing: { laminate: true } });
ok(ids(flyer) === 'print,laminate', 'lamination added to the flyers');
flyer = await update(flyer, { step: 'print' });
flyer = await update(flyer, { finishing: { laminate: true, cut: true } });
ok(ids(flyer) === 'print✓,laminate,cut', 'cutting added — what was already ticked stays');
flyer = await update(flyer, { finishing: {} });
ok(flyer.steps === null && flyer.status === 'pending', 'all finishing removed: back to the plain flow');
ok(flyer.history.filter((h) => h.event === 'finishing').length === 3, 'each change is in the history');

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
