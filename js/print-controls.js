// Links & access → Customers and → Master controls — shared by the Creative Hub (owners) and the Print Hub (master).
// <CustomerControls printKey data onChange />: the customer order link + the messages customers get.
// <MasterControls printKey data onChange />: the master link, the bot connection and the devices that get new-order alerts.
// printKey = the Print Hub link in use (null = a signed-in owner); data = { settings, devices, pushKey } from api.print.me();
// onChange(patch) gets the new values.
import { html, useState, useEffect } from './lib.js';
import { api } from './store.js';
import { fmtDate, copyText } from './util.js';
import { Icon, Pill, Field, confirmDialog, toast, toastError } from './ui.js';
import { LinkCard } from './team-access.js';
import { fillMessage, notifyPayload, SAMPLE_ORDER, MESSAGE_TAGS } from './print/model.js';

const SITE = new URL('../', import.meta.url).href; // the website's own folder

// Links & access is split into three pages (each app's menu folds them out under "Links & access").
export const ACCESS_PAGES = [
  { id: '', label: 'Team', title: 'Team', sub: 'Who can get in: share the join link, approve new people and manage everyone\'s access.' },
  { id: 'customers', label: 'Customers', title: 'Customer link & messages', sub: 'The order link your customers use, and the messages they get.' },
  { id: 'master', label: 'Master controls', title: 'Master controls', sub: 'Only for you: your master link, the order form, the bot connection and which devices get new-order alerts.' },
];
export const orderLink = (key) => SITE + 'print/order.html#' + key;
export const masterLink = (key) => SITE + 'print/index.html#k=' + key;

// Change / turn on-off a link kept in the Print Hub settings ('order', 'master').
function useLinkActions(printKey, onChange) {
  const act = async (fn, msg) => {
    try { const s = await fn(); onChange({ settings: s }); if (msg) toast(msg); return s; } catch (e) { toastError(e); return null; }
  };
  const change = async (which, label) => {
    const ok = await confirmDialog({ title: `Change the ${label}?`, message: 'A new link is created and the old one stops working immediately. You\'ll need to share the new one.', confirmLabel: 'Change link' });
    if (ok) await act(() => api.print.regenerate(printKey, which), 'New link created — the old one no longer works.');
  };
  const toggle = (which, active) => act(() => api.print.setActive(printKey, which, !active), active ? 'Link disabled.' : 'Link enabled.');
  return { change, toggle };
}

// Edits part of the Print Hub settings and saves it.
function useSaver(printKey, settings, onChange, pick) {
  const key = JSON.stringify(pick(settings || {}));
  const [d, setD] = useState(() => pick(settings || {}));
  const [busy, setBusy] = useState(false);
  useEffect(() => setD(pick(settings || {})), [key]);
  const save = async () => {
    setBusy(true);
    try { onChange({ settings: await api.print.saveSettings(printKey, d) }); toast('Saved.'); } catch (e) { toastError(e); }
    setBusy(false);
  };
  return { d, set: (k) => (v) => setD((x) => ({ ...x, [k]: v })), dirty: JSON.stringify(d) !== key, busy, save };
}

// ── Customers ─────────────────────────────────────────────────────────────
export function CustomerControls({ printKey = null, data, onChange }) {
  const { settings } = data || {};
  const { change, toggle } = useLinkActions(printKey, onChange);
  const { d, set, dirty, busy, save } = useSaver(printKey, settings, onChange, (s) => ({ newOrderMessage: s.newOrderMessage || '', readyMessage: s.readyMessage || '' }));
  if (!settings) return null;
  const box = (title, k) => html`<div class="bot-event">
    <b>${title}</b>
    <textarea rows="2" value=${d[k]} onInput=${(e) => set(k)(e.target.value)}></textarea>
    <div class="msg-preview"><span class="muted small">Preview</span>${fillMessage(d[k], SAMPLE_ORDER)}</div>
  </div>`;
  return html`
    <div class="access-grid access-grid-1">
      <${LinkCard} title="Customer order link" url=${orderLink(settings.orderKey)} active=${settings.orderActive} canDisable
        hint="One link for all customers — share it on WhatsApp, your Instagram bio or website. Anyone with it can place an order."
        onToggle=${() => toggle('order', settings.orderActive)} onChange=${() => change('order', 'customer order link')} />
    </div>
    <section class="card bot-card">
      <header class="card-head"><h2>Customer messages</h2></header>
      <p class="muted small">Sent by your bot, and used by the one-tap WhatsApp buttons on each order. You can use ${MESSAGE_TAGS.join(' ')}.</p>
      ${box('“Order received”', 'newOrderMessage')}
      ${box('“Ready for pickup”', 'readyMessage')}
      <div class="page-actions"><button class="btn btn-primary" disabled=${!dirty || busy} onClick=${save}>${busy ? 'Saving…' : 'Save messages'}</button></div>
    </section>`;
}

// ── Master controls ───────────────────────────────────────────────────────
export function MasterControls({ printKey = null, data, onChange, formHref }) {
  const { settings, devices = [], pushKey } = data || {};
  const { change } = useLinkActions(printKey, onChange);
  if (!settings) return null;
  return html`
    <section class="card access-card master-card">
      <header class="card-head"><h2><${Icon} name="key" size=${18} /> Master link</h2><${Pill} tone="bad">Keep private<//></header>
      <p class="muted small">Opens the Print Hub with full control. Only for you — never send it to your team (they use the join link).</p>
      <ul class="master-can">
        <li><${Icon} name="check" size=${14} />Everything the team can do with orders</li>
        <li><${Icon} name="check" size=${14} />Edit the customer order form</li>
        <li><${Icon} name="check" size=${14} />Manage the team, the join link and the customer link</li>
        <li><${Icon} name="check" size=${14} />The bot connection, customer messages and alert devices</li>
        <li><${Icon} name="check" size=${14} />Delete orders</li>
      </ul>
      <${LinkCardBody} url=${masterLink(settings.masterKey)} onChange=${() => change('master', 'master link')} />
      <p class="muted small">Signed in to the Creative Hub with your email and password? You already have master access there — no link needed.</p>
    </section>
    ${formHref && html`<section class="card master-row">
      <div><h2>Order form</h2><p class="muted small">The questions customers answer when they order.</p></div>
      <a class="btn" href=${formHref}><${Icon} name="list" size=${16} />Edit order form</a>
    </section>`}
    <${BotCard} printKey=${printKey} settings=${settings} onChange=${onChange} />
    <${AlertsCard} printKey=${printKey} devices=${devices} pushKey=${pushKey} onChange=${onChange} />`;
}

function LinkCardBody({ url, onChange }) {
  const [shown, setShown] = useState(false);
  return html`<div class="url-box">
      <code>${shown ? url : url.replace(/(#k=).*$/, '$1' + '•'.repeat(16))}</code>
      <button class="btn btn-sm btn-ghost" onClick=${() => setShown(!shown)}>${shown ? 'Hide' : 'Show'}</button>
      <button class="btn btn-sm" onClick=${async () => { await copyText(url); toast('Master link copied — keep it private.'); }}><${Icon} name="copy" size=${14} />Copy</button>
    </div>
    <div class="page-actions"><button class="btn btn-sm" onClick=${onChange}><${Icon} name="refresh" size=${14} />Change link</button></div>`;
}

function BotCard({ printKey, settings, onChange }) {
  const pick = (s) => ({ webhookUrl: s.webhookUrl || '', webhookSecret: s.webhookSecret || '', notifyOnNew: s.notifyOnNew !== false, notifyOnDone: s.notifyOnDone !== false });
  const { d, set, dirty, busy, save } = useSaver(printKey, settings, onChange, pick);
  const [showPayload, setShowPayload] = useState(false);
  const test = async (kind) => {
    try { const r = await api.print.testNotify(printKey, kind); toast(r.detail, r.ok ? 'ok' : 'error'); } catch (e) { toastError(e); }
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
      details and the customer messages (plus a ready-made <code>team_message</code> it can post to your team's group). Paste the link your
      bot gives you — often called a “webhook URL”.</p>
    <div class="form-grid">
      <${Field} label="Bot link (webhook URL)" wide><input type="url" value=${d.webhookUrl} placeholder="https://…" onInput=${(e) => set('webhookUrl')(e.target.value)} /><//>
      <${Field} label="Secret (optional)" hint="Sent as the X-Webhook-Secret header" wide><input value=${d.webhookSecret} onInput=${(e) => set('webhookSecret')(e.target.value)} autocomplete="off" /><//>
    </div>
    <div class="switch-list">
      ${toggle('notifyOnNew', 'Tell the bot when a new order comes in', 'created')}
      ${toggle('notifyOnDone', 'Tell the bot when an order is completed', 'completed')}
    </div>
    <div class="page-actions">
      <button class="btn btn-primary" disabled=${!dirty || busy} onClick=${save}>${busy ? 'Saving…' : 'Save bot settings'}</button>
      <button class="btn btn-ghost" onClick=${() => setShowPayload(!showPayload)}>${showPayload ? 'Hide' : 'Show'} what the bot receives</button>
    </div>
    ${showPayload && html`<div class="payload-grid">
      <div><h3>New order</h3><pre class="code payload">${JSON.stringify(notifyPayload('created', SAMPLE_ORDER, settings.newOrderMessage), null, 2)}</pre></div>
      <div><h3>Order completed</h3><pre class="code payload">${JSON.stringify(notifyPayload('completed', SAMPLE_ORDER, settings.readyMessage), null, 2)}</pre></div>
    </div>`}
  </section>`;
}

// Which phones and computers get a notification for every new order.
function AlertsCard({ printKey, devices, pushKey, onChange }) {
  const remove = async (d) => {
    if (!(await confirmDialog({ title: `Stop alerts on ${d.who}'s ${d.device || 'device'}?`, message: 'That device stops getting new-order notifications. They can turn alerts on again from the menu.', confirmLabel: 'Stop alerts', danger: true }))) return;
    try { onChange({ devices: await api.print.pushRemove(printKey, d.id) }); toast('Alerts stopped on that device.'); } catch (e) { toastError(e); }
  };
  return html`<section class="card bot-card">
    <header class="card-head"><h2>New-order alerts</h2>
      ${pushKey && html`<${Pill} tone=${devices.length ? 'good' : 'neutral'}>${devices.length} ${devices.length === 1 ? 'device' : 'devices'}<//>`}</header>
    <p class="muted small">${pushKey
      ? html`Everyone on the team — and you — can get a notification on their phone for every new order, even when the app is closed.
        It stays in their notification centre until they open it, like a WhatsApp message. Each person turns it on once on their own device:
        <b>New-order alerts</b> at the bottom of the Print Hub menu (on iPhone, add the Print Hub to the Home Screen first).`
      : html`Each person can turn on <b>New-order alerts</b> at the bottom of the Print Hub menu: a chime and a pop-up while the Print Hub is open.`}</p>
    ${pushKey && (devices.length
      ? html`<ul class="plain-list device-list">${devices.map((d) => html`<li key=${d.id}>
          <span><${Icon} name="bell" size=${15} /> <b>${d.who || 'Someone'}</b><span class="muted small"> · ${d.device || 'device'} · since ${fmtDate(d.since)}</span></span>
          <button class="icon-btn" aria-label="Stop alerts on this device" data-tip="Stop alerts on this device" onClick=${() => remove(d)}><${Icon} name="trash" size=${15} /></button>
        </li>`)}</ul>`
      : html`<p class="muted small">No devices yet — once someone turns alerts on, their phone shows up here.</p>`)}
  </section>`;
}
