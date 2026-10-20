// Socmed Hub: what's scheduled in Buffer, by brand and by platform. Posting and editing stay in Buffer —
// every channel has an "Open in Buffer" button. Owners connect Buffer and name the brands in Setup.
import { html, useState, useEffect } from '../lib.js';
import { api, useStore } from '../store.js';
import { Icon, PageHead, Tabs, Empty, Pill, Field, toast, toastError, confirmDialog } from '../ui.js';
import { hrefFor, go, timeAgo } from '../util.js';

const BUFFER_HOME = 'https://publish.buffer.com/';
const BUFFER_API_SETTINGS = 'https://publish.buffer.com/settings/api';
const NO_BRAND = 'No brand yet';
// Buffer's platforms: name + colour (dark ones follow the text colour so they show in dark mode too).
const PLATFORMS = {
  instagram: ['Instagram', '#e1306c'], facebook: ['Facebook', '#1877f2'], tiktok: ['TikTok', 'var(--ink)'],
  youtube: ['YouTube', '#ff0000'], threads: ['Threads', 'var(--ink)'], twitter: ['X', 'var(--ink)'],
  linkedin: ['LinkedIn', '#0a66c2'], pinterest: ['Pinterest', '#e60023'], googlebusiness: ['Google Business', '#4285f4'],
  bluesky: ['Bluesky', '#1185fe'], mastodon: ['Mastodon', '#6364ff'], substack: ['Substack', '#ff6719'],
  whatsapp: ['WhatsApp', '#25d366'], startPage: ['Start Page', '#2c4bff'],
};
const platform = (s) => PLATFORMS[s] || [s ? s[0].toUpperCase() + s.slice(1) : 'Other', 'var(--muted)'];
const platformOrder = (s) => { const i = Object.keys(PLATFORMS).indexOf(s); return i < 0 ? 99 : i; };
const KINDS = { post: 'Post', reel: 'Reel', story: 'Story', short: 'Short', carousel: 'Carousel', thread: 'Thread', event: 'Event', offer: 'Offer', whats_new: 'Update', ghost_post: 'Post' };
const UPCOMING = ['scheduled', 'sending', 'needs_approval'];
const STATUS = {
  scheduled: ['info', 'Scheduled'], sending: ['info', 'Posting now'], needs_approval: ['warn', 'Needs approval'],
  error: ['bad', 'Failed'], sent: ['good', 'Sent'], draft: ['neutral', 'Draft'],
};

// ── Small pieces ──────────────────────────────────────────────────────────
export function PlatformTag({ service }) {
  const [label, color] = platform(service);
  return html`<span class="plat-tag"><span class="dot" style=${{ background: color }}></span>${label}</span>`;
}

function ChannelAvatar({ ch, service }) {
  const [, color] = platform(ch?.service || service);
  const [broken, setBroken] = useState(false);
  return html`<span class="sm-avatar" style=${{ '--plat': color }}>
    ${ch?.avatar && !broken ? html`<img src=${ch.avatar} alt="" loading="lazy" referrerpolicy="no-referrer" onError=${() => setBroken(true)} />`
      : html`<span>${(ch?.name || platform(service)[0]).slice(0, 1).toUpperCase()}</span>`}
  </span>`;
}

const BufferLink = ({ href, label = 'Open in Buffer', small = true }) => html`<a class=${'btn' + (small ? ' btn-sm' : '')} href=${href} target="_blank" rel="noopener">
  <${Icon} name="external" size=${14} />${label}</a>`;

const timeText = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };
function dayLabel(d) {
  const x = new Date(d), t = new Date();
  const diff = Math.round((new Date(x.getFullYear(), x.getMonth(), x.getDate()) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5);
  const date = x.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return diff === 0 ? `Today · ${date}` : diff === 1 ? `Tomorrow · ${date}` : diff === -1 ? `Yesterday · ${date}` : date;
}
const whenText = (d) => (d ? `${dayLabel(d).split(' · ')[0]} ${timeText(d)}` : 'No time set');
function relText(d) {
  const m = Math.round((new Date(d) - Date.now()) / 60e3);
  if (m < 0) return timeAgo(d);
  if (m < 60) return `in ${m} min`;
  if (m < 48 * 60) return `in ${Math.round(m / 60)} h`;
  return `in ${Math.round(m / 1440)} days`;
}
const brandOf = (ch) => ch?.brand || NO_BRAND;
const byBrand = (a, b) => (a === NO_BRAND) - (b === NO_BRAND) || a.localeCompare(b);

function Stat({ label, value, sub, href, tone, icon, n, small }) {
  return html`<a class=${'stat stat-' + n + (tone ? ' stat-' + tone : '')} href=${href}>
    <span class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon"><${Icon} name=${icon} size=${18} /></span></span>
    <span class=${'stat-value' + (small ? ' sm-next' : '')}>${value}</span>
    ${sub && html`<span class="stat-sub">${sub}</span>`}
  </a>`;
}

// The last answer, so coming back to the page shows it straight away.
let kept = null;

// ── Page ──────────────────────────────────────────────────────────────────
export function Socmed({ sub, query }) {
  const { user } = useStore();
  const owner = !user?.viaLink;
  if (sub === 'setup' && owner) return html`<${SocmedSetup} />`;
  return html`<${Overview} query=${query} owner=${owner} />`;
}

function Overview({ query, owner }) {
  const [d, setD] = useState(kept);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const load = async (refresh = false) => {
    if (!api.socmed) return setError('The Socmed Hub needs the Cloudflare setup (see README.md).');
    setBusy(true);
    try {
      kept = await api.socmed.overview(refresh);
      setD(kept); setError(null);
      if (refresh) toast(kept.problems.length ? 'Some of Buffer could not be read — see the note at the top.' : 'Up to date with Buffer.', kept.problems.length ? 'error' : 'ok');
    } catch (e) { if (refresh || !kept) setError(e.message); else toastError(e); }
    setBusy(false);
  };
  useEffect(() => { load(false); }, []);
  const set = (patch) => go('socmed', { ...query, ...patch }, { replace: true });

  const head = html`<${PageHead} title="Socmed Hub" sub="Everything scheduled in Buffer — by brand and by platform. Posting and editing happen in Buffer.">
    ${d?.connected && html`<button class="btn btn-ghost" onClick=${() => load(true)} disabled=${busy}><${Icon} name="refresh" size=${16} />${busy ? 'Checking…' : 'Refresh'}</button>`}
    ${owner && html`<a class="btn" href=${hrefFor('socmed/setup')}><${Icon} name="settings" size=${16} />Setup</a>`}
    <${BufferLink} href=${BUFFER_HOME} label="Open Buffer" small=${false} />
  <//>`;
  if (error && !d) return html`${head}<section class="card"><p class="muted">${error}</p></section>`;
  if (!d) return html`${head}<div class="loading"><div class="spinner"></div></div>`;
  if (!d.connected) {
    return html`${head}<section class="card sm-connect">
      <div class="alert-banner-icon"><${Icon} name="megaphone" /></div>
      <div><h2>Connect Buffer to see your schedule here</h2>
        <p class="muted">Keep scheduling in Buffer (or with your bot). This page shows what's coming up for every brand and platform, with a button to open each account in Buffer.</p>
        ${owner ? html`<a class="btn btn-primary" href=${hrefFor('socmed/setup')}><${Icon} name="link" size=${16} />Connect Buffer</a>`
          : html`<p class="muted small">Ask an owner to connect Buffer (Socmed Hub → Setup).</p>`}
      </div>
    </section>`;
  }

  // Filters (brand + platform) apply to every view.
  const chById = Object.fromEntries(d.channels.map((c) => [c.id, c]));
  const brands = [...new Set(d.channels.map(brandOf))].sort(byBrand);
  const services = [...new Set(d.channels.map((c) => c.service))].sort((a, b) => platformOrder(a) - platformOrder(b));
  const chMatch = (c) => (!query.brand || brandOf(c) === query.brand) && (!query.platform || c.service === query.platform);
  const channels = d.channels.filter(chMatch);
  const posts = d.posts.filter((p) => chMatch(chById[p.channelId] || { service: p.service }));
  const dueSort = (a, b) => (a.dueAt || '9') < (b.dueAt || '9') ? -1 : 1;
  const upcoming = posts.filter((p) => UPCOMING.includes(p.status)).sort(dueSort);
  const attention = posts.filter((p) => p.status === 'error' || p.status === 'needs_approval').sort(dueSort);
  const sent = posts.filter((p) => p.status === 'sent').sort((a, b) => ((a.sentAt || a.dueAt) < (b.sentAt || b.dueAt) ? 1 : -1));
  const week = upcoming.filter((p) => p.dueAt && new Date(p.dueAt) - Date.now() < 7 * 864e5).length;
  const next = upcoming.find((p) => p.dueAt && new Date(p.dueAt) > Date.now());
  const view = ['brands', 'platforms'].includes(query.view) ? query.view : 'schedule';
  const show = ['attention', 'sent'].includes(query.show) ? query.show : 'upcoming';
  const unbranded = d.channels.some((c) => !c.brand);

  return html`${head}
    ${d.problems.map((p) => html`<div class="sm-problem" key=${p.account}><${Icon} name="alert" size=${16} />
      <span><b>${p.account}:</b> ${p.message}${d.updatedAt ? ` Showing the schedule from ${timeAgo(d.updatedAt)}.` : ''}</span>
      ${owner && p.code === 'BUFFER_KEY' && html`<a class="btn btn-sm" href=${hrefFor('socmed/setup')}>Fix in Setup</a>`}</div>`)}

    <div class="stats sm-stats">
      <${Stat} n="1" icon="calendar" label="Coming up" value=${upcoming.length} sub=${`${week} in the next 7 days`} href=${hrefFor('socmed', { ...query, view: '', show: '' })} />
      <${Stat} n="2" icon="clock" label="Next post" value=${next ? whenText(next.dueAt) : '—'} small
        sub=${next ? `${platform(next.service)[0]} · ${chById[next.channelId]?.name || ''}` : 'Nothing scheduled'} href=${hrefFor('socmed', { ...query, view: '', show: '' })} />
      <${Stat} n="4" icon="alert" label="Needs attention" value=${attention.length} tone=${attention.length ? 'warn' : ''}
        sub=${attention.length ? 'Failed or waiting for approval' : 'All good'} href=${hrefFor('socmed', { ...query, view: '', show: 'attention' })} />
      <${Stat} n="3" icon="check" label="Sent" value=${sent.length} sub="in the last 7 days" href=${hrefFor('socmed', { ...query, view: '', show: 'sent' })} />
    </div>

    <div class="view-row">
      <div class="segmented-toggle sm-view" role="tablist" aria-label="View">
        <button role="tab" aria-selected=${view === 'schedule'} class=${view === 'schedule' ? 'on' : ''} onClick=${() => set({ view: '' })}><${Icon} name="calendar" size=${15} />Schedule</button>
        <button role="tab" aria-selected=${view === 'brands'} class=${view === 'brands' ? 'on' : ''} onClick=${() => set({ view: 'brands' })}><${Icon} name="tag" size=${15} />By brand</button>
        <button role="tab" aria-selected=${view === 'platforms'} class=${view === 'platforms' ? 'on' : ''} onClick=${() => set({ view: 'platforms' })}><${Icon} name="grid" size=${15} />By platform</button>
      </div>
      <span class="muted small">${d.updatedAt ? `Updated ${timeAgo(d.updatedAt)}` : ''}${d.more ? ' · showing the first 400 upcoming posts' : ''}</span>
    </div>

    <div class="filters">
      <select value=${query.brand || ''} onChange=${(e) => set({ brand: e.target.value })} aria-label="Brand">
        <option value="">All brands</option>${brands.map((b) => html`<option value=${b}>${b}</option>`)}
      </select>
      <select value=${query.platform || ''} onChange=${(e) => set({ platform: e.target.value })} aria-label="Platform">
        <option value="">All platforms</option>${services.map((s) => html`<option value=${s}>${platform(s)[0]}</option>`)}
      </select>
      ${(query.brand || query.platform) && html`<button class="btn btn-ghost" onClick=${() => set({ brand: '', platform: '' })}><${Icon} name="x" size=${14} />Clear</button>`}
    </div>

    ${view === 'schedule' ? html`
      <${Tabs} value=${show} onChange=${(v) => set({ show: v === 'upcoming' ? '' : v })} items=${[
        { id: 'upcoming', label: 'Coming up', count: upcoming.length },
        { id: 'attention', label: 'Needs attention', count: attention.length },
        { id: 'sent', label: 'Sent · last 7 days', count: sent.length },
      ]} />
      <${PostList} posts=${show === 'attention' ? attention : show === 'sent' ? sent : upcoming} chById=${chById}
        empty=${show === 'attention' ? 'Nothing needs attention.' : show === 'sent' ? 'Nothing went out in the last 7 days.' : 'Nothing scheduled — add posts in Buffer and they show up here.'} />`
    : html`
      ${owner && unbranded && view === 'brands' && html`<p class="muted small sm-hint"><${Icon} name="tag" size=${14} />Some channels don't have a brand yet. <a class="link" href=${hrefFor('socmed/setup')}>Name them in Setup</a>.</p>`}
      <${Groups} by=${view} channels=${channels} upcoming=${upcoming} attention=${attention}
        onPick=${(patch) => set({ view: '', show: '', ...patch })} />`}`;
}

// ── Schedule: posts grouped by day ────────────────────────────────────────
function PostList({ posts, chById, empty }) {
  if (!posts.length) return html`<${Empty} icon="calendar" title=${empty} />`;
  const days = [];
  for (const p of posts) {
    const k = p.dueAt || p.sentAt ? dayKey(p.sentAt || p.dueAt) : 'none';
    if (!days.length || days[days.length - 1].k !== k) days.push({ k, label: k === 'none' ? 'No time set' : dayLabel(p.sentAt || p.dueAt), items: [] });
    days[days.length - 1].items.push(p);
  }
  return html`<div class="sm-days">${days.map((g) => html`<section key=${g.k}>
    <h3 class="sm-day">${g.label}<span class="muted">${g.items.length} post${g.items.length === 1 ? '' : 's'}</span></h3>
    <ul class="sm-posts">${g.items.map((p) => html`<${PostRow} key=${p.id} p=${p} ch=${chById[p.channelId]} />`)}</ul>
  </section>`)}</div>`;
}

function PostRow({ p, ch }) {
  const [tone, label] = STATUS[p.status] || ['neutral', p.status];
  const at = p.sentAt || p.dueAt;
  const [broken, setBroken] = useState(false);
  return html`<li class=${'sm-post card' + (p.status === 'error' ? ' is-error' : '')}>
    <div class="sm-when"><b>${at ? timeText(at) : '—'}</b><span class="muted small">${at ? relText(at) : ''}</span></div>
    <div class="sm-thumb">${p.thumb && !broken ? html`<img src=${p.thumb} alt="" loading="lazy" referrerpolicy="no-referrer" onError=${() => setBroken(true)} />`
      : html`<${Icon} name=${p.mediaType === 'video' ? 'video' : p.mediaType === 'image' ? 'image' : 'file'} size=${20} />`}
      ${p.mediaType === 'video' && p.thumb && !broken && html`<span class="sm-play"><${Icon} name="play" size=${12} /></span>`}
      ${p.media > 1 && html`<span class="sm-count">${p.media}</span>`}</div>
    <div class="sm-body">
      <div class="sm-meta">
        <${PlatformTag} service=${p.service} /><b class="sm-ch">${ch?.name || 'Channel'}</b>
        ${p.kind && KINDS[p.kind] && p.kind !== 'post' && html`<span class="mini-pill">${KINDS[p.kind]}</span>`}
        <span class="mini-pill mini-accent">${brandOf(ch)}</span>
        ${p.status !== 'scheduled' && html`<${Pill} tone=${tone}>${label}<//>`}
        ${p.reminder && html`<span class="mini-pill" data-tip="Buffer sends a reminder — someone posts this one by hand">Reminder</span>`}
      </div>
      ${p.title && html`<b class="sm-title">${p.title}</b>`}
      <p class="sm-text">${p.text || html`<span class="muted">No caption</span>`}</p>
      ${p.error && html`<p class="warn-text small"><${Icon} name="alert" size=${14} />${p.error.message}
        ${p.error.help && html` <a class="link" href=${p.error.help} target="_blank" rel="noopener">How to fix</a>`}</p>`}
      ${p.tags?.length > 0 && html`<div class="sm-tags">${p.tags.map((t) => html`<span class="season-tag small"><span class="dot" style=${{ background: t.color || 'var(--muted)' }}></span>${t.name}</span>`)}</div>`}
    </div>
    <div class="sm-actions">
      ${p.link && html`<a class="btn btn-sm" href=${p.link} target="_blank" rel="noopener"><${Icon} name="external" size=${14} />View post</a>`}
      ${ch && html`<${BufferLink} href=${ch.buffer} />`}
    </div>
  </li>`;
}

// ── By brand / by platform: every Buffer channel, with its schedule at a glance ──
function Groups({ by, channels, upcoming, attention, onPick }) {
  if (!channels.length) return html`<${Empty} icon="megaphone" title="No channels match">Try a different filter.<//>`;
  const keyOf = (c) => (by === 'brands' ? brandOf(c) : c.service);
  const keys = [...new Set(channels.map(keyOf))].sort(by === 'brands' ? byBrand : (a, b) => platformOrder(a) - platformOrder(b));
  const count = (list, ids) => list.filter((p) => ids.has(p.channelId)).length;
  return html`<div class="sm-groups">${keys.map((k) => {
    const chs = channels.filter((c) => keyOf(c) === k).sort((a, b) => (by === 'brands' ? platformOrder(a.service) - platformOrder(b.service) : byBrand(brandOf(a), brandOf(b))));
    const ids = new Set(chs.map((c) => c.id));
    const nextPost = upcoming.find((p) => ids.has(p.channelId) && p.dueAt && new Date(p.dueAt) > Date.now());
    const n = count(upcoming, ids), bad = count(attention, ids);
    return html`<section class="card sm-group" key=${k}>
      <header class="card-head">
        <div><h2>${by === 'brands' ? k : html`<${PlatformTag} service=${k} />`}</h2>
          <span class="muted small">${n} coming up${nextPost ? ` · next ${whenText(nextPost.dueAt)}` : ''}${bad ? ` · ${bad} need${bad === 1 ? 's' : ''} attention` : ''}</span></div>
        <button class="btn btn-sm btn-ghost" onClick=${() => onPick(by === 'brands' ? { brand: k } : { platform: k })}><${Icon} name="calendar" size=${14} />See schedule</button>
      </header>
      <ul class="sm-channels">${chs.map((c) => {
        const one = new Set([c.id]);
        const nx = upcoming.find((p) => p.channelId === c.id && p.dueAt && new Date(p.dueAt) > Date.now());
        return html`<li key=${c.id}>
          <${ChannelAvatar} ch=${c} />
          <div class="sm-ch-main">
            <b>${c.name}</b>
            <span class="muted small">${by === 'brands' ? html`<${PlatformTag} service=${c.service} />` : brandOf(c)}${c.handle && c.handle !== c.name ? ` · ${c.handle}` : ''}</span>
            <span class="small sm-ch-next"><b>${count(upcoming, one)}</b> coming up${nx ? ` · next ${whenText(nx.dueAt)}` : ''}</span>
            ${(c.disconnected || c.paused || c.locked) && html`<span class="sm-flags">
              ${c.disconnected && html`<${Pill} tone="bad">Disconnected — reconnect in Buffer<//>`}
              ${c.paused && html`<${Pill} tone="warn">Queue paused<//>`}
              ${c.locked && html`<${Pill} tone="neutral">Locked (Buffer plan)<//>`}</span>`}
          </div>
          <div class="sm-ch-actions">
            ${c.profile && html`<a class="icon-btn" href=${c.profile} target="_blank" rel="noopener" aria-label=${'Open ' + c.name + ' on ' + platform(c.service)[0]} data-tip=${'Open on ' + platform(c.service)[0]}><${Icon} name="external" size=${16} /></a>`}
            <${BufferLink} href=${c.buffer} />
          </div>
        </li>`;
      })}</ul>
    </section>`;
  })}</div>`;
}

// ── Setup (owners): connect Buffer, name the brands ───────────────────────
function SocmedSetup() {
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState({});
  const apply = (next) => { setS(next); kept = null; };
  useEffect(() => {
    if (!api.socmed) return setError('The Socmed Hub needs the Cloudflare setup (see README.md).');
    api.socmed.setup().then(setS).catch((e) => setError(e.message));
  }, []);

  const connect = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      apply(await api.socmed.connect(label.trim(), key.trim()));
      setKey(''); setLabel('');
      toast('Buffer connected.');
    } catch (err) { toastError(err); }
    setBusy(false);
  };
  const remove = async (a) => {
    if (!(await confirmDialog({ title: `Disconnect ${a.label}?`, message: "Its channels and posts disappear from the Socmed Hub. Nothing changes in Buffer — you can connect it again any time. (To stop the key working, delete it in Buffer → Settings → API.)", confirmLabel: 'Disconnect', danger: true }))) return;
    try { apply(await api.socmed.remove(a.id)); toast('Disconnected.'); } catch (err) { toastError(err); }
  };
  const val = (c, f) => (edits[c.id]?.[f] ?? c[f] ?? '');
  const edit = (c, f, v) => setEdits((x) => ({ ...x, [c.id]: { brand: val(c, 'brand'), link: val(c, 'link'), ...x[c.id], [f]: v } }));
  const dirty = Object.keys(edits).length > 0;
  const save = async () => {
    setBusy(true);
    try { apply(await api.socmed.saveChannels(edits)); setEdits({}); toast('Brands saved.'); } catch (err) { toastError(err); }
    setBusy(false);
  };

  const back = { href: hrefFor('socmed'), label: 'Socmed Hub' };
  if (error) return html`<${PageHead} title="Socmed Hub setup" back=${back} /><section class="card"><p class="muted">${error}</p></section>`;
  if (!s) return html`<${PageHead} title="Socmed Hub setup" back=${back} /><div class="loading"><div class="spinner"></div></div>`;
  const byAccount = s.accounts.map((a) => ({ a, chs: s.channels.filter((c) => c.account === a.id).sort((x, y) => platformOrder(x.service) - platformOrder(y.service)) }));

  return html`
    <${PageHead} title="Socmed Hub setup" back=${back} sub="Connect your Buffer account, then say which brand each channel belongs to." />

    <section class="card staff-card">
      <header class="card-head"><h2>Buffer accounts</h2></header>
      ${s.accounts.length > 0 && html`<ul class="staff-list">${s.accounts.map((a) => html`<li key=${a.id}>
        <div class="staff-top"><b>${a.label}</b>${a.error ? html`<${Pill} tone="bad">Problem<//>` : html`<${Pill} tone="good" icon="check">Connected<//>`}
          <span class="staff-used muted small">${a.updatedAt ? `Updated ${timeAgo(a.updatedAt)}` : ''}</span></div>
        <span class="muted small">Buffer account: ${[a.name, a.email].filter(Boolean).join(' · ') || '—'} · key ending in ${a.keyEnd}${a.orgs?.length ? ` · ${a.orgs.length > 1 ? 'organizations' : 'organization'}: ${a.orgs.join(', ')}` : ''}</span>
        ${a.error && html`<p class="warn-text small"><${Icon} name="alert" size=${14} />${a.error}</p>`}
        <div class="page-actions"><button class="btn btn-sm btn-ghost-danger" onClick=${() => remove(a)}><${Icon} name="trash" size=${14} />Disconnect</button></div>
      </li>`)}</ul>`}

      <form class=${'sm-connect-form' + (s.accounts.length ? '' : ' no-line')} onSubmit=${connect}>
        <h3>${s.accounts.length ? 'Connect another Buffer account' : 'Connect Buffer'}</h3>
        <ol class="setup-steps">
          <li>Open <a class="link" href=${BUFFER_API_SETTINGS} target="_blank" rel="noopener">Buffer → Settings → API</a> (sign in to Buffer if it asks).</li>
          <li>Create a new API key and call it <b>GIG Hub</b>. Buffer shows the key only once.</li>
          <li>Copy the key and paste it below. ${s.accounts.length ? 'Using a second Buffer login (e.g. for another brand)? Connect it here too.' : ''}</li>
        </ol>
        <div class="form-grid">
          <${Field} label="Name (optional)" hint="Shown in the hub, e.g. Main Buffer."><input value=${label} maxlength="40" onInput=${(e) => setLabel(e.target.value)} placeholder="Main Buffer" /><//>
          <${Field} label="Buffer API key" hint="Kept on your GIG server only — never shown on the website again. If your bot uses Buffer too, it can use the same key.">
            <input type="password" value=${key} onInput=${(e) => setKey(e.target.value)} autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="Paste the key here" /><//>
        </div>
        <div class="page-actions"><button class="btn btn-primary" disabled=${busy || key.trim().length < 16}>${busy ? 'Checking with Buffer…' : 'Connect'}</button></div>
      </form>
    </section>

    ${s.accounts.length > 0 && html`<section class="card staff-card">
      <header class="card-head"><div><h2>Brands</h2><p class="muted small">Type the brand for each channel — the Socmed Hub groups and filters by these. Leave it empty if it doesn't belong to a brand.</p></div></header>
      <datalist id="sm-brands">${s.brands.map((b) => html`<option value=${b} />`)}</datalist>
      ${byAccount.map(({ a, chs }) => html`<div key=${a.id}>
        ${s.accounts.length > 1 && html`<h3 class="subhead">${a.label}</h3>`}
        ${!chs.length ? html`<p class="muted small">${a.error ? "Can't read this account's channels right now." : 'No channels in this Buffer account yet — connect them in Buffer, then refresh the Socmed Hub.'}</p>`
          : html`<ul class="sm-brand-list">${chs.map((c) => html`<li key=${c.id}>
            <${ChannelAvatar} ch=${c} />
            <div class="sm-ch-main"><b>${c.name}</b><span class="muted small"><${PlatformTag} service=${c.service} />${c.handle && c.handle !== c.name ? ` · ${c.handle}` : ''}</span></div>
            <input class="sm-brand-input" list="sm-brands" value=${val(c, 'brand')} maxlength="40" placeholder=${c.defaultBrand || 'Brand'} aria-label=${'Brand for ' + c.name}
              onInput=${(e) => edit(c, 'brand', e.target.value)} />
            <details class="sm-link-edit">
              <summary class="muted small">Buffer link</summary>
              <input value=${val(c, 'link')} placeholder=${'https://publish.buffer.com/channels/' + c.id} aria-label=${'Buffer link for ' + c.name}
                onInput=${(e) => edit(c, 'link', e.target.value)} />
              <span class="field-hint">Only if "Open in Buffer" lands on the wrong page: open this channel in Buffer, copy the address bar and paste it here.</span>
            </details>
          </li>`)}</ul>`}
      </div>`)}
      ${dirty && html`<div class="save-bar"><span class="spacer">Unsaved brand changes</span>
        <button class="btn" onClick=${() => setEdits({})} disabled=${busy}>Undo</button>
        <button class="btn btn-primary" onClick=${save} disabled=${busy}>${busy ? 'Saving…' : 'Save brands'}</button></div>`}
    </section>`}`;
}
