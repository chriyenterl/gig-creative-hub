// Push notifications end to end: the Worker (wrangler dev) sends real Web Push requests to a stand-in
// push service here, and this script decrypts them exactly like a phone would (RFC 8291) and checks
// the VAPID signature (RFC 8292). See run.sh.
import http from 'node:http';
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const PORT = 9911;
let pass = 0, failN = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('  ✓', label); } else { failN++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const api = async (action, args = {}) => (await fetch(BASE + '/api', { method: 'POST', body: JSON.stringify({ action, ...args }) })).json();
const data = async (action, args) => { const j = await api(action, args); if (!j.ok) throw new Error(action + ': ' + j.error); return j.data; };
const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const enc = new TextEncoder();
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const hmac = async (k, d) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), d));

// ── stand-in push service ──
const received = [];
const gone = new Set();
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({ path: req.url, headers: req.headers, body: new Uint8Array(Buffer.concat(chunks)) });
    res.statusCode = gone.has(req.url) ? 410 : 201;
    res.end();
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// A "phone": its own key pair + auth secret, like PushManager.subscribe() makes.
async function makeDevice(name) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { kp, pub, auth, sub: { endpoint: `http://127.0.0.1:${PORT}/push/${name}`, keys: { p256dh: b64u(pub), auth: b64u(auth) } } };
}

async function decrypt(dev, body) {
  const salt = body.slice(0, 16), idlen = body[20], asPublic = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, dev.kp.privateKey, 256));
  const prkKey = await hmac(dev.auth, shared);
  const ikm = (await hmac(prkKey, cat(enc.encode('WebPush: info\0'), dev.pub, asPublic, new Uint8Array([1])))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
  if (plain[plain.length - 1] !== 2) throw new Error('bad padding delimiter');
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

async function vapidValid(headers, pushKey) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(headers.authorization || '');
  if (!m) return false;
  const [h, c, sig] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  const key = await crypto.subtle.importKey('raw', unb64u(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64u(sig), enc.encode(h + '.' + c));
  return good && m[2] === pushKey && claims.aud === `http://127.0.0.1:${PORT}` && claims.exp > Date.now() / 1000 && /^https?:|^mailto:/.test(claims.sub);
}
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };

console.log('Setup');
await data('setupAdmin', { email: 'owner@example.test', name: 'Owner', password: 'push-test-pass' });
const T = (await data('login', { email: 'owner@example.test', password: 'push-test-pass' })).token;
const me = await data('printMe', { token: T });
ok(typeof me.pushKey === 'string' && unb64u(me.pushKey).length === 65, 'server shares its public push key');
const ali = (await data('printStaffAdd', { token: T, name: 'Ali' }))[0];
ok((await data('printMe', { printKey: ali.key })).pushKey === me.pushKey, 'team links get the same key');

console.log('Subscribe & test notification');
const phoneAli = await makeDevice('ali'), phoneOwner = await makeDevice('owner'), phoneOld = await makeDevice('old');
ok((await api('printPushSubscribe', { printKey: 'wrong', subscription: phoneAli.sub })).code === 'PRINT_AUTH', 'needs a valid link');
ok((await api('printPushSubscribe', { printKey: ali.key, subscription: { endpoint: 'ftp://x', keys: phoneAli.sub.keys } })).ok === false, 'bad endpoint refused');
ok((await api('printPushSubscribe', { printKey: ali.key, subscription: { endpoint: phoneAli.sub.endpoint, keys: { p256dh: 'x', auth: 'y' } } })).ok === false, 'bad keys refused');
await data('printPushSubscribe', { printKey: ali.key, subscription: phoneAli.sub, device: 'iPhone' });
await data('printPushSubscribe', { token: T, subscription: phoneOwner.sub, device: 'Android phone' });
await data('printPushSubscribe', { token: T, subscription: phoneOld.sub });
await data('printPushSubscribe', { printKey: ali.key, subscription: phoneAli.sub, device: 'iPhone' }); // again: no duplicate
const devs = (await data('printMe', { token: T })).devices;
ok(devs.length === 3 && devs.some((d) => d.who === 'Ali' && d.device === 'iPhone') && devs.some((d) => d.who === 'Owner' && d.device === 'Android phone'), 'master sees who gets alerts, on which device', devs);
const t = await data('printPushTest', { printKey: ali.key, endpoint: phoneAli.sub.endpoint });
ok(t.ok === true, 'test notification accepted by the push service', t);
const tr = received.find((r) => r.path === '/push/ali');
ok(tr && tr.headers['content-encoding'] === 'aes128gcm' && tr.headers.ttl && tr.headers.urgency === 'high', 'sent with Web Push headers', tr?.headers);
ok(tr && await vapidValid(tr.headers, me.pushKey), 'VAPID signature checks out');
const tp = tr && await decrypt(phoneAli, tr.body);
ok(tp?.title === 'New-order alerts are on', 'phone decrypts the test message', tp);

console.log('New order → everyone gets a notification');
received.length = 0;
gone.add('/push/old'); // this phone removed the app
const due = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
const answers = { q_name: 'Jason Lim', q_company: 'Noms', q_phone: '0123456789', q_item: 'Flyers', q_qty: '500', q_size: 'A5', q_lamination: 'No', q_design: 'No', q_design_brief: 'Red and gold', q_due: due };
const o = await data('printSubmit', { orderKey: me.settings.orderKey, answers, files: {} });
ok(!!(await waitFor(() => (received.length >= 3 ? received : null))), 'three devices were sent the new order', received.map((r) => r.path));
const forAli = received.find((r) => r.path === '/push/ali'), forOwner = received.find((r) => r.path === '/push/owner');
const pa = forAli && await decrypt(phoneAli, forAli.body), po = forOwner && await decrypt(phoneOwner, forOwner.body);
ok(pa?.title === `New order ${o.order_no}` && /Jason Lim \(Noms\) — Flyers × 500 — due/.test(pa.body) && !!pa.orderId, "Ali's phone shows the order", pa);
ok(po?.title === pa?.title && po?.orderId === pa?.orderId, "owner's phone shows it too");
ok(typeof pa?.at === 'number', 'notification carries the order time');
ok(typeof pa?.badge === 'number' && pa.badge >= 1, 'it carries the number for the app icon', pa?.badge);
received.length = 0;
await data('printAddOrder', { printKey: ali.key, answers: { q_name: 'Phone Customer', q_item: 'Flyers' } });
await waitFor(() => (received.some((r) => r.path === '/push/owner') ? received : null));
await new Promise((r) => setTimeout(r, 800));
ok(received.some((r) => r.path === '/push/owner') && !received.some((r) => r.path === '/push/ali'), "Ali adds an order: the owner is alerted, Ali's own phone isn't", received.map((r) => r.path));
ok(!(await data('printOrders', { token: T }))[0].history.some((h) => h.event === 'push'), 'order history stays clean');

console.log('Access changes stop alerts');
received.length = 0;
await data('printSubmit', { orderKey: me.settings.orderKey, answers, files: {} });
await waitFor(() => (received.length >= 2 ? received : null));
ok(!received.some((r) => r.path === '/push/old'), "a phone that removed the app isn't messaged again");
received.length = 0;
await data('printStaffUpdate', { token: T, id: ali.id, patch: { active: false } });
await data('printSubmit', { orderKey: me.settings.orderKey, answers, files: {} });
await waitFor(() => (received.length >= 1 ? received : null)); await new Promise((r) => setTimeout(r, 800));
ok(received.length === 1 && received[0].path === '/push/owner', "turned-off link: Ali's phone is paused", received.map((r) => r.path));
received.length = 0;
await data('printStaffUpdate', { token: T, id: ali.id, patch: { active: true } });
await data('printSubmit', { orderKey: me.settings.orderKey, answers, files: {} });
await waitFor(() => (received.length >= 2 ? received : null));
ok(received.some((r) => r.path === '/push/ali'), "turned back on: Ali's phone gets alerts again");
received.length = 0;
await data('printStaffRegenerate', { token: T, id: ali.id });
await data('printSubmit', { orderKey: me.settings.orderKey, answers, files: {} });
await waitFor(() => (received.length >= 1 ? received : null)); await new Promise((r) => setTimeout(r, 800));
ok(!received.some((r) => r.path === '/push/ali'), 'changed link: the old phone stops getting alerts', received.map((r) => r.path));

console.log('Link with Creative Hub access');
const zara = (await data('printStaffAdd', { token: T, name: 'Zara', hub: true })).find((x) => x.name === 'Zara');
const ZT = (await data('linkLogin', { linkKey: zara.key })).token;
const phoneZara = await makeDevice('zara');
await data('printPushSubscribe', { token: ZT, subscription: phoneZara.sub, device: 'iPhone' });
received.length = 0;
await data('printSubmit', { orderKey: me.settings.orderKey, answers, files: {} });
await waitFor(() => (received.some((r) => r.path === '/push/zara') ? received : null));
ok(received.some((r) => r.path === '/push/zara'), 'Zara (signed in via the Creative Hub) gets alerts');
await data('printStaffUpdate', { token: T, id: zara.id, patch: { active: false } });
received.length = 0;
await data('printSubmit', { orderKey: me.settings.orderKey, answers, files: {} });
await new Promise((r) => setTimeout(r, 1500));
ok(!received.some((r) => r.path === '/push/zara'), 'her link turned off: alerts pause');
const before = (await data('printMe', { token: T })).devices.length;
const zdev = (await data('printMe', { token: T })).devices.find((d) => d.who === 'Zara');
const after = await data('printPushRemove', { token: T, id: zdev.id });
ok(after.length === before - 1 && !after.some((d) => d.who === 'Zara'), 'master can stop alerts on a device');

console.log('Join requests alert the owner');
received.length = 0;
const S = (await data('printMe', { token: T })).settings;
await data('joinRequest', { joinKey: S.joinKey, name: 'New Person', passcode: '123456', email: 'new@example.test' });
await waitFor(() => (received.some((r) => r.path === '/push/owner') ? received : null));
const jp = received.find((r) => r.path === '/push/owner');
const jd = jp && await decrypt(phoneOwner, jp.body);
ok(jd?.title === 'New Person wants to join' && !received.some((r) => r.path === '/push/ali'), 'only owners hear "… wants to join"', jd);

console.log('Unsubscribe');
received.length = 0;
await data('printPushUnsubscribe', { token: T, endpoint: phoneOwner.sub.endpoint });
await data('printSubmit', { orderKey: me.settings.orderKey, answers, files: {} });
await new Promise((r) => setTimeout(r, 1500));
ok(received.length === 0, 'turning alerts off stops them', received.map((r) => r.path));

server.close();
console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
