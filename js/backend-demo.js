// Demo backend: same interface as the Supabase one, but everything lives in this
// browser (localStorage for data, IndexedDB for uploaded files). Used when
// config.js has no Supabase details, so you can click around before setting up.
import { uid, newToken, today, fmtGB } from './util.js';
import { DEFAULT_QUESTIONS, DEFAULT_READY_MESSAGE, DEFAULT_NEW_MESSAGE, notifyPayload, isVisible } from './print/model.js';

const KEY = 'mediahub-demo-v1';
const USER = { email: 'you@demo.team' };

// ── Tiny IndexedDB wrapper for uploaded files ─────────────────────────────
const idb = {
  db: null,
  open() {
    return (this.db ||= new Promise((res, rej) => {
      const r = indexedDB.open('mediahub-demo-files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('files', mode);
      const req = fn(tx.objectStore('files'));
      tx.oncomplete = () => res(req?.result);
      tx.onerror = () => rej(tx.error);
    });
  },
  put(k, v) { return this.run('readwrite', (s) => s.put(v, k)); },
  get(k) { return this.run('readonly', (s) => s.get(k)); },
  del(k) { return this.run('readwrite', (s) => s.delete(k)); },
  clear() { return this.run('readwrite', (s) => s.clear()); },
};

// ── Sample artwork (generated SVGs so the demo has something to look at) ──
const ART = {
  'logo-primary':   { kind: 'logo', bg: '#ffffff', fg: '#2a78d6', text: 'BRAND' },
  'logo-white':     { kind: 'logo', bg: '#1c5cab', fg: '#ffffff', text: 'BRAND' },
  'logo-mark':      { kind: 'mark', bg: '#f0efec', fg: '#2a78d6' },
  'mascot-wave':    { kind: 'mascot', bg: '#cde2fb', fg: '#eb6834', mood: 'happy' },
  'mascot-thumbs':  { kind: 'mascot', bg: '#fdf1d6', fg: '#1baf7a', mood: 'wink' },
  'mascot-xmas':    { kind: 'mascot', bg: '#f9e0e0', fg: '#e34948', mood: 'happy', hat: true },
  'colours':        { kind: 'swatches' },
  'flatlay-1':      { kind: 'photo', a: '#f6d365', b: '#fda085', text: 'Product flatlay 01' },
  'flatlay-2':      { kind: 'photo', a: '#84fab0', b: '#8fd3f4', text: 'Product flatlay 02' },
  'flatlay-3':      { kind: 'photo', a: '#a1c4fd', b: '#c2e9fb', text: 'Product flatlay 03' },
  'studio-bts':     { kind: 'photo', a: '#d4d3dd', b: '#9795f0', text: 'Studio BTS' },
  'xmas-maya':      { kind: 'photo', a: '#e34948', b: '#8c1c1c', text: 'Holiday gift guide' },
  'xmas-dan':       { kind: 'photo', a: '#0f5132', b: '#e34948', text: 'Unboxing the advent box' },
  'summer-aisha':   { kind: 'photo', a: '#fbc2eb', b: '#f6d365', text: 'Summer picnic set' },
  'summer-leo':     { kind: 'photo', a: '#43e97b', b: '#38f9d7', text: 'Beach day essentials' },
  'vday-maya':      { kind: 'photo', a: '#ff9a9e', b: '#fecfef', text: 'Date night picks' },
  'halloween-sam':  { kind: 'photo', a: '#f77062', b: '#2b1a3d', text: 'Spooky treats' },
  'bts-priya':      { kind: 'photo', a: '#667eea', b: '#764ba2', text: 'Desk setup refresh' },
  'ever-1':         { kind: 'photo', a: '#89f7fe', b: '#66a6ff', text: 'Morning routine' },
  'ever-2':         { kind: 'photo', a: '#fddb92', b: '#d1fdff', text: 'Everyday carry' },
  'ever-3':         { kind: 'photo', a: '#e0c3fc', b: '#8ec5fc', text: 'Customer review' },
  'ever-4':         { kind: 'photo', a: '#fccb90', b: '#d57eeb', text: 'How-to: 3 ways' },
  'bf-dan':         { kind: 'photo', a: '#232526', b: '#414345', text: '11.11 mega deals' },
  'ny-aisha':       { kind: 'photo', a: '#30cfd0', b: '#330867', text: 'New year, new you' },
};

function svgFor(key) {
  const a = ART[key];
  if (!a) return null;
  const W = 800, H = 1000;
  let body = '';
  if (a.kind === 'photo') {
    body = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a.a}"/><stop offset="1" stop-color="${a.b}"/></linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
      <circle cx="600" cy="260" r="180" fill="#fff" opacity=".18"/><circle cx="220" cy="720" r="240" fill="#fff" opacity=".12"/>
      <rect x="250" y="360" width="300" height="300" rx="36" fill="#fff" opacity=".85"/>
      <circle cx="400" cy="480" r="70" fill="${a.b}" opacity=".9"/><rect x="310" y="580" width="180" height="22" rx="11" fill="${a.a}"/>
      <text x="60" y="920" font-family="system-ui,sans-serif" font-size="48" font-weight="700" fill="#fff">${a.text}</text>`;
  } else if (a.kind === 'logo') {
    body = `<rect width="${W}" height="${H}" fill="${a.bg}"/>
      <circle cx="400" cy="420" r="120" fill="${a.fg}"/><circle cx="400" cy="420" r="52" fill="${a.bg}"/>
      <text x="400" y="660" text-anchor="middle" font-family="system-ui,sans-serif" font-size="96" font-weight="800" letter-spacing="10" fill="${a.fg}">${a.text}</text>`;
  } else if (a.kind === 'mark') {
    body = `<rect width="${W}" height="${H}" fill="${a.bg}"/><circle cx="400" cy="500" r="200" fill="${a.fg}"/><circle cx="400" cy="500" r="86" fill="${a.bg}"/>`;
  } else if (a.kind === 'mascot') {
    const eyes = a.mood === 'wink'
      ? `<circle cx="340" cy="470" r="22" fill="#0b0b0b"/><path d="M438 470 q22 -18 44 0" stroke="#0b0b0b" stroke-width="12" fill="none" stroke-linecap="round"/>`
      : `<circle cx="340" cy="470" r="22" fill="#0b0b0b"/><circle cx="460" cy="470" r="22" fill="#0b0b0b"/>`;
    const hat = a.hat ? `<path d="M270 330 L400 150 L530 330 Z" fill="#e34948"/><rect x="250" y="320" width="300" height="40" rx="20" fill="#fff"/><circle cx="400" cy="150" r="26" fill="#fff"/>` : '';
    body = `<rect width="${W}" height="${H}" fill="${a.bg}"/>
      <ellipse cx="400" cy="540" rx="220" ry="230" fill="${a.fg}"/>
      <ellipse cx="400" cy="780" rx="170" ry="26" fill="#000" opacity=".08"/>
      ${eyes}<path d="M350 560 q50 50 100 0" stroke="#0b0b0b" stroke-width="12" fill="none" stroke-linecap="round"/>
      <circle cx="300" cy="540" r="18" fill="#fff" opacity=".35"/><circle cx="500" cy="540" r="18" fill="#fff" opacity=".35"/>${hat}`;
  } else if (a.kind === 'swatches') {
    const cols = ['#2a78d6', '#1c5cab', '#eb6834', '#1baf7a', '#eda100', '#0b0b0b'];
    body = `<rect width="${W}" height="${H}" fill="#fcfcfb"/>` + cols.map((c, i) =>
      `<rect x="${80 + (i % 2) * 330}" y="${90 + Math.floor(i / 2) * 290}" width="300" height="200" rx="20" fill="${c}"/>
       <text x="${80 + (i % 2) * 330}" y="${330 + Math.floor(i / 2) * 290}" font-family="ui-monospace,monospace" font-size="30" fill="#52514e">${c}</text>`).join('');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

// ── Seed data ─────────────────────────────────────────────────────────────
function seed() {
  const now = Date.now();
  const ago = (days) => new Date(now - days * 86400e3).toISOString();
  const dayAgo = (days) => new Date(now - days * 86400e3).toISOString().slice(0, 10);

  const seasons = [
    ['New Year', '#2a78d6'], ['Valentine\'s Day', '#e87ba4'], ['Spring', '#1baf7a'], ['Summer', '#eda100'],
    ['Back to School', '#4a3aa7'], ['Halloween', '#eb6834'], ['Black Friday / 11.11', '#0b0b0b'], ['Christmas & Holidays', '#e34948'],
  ].map(([name, color], i) => ({ id: uid(), name, color, sort_order: i + 1, created_at: ago(120) }));
  const S = Object.fromEntries(seasons.map((s) => [s.name, s.id]));

  const t = (o) => ({
    id: uid(), handle: null, platform: null, profile_url: null, followers: null, engagement_rate: null, niche: null,
    location: null, email: null, phone: null, rate: null, status: 'prospect', tags: [], notes: null,
    brand: 'Noms', tier: null, talent_type: 'Creator', languages: ['English'],
    created_at: ago(o.days ?? 30), updated_at: ago((o.days ?? 30) / 2), ...o,
  });
  const talents = [
    t({ name: 'Maya Lee', tier: 'Micro KOL', languages: ['English', 'Chinese'],  handle: '@mayaleeeats', platform: 'Instagram', followers: 48200, engagement_rate: 4.1, niche: 'Food & lifestyle', location: 'Singapore', email: 'maya@example.com', rate: '$450 / reel', status: 'delivered', tags: ['food', 'lifestyle'], notes: 'Great turnaround. Wants to do the CNY campaign too.', days: 90 }),
    t({ name: 'Dan Okafor', tier: 'Mid KOL', handle: '@dan.unboxes', platform: 'YouTube, Instagram', followers: 212000, engagement_rate: 2.8, niche: 'Tech & unboxing', location: 'London', email: 'dan@example.com', rate: '$1,800 / video', status: 'in_production', tags: ['tech'], notes: 'Holiday unboxing video due mid-December.', days: 60 }),
    t({ name: 'Aisha Rahman', tier: 'Micro KOL', languages: ['BM', 'English'],  handle: '@aisharahman', platform: 'TikTok', followers: 96500, engagement_rate: 7.3, niche: 'Beauty & GRWM', location: 'Sydney', email: 'aisha@example.com', rate: '$600 / video', status: 'approved', tags: ['beauty'], notes: 'Approved for summer + new year pushes.', days: 45 }),
    t({ name: 'Leo Santos', tier: 'Micro KOL',  handle: '@leo.outdoors', platform: 'Instagram', followers: 31800, engagement_rate: 5.6, niche: 'Travel & outdoors', location: 'Toronto', status: 'awaiting', tags: ['travel'], notes: 'Rate card received — needs sign-off.', days: 12 }),
    t({ name: 'Sam Carter', tier: 'Micro KOL',  handle: '@samcooks', platform: 'TikTok', followers: 15400, engagement_rate: 9.2, niche: 'Home cooking', location: 'Manila', status: 'contacted', tags: ['food'], days: 6 }),
    t({ name: 'Priya Nair', tier: 'Nano UGC', languages: ['English', 'Tamil'],  handle: '@priyaworks', platform: 'LinkedIn', followers: 8700, niche: 'Productivity', location: 'Los Angeles', status: 'prospect', tags: ['b2b'], days: 3 }),
    t({ name: 'Jonas Berg', tier: 'Micro KOL', talent_type: 'Media',  handle: '@jonasfilms', platform: 'YouTube', followers: 54000, niche: 'Filmmaking', status: 'declined', notes: 'Budget too high for Q4.', days: 50 }),
  ];
  const T = Object.fromEntries(talents.map((x) => [x.name.split(' ')[0], x.id]));

  const upload_links = [
    { id: uid(), token: newToken(), label: 'Dan Okafor — Holiday unboxing', talent_id: T.Dan, season_id: S['Christmas & Holidays'], instructions: 'Please upload the final cut (4K, 16:9) plus 3 vertical cut-downs. Include captions as a .txt if you have them.', is_active: true, expires_at: null, upload_count: 1, last_upload_at: ago(2), created_at: ago(20) },
    { id: uid(), token: newToken(), label: 'Aisha Rahman', talent_id: T.Aisha, season_id: null, instructions: 'Upload anything for the summer + new year campaigns here. Vertical 9:16 please!', is_active: true, expires_at: null, upload_count: 2, last_upload_at: ago(1), created_at: ago(30) },
    { id: uid(), token: newToken(), label: 'Photographer — studio day', talent_id: null, season_id: null, instructions: 'Raw selects from the studio shoot.', is_active: false, expires_at: null, upload_count: 4, last_upload_at: ago(40), created_at: ago(55) },
  ];

  const a = (o) => ({
    id: uid(), description: null, category: 'final', media_type: 'image', season_id: null, talent_id: null, upload_link_id: null,
    source: 'team', file_name: null, mime_type: 'image/svg+xml', size_bytes: 180000 + Math.round(Math.random() * 4e6), tags: [], status: 'approved',
    review_note: null, reviewed_at: null, use_count: 0, last_used_on: null, uploaded_by: USER.email,
    created_at: ago(o.days ?? 10), updated_at: ago(o.days ?? 10), ...o,
    storage_path: o.storage_path || `demo-seed/${o.art}.svg`,
  });
  const vid = (n) => ({ media_type: 'video', mime_type: 'video/mp4', storage_path: `demo-seed/video-${n}.mp4`, size_bytes: 80e6 + n * 13e6 });

  const assets = [
    // Brand kit
    a({ title: 'Logo — primary', art: 'logo-primary', category: 'brand', tags: ['logo'], days: 120, use_count: 6 }),
    a({ title: 'Logo — white on blue', art: 'logo-white', category: 'brand', tags: ['logo'], days: 120, use_count: 3 }),
    a({ title: 'Logo mark (icon only)', art: 'logo-mark', category: 'brand', tags: ['logo', 'icon'], days: 120, use_count: 2 }),
    a({ title: 'Mascot — waving', art: 'mascot-wave', category: 'brand', tags: ['mascot'], days: 100, use_count: 4 }),
    a({ title: 'Mascot — wink', art: 'mascot-thumbs', category: 'brand', tags: ['mascot'], days: 100 }),
    a({ title: 'Mascot — holiday hat', art: 'mascot-xmas', category: 'brand', tags: ['mascot'], season_id: S['Christmas & Holidays'], days: 70 }),
    a({ title: 'Brand colours', art: 'colours', category: 'brand', tags: ['colours', 'guidelines'], days: 120, use_count: 1 }),
    a({ title: 'Brand guidelines 2026', category: 'brand', media_type: 'document', mime_type: 'application/pdf', storage_path: 'demo-seed/guidelines.pdf', tags: ['guidelines'], days: 110 }),
    // Raw footage
    a({ title: 'Studio shoot — flatlay 01', art: 'flatlay-1', category: 'raw', tags: ['product', 'studio'], days: 40, use_count: 1 }),
    a({ title: 'Studio shoot — flatlay 02', art: 'flatlay-2', category: 'raw', tags: ['product', 'studio'], days: 40 }),
    a({ title: 'Studio shoot — flatlay 03', art: 'flatlay-3', category: 'raw', tags: ['product', 'studio'], days: 40 }),
    a({ title: 'Studio behind the scenes', art: 'studio-bts', category: 'raw', tags: ['bts'], days: 40 }),
    a({ title: 'B-roll — product close-ups', category: 'raw', ...vid(1), tags: ['b-roll', 'product'], days: 38 }),
    a({ title: 'B-roll — warehouse & packing', category: 'raw', ...vid(2), tags: ['b-roll'], days: 38, use_count: 2 }),
    a({ title: 'Office interviews (raw)', category: 'raw', ...vid(3), tags: ['interview'], days: 25 }),
    // Final content (from talents)
    a({ title: 'Holiday gift guide carousel', art: 'xmas-maya', talent_id: T.Maya, source: 'talent', season_id: S['Christmas & Holidays'], tags: ['carousel'], days: 18, use_count: 1, uploaded_by: 'Maya Lee' }),
    a({ title: 'Advent box unboxing — thumbnail', art: 'xmas-dan', talent_id: T.Dan, source: 'talent', upload_link_id: upload_links[0].id, season_id: S['Christmas & Holidays'], status: 'pending', days: 2, uploaded_by: upload_links[0].label }),
    a({ title: 'Advent box unboxing — full video', ...vid(4), talent_id: T.Dan, source: 'talent', upload_link_id: upload_links[0].id, season_id: S['Christmas & Holidays'], status: 'pending', days: 2, uploaded_by: upload_links[0].label, description: '4K master. Vertical cut-downs coming tomorrow.' }),
    a({ title: 'Summer picnic set', art: 'summer-aisha', talent_id: T.Aisha, source: 'talent', upload_link_id: upload_links[1].id, season_id: S.Summer, days: 60, use_count: 3, uploaded_by: upload_links[1].label }),
    a({ title: 'Beach day essentials', art: 'summer-leo', talent_id: T.Leo, source: 'talent', season_id: S.Summer, days: 58 }),
    a({ title: 'GRWM — summer glow (reel)', ...vid(5), talent_id: T.Aisha, source: 'talent', upload_link_id: upload_links[1].id, season_id: S.Summer, days: 57, use_count: 2, uploaded_by: upload_links[1].label }),
    a({ title: 'Date night picks', art: 'vday-maya', talent_id: T.Maya, source: 'talent', season_id: S['Valentine\'s Day'], days: 80, use_count: 1 }),
    a({ title: 'Spooky treats', art: 'halloween-sam', talent_id: T.Sam, source: 'talent', season_id: S.Halloween, status: 'changes', review_note: 'Logo needs to be visible in the first 3 seconds.', reviewed_at: ago(3), days: 5 }),
    a({ title: '11.11 mega deals teaser', art: 'bf-dan', talent_id: T.Dan, source: 'talent', season_id: S['Black Friday / 11.11'], days: 9 }),
    a({ title: 'New year, new you', art: 'ny-aisha', talent_id: T.Aisha, source: 'talent', upload_link_id: upload_links[1].id, season_id: S['New Year'], status: 'pending', days: 1, uploaded_by: upload_links[1].label }),
    a({ title: 'Desk setup refresh', art: 'bts-priya', talent_id: T.Priya, source: 'talent', status: 'rejected', review_note: 'Off-brand, not using.', reviewed_at: ago(15), days: 16 }),
    // Evergreen
    a({ title: 'Morning routine', art: 'ever-1', talent_id: T.Maya, source: 'talent', days: 35, use_count: 2 }),
    a({ title: 'Everyday carry', art: 'ever-2', days: 33 }),
    a({ title: 'Customer review quote card', art: 'ever-3', days: 30, tags: ['testimonial'] }),
    a({ title: 'How-to: 3 ways to use it', art: 'ever-4', talent_id: T.Sam, source: 'talent', days: 29 }),
    a({ title: 'How-to video (60s)', ...vid(6), talent_id: T.Sam, source: 'talent', days: 29 }),
    a({ title: 'Founder story (short)', ...vid(7), days: 28, use_count: 1 }),
  ];
  for (const x of assets) {
    x.file_name ||= x.storage_path.split('/').pop();
    delete x.art;
  }

  const channels = ['Instagram post', 'TikTok', 'Website', 'Paid ads', 'Email / newsletter', 'Instagram reel'];
  const asset_usage = [];
  for (const x of assets) {
    for (let i = 0; i < x.use_count; i++) {
      asset_usage.push({ id: uid(), asset_id: x.id, channel: channels[(i + x.title.length) % channels.length], note: null, used_on: dayAgo(3 + i * 7), created_by: USER.email, created_at: ago(3 + i * 7) });
    }
    x.last_used_on = x.use_count ? dayAgo(3) : null;
  }

  const team_members = [{ id: uid(), email: USER.email, name: 'You (demo)', created_at: ago(120) }];
  return { v: 1, seasons, talents, upload_links, assets, asset_usage, team_members };
}

// ── Persistence ───────────────────────────────────────────────────────────
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) return s;
  } catch {}
  return seed();
}

const DEFAULTS = {
  seasons: () => ({ color: '#2a78d6', sort_order: 0 }),
  talents: () => ({ status: 'prospect', tags: [], languages: [], brand: null, tier: null, talent_type: null, updated_at: new Date().toISOString() }),
  upload_links: () => ({ token: newToken(), is_active: true, expires_at: null, upload_count: 0, last_upload_at: null }),
  assets: () => ({ category: 'final', media_type: 'other', source: 'team', tags: [], status: 'pending', use_count: 0, last_used_on: null, updated_at: new Date().toISOString() }),
  asset_usage: () => ({ used_on: today(), created_by: USER.email }),
  team_members: () => ({}),
};


// ── Print Hub (demo) ──────────────────────────────────────────────────────
const PRINT_KEY = 'gig-print-demo-v4';
function printSeed() {
  const now = Date.now();
  const ago = (h) => new Date(now - h * 3600e3).toISOString();
  const inDays = (d) => new Date(now + d * 86400e3).toISOString().slice(0, 10);
  const order = (no, status, [name, company, phone, item, qty, due, size, paper, lamination, brief], hoursAgo, steps) => {
    const vals = { q_name: name, q_company: company, q_phone: phone, q_email: null, q_item: item, q_qty: qty, q_size: size, q_paper: paper,
                   q_lamination: lamination, q_design: 'No', q_design_file: null, q_design_brief: { text: brief, files: [] }, q_due: due, q_notes: null };
    const history = [{ status: 'new', at: ago(hoursAgo), by: 'customer' }, ...steps.map(([st, h, by]) => (st === 'notify'
      ? { event: 'notify', kind: 'completed', ok: false, at: ago(h), detail: 'No bot linked yet — customer was not notified.' }
      : { status: st, at: ago(h), by }))];
    return {
      id: uid(), order_no: no, status, customer_name: name, company, phone, email: null, summary: item, quantity: String(qty), due_date: due,
      answers: DEFAULT_QUESTIONS.map((q) => (isVisible(q, vals, DEFAULT_QUESTIONS)
        ? { id: q.id, label: q.label, type: q.type, value: vals[q.id] ?? null }
        : { id: q.id, label: q.label, type: q.type, value: null, hidden: true })),
      history, internal_notes: null, created_at: ago(hoursAgo), updated_at: ago(steps.length ? steps[steps.length - 1][1] : hoursAgo),
    };
  };
  return {
    v: 4,
    // Fixed demo links, so the customer link also works in a private window or another browser on this computer.
    settings: { masterKey: 'demomasterlink', orderKey: 'demoorderlink', orderActive: true, joinKey: 'demojoinlink', joinActive: true, nextNo: 1006,
                webhookUrl: '', webhookSecret: '', readyMessage: DEFAULT_READY_MESSAGE, newOrderMessage: DEFAULT_NEW_MESSAGE,
                notifyOnNew: true, notifyOnDone: true },
    // One private admin link per staff member.
    staff: [
      // Demo only: passcodes are kept as plain text here (the real server stores them hashed).
      { id: uid(), name: 'Production team', key: 'demoadminlink', active: true, hub: false, status: 'approved', pin: null, last_used_at: ago(2), created_at: ago(400) },
      { id: uid(), name: 'Ali', key: 'demoalilink', active: true, hub: true, status: 'approved', pin: '123456', last_used_at: null, created_at: ago(30) },
      { id: uid(), name: 'Siti', key: newToken(), active: true, hub: false, status: 'pending', pin: '654321', requested_at: ago(1), created_at: ago(1) },
    ],
    questions: DEFAULT_QUESTIONS,
    orders: [
      order('P-1005', 'new', ['Siti Mariam', '', '+60 12-555 0199', 'Posters', 20, inDays(7), 'A2', 'Normal paper', 'Yes', 'Hari Raya sale poster, green and gold, with our logo at the top'], 3, []),
      order('P-1004', 'new', ['Kevin Wong', 'KK Fitness', '+60 16-555 0142', 'Banner / bunting', 2, inDays(5), '2m × 1m', 'Not sure', null, 'Grand opening bunting, bold red, include the gym address and phone number'], 20, []),
      order('P-1003', 'pending', ['Farah Hassan', 'Farah Bakes', '+60 19-555 0177', 'Business cards', 500, inDays(-1), '9cm × 5.4cm', 'Hard card paper', 'Yes', 'Pastel pink with our cupcake logo, name and Instagram on the back'], 70, [['pending', 60, 'admin']]),
      order('P-1002', 'pending', ['Jason Lim', 'Noms', '+60 11-555 0123', 'Stickers / labels', 2000, inDays(2), '5cm round', 'Not sure', null, 'Noms logo on a white background, waterproof'], 50, [['pending', 30, 'admin']]),
      order('P-1001', 'completed', ['Nurul Aina', 'Kedai Kopi Aina', '+60 13-555 0110', 'Flyers', 1000, inDays(-3), 'A5', 'Normal paper', 'No', 'Menu flyer with our coffee photos and prices'], 140, [['pending', 120, 'admin'], ['completed', 80, 'admin'], ['notify', 80]]),
    ],
  };
}

export function createDemoBackend() {
  let db = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  save();
  const urlCache = new Map();
  const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function syncUsage(assetId) {
    const a = db.assets.find((x) => x.id === assetId);
    if (!a) return;
    const uses = db.asset_usage.filter((u) => u.asset_id === assetId);
    a.use_count = uses.length;
    a.last_used_on = uses.map((u) => u.used_on).sort().pop() ?? null;
  }
  function removeRow(table, id) {
    const row = db[table].find((r) => r.id === id);
    db[table] = db[table].filter((r) => r.id !== id);
    const unlink = (tbl, col) => db[tbl].forEach((r) => { if (r[col] === id) r[col] = null; });
    if (table === 'seasons') { unlink('assets', 'season_id'); unlink('upload_links', 'season_id'); }
    if (table === 'talents') { unlink('assets', 'talent_id'); unlink('upload_links', 'talent_id'); }
    if (table === 'upload_links') unlink('assets', 'upload_link_id');
    if (table === 'assets') db.asset_usage = db.asset_usage.filter((u) => u.asset_id !== id);
    if (table === 'asset_usage' && row) syncUsage(row.asset_id);
  }
  // Storage limit (same rule as the live version): new uploads stop once the limit is reached.
  const LIMIT_KEY = 'gig-demo-storage-limit';
  function demoStorage() {
    let used = db.assets.reduce((n, a) => n + (a.size_bytes || 0), 0);
    try {
      for (const o of JSON.parse(localStorage.getItem(PRINT_KEY))?.orders || []) {
        for (const a of o.answers || []) {
          const list = a.type === 'file' ? a.value : a.type === 'voice_text' ? a.value?.files : null;
          for (const f of list || []) used += f.size || 0;
        }
      }
    } catch {}
    let gb = 10;
    try { gb = Number(localStorage.getItem(LIMIT_KEY)) || 10; } catch {}
    return { used, limit: gb * 1e9 };
  }
  function checkSpace(size, who) {
    const { used, limit } = demoStorage();
    if (used + size <= limit) return;
    if (who !== 'team') throw new Error('Uploads are paused right now because our storage is full. Please contact the GIG team.');
    throw new Error(used >= limit
      ? `Storage is full (${fmtGB(used)} of your ${fmtGB(limit)} limit). Delete old files, or raise the limit in Settings, to upload more.`
      : `Not enough space for this file — ${fmtGB(used)} of your ${fmtGB(limit)} limit is used. Delete old files, or raise the limit in Settings.`);
  }

  function validLink(token) {
    return db.upload_links.find((l) => l.token === token && l.is_active && (!l.expires_at || new Date(l.expires_at) > new Date()));
  }

  const backend = {
    mode: 'demo',

    auth: {
      async getUser() { return USER; },
      onChange(cb) { setTimeout(() => cb(USER), 0); return () => {}; },
      async signIn() {},
      // Team links with Creative Hub access (demo: checks the link, then you carry on as the demo user).
      async signInWithLink(key) {
        let st = null;
        try { st = (JSON.parse(localStorage.getItem(PRINT_KEY))?.staff || []).find((x) => x.key === key && x.active); } catch {}
        if (!st) throw new Error('This team link is no longer valid. Please ask for a new one.');
        if (!st.hub) throw Object.assign(new Error('This link opens the Print Hub only.'), { code: 'PRINT_ONLY' });
      },
      // Team sign-in with name + 6-digit passcode (demo: checks it, then you carry on as the demo user).
      async signInWithPasscode(name, passcode) {
        const ln = String(name || '').trim().toLowerCase();
        let st = null;
        try { st = (JSON.parse(localStorage.getItem(PRINT_KEY))?.staff || []).find((x) => x.name.toLowerCase() === ln && x.pin && x.pin === passcode); } catch {}
        if (!st) throw new Error("That name and passcode don't match.");
        if (st.status === 'pending') throw new Error("You're waiting for approval — ask the owner to approve you, then try again.");
        if (!st.active) throw new Error('Your access is turned off. Please ask the owner.');
      },
      async changePasscode() {},
      async signOut() {},
      async changePassword() {},
      async isTeam() { return true; },
    },

    // Join page (demo): asks to join with a name + passcode; the request shows up in Print Hub → Links & access.
    join: {
      async info(key) {
        try { const s = JSON.parse(localStorage.getItem(PRINT_KEY))?.settings; return { ok: !!(s?.joinActive && key === s.joinKey) }; } catch { return { ok: false }; }
      },
      async request(key, name, passcode) {
        let d = null;
        try { d = JSON.parse(localStorage.getItem(PRINT_KEY)); } catch {}
        if (!d || !d.settings?.joinActive || key !== d.settings.joinKey) throw new Error('This join link is no longer active. Please ask the owner for a new one.');
        name = String(name || '').trim().replace(/\s+/g, ' ');
        if (name.length < 2) throw new Error('Type your name.');
        if (!/^\d{6}$/.test(String(passcode))) throw new Error('Your passcode must be exactly 6 digits.');
        if (d.staff.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error('That name is already taken — add your surname or an initial (e.g. "Ali K").');
        const now = new Date().toISOString();
        d.staff.push({ id: uid(), name, key: newToken(), active: true, hub: false, status: 'pending', pin: String(passcode), requested_at: now, created_at: now });
        try { localStorage.setItem(PRINT_KEY, JSON.stringify(d)); } catch {}
        return { status: 'pending', name };
      },
    },

    async list(table, { eq, order = ['created_at', false] } = {}) {
      await wait();
      let rows = db[table];
      if (eq) rows = rows.filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v));
      const [col, asc] = order;
      rows = [...rows].sort((x, y) => (x[col] > y[col] ? 1 : x[col] < y[col] ? -1 : 0) * (asc ? 1 : -1));
      return clone(rows);
    },
    async insert(table, row) {
      await wait();
      const r = { id: uid(), created_at: new Date().toISOString(), ...DEFAULTS[table](), ...row };
      if (table === 'team_members' && db.team_members.some((m) => m.email.toLowerCase() === r.email.toLowerCase())) throw new Error('That already exists.');
      if (table === 'seasons' && db.seasons.some((s) => s.name.toLowerCase() === r.name.toLowerCase())) throw new Error('That already exists.');
      db[table].push(r);
      if (table === 'asset_usage') syncUsage(r.asset_id);
      save();
      return clone(r);
    },
    async insertMany(table, rows) {
      const out = [];
      for (const row of rows) out.push(await this.insert(table, row));
      return out;
    },
    async update(table, id, patch) {
      await wait();
      const r = db[table].find((x) => x.id === id);
      if (!r) throw new Error('Not found');
      Object.assign(r, patch);
      if ('updated_at' in r) r.updated_at = new Date().toISOString();
      save();
      return clone(r);
    },
    async updateMany(table, ids, patch) {
      const out = [];
      for (const id of ids) out.push(await this.update(table, id, patch));
      return out;
    },
    async remove(table, id) { await wait(); removeRow(table, id); save(); },
    async removeMany(table, ids) { await wait(); ids.forEach((id) => removeRow(table, id)); save(); },

    async uploadFile(path, file, { onProgress, linkToken } = {}) {
      checkSpace(file.size, linkToken ? 'creator' : 'team');
      for (let p = 0; p <= 1; p += 0.2) { onProgress?.(p); await wait(90); }
      await idb.put(path, file);
      onProgress?.(1);
      return path;
    },
    async signedUrls(paths) {
      const out = {};
      for (const p of paths) {
        if (urlCache.has(p)) { out[p] = urlCache.get(p); continue; }
        let url = null;
        if (p.startsWith('demo-seed/')) {
          const svg = svgFor(p.slice(10).replace(/\.svg$/, ''));
          if (svg) url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        } else {
          const blob = await idb.get(p).catch(() => null);
          if (blob) url = URL.createObjectURL(blob);
        }
        if (url) { urlCache.set(p, url); out[p] = url; }
      }
      return out;
    },
    async downloadUrl(path) {
      const url = (await this.signedUrls([path]))[path];
      if (!url) throw new Error('This is a sample item in demo mode — there is no real file to download.');
      return url;
    },
    async shareUrl(path) { return this.downloadUrl(path); },
    async removeFiles(paths) {
      for (const p of paths) { await idb.del(p).catch(() => {}); urlCache.delete(p); }
    },

    print: (() => {
      let pdb = null;
      const pload = () => {
        if (pdb) return pdb;
        try {
          const x = JSON.parse(localStorage.getItem(PRINT_KEY));
          if (x && x.v === 4) {
            if (!x.staff) { // saved before per-person links: the old shared admin link becomes one
              x.staff = [{ id: uid(), name: 'Production team', key: x.settings.adminKey || 'demoadminlink', active: x.settings.adminActive !== false,
                           last_used_at: null, created_at: new Date().toISOString() }];
              delete x.settings.adminKey; delete x.settings.adminActive;
              pdb = x;
              psave();
            }
            if (!x.settings.joinKey) { // saved before joining with a passcode existed
              Object.assign(x.settings, { joinKey: 'demojoinlink', joinActive: true });
              x.staff.forEach((st) => { st.status = st.status || 'approved'; });
              pdb = x;
              psave();
            }
            return (pdb = x);
          }
        } catch {}
        pdb = printSeed();
        psave(); // save right away so the customer page and staff app share the same links
        return pdb;
      };
      const psave = () => { try { localStorage.setItem(PRINT_KEY, JSON.stringify(pdb)); } catch {} };
      // Who is using the Print Hub: the master link, one person's staff link, or the hub's team (master).
      const actor = (key) => {
        const d = pload();
        if (!key) return { role: 'master', who: 'Demo user' }; // demo: everyone coming from the hub is on the team
        if (key === d.settings.masterKey) return { role: 'master', who: 'Master' };
        const st = d.staff.find((x) => x.key === key && x.active && x.status !== 'pending');
        if (st) {
          if (!st.last_used_at || Date.now() - new Date(st.last_used_at) > 3600e3) { st.last_used_at = new Date().toISOString(); psave(); }
          return { role: 'admin', who: st.name, hub: !!st.hub };
        }
        const e = new Error('This access link is no longer valid. Please ask for a new one.'); e.code = 'PRINT_AUTH'; throw e;
      };
      const role = (key) => actor(key).role;
      const needMaster = (key) => { if (role(key) !== 'master') throw new Error('Only the master link can do that.'); };
      const staffOut = () => pload().staff.map(({ pin, ...x }) => ({ ...clone(x), status: x.status || 'approved', passcode: !!pin }));
      const staffName = (n) => { n = String(n || '').trim().slice(0, 60); if (!n) throw new Error("Type the person's name."); return n; };
      const staffFind = (id) => { const x = pload().staff.find((s) => s.id === id); if (!x) throw new Error('That link no longer exists.'); return x; };
      const orderOk = (k) => pload().settings.orderActive && k === pload().settings.orderKey;
      const settingsOut = () => { const { nextNo, wa, teamEmails, teamEmailOn, siteUrl, ...rest } = pload().settings; return rest; };
      const find = (id) => { const o = pload().orders.find((x) => x.id === id); if (!o) throw new Error('That order no longer exists.'); return o; };
      async function notify(kind, o, test) {
        const st = pload().settings;
        const at = new Date().toISOString();
        if (!st.webhookUrl) return { event: 'notify', kind, ok: false, at, detail: 'No bot linked yet — customer was not notified.' };
        const message = kind === 'completed' ? st.readyMessage : st.newOrderMessage;
        try {
          await fetch(st.webhookUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify(notifyPayload(kind, o, message, test)) });
          return { event: 'notify', kind, ok: true, at, detail: 'Sent to the bot (demo mode can’t confirm it was delivered).' };
        } catch { return { event: 'notify', kind, ok: false, at, detail: 'Could not reach the bot.' }; }
      }
      const methods = {
        async form(orderKey) { await wait(); return orderOk(orderKey) ? { questions: clone(pload().questions) } : null; },
        async uploadFile(file, { orderKey, onProgress } = {}) {
          if (!orderOk(orderKey)) throw new Error('This order link is no longer active. Please contact us.');
          checkSpace(file.size, 'customer');
          const path = `print/${uid()}-${file.name}`;
          for (let p = 0; p <= 1; p += 0.25) { onProgress?.(p); await wait(80); }
          await idb.put(path, file);
          onProgress?.(1);
          return { id: path, name: file.name, size: file.size, mime: file.type || null };
        },
        async submit(orderKey, answersIn = {}, filesIn = {}) {
          await wait();
          if (!orderOk(orderKey)) throw new Error('This order link is no longer active. Please contact us.');
          const d = pload();
          const roleCol = { name: 'customer_name', company: 'company', email: 'email', phone: 'phone', item: 'summary', quantity: 'quantity', deadline: 'due_date' };
          const row = {};
          const answers = d.questions.map((q) => {
            if (!isVisible(q, answersIn, d.questions)) return { id: q.id, label: q.label, type: q.type, value: null, hidden: true };
            if (q.type === 'voice_text') {
              const text = String(answersIn[q.id] || '').trim();
              const vf = filesIn[q.id] || [];
              if (q.required && !text && !vf.length) throw new Error('Please answer: ' + q.label);
              return { id: q.id, label: q.label, type: q.type, value: text || vf.length ? { text: text || null, files: vf } : null };
            }
            let v = q.type === 'file' ? filesIn[q.id] || [] : answersIn[q.id];
            if (typeof v === 'string') v = v.trim();
            const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
            if (q.required && empty) throw new Error('Please answer: ' + q.label);
            if (q.type === 'date' && !empty && String(v) < new Date(Date.now() - 86400e3).toISOString().slice(0, 10)) throw new Error('Please choose today or a future date for: ' + q.label);
            if (q.role && roleCol[q.role] && !empty) row[roleCol[q.role]] = Array.isArray(v) ? v.join(', ') : String(v);
            return { id: q.id, label: q.label, type: q.type, value: empty ? null : v };
          });
          const now = new Date().toISOString();
          const order = { id: uid(), order_no: 'P-' + d.settings.nextNo, status: 'new', customer_name: null, company: null, phone: null, email: null,
            summary: null, quantity: null, due_date: null, ...row, answers, history: [{ status: 'new', at: now, by: 'customer' }],
            internal_notes: null, created_at: now, updated_at: now };
          d.settings.nextNo += 1;
          d.orders.unshift(order);
          if (d.settings.webhookUrl && d.settings.notifyOnNew) order.history.push(await notify('created', order, false));
          psave();
          return { order_no: order.order_no };
        },
        async me(key) {
          await wait();
          const a = actor(key);
          const r = a.role;
          const st = pload().settings;
          return { role: r, name: a.who, via: key ? 'key' : 'token', hub: !!a.hub, hubLinks: true, questions: clone(pload().questions), botLinked: !!st.webhookUrl, readyMessage: st.readyMessage,
                   newOrderMessage: st.newOrderMessage, notifyOnDone: st.notifyOnDone, storage: demoStorage(),
                   ...(r === 'master' ? { settings: settingsOut(), staff: staffOut() } : {}) };
        },
        async orders(key) { await wait(); role(key); return clone(pload().orders); },
        async update(key, id, patch) {
          await wait();
          const r = actor(key).who;
          const o = find(id);
          if (patch.status && patch.status !== o.status) {
            o.history = [...(o.history || []), { status: patch.status, at: new Date().toISOString(), by: r }];
            const st = pload().settings;
            if (patch.status === 'completed' && patch.notify !== false && st.webhookUrl && st.notifyOnDone) o.history.push(await notify('completed', o, false));
            o.status = patch.status;
          }
          if (patch.whatsapp) o.history = [...(o.history || []), { event: 'whatsapp', kind: patch.whatsapp === 'created' ? 'created' : 'completed', at: new Date().toISOString(), by: r }];
          if (patch.internal_notes !== undefined) o.internal_notes = patch.internal_notes || null;
          o.updated_at = new Date().toISOString();
          psave();
          return clone(o);
        },
        async notify(key, id, kind) {
          role(key);
          const o = find(id);
          o.history = [...(o.history || []), await notify(kind === 'created' ? 'created' : 'completed', o, false)];
          psave();
          return clone(o);
        },
        async remove(key, id) {
          needMaster(key);
          const o = find(id);
          for (const a of o.answers) {
            const fl = a.type === 'file' ? a.value : a.type === 'voice_text' ? a.value?.files : null;
            for (const f of fl || []) await idb.del(f.id).catch(() => {});
          }
          pdb.orders = pdb.orders.filter((x) => x.id !== id);
          psave();
          return true;
        },
        async saveQuestions(key, questions) {
          needMaster(key);
          if (!questions.length) throw new Error('The form needs at least one question.');
          if (questions.some((q) => !String(q.label || '').trim())) throw new Error('Every question needs a label.');
          pload().questions = clone(questions);
          psave();
          return clone(pdb.questions);
        },
        async saveSettings(key, input) {
          needMaster(key);
          const st = pload().settings;
          if (input.webhookUrl !== undefined) {
            const url = String(input.webhookUrl || '').trim();
            if (url && !/^https:\/\//.test(url)) throw new Error('The bot link must start with https://');
            st.webhookUrl = url;
          }
          if (input.webhookSecret !== undefined) st.webhookSecret = String(input.webhookSecret || '').trim();
          if (input.readyMessage !== undefined) st.readyMessage = String(input.readyMessage || '').trim() || DEFAULT_READY_MESSAGE;
          if (input.newOrderMessage !== undefined) st.newOrderMessage = String(input.newOrderMessage || '').trim() || DEFAULT_NEW_MESSAGE;
          if (input.notifyOnNew !== undefined) st.notifyOnNew = !!input.notifyOnNew;
          if (input.notifyOnDone !== undefined) st.notifyOnDone = !!input.notifyOnDone;
          psave();
          return settingsOut();
        },
        async regenerate(key, which) {
          needMaster(key);
          const field = { order: 'orderKey', master: 'masterKey', join: 'joinKey' }[which];
          if (!field) throw new Error('Admin links are per person now — use Staff links.');
          pload().settings[field] = newToken();
          psave();
          return settingsOut();
        },
        async setActive(key, which, active) {
          needMaster(key);
          const field = { order: 'orderActive', join: 'joinActive' }[which];
          if (!field) throw new Error("That link can't be turned off.");
          pload().settings[field] = !!active;
          psave();
          return settingsOut();
        },
        async staffAdd(key, name, hub) {
          needMaster(key);
          pload().staff.push({ id: uid(), name: staffName(name), key: newToken(), active: true, hub: !!hub, last_used_at: null, created_at: new Date().toISOString() });
          psave();
          return staffOut();
        },
        async staffUpdate(key, id, patch) {
          needMaster(key);
          const x = staffFind(id);
          if (patch.name !== undefined) x.name = staffName(patch.name);
          if (patch.active !== undefined) x.active = !!patch.active;
          if (patch.hub !== undefined) x.hub = !!patch.hub;
          psave();
          return staffOut();
        },
        async staffRegenerate(key, id) {
          needMaster(key);
          Object.assign(staffFind(id), { key: newToken(), last_used_at: null });
          psave();
          return staffOut();
        },
        async staffApprove(key, id, hub) {
          needMaster(key);
          Object.assign(staffFind(id), { status: 'approved', hub: !!hub, active: true });
          psave();
          return staffOut();
        },
        async staffResetPasscode(key, id) {
          needMaster(key);
          const passcode = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
          Object.assign(staffFind(id), { pin: passcode, key: newToken() });
          psave();
          return { staff: staffOut(), passcode };
        },
        async staffDelete(key, id) {
          needMaster(key);
          pload().staff = pload().staff.filter((s) => s.id !== id);
          psave();
          return staffOut();
        },
        async testNotify(key, kind) {
          needMaster(key);
          return notify(kind === 'created' ? 'created' : 'completed', { order_no: 'P-TEST', customer_name: 'Test Customer', company: 'Test Co', phone: '+60123456789', summary: 'Flyers', quantity: '500', answers: [] }, true);
        },
        async fileLinks(id) {
          if (!urlCache.has(id)) {
            const blob = await idb.get(id).catch(() => null);
            urlCache.set(id, blob ? URL.createObjectURL(blob) : null);
          }
          const url = urlCache.get(id);
          return { thumb: url, open: url, download: url, preview: url };
        },
      };
      // Re-read the saved data on every call, so several open tabs (customer + staff) see each other's changes.
      return Object.fromEntries(Object.entries(methods).map(([k, f]) => [k, (...a) => { pdb = null; return f.apply(methods, a); }]));
    })(),

    portal: {
      async linkInfo(token) {
        await wait();
        const l = validLink(token);
        if (!l) return null;
        return {
          label: l.label,
          instructions: l.instructions,
          season_name: db.seasons.find((s) => s.id === l.season_id)?.name ?? null,
          talent_name: db.talents.find((x) => x.id === l.talent_id)?.name ?? null,
        };
      },
      async submit(token, m) {
        await wait();
        const l = validLink(token);
        if (!l) throw new Error('This upload link is no longer active. Please contact the team.');
        if (!m.path.startsWith(`submissions/${token}/`)) throw new Error('Invalid file location.');
        const mime = m.mime_type || 'application/octet-stream';
        const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : mime === 'application/pdf' ? 'document' : 'other';
        const r = {
          ...DEFAULTS.assets(), id: uid(), created_at: new Date().toISOString(),
          title: (m.title || '').trim() || m.file_name, description: (m.description || '').trim() || null,
          category: 'final', media_type: kind, season_id: l.season_id, talent_id: l.talent_id, upload_link_id: l.id,
          source: 'talent', storage_path: m.path, file_name: m.file_name, mime_type: mime, size_bytes: m.size_bytes,
          status: 'pending', review_note: null, reviewed_at: null, uploaded_by: l.label,
        };
        db.assets.push(r);
        l.upload_count += 1;
        l.last_upload_at = new Date().toISOString();
        save();
        return r.id;
      },
      async submissions(token) {
        await wait();
        const l = validLink(token);
        if (!l) return [];
        return db.assets.filter((x) => x.upload_link_id === l.id)
          .sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
          .map(({ title, media_type, status, created_at }) => ({ title, media_type, status, created_at }));
      },
    },

    async storage() { return demoStorage(); },
    async setStorageLimit(gb) {
      if (!(Number(gb) >= 1)) throw new Error('Enter a limit between 1 and 100,000 GB.');
      try { localStorage.setItem(LIMIT_KEY, String(Math.round(Number(gb) * 10) / 10)); } catch {}
      return demoStorage();
    },

    // Demo-only: wipe everything and start again with sample data.
    async resetDemo() {
      try { localStorage.removeItem(KEY); localStorage.removeItem(PRINT_KEY); localStorage.removeItem(LIMIT_KEY); } catch {}
      await idb.clear().catch(() => {});
      db = seed();
      save();
    },
  };
  // Re-read the saved data on every call, so several open tabs (e.g. a creator's upload page and the team app)
  // don't overwrite each other's changes.
  const fresh = (obj) => {
    for (const [k, f] of Object.entries(obj)) {
      if (typeof f === 'function' && k !== 'resetDemo') obj[k] = function (...a) { db = load(); return f.apply(this, a); };
    }
  };
  fresh(backend);
  fresh(backend.portal);
  return backend;
}
