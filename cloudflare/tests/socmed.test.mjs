// Socmed Hub: the Worker reads a stand-in Buffer (BUFFER_API_URL) — channels, scheduled and sent posts —
// keeps the answer for a while, and never shows the API key to the website. See run.sh.
import http from 'node:http';
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
let pass = 0, failN = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('  ✓', label); } else { failN++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const api = async (action, args = {}) => (await fetch(BASE + '/api', { method: 'POST', body: JSON.stringify({ action, ...args }) })).json();
const data = async (action, args) => { const j = await api(action, args); if (!j.ok) throw new Error(action + ': ' + j.error); return j.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Stand-in Buffer ──
const KEY1 = 'buf_main_key_0000000000000001', KEY2 = 'buf_brands_key_000000000002';
const day = 864e5, at = (ms) => new Date(Date.now() + ms).toISOString();
const post = (id, channelId, channelService, status, dueAt, extra = {}) => ({
  id, channelId, channelService, status, dueAt, sentAt: null, text: 'Post ' + id, externalLink: null, schedulingType: 'automatic',
  error: null, assets: [], tags: [], author: { name: 'Owner' }, metadata: { type: 'post' }, ...extra,
});
const BUFFER = {
  [KEY1]: {
    account: { id: 'acc1', name: 'GIG Owner', email: 'owner@buffer.test', organizations: [{ id: 'org1', name: 'GIG Creatives' }] },
    org1: {
      channels: [
        { id: 'ch_ig', name: 'noms.my', displayName: 'Noms Malaysia', service: 'instagram', avatar: 'https://img.test/ig.png', type: 'business', externalLink: 'https://instagram.com/noms.my', isQueuePaused: false, isDisconnected: false, isLocked: false },
        { id: 'ch_fb', name: 'Noms', displayName: null, service: 'facebook', avatar: 'javascript:alert(1)', type: 'page', externalLink: null, isQueuePaused: false, isDisconnected: true, isLocked: false },
        { id: 'ch_tt', name: 'gigprints', displayName: 'GIG Prints', service: 'tiktok', avatar: 'https://img.test/tt.png', type: 'business', externalLink: null, isQueuePaused: true, isDisconnected: false, isLocked: false },
      ],
      upcoming: [
        post('p1', 'ch_ig', 'instagram', 'scheduled', at(day), { metadata: { type: 'reel' }, assets: [{ type: 'video', thumbnail: 'https://img.test/t1.jpg' }], tags: [{ name: 'Raya', color: '#ff0000' }] }),
        post('p2', 'ch_fb', 'facebook', 'error', at(-3600e3), { error: { message: 'Facebook needs you to reconnect.', supportUrl: 'https://support.buffer.com/x' } }),
      ],
      more: [post('p3', 'ch_tt', 'tiktok', 'scheduled', at(3 * day), { externalLink: 'javascript:alert(1)', schedulingType: 'notification', metadata: { type: 'post', title: 'Raya sale' } })],
      recent: [post('p4', 'ch_ig', 'instagram', 'sent', at(-2 * day), { sentAt: at(-2 * day), externalLink: 'https://instagram.com/p/abc' })],
    },
  },
  [KEY2]: {
    account: { id: 'acc2', name: 'Brands', email: 'brands@buffer.test', organizations: [{ id: 'orgA', name: 'Brand A' }, { id: 'orgB', name: 'Brand B' }] },
    orgA: { channels: [{ id: 'ch_yt', name: 'branda', displayName: 'Brand A', service: 'youtube', avatar: 'https://img.test/yt.png', type: 'channel', externalLink: null, isQueuePaused: false, isDisconnected: false, isLocked: false }], upcoming: [], more: [], recent: [] },
    orgB: { channels: [{ id: 'ch_th', name: 'brandb', displayName: 'Brand B', service: 'threads', avatar: 'https://img.test/th.png', type: 'profile', externalLink: null, isQueuePaused: false, isDisconnected: false, isLocked: false }], upcoming: [post('pb1', 'ch_th', 'threads', 'scheduled', at(2 * day))], more: [], recent: [] },
  },
};
const calls = [];
let mode = 'ok'; // 'revoked' | 'busy'
const server = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    const { query, variables = {} } = JSON.parse(b);
    const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const op = (/query (\w+)/.exec(query) || [])[1];
    calls.push({ key, op, variables });
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
    if (mode === 'busy') return send(429, { errors: [{ message: 'Too many requests' }] }, { 'Retry-After': '60' });
    const acct = mode === 'revoked' ? null : BUFFER[key];
    if (!acct) return send(401, { errors: [{ message: 'An authentication JWT or Access Token is required', extensions: { code: 'UNAUTHENTICATED' } }] });
    const page = (list, next) => ({ edges: list.map((node) => ({ node, cursor: node.id })), pageInfo: { hasNextPage: !!next, endCursor: next || null } });
    if (op === 'GigAccount') return send(200, { data: { account: acct.account } });
    const org = acct[variables.org];
    if (op === 'GigOverview') return send(200, { data: { channels: org.channels, upcoming: page(org.upcoming, org.more.length ? 'c1' : null), recent: page(org.recent) } });
    if (op === 'GigMore') return send(200, { data: { upcoming: page(variables.after === 'c1' ? org.more : []) } });
    send(400, { errors: [{ message: 'Unknown query' }] });
  });
});
await new Promise((r) => server.listen(9913, '127.0.0.1', r));

// ── People ──
await data('setupAdmin', { email: 'owner@example.test', name: 'Owner', password: 'socmed-test-pass' });
const T = (await data('login', { email: 'owner@example.test', password: 'socmed-test-pass' })).token;
const me = await data('printMe', { token: T });
const HUB = (await data('linkLogin', { linkKey: me.adminLinks.hub.key, asName: 'Kim' })).token;
await data('joinRequest', { joinKey: me.settings.joinKey, name: 'Pat', passcode: '246810', email: 'pat@example.test' });
const PAT = (await data('printMe', { token: T })).staff.find((x) => x.name === 'Pat');
await data('printStaffApprove', { token: T, id: PAT.id, hub: false });
const PT = (await data('passcodeLogin', { name: 'Pat', passcode: '246810' })).token;

console.log('Before Buffer is connected');
let o = await data('socmedOverview', { token: T });
ok(o.connected === false && o.channels.length === 0 && o.posts.length === 0, 'nothing connected yet');
ok((await data('socmedOverview', { token: HUB })).connected === false, 'the team (Creative Hub admin link) can open the Socmed Hub');
ok((await api('socmedOverview', { token: PT })).code === 'PRINT_ONLY', 'Print-Hub-only people cannot');
ok((await api('socmedOverview', {})).code === 'AUTH', 'signed-out visitors cannot');
ok((await api('socmedConnect', { token: HUB, apiKey: KEY1 })).ok === false && (await api('socmedSetup', { token: HUB })).ok === false, 'only owners connect Buffer');

console.log('Connecting');
ok(/doesn't look like/.test((await api('socmedConnect', { token: T, apiKey: 'short' })).error), 'too-short key refused before asking Buffer');
let j = await api('socmedConnect', { token: T, apiKey: 'buf_wrong_key_000000000000' });
ok(j.ok === false && /didn't accept that key/.test(j.error), 'a wrong key: clear message', j.error);
let setup = await data('socmedConnect', { token: T, label: ' Main  Buffer ', apiKey: '  ' + KEY1 + ' ' });
ok(setup.accounts.length === 1 && setup.accounts[0].label === 'Main Buffer' && setup.accounts[0].name === 'GIG Owner' && setup.accounts[0].keyEnd === '0001', 'connected: shows the account, not the key', setup.accounts[0]);
ok(!JSON.stringify(setup).includes(KEY1), 'the API key never comes back to the website');
ok(setup.channels.length === 3 && setup.channels.every((c) => c.buffer === 'https://publish.buffer.com/channels/' + c.id), 'its channels, each with a link into Buffer', setup.channels.map((c) => c.buffer));
const c1 = calls.length;
ok(calls.every((c) => c.key === KEY1 || c.key === 'buf_wrong_key_000000000000') && calls.filter((c) => c.key === KEY1).map((c) => c.op).join() === 'GigAccount,GigOverview,GigMore', 'asked Buffer: account, overview, next page', calls.map((c) => c.op));

console.log('The overview');
o = await data('socmedOverview', { token: HUB });
ok(calls.length === c1, 'the team sees the kept answer — no extra Buffer requests');
ok(o.connected && o.channels.length === 3 && o.posts.length === 4 && !!o.updatedAt && o.problems.length === 0, 'channels + upcoming + sent posts', { n: o.posts.length, p: o.problems });
ok(!JSON.stringify(o).includes(KEY1), 'no key in the overview either');
const P = Object.fromEntries(o.posts.map((p) => [p.id, p]));
const C = Object.fromEntries(o.channels.map((c) => [c.id, c]));
ok(P.p1.kind === 'reel' && P.p1.thumb === 'https://img.test/t1.jpg' && P.p1.mediaType === 'video' && P.p1.tags[0].name === 'Raya', 'post type, cover and tags');
ok(P.p2.status === 'error' && P.p2.error.message === 'Facebook needs you to reconnect.' && P.p2.error.help === 'https://support.buffer.com/x', 'failed post says why');
ok(P.p3.link === null && P.p3.reminder === true && P.p3.title === 'Raya sale', 'unsafe links dropped; reminder posts marked', P.p3);
ok(P.p4.status === 'sent' && P.p4.link === 'https://instagram.com/p/abc', 'sent post links to the live post');
ok(C.ch_fb.avatar === null && C.ch_fb.disconnected === true && C.ch_tt.paused === true && C.ch_ig.name === 'Noms Malaysia' && C.ch_fb.name === 'Noms', 'channel details (unsafe picture dropped)');
ok(o.channels.every((c) => c.brand === null && c.accountLabel === 'Main Buffer'), 'no brands yet (one Buffer organization)');
await data('socmedOverview', { token: T, refresh: true });
ok(calls.length === c1, '"Refresh" right away still uses the kept answer (2-minute gap)');

console.log('Brands');
j = await api('socmedSaveChannels', { token: T, channels: { ch_ig: { brand: 'Noms', link: 'javascript:alert(1)' } } });
ok(j.ok === false && /doesn't look right/.test(j.error), 'bad link refused');
ok((await api('socmedSaveChannels', { token: HUB, channels: { ch_ig: { brand: 'X' } } })).ok === false, 'only owners set brands');
setup = await data('socmedSaveChannels', { token: T, channels: { ch_ig: { brand: '  Noms ' }, ch_fb: { brand: 'Noms' }, ch_tt: { brand: 'GIG Prints', link: 'publish.buffer.com/channels/ch_tt/queue' } } });
ok(setup.channels.find((c) => c.id === 'ch_ig').brand === 'Noms' && setup.brands.includes('Noms') && setup.brands.includes('GIG Prints'), 'brands saved and suggested');
o = await data('socmedOverview', { token: HUB });
ok(C.ch_ig && o.channels.find((c) => c.id === 'ch_ig').brand === 'Noms' && o.channels.find((c) => c.id === 'ch_tt').buffer === 'https://publish.buffer.com/channels/ch_tt/queue', 'overview shows brands and the custom Buffer link');
await data('socmedSaveChannels', { token: T, channels: { ch_fb: { brand: '' } } });
ok((await data('socmedOverview', { token: T })).channels.find((c) => c.id === 'ch_fb').brand === null, 'brand cleared');

console.log('A second Buffer account, one organization per brand');
setup = await data('socmedConnect', { token: T, apiKey: KEY2 });
ok(setup.accounts.length === 2 && setup.accounts[1].label === 'Brands' && setup.accounts[1].orgs.join() === 'Brand A,Brand B', 'second account added (named after the Buffer account)');
o = await data('socmedOverview', { token: T });
ok(o.channels.length === 5 && o.channels.find((c) => c.id === 'ch_yt').brand === 'Brand A' && o.channels.find((c) => c.id === 'ch_th').brand === 'Brand B', 'brand = Buffer organization when an account has several', o.channels.map((c) => c.brand));
ok(o.posts.some((p) => p.id === 'pb1' && p.service === 'threads'), "both accounts' posts");
setup = await data('socmedConnect', { token: T, label: 'Brands Buffer', apiKey: KEY2 });
ok(setup.accounts.length === 2 && setup.accounts[1].label === 'Brands Buffer', 'connecting the same Buffer account again updates it (no duplicate)');

console.log('Keeping within Buffer\'s limits');
await sleep(2000); // BUFFER_REFRESH_MINUTES is tiny in the test server
let n = calls.length;
await data('socmedOverview', { token: T });
ok(calls.length > n && calls.slice(n).every((c) => c.op !== 'GigAccount'), 'after the wait it asks Buffer again (organizations kept for a day)', calls.slice(n).map((c) => c.op));
mode = 'revoked';
await sleep(2000);
o = await data('socmedOverview', { token: T });
ok(o.problems.length === 2 && /didn't accept the API key/.test(o.problems[0].message) && o.posts.length === 5, 'key deleted in Buffer: a clear note, and the last schedule stays on screen', o.problems);
n = calls.length;
await sleep(2000);
await data('socmedOverview', { token: T });
ok(calls.length === n, "with a broken key it doesn't keep asking by itself");
mode = 'busy';
await data('socmedOverview', { token: T, refresh: true });
ok(calls.length === n + 2, '"Refresh" tries again');
o = await data('socmedOverview', { token: T });
ok(/asked too often/.test(o.problems[0].message), 'Buffer busy: says so');
n = calls.length;
await sleep(2000);
await data('socmedOverview', { token: T, refresh: true });
ok(calls.length === n, "and waits as long as Buffer asks before trying again");

console.log('Removing');
setup = await data('socmedRemove', { token: T, id: setup.accounts[1].id });
ok(setup.accounts.length === 1, 'account removed');
o = await data('socmedOverview', { token: T });
ok(!o.channels.some((c) => c.id === 'ch_yt') && !o.posts.some((p) => p.id === 'pb1'), "its channels and posts are gone");
ok((await api('socmedRemove', { token: HUB, id: setup.accounts[0].id })).ok === false, 'only owners remove');

server.close();
console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
