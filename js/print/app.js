// Print Hub — staff app (admin & master). Opened via the admin/master
// link (print/index.html#k=…) or from the Creative Hub sidebar (master).
import { html, render, useState, useEffect } from '../lib.js';
import { loadBackend, MODE } from '../api.js';
import { setApi } from '../store.js';
import { CONFIG } from '../../config.js';
import { fmtDate, timeAgo, copyText, parseHash, hrefFor, go, fmtBytes } from '../util.js';
import { Icon, PageHead, Field, Empty, Pill, Tabs, MultiChips, DialogHost, ToastHost, TooltipHost, InstallButton, InstallHelpHost, StorageWarning, isInstalledApp, confirmDialog, toast, toastError } from '../ui.js';
import {
  ORDER_STATUS, STATUS_ORDER, QUESTION_TYPES, QUESTION_ROLES, hasOptions, newQuestionId, answerText, isOverdue, dueLabel,
  fillMessage, notifyPayload, SAMPLE_ORDER, MESSAGE_TAGS, useFileLinks, waLink, teamMessage,
} from './shared.js';
const CC = CONFIG.WHATSAPP_COUNTRY_CODE || '60';

const api = await loadBackend();
setApi(api);
const PRINT_TITLE = CONFIG.PRINT_NAME || 'Print Hub';

// ── Access key (from the admin/master link) ────────────────────────────────
const KEY_STORE = 'gig-print-key';
const getKey = () => { try { return localStorage.getItem(KEY_STORE) || null; } catch { return null; } };
const setKey = (k) => { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch {} };
const takeKeyFromLink = () => {
  const m = location.hash.match(/^#k=([A-Za-z0-9]+)/);
  if (!m) return false;
  setKey(m[1]);
  history.replaceState(null, '', location.pathname + location.search + '#/');
  return true;
};
takeKeyFromLink();
// Opening a different admin/master link in an already-open tab switches to it.
addEventListener('hashchange', () => { if (takeKeyFromLink()) location.reload(); });
const linkFor = (page, key) => new URL(page === 'order' ? 'order.html#' + key : 'index.html#k=' + key, location.href.split('#')[0]).href;

// ── Tiny store ─────────────────────────────────────────────────────────────
let P = { loaded: false, role: null, name: '', staff: [], pushKey: null, questions: [], settings: null, orders: [], botLinked: false, readyMessage: '', newOrderMessage: '', notifyOnDone: true, emailReady: true };
const subs = new Set();
const setP = (patch) => { P = { ...P, ...patch }; subs.forEach((f) => f(P)); };
function usePrint() {
  const [s, set] = useState(P);
  useEffect(() => { subs.add(set); set(P); return () => subs.delete(set); }, []);
  return s;
}
const byNewest = (a, b) => (a.created_at < b.created_at ? 1 : -1);

// ── New-order alerts on this device (sound + desktop notification) ─────────
const ALERT_KEY = 'gig-print-alerts';
const alertChoice = () => { try { return localStorage.getItem(ALERT_KEY); } catch { return null; } }; // 'on' | 'off' | null (not asked yet)
const alertsOn = () => alertChoice() === 'on';
// Android only allows pop-ups through a service worker, so register a tiny one.
const swReady = 'serviceWorker' in navigator ? navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).catch(() => null) : Promise.resolve(null);
async function popup(title, body, orderId) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const url = orderId ? 'index.html#/order/' + orderId : 'index.html';
  try {
    const n = new Notification(title, { body, tag: orderId || 'gig-alert' });
    n.onclick = () => { window.focus(); if (orderId) go('order/' + orderId); n.close(); };
    return true;
  } catch {
    const reg = await swReady; // e.g. Android Chrome
    if (!reg) return false;
    await reg.showNotification(title, { body, tag: orderId || 'gig-alert', data: { url } });
    return true;
  }
}
// ── Push: alerts even when the app is closed (Cloudflare setup; iPhone needs iOS 16.4+ and the app on the Home Screen) ──
const isIPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const canPush = () => !!(P.pushKey && api.print.pushSubscribe && 'PushManager' in window && 'Notification' in window && 'serviceWorker' in navigator);
const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
let pushActive = false;
// Registers this device with the GIG server. Returns its subscription, or null if push isn't possible here.
async function syncPush(create) {
  if (!canPush() || Notification.permission !== 'granted') return null;
  try {
    const reg = await swReady;
    if (!reg) return null;
    let sub = await reg.pushManager.getSubscription();
    const want = keyBytes(P.pushKey);
    const have = sub?.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
    if (sub && have && (have.length !== want.length || have.some((b, i) => b !== want[i]))) { await sub.unsubscribe(); sub = null; } // server keys changed
    if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    if (!sub) return null;
    await api.print.pushSubscribe(getKey(), sub.toJSON());
    pushActive = true;
    return sub;
  } catch { return null; }
}
async function stopPush() {
  pushActive = false;
  try {
    const sub = await (await swReady)?.pushManager.getSubscription();
    if (!sub) return;
    await api.print.pushUnsubscribe?.(getKey(), sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  } catch {}
}
async function turnOffAlerts() {
  try { localStorage.setItem(ALERT_KEY, 'off'); } catch {}
  await stopPush();
}

async function turnOnAlerts() {
  if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} }
  try { localStorage.setItem(ALERT_KEY, 'on'); } catch {}
  chime();
  const sub = await syncPush(true);
  if (sub) {
    const r = await api.print.pushTest(getKey(), sub.endpoint).catch(() => ({ ok: false }));
    return toast(r.ok ? "Alerts on — you'll get a notification for every new order, even when the app is closed."
      : 'Alerts on while the Print Hub is open. (The test notification didn\'t go through — try turning alerts off and on again.)');
  }
  const shown = await popup('New-order alerts are on', 'This device will chime and show a pop-up when a new order comes in (while the Print Hub is open).');
  if (P.pushKey && isIPhone() && !isInstalledApp()) {
    return toast('Alerts on while this page is open. To get them with the app closed, add the Print Hub to your Home Screen (Share → Add to Home Screen) and turn alerts on there.');
  }
  toast(shown ? 'Alerts on for this device while the Print Hub is open.' : 'Alerts on — this device will chime. (Pop-ups aren\'t allowed on this device; allow notifications in the browser settings to get them.)');
}
let audio = null;
const unlockAudio = () => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch {} };
addEventListener('pointerdown', unlockAudio, { once: true }); // browsers only allow sound after a click on the page
function chime() {
  try {
    unlockAudio();
    const t = audio.currentTime;
    [[880, 0], [1320, 0.16]].forEach(([f, d]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
      o.connect(g).connect(audio.destination); o.start(t + d); o.stop(t + d + 0.3);
    });
  } catch {}
}
function alertNewOrders(list) {
  if (!alertsOn() || !list.length) return;
  chime();
  if (pushActive) return; // the push notification already showed it
  list.forEach((o) => popup(`New print order ${o.order_no}`, teamMessage('created', o), o.id));
}

async function refreshOrders() {
  const before = new Set(P.orders.map((o) => o.id));
  const orders = (await api.print.orders(getKey())).sort(byNewest);
  setP({ orders });
  const fresh = orders.filter((o) => !before.has(o.id) && o.status === 'new');
  if (fresh.length && P.loaded) {
    alertNewOrders(fresh);
    toast(fresh.length === 1 ? `New order ${fresh[0].order_no} from ${fresh[0].customer_name || 'a customer'}` : `${fresh.length} new orders`);
  }
}
function replaceOrder(o) { setP({ orders: P.orders.map((x) => (x.id === o.id ? o : x)) }); }
const isMaster = () => P.role === 'master';

// Move an order to a new status (completing it notifies the customer through the bot).
async function changeStatus(order, status) {
  if (status === 'completed') {
    const msg = fillMessage(P.readyMessage, order);
    const ok = await confirmDialog({
      title: `Mark ${order.order_no} as completed?`,
      message: P.botLinked && P.notifyOnDone !== false ? `Your bot will be told, so it can send the customer: “${msg}”`
        : 'Next, tap the green “WhatsApp: ready for pickup” button to send the customer the message.',
      confirmLabel: 'Mark completed',
    });
    if (!ok) return null;
  }
  try {
    const o = await api.print.update(getKey(), order.id, { status });
    replaceOrder(o);
    const note = o.history?.[o.history.length - 1];
    if (status === 'completed' && note?.event === 'notify' && note.kind !== 'created') toast(note.ok ? 'Completed — sent to your bot.' : 'Completed, but ' + note.detail, note.ok ? 'ok' : 'error');
    else if (status === 'completed') toast('Completed — now tap “WhatsApp: ready for pickup”.');
    else toast(`${order.order_no}: ${ORDER_STATUS[status].label}`);
    return o;
  } catch (e) { toastError(e); return null; }
}

// Opens WhatsApp with the customer's number and the message already typed; logs it in the order history.
function WhatsAppButton({ order, kind, primary }) {
  const label = kind === 'created' ? 'order received' : 'ready for pickup';
  const text = fillMessage(kind === 'created' ? P.newOrderMessage : P.readyMessage, order);
  const href = waLink(order.phone, text, CC);
  if (!href) return html`<span class="muted small" data-tip="Add a phone number to the order form to message customers">No phone number</span>`;
  const log = () => api.print.update(getKey(), order.id, { whatsapp: kind }).then(replaceOrder).catch(() => {});
  return html`<a class=${'btn btn-wa' + (primary ? '' : ' btn-wa-soft')} href=${href} target="_blank" rel="noopener" onClick=${log}
      data-tip=${'Opens WhatsApp with: “' + text + '”'}>
    <${Icon} name="whatsapp" size=${16} />WhatsApp: ${label}</a>`;
}

function StatusPill({ status }) {
  const s = ORDER_STATUS[status] || ORDER_STATUS.new;
  return html`<${Pill} tone=${s.tone} icon=${s.icon}>${s.label}<//>`;
}
function DueCell({ order }) {
  const late = isOverdue(order);
  return html`<span class=${late ? 'overdue' : ''}>${dueLabel(order)}${late && html` · late`}</span>`;
}
function NextAction({ order, small }) {
  const cls = 'btn' + (small ? ' btn-sm' : '');
  if (order.status === 'new') return html`<button class=${cls} onClick=${(e) => { e.stopPropagation(); changeStatus(order, 'pending'); }}><${Icon} name="play" size=${12} />Start</button>`;
  if (order.status === 'pending') return html`<button class=${cls + ' btn-good'} onClick=${(e) => { e.stopPropagation(); changeStatus(order, 'completed'); }}><${Icon} name="check" size=${14} />Done</button>`;
  return null;
}

// ── Pages ──────────────────────────────────────────────────────────────────
function Overview() {
  const { orders, settings } = usePrint();
  const by = (s) => orders.filter((o) => o.status === s);
  const open = orders.filter((o) => o.status !== 'completed');
  const late = open.filter(isOverdue);
  const weekAgo = Date.now() - 7 * 86400e3;
  const doneThisWeek = by('completed').filter((o) => {
    const h = [...(o.history || [])].reverse().find((x) => x.status === 'completed');
    return h && new Date(h.at).getTime() > weekAgo;
  }).length;
  const dueSoon = open.filter((o) => o.due_date).sort((a, b) => (a.due_date > b.due_date ? 1 : -1)).slice(0, 6);
  const cards = [
    { s: 'new', n: 1, sub: by('new').length ? 'Waiting to be started' : 'Nothing waiting' },
    { s: 'pending', n: 2, sub: late.length ? `${late.length} past the due date` : 'In production' },
    { s: 'completed', n: 3, sub: `${doneThisWeek} completed this week` },
  ];
  return html`
    <${PageHead} title="Print orders" sub="Every order customers place through your order link lands here as New.">
      ${settings && html`<button class="btn" onClick=${async () => { await copyText(linkFor('order', settings.orderKey)); toast('Customer order link copied.'); }}>
        <${Icon} name="link" size=${16} />Copy customer order link</button>`}
      <button class="btn btn-ghost" onClick=${() => refreshOrders().then(() => toast('Up to date.')).catch(toastError)}><${Icon} name="refresh" size=${16} />Refresh</button>
    <//>
    <div class="stats stats-3">
      ${cards.map((c) => html`<a class=${'stat stat-' + c.n} href=${hrefFor('orders/' + c.s)}>
        <span class="stat-top"><span class="stat-label">${ORDER_STATUS[c.s].label}</span><span class="stat-icon"><${Icon} name=${ORDER_STATUS[c.s].icon} size=${18} /></span></span>
        <span class="stat-value">${by(c.s).length}</span><span class="stat-sub">${c.sub}</span></a>`)}
    </div>
    <div class="dash-grid">
      <section class="card">
        <header class="card-head"><h2>Due soonest</h2><span class="muted">Not completed yet</span></header>
        ${dueSoon.length ? html`<ul class="order-mini">${dueSoon.map((o) => html`<li key=${o.id}><a href=${hrefFor('order/' + o.id)}>
            <span><b>${o.order_no}</b> · ${o.customer_name || 'Customer'}<span class="muted small"> — ${o.summary || ''}${o.quantity ? ' × ' + o.quantity : ''}</span></span>
            <span class="order-mini-right"><${DueCell} order=${o} /><${StatusPill} status=${o.status} /></span></a></li>`)}</ul>`
        : html`<${Empty} icon="check" title="Nothing due">No open orders with a due date.<//>`}
      </section>
      <section class="card">
        <header class="card-head"><h2>Latest orders</h2><a class="link" href=${hrefFor('orders/new')}>All new orders →</a></header>
        ${orders.length ? html`<ul class="order-mini">${orders.slice(0, 6).map((o) => html`<li key=${o.id}><a href=${hrefFor('order/' + o.id)}>
            <span><b>${o.order_no}</b> · ${o.customer_name || 'Customer'}<span class="muted small"> — ${timeAgo(o.created_at)}</span></span>
            <${StatusPill} status=${o.status} /></a></li>`)}</ul>`
        : html`<${Empty} icon="inbox" title="No orders yet">Share your customer order link to start receiving orders.<//>`}
      </section>
    </div>`;
}

function OrderList({ status, query }) {
  const { orders } = usePrint();
  const q = (query.q || '').toLowerCase();
  const sort = query.sort || (status === 'completed' ? 'newest' : 'due');
  const rows = orders.filter((o) => o.status === status)
    .filter((o) => !q || [o.order_no, o.customer_name, o.company, o.summary, o.phone, o.email].join(' ').toLowerCase().includes(q))
    .sort(sort === 'due' ? ((a, b) => ((a.due_date || '9999') > (b.due_date || '9999') ? 1 : -1)) : byNewest);
  const set = (patch) => go('orders/' + status, { ...query, ...patch }, { replace: true });
  return html`
    <${PageHead} title=${ORDER_STATUS[status].label + ' orders'} sub=${ORDER_STATUS[status].hint}>
      <button class="btn btn-ghost" onClick=${() => refreshOrders().catch(toastError)}><${Icon} name="refresh" size=${16} />Refresh</button>
    <//>
    <${Tabs} value=${status} onChange=${(s) => go('orders/' + s)} items=${STATUS_ORDER.map((s) => ({ id: s, label: ORDER_STATUS[s].label, count: orders.filter((o) => o.status === s).length }))} />
    <div class="filters">
      <label class="search"><${Icon} name="search" size=${16} />
        <input type="search" placeholder="Search order no., customer, company, item…" value=${query.q || ''} onInput=${(e) => set({ q: e.target.value })} />
      </label>
      <select value=${sort} onChange=${(e) => set({ sort: e.target.value })} aria-label="Sort">
        <option value="due">Due date (soonest first)</option><option value="newest">Newest first</option>
      </select>
    </div>
    ${rows.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Order</th><th>Customer</th><th>Item</th><th class="num">Qty</th><th>Due</th><th>Received</th><th></th></tr></thead>
      <tbody>${rows.map((o) => html`<tr key=${o.id} onClick=${() => go('order/' + o.id)}>
        <td data-label="Order"><b>${o.order_no}</b></td>
        <td data-label="Customer">${o.customer_name || '—'}${o.company && html`<div class="muted small">${o.company}</div>`}</td>
        <td data-label="Item">${o.summary || '—'}</td>
        <td data-label="Qty" class="num">${o.quantity || '—'}</td>
        <td data-label="Due"><${DueCell} order=${o} /></td>
        <td data-label="Received" class="muted">${timeAgo(o.created_at)}</td>
        <td data-label="" class="row-action"><${NextAction} order=${o} small /></td>
      </tr>`)}</tbody></table></div>`
    : html`<${Empty} icon=${ORDER_STATUS[status].icon} title=${q ? 'No matches' : `No ${ORDER_STATUS[status].label.toLowerCase()} orders`} />`}`;
}

function FileTiles({ files }) {
  const links = useFileLinks(api, files);
  return html`<div class="file-tiles">${files.map((f) => {
    const l = links[f.id];
    const img = /^image\//.test(f.mime || '') || /\.(png|jpe?g|gif|webp)$/i.test(f.name);
    return html`<div class="file-tile" key=${f.id}>
      <a class="file-thumb" href=${l?.open} target="_blank" rel="noopener">
        ${img && l?.thumb ? html`<img src=${l.thumb} alt="" loading="lazy" />` : html`<${Icon} name="file" size=${26} />`}
      </a>
      <div class="file-tile-meta"><b class="small break">${f.name}</b><span class="muted small">${fmtBytes(f.size)}</span></div>
      <div class="file-tile-actions no-print">
        ${l && html`<a class="btn btn-sm" href=${l.open} target="_blank" rel="noopener"><${Icon} name="external" size=${13} />Open</a>
        <a class="btn btn-sm btn-ghost" href=${l.download} download=${f.name} target="_blank" rel="noopener"><${Icon} name="download" size=${13} />Download</a>`}
      </div>
    </div>`;
  })}</div>`;
}

// Plays a customer's voice note (Drive player in the Google version, the browser's own player otherwise).
function VoiceNotes({ files }) {
  const links = useFileLinks(api, files);
  return html`<div class="voice-notes">${files.map((f) => {
    const l = links[f.id];
    return html`<div class="voice-note" key=${f.id}>
      <span class="voice-label"><${Icon} name="mic" size=${14} />Voice note</span>
      ${!l ? html`<span class="muted small">Loading…</span>`
        : api.mode === 'google' ? html`<iframe class="voice-frame" src=${l.preview} title="Voice note" allow="autoplay"></iframe>`
        : l.preview ? html`<audio controls src=${l.preview} preload="metadata"></audio>` : html`<span class="muted small">File not available in this browser.</span>`}
      ${l && html`<a class="btn btn-sm btn-ghost no-print" href=${l.download} download=${f.name} target="_blank" rel="noopener"><${Icon} name="download" size=${13} />Download</a>`}
    </div>`;
  })}</div>`;
}

function OrderDetail({ id }) {
  const { orders, role } = usePrint();
  const o = orders.find((x) => x.id === id);
  const [notes, setNotes] = useState(o?.internal_notes || '');
  useEffect(() => setNotes(o?.internal_notes || ''), [o?.id]);
  if (!o) return html`<${Empty} icon="inbox" title="Order not found"><a class="link" href=${hrefFor('')}>Back to overview</a><//>`;
  const late = isOverdue(o);
  const phoneDigits = (o.phone || '').replace(/[^\d]/g, '');
  const saveNotes = async () => {
    if ((notes || '') === (o.internal_notes || '')) return;
    try { replaceOrder(await api.print.update(getKey(), o.id, { internal_notes: notes })); toast('Notes saved.'); } catch (e) { toastError(e); }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete ${o.order_no}?`, message: 'The order and its attached files are removed. This can\'t be undone.', confirmLabel: 'Delete order', danger: true }))) return;
    try { await api.print.remove(getKey(), o.id); setP({ orders: P.orders.filter((x) => x.id !== o.id) }); toast('Order deleted.'); go('orders/' + o.status); } catch (e) { toastError(e); }
  };
  const notifyAgain = async (kind) => {
    try {
      const u = await api.print.notify(getKey(), o.id, kind);
      replaceOrder(u);
      const h = u.history[u.history.length - 1];
      toast(h.ok ? 'Sent to your bot.' : h.detail, h.ok ? 'ok' : 'error');
    } catch (e) { toastError(e); }
  };
  return html`
    <${PageHead} title=${'Order ' + o.order_no} sub=${`Received ${fmtDate(o.created_at)}, ${new Date(o.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${timeAgo(o.created_at)}`}
        back=${{ href: hrefFor('orders/' + o.status), label: ORDER_STATUS[o.status].label + ' orders' }}>
      <button class="btn btn-ghost" onClick=${() => window.print()}><${Icon} name="printer" size=${16} />Print job sheet</button>
      ${role === 'master' && html`<button class="btn btn-ghost-danger" onClick=${remove}><${Icon} name="trash" size=${16} />Delete</button>`}
    <//>
    <section class="card status-card">
      <div class="status-track">
        ${STATUS_ORDER.map((s, i) => html`<button key=${s} class=${'track-step tone-' + ORDER_STATUS[s].tone + (o.status === s ? ' on' : '') + (STATUS_ORDER.indexOf(o.status) > i ? ' past' : '')}
            aria-pressed=${o.status === s} onClick=${() => o.status !== s && changeStatus(o, s)}>
          <span class="track-dot">${STATUS_ORDER.indexOf(o.status) > i ? html`<${Icon} name="check" size=${12} />` : i + 1}</span>${ORDER_STATUS[s].label}
        </button>`)}
      </div>
      <div class="status-actions no-print">
        ${late && html`<${Pill} tone="bad" icon="alert">Past due date<//>`}
        ${o.status === 'new' && P.botLinked && html`<button class="btn btn-ghost" onClick=${() => notifyAgain('created')}><${Icon} name="refresh" size=${14} />Send to bot again</button>`}
        ${o.status === 'new' && html`<${WhatsAppButton} order=${o} kind="created" />
          <button class="btn btn-primary" onClick=${() => changeStatus(o, 'pending')}><${Icon} name="play" size=${14} />Start working on it</button>`}
        ${o.status === 'pending' && html`<button class="btn btn-good" onClick=${() => changeStatus(o, 'completed')}><${Icon} name="check" size=${16} />Mark as completed</button>`}
        ${o.status === 'completed' && html`<${WhatsAppButton} order=${o} kind="completed" primary />
          ${P.botLinked && html`<button class="btn btn-ghost" onClick=${() => notifyAgain('completed')}><${Icon} name="refresh" size=${14} />Send to bot again</button>`}`}
      </div>
    </section>

    <div class="order-layout">
      <section class="card">
        <header class="card-head"><h2>Order details</h2></header>
        <dl class="answers">
          ${(o.answers || []).filter((a) => !a.hidden && a.type !== 'file' && a.type !== 'voice_text').map((a) => html`<div key=${a.id}><dt>${a.label}</dt><dd>${answerText(a)}</dd></div>`)}
        </dl>
        ${(o.answers || []).filter((a) => !a.hidden && a.type === 'voice_text').map((a) => html`<div key=${a.id} class="answers-files">
          <h3>${a.label}</h3>
          ${a.value?.text ? html`<p class="brief">${a.value.text}</p>` : !a.value?.files?.length && html`<p class="muted small">No answer.</p>`}
          ${a.value?.files?.length > 0 && html`<${VoiceNotes} files=${a.value.files} />`}
        </div>`)}
        ${(o.answers || []).filter((a) => !a.hidden && a.type === 'file').map((a) => html`<div key=${a.id} class="answers-files">
          <h3>${a.label}</h3>${a.value?.length ? html`<${FileTiles} files=${a.value} />` : html`<p class="muted small">No files attached.</p>`}</div>`)}
      </section>
      <div class="stack">
        <section class="card">
          <header class="card-head"><h2>Customer</h2></header>
          <dl class="facts">
            <dt>Name</dt><dd>${o.customer_name || '—'}</dd>
            ${o.company && html`<dt>Company</dt><dd>${o.company}</dd>`}
            ${o.phone && html`<dt>Phone</dt><dd><a class="link" href=${'tel:' + o.phone}>${o.phone}</a>
              ${phoneDigits.length >= 8 && html` · <a class="link" href=${waLink(o.phone, '', CC)} target="_blank" rel="noopener">WhatsApp</a>`}</dd>`}
            ${o.email && html`<dt>Email</dt><dd><a class="link" href=${'mailto:' + o.email}>${o.email}</a></dd>`}
            <dt>Due</dt><dd><${DueCell} order=${o} /></dd>
          </dl>
        </section>
        <section class="card">
          <header class="card-head"><h2>Internal notes</h2><span class="muted small">Only your team sees these</span></header>
          <textarea rows="4" value=${notes} placeholder="e.g. Using 300gsm stock, proof sent on WhatsApp" onInput=${(e) => setNotes(e.target.value)} onBlur=${saveNotes}></textarea>
        </section>
        <section class="card">
          <header class="card-head"><h2>History</h2></header>
          <ol class="timeline">${[...(o.history || [])].reverse().map((h, i) => html`<li key=${i} class=${h.event === 'team' ? (h.ok ? 'ok' : 'warn') : h.event === 'whatsapp' ? 'wa' : h.event === 'notify' ? (h.ok ? 'ok' : 'warn') : 'tone-' + (ORDER_STATUS[h.status]?.tone || 'neutral')}>
            <b>${h.event === 'team' ? (h.ok ? 'Team alerted by email' : 'Team email not sent')
              : h.event === 'whatsapp' ? `WhatsApp opened — “${h.kind === 'created' ? 'order received' : 'ready for pickup'}” message`
              : h.event === 'notify'
              ? (h.kind === 'created' ? (h.ok ? 'Bot told about the new order' : 'Bot not reached (new order)') : h.ok ? 'Bot told the order is ready' : 'Bot not reached (order ready)')
              : h.status === 'new' ? 'Order placed' : 'Moved to ' + ORDER_STATUS[h.status]?.label}</b>
            <span class="muted small">${fmtDate(h.at)} ${new Date(h.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${h.by ? ' · by ' + h.by : ''}</span>
            ${h.detail && html`<span class="small">${h.detail}</span>`}
          </li>`)}</ol>
        </section>
      </div>
    </div>`;
}

// "Only show this question when <earlier question> is / isn't one of …"
function ConditionEditor({ q, i, all, update }) {
  const candidates = all.slice(0, i).filter((x) => hasOptions(x.type));
  const c = q.showIf;
  if (!candidates.length && !c) return null;
  const parent = c && all.find((x) => x.id === c.q);
  return html`<div class="cond">
    <label class="check-row"><input type="checkbox" checked=${!!c}
      onChange=${(e) => update({ showIf: e.target.checked ? { q: candidates[candidates.length - 1]?.id, op: 'in', values: [] } : null })} />
      Only show this question when…</label>
    ${c && html`<div class="cond-row">
      <select value=${c.q} onChange=${(e) => update({ showIf: { ...c, q: e.target.value, values: [] } })} aria-label="Depends on">
        ${!parent && html`<option value=${c.q}>(question removed)</option>`}
        ${candidates.map((x) => html`<option value=${x.id}>${x.label || 'Untitled question'}</option>`)}
      </select>
      <select value=${c.op} onChange=${(e) => update({ showIf: { ...c, op: e.target.value } })} aria-label="Condition">
        <option value="in">is one of</option><option value="not_in">is NOT one of</option>
      </select>
    </div>
    ${parent ? html`<${MultiChips} options=${(parent.options || []).map((x) => x.trim()).filter(Boolean)} value=${c.values || []}
        onChange=${(v) => update({ showIf: { ...c, values: v } })} />
      ${!(c.values || []).length && html`<span class="error-text small">Pick at least one answer above.</span>`}`
      : html`<span class="error-text small">The question this depends on was removed or moved below. Pick another, or untick.</span>`}`}
  </div>`;
}

function QuestionEditor({ q, i, count, all, update, move, remove }) {
  return html`<div class="q-edit card">
    <div class="q-edit-top">
      <span class="q-num">${i + 1}</span>
      <input class="q-label" value=${q.label} placeholder="Question" onInput=${(e) => update({ label: e.target.value })} aria-label="Question" />
      <select value=${q.type} onChange=${(e) => update({ type: e.target.value })} aria-label="Answer type">
        ${QUESTION_TYPES.map((t) => html`<option value=${t.id}>${t.label}</option>`)}
      </select>
      <div class="q-tools">
        <button class="icon-btn" data-tip="Move up" disabled=${i === 0} onClick=${() => move(-1)}>↑</button>
        <button class="icon-btn" data-tip="Move down" disabled=${i === count - 1} onClick=${() => move(1)}>↓</button>
        <button class="icon-btn" data-tip="Remove question" onClick=${remove}><${Icon} name="trash" size=${15} /></button>
      </div>
    </div>
    <div class="q-edit-grid">
      <${Field} label="Help text (optional)"><input value=${q.help || ''} onInput=${(e) => update({ help: e.target.value })} placeholder="Shown under the question" /><//>
      <${Field} label="Show in order list as">
        <select value=${q.role || ''} onChange=${(e) => update({ role: e.target.value })}>${QUESTION_ROLES.map((r) => html`<option value=${r.id}>${r.label}</option>`)}</select>
      <//>
      ${hasOptions(q.type) && html`<${Field} label="Choices (one per line)" wide>
        <textarea rows="4" value=${(q.options || []).join('\n')} onInput=${(e) => update({ options: e.target.value.split('\n') })}></textarea><//>`}
    </div>
    <label class="check-row"><input type="checkbox" checked=${!!q.required} onChange=${(e) => update({ required: e.target.checked })} /> Required</label>
    <${ConditionEditor} q=${q} i=${i} all=${all} update=${update} />
    ${q.showIf && html`<span class="muted small">Hidden questions are skipped — “Required” only applies when it's shown.</span>`}
  </div>`;
}

function FormEditor() {
  const { questions, settings } = usePrint();
  const [draft, setDraft] = useState(questions);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(questions), [questions]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(questions);
  const update = (i, patch) => setDraft((d) => d.map((q, j) => {
    if (j === i) return { ...q, ...patch };
    return patch.role && q.role === patch.role ? { ...q, role: '' } : q; // each "show as" is used once
  }));
  const move = (i, dir) => setDraft((d) => { const n = [...d]; [n[i], n[i + dir]] = [n[i + dir], n[i]]; return n; });
  const save = async () => {
    const clean = draft.map((q) => ({ ...q, label: q.label.trim(), options: hasOptions(q.type) ? (q.options || []).map((x) => x.trim()).filter(Boolean) : [] }));
    if (clean.some((q) => !q.label)) return toast('Every question needs a label.', 'error');
    if (clean.some((q) => hasOptions(q.type) && !q.options.length)) return toast('Choice questions need at least one choice.', 'error');
    if (clean.some((q) => q.showIf && !(q.showIf.values || []).length)) return toast('A “only show when” rule needs at least one answer picked.', 'error');
    setBusy(true);
    try { const saved = await api.print.saveQuestions(getKey(), clean); setP({ questions: saved }); toast('Order form saved.'); } catch (e) { toastError(e); }
    setBusy(false);
  };
  return html`
    <${PageHead} title="Order form" sub="The questions customers answer when they place an order. Changes only affect new orders.">
      ${settings && html`<a class="btn" href=${linkFor('order', settings.orderKey)} target="_blank" rel="noopener"><${Icon} name="external" size=${16} />Preview form</a>`}
      <button class="btn btn-primary" disabled=${!dirty || busy} onClick=${save}><${Icon} name="check" size=${16} />${busy ? 'Saving…' : 'Save form'}</button>
    <//>
    <div class="q-list">
      ${draft.map((q, i) => html`<${QuestionEditor} key=${q.id} q=${q} i=${i} count=${draft.length} all=${draft}
        update=${(p) => update(i, p)} move=${(d) => move(i, d)} remove=${() => setDraft((d) => d.filter((_, j) => j !== i))} />`)}
      <button class="add-q" onClick=${() => setDraft((d) => [...d, { id: newQuestionId(), label: '', type: 'text', required: false, help: '', role: '', options: [] }])}>
        <${Icon} name="plus" size=${16} />Add a question</button>
    </div>
    ${dirty && html`<div class="save-bar"><span>You have unsaved changes</span><span class="spacer"></span>
      <button class="btn" onClick=${() => setDraft(questions)}>Discard</button>
      <button class="btn btn-primary" disabled=${busy} onClick=${save}>Save form</button></div>`}`;
}

function LinkCard({ title, hint, url, active, canDisable, onToggle, onChange, warn }) {
  return html`<section class=${'card access-card' + (active === false ? ' inactive' : '')}>
    <header class="card-head"><h2>${title}</h2>${active !== undefined && html`<${Pill} tone=${active ? 'good' : 'neutral'}>${active ? 'Active' : 'Disabled'}<//>`}</header>
    <p class="muted small">${hint}</p>
    ${warn && html`<p class="small warn-text"><${Icon} name="alert" size=${14} /> ${warn}</p>`}
    <div class="url-box">
      <code>${active === false ? url.replace(/(#k?=?)[^#]*$/, '$1' + '•'.repeat(12)) : url}</code>
      <button class="btn btn-sm" disabled=${active === false} onClick=${async () => { await copyText(url); toast('Link copied.'); }}><${Icon} name="copy" size=${14} />Copy</button>
    </div>
    <div class="page-actions">
      ${canDisable && html`<button class="btn btn-sm" onClick=${onToggle}><${Icon} name=${active ? 'pause' : 'power'} size=${14} />${active ? 'Disable' : 'Enable'}</button>`}
      <button class="btn btn-sm" onClick=${onChange}><${Icon} name="refresh" size=${14} />Change link</button>
    </div>
  </section>`;
}

function useSaver(pickFn, extra) {
  const { settings } = usePrint();
  const [d, setD] = useState(() => pickFn(settings));
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(pickFn(settings));
  useEffect(() => setD(pickFn(settings)), [key]);
  const dirty = JSON.stringify(d) !== key;
  const save = async (payload) => {
    setBusy(true);
    try {
      const s = await api.print.saveSettings(getKey(), payload || d);
      setP({ settings: s, botLinked: !!s.webhookUrl, readyMessage: s.readyMessage, newOrderMessage: s.newOrderMessage, notifyOnDone: s.notifyOnDone });
      toast('Saved.');
      extra?.();
    } catch (e) { toastError(e); }
    setBusy(false);
  };
  return { settings, d, setD, set: (k) => (v) => setD((x) => ({ ...x, [k]: v })), dirty, busy, save };
}

function MessagesCard() {
  const { d, set, dirty, busy, save } = useSaver((s) => ({ newOrderMessage: s.newOrderMessage || '', readyMessage: s.readyMessage || '' }));
  const box = (title, k) => html`<div class="bot-event">
    <b>${title}</b>
    <textarea rows="2" value=${d[k]} onInput=${(e) => set(k)(e.target.value)}></textarea>
    <div class="msg-preview"><span class="muted small">Preview</span>${fillMessage(d[k], SAMPLE_ORDER)}</div>
  </div>`;
  return html`<section class="card bot-card">
    <header class="card-head"><h2>Customer messages</h2></header>
    <p class="muted small">Sent by your bot, and used by the one-tap WhatsApp buttons on each order. You can use ${MESSAGE_TAGS.join(' ')}.</p>
    ${box('“Order received”', 'newOrderMessage')}
    ${box('“Ready for pickup”', 'readyMessage')}
    <div class="page-actions"><button class="btn btn-primary" disabled=${!dirty || busy} onClick=${() => save()}>${busy ? 'Saving…' : 'Save messages'}</button></div>
  </section>`;
}

function TeamAlertsCard() {
  const pick = (s) => ({ teamEmails: s.teamEmails || '', teamEmailOn: !!s.teamEmailOn });
  const siteUrl = new URL('index.html', location.href.split('#')[0]).href;
  const { settings, d, set, dirty, busy, save } = useSaver(pick);
  const test = async () => {
    try { const r = await api.print.testTeamEmail(getKey()); toast(r.detail, r.ok ? 'ok' : 'error'); } catch (e) { toastError(e); }
  };
  return html`<section class="card bot-card">
    <header class="card-head"><h2>Team alerts — new orders</h2>
      <${Pill} tone=${settings.teamEmailOn && settings.teamEmails ? 'good' : 'neutral'}>${settings.teamEmailOn && settings.teamEmails ? 'Email alerts on' : 'Email alerts off'}<//></header>
    <p class="muted small">Let your in-house team know the moment an order comes in:</p>
    <ul class="alert-ways small">
      <li><b>Email</b> — everyone below gets the order details and an “Open the order” button${api.mode === 'google' ? " (sent from your Google account, so it's free)" : ''}.</li>
      <li><b>On each teammate's device</b> — the Print Hub asks each person the first time they open it (they can also use <b>New-order alerts</b>
        at the bottom of the menu): a chime and a pop-up while the Print Hub is open. Works on computers and Android; on iPhones use email or your bot.</li>
      <li><b>Your bot</b> — every new order it receives includes a ready-made <code>team_message</code> it can post to your team's WhatsApp or Telegram group.</li>
    </ul>
    ${!P.emailReady && html`<p class="info-box"><${Icon} name="alert" size=${16} /><span>Email sending isn't connected yet — add a free Resend key to the server first
      (README → <b>Team email alerts</b>). Device alerts and your bot work without it.</span></p>`}
    <div class="form-grid">
      <${Field} label="Team email addresses" hint="Separate with commas" wide>
        <input value=${d.teamEmails} placeholder="production@gig.com, boss@gig.com" onInput=${(e) => set('teamEmails')(e.target.value)} /><//>
    </div>
    <div class="switch-list">
      <label class="switch-row"><span class="switch"><input type="checkbox" checked=${d.teamEmailOn} onChange=${(e) => set('teamEmailOn')(e.target.checked)} /><span></span></span>
        <span>Email the team when a new order comes in</span></label>
    </div>
    <div class="page-actions">
      <button class="btn btn-primary" disabled=${!dirty || busy} onClick=${() => save({ ...d, siteUrl })}>${busy ? 'Saving…' : 'Save team alerts'}</button>
      <button class="btn" disabled=${!settings.teamEmails || dirty} onClick=${test}><${Icon} name="mail" size=${16} />Send a test email</button>
    </div>
  </section>`;
}

function BotCard() {
  const pick = (s) => ({ webhookUrl: s.webhookUrl || '', webhookSecret: s.webhookSecret || '', notifyOnNew: s.notifyOnNew !== false, notifyOnDone: s.notifyOnDone !== false });
  const { settings, d, set, dirty, busy, save } = useSaver(pick);
  const [showPayload, setShowPayload] = useState(false);
  const test = async (kind) => {
    try { const r = await api.print.testNotify(getKey(), kind); toast(r.detail, r.ok ? 'ok' : 'error'); } catch (e) { toastError(e); }
  };
  const canTest = !!settings.webhookUrl && !dirty;
  const toggle = (k, label, kind) => html`<div class="switch-row">
    <label class="switch"><input type="checkbox" checked=${d[k]} onChange=${(e) => set(k)(e.target.checked)} /><span></span></label>
    <span class="grow">${label}</span>
    <button class="btn btn-sm btn-ghost" disabled=${!canTest} onClick=${() => test(kind)}><${Icon} name="mail" size=${14} />Test</button></div>`;
  return html`<section class="card bot-card">
    <header class="card-head"><h2>Bot connection</h2>
      <${Pill} tone=${settings.webhookUrl ? 'good' : 'neutral'}>${settings.webhookUrl ? 'Bot linked' : 'No bot yet'}<//></header>
    <p class="muted small">Your bot sends the WhatsApp messages automatically. Each new and completed order is sent to it with the customer's
      details and the messages above (plus a ready-made <code>team_message</code> it can post to your team's group). Paste the link your
      bot gives you — often called a “webhook URL”.</p>
    ${html`
      <div class="form-grid">
        <${Field} label="Bot link (webhook URL)" wide><input type="url" value=${d.webhookUrl} placeholder="https://…" onInput=${(e) => set('webhookUrl')(e.target.value)} /><//>
        <${Field} label="Secret (optional)" hint="Sent as the X-Webhook-Secret header" wide><input value=${d.webhookSecret} onInput=${(e) => set('webhookSecret')(e.target.value)} autocomplete="off" /><//>
      </div>
      <div class="switch-list">
        ${toggle('notifyOnNew', 'Tell the bot when a new order comes in', 'created')}
        ${toggle('notifyOnDone', 'Tell the bot when an order is completed', 'completed')}
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" disabled=${!dirty || busy} onClick=${() => save()}>${busy ? 'Saving…' : 'Save bot settings'}</button>
        <button class="btn btn-ghost" onClick=${() => setShowPayload(!showPayload)}>${showPayload ? 'Hide' : 'Show'} what the bot receives</button>
      </div>
      ${showPayload && html`<div class="payload-grid">
        <div><h3>New order</h3><pre class="code payload">${JSON.stringify(notifyPayload('created', SAMPLE_ORDER, settings.newOrderMessage), null, 2)}</pre></div>
        <div><h3>Order completed</h3><pre class="code payload">${JSON.stringify(notifyPayload('completed', SAMPLE_ORDER, settings.readyMessage), null, 2)}</pre></div>
      </div>`}`}
  </section>`;
}

function Access() {
  const { settings } = usePrint();
  const act = async (fn, msg) => {
    try { const s = await fn(); setP({ settings: s }); if (msg) toast(msg); return s; } catch (e) { toastError(e); return null; }
  };
  const change = async (which, label) => {
    const ok = await confirmDialog({ title: `Change the ${label}?`, message: 'A new link is created and the old one stops working immediately. You\'ll need to share the new one.', confirmLabel: 'Change link' });
    if (!ok) return;
    const usingThis = getKey() && getKey() === settings[which + 'Key'];
    const s = await act(() => api.print.regenerate(getKey(), which), 'New link created — the old one no longer works.');
    if (s && usingThis) setKey(s[which + 'Key']);
  };
  const toggle = (which, active) => act(() => api.print.setActive(getKey(), which, !active), active ? 'Link disabled.' : 'Link enabled.');
  return html`
    <${PageHead} title="Links & access" sub="Customers order through one shared link, each staff member has their own link, and master runs everything." />
    <div class="access-grid access-grid-2">
      <${LinkCard} title="Customer order link" url=${linkFor('order', settings.orderKey)} active=${settings.orderActive} canDisable
        hint="One link for all customers — share it on WhatsApp, your Instagram bio or website. Anyone with it can place an order."
        onToggle=${() => toggle('order', settings.orderActive)} onChange=${() => change('order', 'customer order link')} />
      <${LinkCard} title="Master link" url=${linkFor('master', settings.masterKey)}
        hint="Full control: everything staff can do, plus the order form, these links, the bot and deleting orders. Your Creative Hub team always has master access."
        warn="Keep this one private." onChange=${() => change('master', 'master link')} />
    </div>
    <${StaffLinks} />
    <${MessagesCard} />
    <${BotCard} />
    <${TeamAlertsCard} />`;
}

// One private admin link per staff member — no account or password, and each can be turned off on its own.
function StaffLinks() {
  const { staff } = usePrint();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn, msg) => {
    try { const list = await fn(); setP({ staff: list }); if (msg) toast(msg); return list; } catch (e) { toastError(e); return null; }
  };
  const add = async () => {
    const n = name.trim();
    if (!n) return toast("Type the person's name first.", 'error');
    setBusy(true);
    const before = new Set(staff.map((s) => s.id));
    const list = await run(() => api.print.staffAdd(getKey(), n));
    setBusy(false);
    const made = list?.find((s) => !before.has(s.id));
    if (!made) return;
    setName('');
    await copyText(linkFor('admin', made.key));
    toast(`Link for ${made.name} created and copied — send it to them.`);
  };
  const change = async (s) => {
    if (!(await confirmDialog({ title: `Change ${s.name}'s link?`, message: 'They get a new link and the old one stops working immediately. Send them the new one.', confirmLabel: 'Change link' }))) return;
    const list = await run(() => api.print.staffRegenerate(getKey(), s.id));
    const fresh = list?.find((x) => x.id === s.id);
    if (fresh) { await copyText(linkFor('admin', fresh.key)); toast(`New link for ${s.name} copied — their old one no longer works.`); }
  };
  const toggle = (s) => run(() => api.print.staffUpdate(getKey(), s.id, { active: !s.active }),
    s.active ? `${s.name}'s link is turned off.` : `${s.name}'s link is on again.`);
  const rename = (s) => {
    const n = prompt('Name for this link:', s.name);
    if (n != null && n.trim() && n.trim() !== s.name) run(() => api.print.staffUpdate(getKey(), s.id, { name: n.trim() }), 'Renamed.');
  };
  const remove = async (s) => {
    if (!(await confirmDialog({ title: `Delete ${s.name}'s link?`, message: 'Their link stops working for good. Their name stays in the history of orders they worked on.', confirmLabel: 'Delete', danger: true }))) return;
    run(() => api.print.staffDelete(getKey(), s.id), `${s.name}'s link is deleted.`);
  };
  return html`<section class="card staff-card">
    <header class="card-head"><h2>Staff links</h2><${Pill} tone="neutral">${staff.length} ${staff.length === 1 ? 'person' : 'people'}<//></header>
    <p class="muted small">Give each staff member their own link — no account or password. They open it and go straight to the orders:
      move them New → Pending → Completed, add notes and print job sheets (they can't change settings or delete orders).
      Turn off or change one person's link without affecting anyone else. Order history shows who did what.</p>
    <div class="inline-form staff-add">
      <input value=${name} maxlength="60" placeholder="Their name, e.g. Ali (production)" aria-label="Staff member's name"
        onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') add(); }} />
      <button class="btn btn-primary" disabled=${busy} onClick=${add}><${Icon} name="plus" size=${16} />Create link</button>
    </div>
    ${staff.length ? html`<ul class="staff-list">${staff.map((s) => {
      const url = linkFor('admin', s.key);
      return html`<li key=${s.id} class=${s.active ? '' : 'inactive'}>
        <div class="staff-top">
          <b>${s.name}</b><${Pill} tone=${s.active ? 'good' : 'neutral'}>${s.active ? 'Active' : 'Off'}<//>
          <span class="muted small staff-used">${s.last_used_at ? 'Last opened ' + timeAgo(s.last_used_at) : 'Not opened yet'}</span>
        </div>
        <div class="url-box">
          <code>${s.active ? url : url.replace(/(#k=)[^#]*$/, '$1' + '•'.repeat(12))}</code>
          <button class="btn btn-sm" disabled=${!s.active} onClick=${async () => { await copyText(url); toast(`${s.name}'s link copied.`); }}><${Icon} name="copy" size=${14} />Copy</button>
        </div>
        <div class="page-actions">
          <button class="btn btn-sm" onClick=${() => toggle(s)}><${Icon} name=${s.active ? 'pause' : 'power'} size=${14} />${s.active ? 'Turn off' : 'Turn on'}</button>
          <button class="btn btn-sm" onClick=${() => change(s)}><${Icon} name="refresh" size=${14} />Change link</button>
          <button class="btn btn-sm btn-ghost" onClick=${() => rename(s)}><${Icon} name="edit" size=${14} />Rename</button>
          <button class="btn btn-sm btn-ghost-danger" onClick=${() => remove(s)}><${Icon} name="trash" size=${14} />Delete</button>
        </div>
      </li>`;
    })}</ul>` : html`<p class="muted small">No staff links yet — type a name above to create the first one.</p>`}
  </section>`;
}

// ── Shell ──────────────────────────────────────────────────────────────────
function useRoute() {
  const [r, setR] = useState(parseHash);
  useEffect(() => { const on = () => setR(parseHash()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  return r;
}

function AlertToggle() {
  const [on, setOn] = useState(alertsOn());
  useEffect(() => { const f = () => setOn(alertsOn()); addEventListener('gig-alerts', f); return () => removeEventListener('gig-alerts', f); }, []);
  const toggle = async () => {
    if (on) { await turnOffAlerts(); setOn(false); toast('New-order alerts off on this device.'); dispatchEvent(new Event('gig-alerts')); return; }
    await turnOnAlerts();
    setOn(true);
    dispatchEvent(new Event('gig-alerts'));
  };
  return html`<button class=${'nav-item alert-toggle' + (on ? ' on' : '')} onClick=${toggle} aria-pressed=${on}
      data-tip=${P.pushKey ? 'A notification on this device for every new order — even when the app is closed' : 'Sound and pop-up on this device when a new order arrives, while this page is open'}>
    <${Icon} name="bell" /><span>New-order alerts</span><span class=${'mini-switch' + (on ? ' on' : '')}></span></button>`;
}

// Asks each teammate once, on their own device, whether they want new-order alerts.
function AlertBanner() {
  const [choice, setChoice] = useState(alertChoice());
  useEffect(() => { const f = () => setChoice(alertChoice()); addEventListener('gig-alerts', f); return () => removeEventListener('gig-alerts', f); }, []);
  if (choice) return null;
  const later = () => { try { localStorage.setItem(ALERT_KEY, 'off'); } catch {} setChoice('off'); dispatchEvent(new Event('gig-alerts'));
    toast('No problem — you can turn alerts on any time at the bottom of the menu.'); };
  const yes = async () => { await turnOnAlerts(); setChoice('on'); dispatchEvent(new Event('gig-alerts')); };
  return html`<div class="alert-banner no-print">
    <span class="alert-banner-icon"><${Icon} name="bell" size=${20} /></span>
    <div><b>Get alerted when a new order comes in?</b>
      <div class="small muted">${P.pushKey
        ? (isIPhone() && !isInstalledApp()
          ? 'This page will chime and show a pop-up while it\'s open. For alerts with the app closed, add it to your Home Screen first (Share → Add to Home Screen).'
          : 'You\'ll get a notification for every new order — even when the app is closed. Your phone or browser will ask you to allow notifications.')
        : 'This device will chime and show a pop-up while the Print Hub is open. Your browser will ask you to allow notifications.'}</div></div>
    <div class="alert-banner-actions">
      <button class="btn btn-primary btn-sm" onClick=${yes}><${Icon} name="bell" size=${14} />Turn on alerts</button>
      <button class="btn btn-ghost btn-sm" onClick=${later}>Not now</button>
    </div>
  </div>`;
}

function PrintBrand() {
  const words = CONFIG.BRAND_NAME.trim().split(/\s+/);
  const initials = /^[A-Z0-9]{2,3}$/.test(words[0]) ? words[0] : words.map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return html`<span class="brand">${CONFIG.LOGO_URL ? html`<img src=${CONFIG.LOGO_URL} alt="" />` : html`<span class="brand-mark">${initials}</span>`}
    <span class="brand-name">${PRINT_TITLE}</span></span>`;
}

function Shell() {
  const route = useRoute();
  const { orders, role } = usePrint();
  const [menuOpen, setMenuOpen] = useState(false);
  const [p0 = '', p1] = route.parts;
  useEffect(() => { setMenuOpen(false); window.scrollTo(0, 0); }, [route.parts.join('/')]);
  const count = (s) => orders.filter((o) => o.status === s).length;
  const master = role === 'master';
  let page;
  if (p0 === 'orders' && ORDER_STATUS[p1]) page = html`<${OrderList} status=${p1} query=${route.query} />`;
  else if (p0 === 'order' && p1) page = html`<${OrderDetail} id=${p1} />`;
  else if (p0 === 'form' && master) page = html`<${FormEditor} />`;
  else if (p0 === 'access' && master) page = html`<${Access} />`;
  else page = html`<${Overview} />`;
  const current = p0 === 'order' ? orders.find((o) => o.id === p1)?.status : p0 === 'orders' ? p1 : null;
  const waiting = count('new');
  useEffect(() => { document.title = waiting ? `(${waiting}) ${PRINT_TITLE}` : PRINT_TITLE; }, [waiting]);
  const item = (href, icon, label, active, badge) => html`<a href=${href} class=${'nav-item' + (active ? ' active' : '')} aria-current=${active ? 'page' : undefined}>
    <${Icon} name=${icon} /><span>${label}</span>${badge > 0 && html`<span class="nav-badge">${badge}</span>`}</a>`;
  const viaHub = !getKey();
  return html`<div class=${'shell' + (menuOpen ? ' menu-open' : '')}>
    <header class="topbar no-print">
      <button class="icon-btn" aria-label="Menu" onClick=${() => setMenuOpen(!menuOpen)}><${Icon} name="menu" /></button><${PrintBrand} />
    </header>
    <aside class="sidebar no-print">
      <a href=${hrefFor('')} class="sidebar-brand"><${PrintBrand} /></a>
      <nav>
        ${item(hrefFor(''), 'grid', 'Overview', !p0)}
        ${STATUS_ORDER.map((s) => item(hrefFor('orders/' + s), ORDER_STATUS[s].icon, ORDER_STATUS[s].label, current === s, s === 'completed' ? 0 : count(s)))}
        ${master && html`<div class="nav-divider"></div>
          ${item(hrefFor('form'), 'list', 'Order form', p0 === 'form')}
          ${item(hrefFor('access'), 'key', 'Links & access', p0 === 'access')}`}
      </nav>
      <div class="sidebar-foot">
        <${InstallButton} appName=${PRINT_TITLE} />
        <${AlertToggle} />
        ${viaHub && html`<a class="nav-item" href="../index.html"><${Icon} name="back" /><span>Back to Creative Hub</span></a>`}
        <div class="user-chip"><span class="avatar">${master ? 'M' : (P.name || 'A').trim().charAt(0).toUpperCase()}</span>
          <span class="user-email">${master ? 'Master access' : `${P.name || 'Staff'} · Admin`}</span>
          ${!viaHub && html`<button class="icon-btn" data-tip="Forget this link on this device" aria-label="Forget this link"
            onClick=${() => { setKey(null); location.reload(); }}><${Icon} name="logout" size=${16} /></button>`}
        </div>
      </div>
    </aside>
    <div class="scrim" onClick=${() => setMenuOpen(false)}></div>
    <main class="main">
      ${MODE === 'demo' && html`<div class="demo-banner no-print"><${Icon} name="alert" size=${16} /><span><b>Demo mode</b> — sample orders, saved only in this browser.</span></div>`}
      <${AlertBanner} />
      <${StorageWarning} storage=${P.storage} print />
      ${page}
    </main>
  </div>`;
}

// Paste an admin/master link (needed once inside an installed iPhone app, which doesn't share Safari's memory).
function PasteLink() {
  const [v, setV] = useState('');
  const go = () => {
    const m = String(v).match(/#k=([A-Za-z0-9]+)/) || String(v).trim().match(/^([A-Za-z0-9]{8,})$/);
    if (!m) return toast('That doesn’t look like an admin or master link — it contains “#k=”.', 'error');
    setKey(m[1]);
    location.replace(location.pathname + '#/');
    location.reload();
  };
  return html`<div class="paste-link">
    <input value=${v} placeholder="https://…/print/index.html#k=…" onInput=${(e) => setV(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && go()} aria-label="Your access link" />
    <button class="btn btn-primary btn-block" onClick=${go}><${Icon} name="key" size=${16} />Open with this link</button>
  </div>`;
}

function App() {
  const [phase, setPhase] = useState({ id: 'loading' });
  useEffect(() => {
    if (!api.print) return setPhase({ id: 'unsupported' });
    (async () => {
      try {
        const me = await api.print.me(getKey());
        const orders = await api.print.orders(getKey());
        setP({ loaded: true, role: me.role, name: me.name || '', staff: me.staff || [], pushKey: me.pushKey || null, questions: me.questions, settings: me.settings || null, botLinked: !!me.settings?.webhookUrl || !!me.botLinked,
               readyMessage: me.settings?.readyMessage || me.readyMessage || '', newOrderMessage: me.settings?.newOrderMessage || me.newOrderMessage || '',
               notifyOnDone: me.notifyOnDone !== false, emailReady: me.emailReady !== false, storage: me.storage || null,
               orders: orders.sort(byNewest) });
        setPhase({ id: 'ready' });
        if (alertsOn()) syncPush(true); // re-register this device so alerts keep arriving with the app closed
      } catch (e) {
        setPhase({ id: 'denied', message: e.message });
      }
    })();
    // New orders arrive from customers — check every 30 seconds while the page is open.
    const t = setInterval(() => { if (P.loaded) refreshOrders().catch(() => {}); }, 30000);
    return () => clearInterval(t);
  }, []);

  let body;
  if (phase.id === 'loading') body = html`<div class="loading"><div class="spinner"></div></div>`;
  else if (phase.id === 'unsupported') body = html`<div class="auth-page"><div class="auth-card card"><${PrintBrand} /><h1>Not available</h1>
    <p class="muted">The Print Hub works with the Cloudflare or Google setup (or the demo). See README.md.</p></div></div>`;
  else if (phase.id === 'denied') body = html`<div class="auth-page"><div class="auth-card card"><${PrintBrand} /><h1>${getKey() ? 'Link not valid' : 'Welcome'}</h1>
    <p class="muted">${getKey() ? phase.message : 'Paste the admin or master link you were given to get in — or sign in to the Creative Hub first and open Print Hub there.'}</p>
    <${PasteLink} />
    ${getKey() && html`<button class="btn btn-ghost btn-block" onClick=${() => { setKey(null); location.reload(); }}>Forget this link</button>`}
    <a class="btn btn-ghost btn-block" href="../index.html">Go to Creative Hub</a></div></div>`;
  else body = html`<${Shell} />`;
  return html`${body}<${DialogHost} /><${InstallHelpHost} /><${ToastHost} /><${TooltipHost} />`;
}

render(html`<${App} />`, document.getElementById('app'));
