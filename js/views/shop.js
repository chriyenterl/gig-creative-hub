// Webstore (team side): orders from the online store (shop/index.html), the menu, and the store's settings.
import { html, useState, useEffect } from '../lib.js';
import { api } from '../store.js';
import { Icon, Pill, PageHead, Tabs, Empty, confirmDialog, toast, toastError } from '../ui.js';
import { hrefFor, go, copyText, fmtDate, timeAgo } from '../util.js';
import { CONFIG } from '../../config.js';
import {
  ORDER_STATUS, STATUS_FLOW, PAYMENT_STATUS, statusLabel, readyLabel, paymentLabel, money, optionText, itemLines,
  fmtWhen, fmtWhenLong, fromMin, storeNow, fillMessage, orderLink, waTo,
} from '../shop/model.js';
import { useShop, loadShop, setShop, shopState, replaceOrder, storeUrl, fileUrl } from './shop-data.js';
import { Products } from './shop-products.js';
import { StoreSettings } from './shop-settings.js';

const CC = CONFIG.WHATSAPP_COUNTRY_CODE || '60';

export function Shop({ sub = 'orders', id, query }) {
  const s = useShop();
  useEffect(() => {
    if (!api.shop) return;
    loadShop().catch((e) => setShop({ error: e.message }));
  }, []);
  if (!api.shop) {
    return html`<${PageHead} title="Webstore" /><section class="card"><${Empty} icon="bag" title="The webstore needs the Cloudflare setup">
      It keeps your menu and orders on your Cloudflare server. See README.md → Webstore.<//></section>`;
  }
  if (s.error && !s.loaded) {
    return html`<${PageHead} title="Webstore" /><section class="card"><${Empty} icon="alert" title="Couldn't load the webstore">${s.error}
      <br /><span class="small">If you've just updated the app, the server needs updating too: run <code>npx wrangler deploy</code> in the cloudflare folder.</span><//></section>`;
  }
  if (!s.loaded) return html`<div class="loading"><div class="spinner"></div></div>`;
  if (sub === 'products') return html`<${Products} query=${query} />`;
  if (sub === 'settings') return html`<${StoreSettings} />`;
  if (sub === 'order') return html`<${OrderDetail} id=${id} />`;
  return html`<${Orders} query=${query} />`;
}

// ── Helpers ──
const slotKey = (o) => `${o.slot_date || ''} ${o.slot_time || ''}`;
const OPEN = ['new', 'preparing', 'ready'];
const NEXT = { new: 'preparing', preparing: 'ready', ready: 'completed' };
const nextLabel = (o) => ({ new: 'Start preparing', preparing: o.fulfilment === 'delivery' ? 'Out for delivery' : 'Mark ready', ready: o.fulfilment === 'delivery' ? 'Delivered' : 'Collected' }[o.status]);
const whenOf = (o) => {
  const t = storeNow();
  return { text: fmtWhen(o), late: OPEN.includes(o.status) && `${o.slot_date} ${o.slot_time}` < `${t.ymd} ${fromMin(t.minutes)}` };
};

async function setStatus(o, status) {
  try {
    replaceOrder(await api.shop.updateOrder(o.id, { status }));
    toast(status === 'ready' ? `${o.order_no}: ${readyLabel(o).toLowerCase()} — send the customer a WhatsApp.` : `${o.order_no} moved to ${statusLabel({ ...o, status })}.`);
  } catch (e) { toastError(e); }
}

function StatusPill({ o }) {
  const st = ORDER_STATUS[o.status] || ORDER_STATUS.new;
  return html`<${Pill} tone=${st.tone} icon=${st.icon}>${statusLabel(o)}<//>`;
}
function PayPill({ o }) {
  const p = PAYMENT_STATUS[o.payment_status] || PAYMENT_STATUS.unpaid;
  return html`<${Pill} tone=${p.tone}>${o.payment_method === 'cash' && o.payment_status === 'unpaid' ? paymentLabel('cash', o.fulfilment) : p.label}<//>`;
}

// One-tap WhatsApp to the customer with the message already typed (logged in the order's history).
function WhatsAppTo({ o, kind, primary }) {
  const { settings } = shopState();
  const tpl = kind === 'confirmed' ? settings.messages.confirmed : o.fulfilment === 'delivery' ? settings.messages.ready_delivery : settings.messages.ready_pickup;
  const text = fillMessage(tpl, o, { store: settings.name, link: orderLink(storeUrl(), o) });
  const href = waTo(o.phone, text, CC);
  if (!href) return null;
  const label = kind === 'confirmed' ? 'order confirmed' : o.fulfilment === 'delivery' ? 'on its way' : 'ready for pickup';
  const log = () => api.shop.updateOrder(o.id, { whatsapp: kind }).then(replaceOrder).catch(() => {});
  return html`<a class=${'btn ' + (primary ? 'btn-wa' : 'btn-wa-soft')} href=${href} target="_blank" rel="noopener" onClick=${log} data-tip=${'Opens WhatsApp with: “' + text + '”'}>
    <${Icon} name="whatsapp" size=${16} />WhatsApp: ${label}</a>`;
}

// ── Orders list ──
function Orders({ query }) {
  const { orders, settings } = useShop();
  const tab = query.tab || 'todo';
  const q = (query.q || '').toLowerCase();
  const [busy, setBusy] = useState(false);
  const refresh = async (quiet) => { setBusy(true); try { await loadShop(); if (!quiet) toast('Up to date.'); } catch (e) { if (!quiet) toastError(e); } setBusy(false); };
  useEffect(() => { // new orders appear by themselves while this page is open
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(true), 60e3);
    return () => clearInterval(t);
  }, []);
  const count = (f) => orders.filter(f).length;
  const tabs = [
    { id: 'todo', label: 'To do', f: (o) => OPEN.includes(o.status) },
    ...['new', 'preparing', 'ready', 'completed', 'cancelled'].map((st) => ({ id: st, label: ORDER_STATUS[st].label, f: (o) => o.status === st })),
  ];
  const cur = tabs.find((t) => t.id === tab) || tabs[0];
  const done = ['completed', 'cancelled'].includes(cur.id);
  const rows = orders.filter(cur.f)
    .filter((o) => !q || [o.order_no, o.customer_name, o.phone, o.email, o.address, ...itemLines(o.items)].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (done ? (a.created_at < b.created_at ? 1 : -1) : slotKey(a) > slotKey(b) ? 1 : -1));
  const set = (patch) => go('shop/orders', { ...query, ...patch }, { replace: true });
  const today = storeNow().ymd;
  const todays = orders.filter((o) => o.slot_date === today && o.status !== 'cancelled');
  const sales = orders.filter((o) => storeNow(new Date(o.created_at)).ymd === today && o.status !== 'cancelled').reduce((n, o) => n + Number(o.total || 0), 0);

  return html`
    <${PageHead} title="Webstore orders" sub="Orders from your online store, sorted by pickup / delivery time. New orders show up here by themselves.">
      <a class="btn btn-primary" href=${storeUrl()} target="_blank" rel="noopener"><${Icon} name="external" size=${16} />Open store</a>
      <button class="btn" onClick=${async () => { if (await copyText(storeUrl())) toast('Store link copied — share it on Instagram, WhatsApp…'); }}><${Icon} name="link" size=${16} />Copy store link</button>
      <button class="btn btn-ghost" onClick=${() => refresh()} disabled=${busy}><${Icon} name="refresh" size=${16} />Refresh</button>
    <//>
    ${!settings.open && html`<div class="info-box"><${Icon} name="pause" size=${16} /><span><b>Your store isn't taking orders.</b> Customers can browse but can't check out.
      ${shopState().owner && html` <a class="link" href=${hrefFor('shop/settings')}>Turn ordering on</a>`}</span></div>`}
    <div class="stats stats-3 ws-stats">
      <a class="stat stat-1" href=${hrefFor('shop/orders', { tab: 'new' })}><span class="stat-top"><span class="stat-label">New</span><span class="stat-icon"><${Icon} name="inbox" size=${18} /></span></span>
        <span class="stat-value">${count((o) => o.status === 'new')}</span><span class="stat-sub">Waiting to be started</span></a>
      <a class="stat stat-2" href=${hrefFor('shop/orders')}><span class="stat-top"><span class="stat-label">For today</span><span class="stat-icon"><${Icon} name="clock" size=${18} /></span></span>
        <span class="stat-value">${todays.length}</span><span class="stat-sub">${todays.filter((o) => OPEN.includes(o.status)).length} still to hand over</span></a>
      <span class="stat stat-3"><span class="stat-top"><span class="stat-label">Ordered today</span><span class="stat-icon"><${Icon} name="bag" size=${18} /></span></span>
        <span class="stat-value">${money(sales)}</span><span class="stat-sub">${count((o) => o.payment_status === 'submitted')} receipt${count((o) => o.payment_status === 'submitted') === 1 ? '' : 's'} to check</span></span>
    </div>
    <${Tabs} value=${cur.id} onChange=${(t) => set({ tab: t })} items=${tabs.map((t) => ({ id: t.id, label: t.label, count: count(t.f) }))} />
    <div class="filters">
      <label class="search"><${Icon} name="search" size=${16} />
        <input type="search" placeholder="Search order no., customer, phone, item…" value=${query.q || ''} onInput=${(e) => set({ q: e.target.value })} /></label>
    </div>
    ${rows.length ? html`<div class="ws-orders">${rows.map((o) => html`<${OrderRow} key=${o.id} o=${o} />`)}</div>`
    : html`<section class="card"><${Empty} icon=${orders.length ? 'check' : 'bag'} title=${orders.length ? 'Nothing here' : 'No orders yet'}>
        ${orders.length ? 'No orders match.' : html`Share your store link to start receiving orders.`}<//></section>`}`;
}

function OrderRow({ o }) {
  const w = whenOf(o);
  const n = o.items.reduce((t, i) => t + i.qty, 0);
  return html`<article class=${'card ws-order' + (o.status === 'new' ? ' is-new' : '')} onClick=${() => go('shop/order/' + o.id)}>
    <div class=${'ws-when' + (w.late ? ' late' : '')}>
      <${Icon} name=${o.fulfilment === 'delivery' ? 'truck' : 'store'} size=${16} />
      <b>${w.text}</b><span class="muted small">${o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}${w.late ? ' · overdue' : ''}</span>
    </div>
    <div class="ws-order-main">
      <div class="ws-order-top"><b>${o.order_no}</b><span>${o.customer_name}</span><span class="muted small">· ${timeAgo(o.created_at)}</span></div>
      <p class="ws-items">${itemLines(o.items).join(' · ')}</p>
      <div class="ws-pills"><${StatusPill} o=${o} /><${PayPill} o=${o} /><span class="muted small">${n} item${n === 1 ? '' : 's'} · <b>${money(o.total)}</b></span></div>
    </div>
    <div class="ws-order-act">
      ${NEXT[o.status] && html`<button class=${'btn btn-sm ' + (o.status === 'ready' ? 'btn-good' : 'btn-primary')} onClick=${(e) => { e.stopPropagation(); setStatus(o, NEXT[o.status]); }}>
        <${Icon} name=${o.status === 'new' ? 'play' : 'check'} size=${12} />${nextLabel(o)}</button>`}
    </div>
  </article>`;
}

// ── One order ──
function OrderDetail({ id }) {
  const { orders, settings } = useShop();
  const o = orders.find((x) => x.id === id);
  const [notes, setNotes] = useState(o?.internal_notes || '');
  const [receipt, setReceipt] = useState(null);
  useEffect(() => setNotes(o?.internal_notes || ''), [o?.id]);
  useEffect(() => { setReceipt(null); if (o?.receipt_path) fileUrl(o.receipt_path).then(setReceipt).catch(() => {}); }, [o?.receipt_path]);
  if (!o) return html`<${Empty} icon="inbox" title="Order not found"><a class="link" href=${hrefFor('shop/orders')}>Back to orders</a><//>`;

  const saveNotes = async () => {
    if ((notes || '') === (o.internal_notes || '')) return;
    try { replaceOrder(await api.shop.updateOrder(o.id, { internal_notes: notes })); toast('Notes saved.'); } catch (e) { toastError(e); }
  };
  const setPay = async (payment_status) => {
    try { replaceOrder(await api.shop.updateOrder(o.id, { payment_status })); toast(payment_status === 'paid' ? 'Marked as paid.' : 'Payment updated.'); } catch (e) { toastError(e); }
  };
  const cancel = async () => {
    if (!(await confirmDialog({ title: `Cancel ${o.order_no}?`, message: 'The customer sees “cancelled” on their order page. Let them know on WhatsApp, and refund them if they’ve paid.', confirmLabel: 'Cancel order', danger: true }))) return;
    setStatus(o, 'cancelled');
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete ${o.order_no}?`, message: 'The order and its payment receipt are removed for good. This can’t be undone.', confirmLabel: 'Delete order', danger: true }))) return;
    try { await api.shop.deleteOrder(o.id); setShop({ orders: shopState().orders.filter((x) => x.id !== o.id) }); toast('Order deleted.'); go('shop/orders'); } catch (e) { toastError(e); }
  };
  const at = STATUS_FLOW.indexOf(o.status);
  const phone = (o.phone || '').replace(/[^\d+]/g, '');
  const isPdf = /\.pdf$/i.test(o.receipt_path || '');
  const count = o.items.reduce((t, i) => t + i.qty, 0);

  return html`
    <${PageHead} title=${'Order ' + o.order_no} back=${{ href: hrefFor('shop/orders'), label: 'Webstore orders' }}
        sub=${`Placed ${fmtDate(o.created_at)}, ${new Date(o.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${timeAgo(o.created_at)}`}>
      <a class="btn btn-ghost" href=${orderLink(storeUrl(), o)} target="_blank" rel="noopener"><${Icon} name="external" size=${16} />Customer's view</a>
      <button class="btn btn-ghost" onClick=${() => window.print()}><${Icon} name="printer" size=${16} />Print</button>
      <button class="btn btn-ghost-danger" onClick=${remove}><${Icon} name="trash" size=${16} />Delete</button>
    <//>
    <section class="card status-card">
      ${o.status === 'cancelled' ? html`<${Pill} tone="bad" icon="x">Cancelled<//>` : html`<div class="status-track">
        ${STATUS_FLOW.map((st, i) => html`<button key=${st} class=${'track-step tone-' + (st === 'completed' ? 'good' : ORDER_STATUS[st].tone) + (o.status === st ? ' on' : '') + (at > i ? ' past' : '')}
            aria-pressed=${o.status === st} onClick=${() => o.status !== st && setStatus(o, st)}>
          <span class="track-dot">${at > i ? html`<${Icon} name="check" size=${12} />` : i + 1}</span>${st === 'ready' ? readyLabel(o) : ORDER_STATUS[st].label}
        </button>`)}
      </div>`}
      <div class="status-actions no-print">
        ${['new', 'preparing'].includes(o.status) && html`<${WhatsAppTo} o=${o} kind="confirmed" />`}
        ${o.status === 'ready' && html`<${WhatsAppTo} o=${o} kind="ready" primary />`}
        ${NEXT[o.status] && html`<button class=${'btn ' + (o.status === 'ready' ? 'btn-good' : 'btn-primary')} onClick=${() => setStatus(o, NEXT[o.status])}>
          <${Icon} name=${o.status === 'new' ? 'play' : 'check'} size=${14} />${nextLabel(o)}</button>`}
        ${o.status === 'cancelled' && html`<button class="btn" onClick=${() => setStatus(o, 'new')}>Restore order</button>`}
        ${OPEN.includes(o.status) && html`<button class="btn btn-ghost-danger" onClick=${cancel}>Cancel order</button>`}
      </div>
    </section>

    <div class="order-layout">
      <div class="stack">
        <section class="card">
          <header class="card-head"><h2>Items</h2><span class="muted small">${count} item${count === 1 ? '' : 's'}</span></header>
          <ul class="ws-lines">${o.items.map((it, i) => html`<li key=${i}>
            <span class="ws-qty">${it.qty}×</span>
            <span class="ws-line-name"><b>${it.name}</b>${it.options?.length > 0 && html`<span class="muted small">${optionText(it.options)}</span>`}
              ${it.note && html`<span class="ws-note">“${it.note}”</span>`}</span>
            <span class="ws-line-price">${money(it.total)}${it.qty > 1 && html`<span class="muted small">${money(it.unit_price)} each</span>`}</span>
          </li>`)}</ul>
          <dl class="ws-totals">
            <div><dt>Subtotal</dt><dd>${money(o.subtotal)}</dd></div>
            ${o.fulfilment === 'delivery' && html`<div><dt>Delivery</dt><dd>${o.delivery_fee > 0 ? money(o.delivery_fee) : 'Free'}</dd></div>`}
            <div class="total"><dt>Total</dt><dd>${money(o.total)}</dd></div>
          </dl>
          ${o.notes && html`<div class="ws-cust-note"><b>Customer's note</b><p>${o.notes}</p></div>`}
        </section>
        <section class="card">
          <header class="card-head"><h2>Payment</h2><${PayPill} o=${o} /></header>
          <dl class="facts">
            <dt>Method</dt><dd>${paymentLabel(o.payment_method, o.fulfilment)}</dd>
            <dt>Amount</dt><dd><b>${money(o.total)}</b></dd>
          </dl>
          ${o.receipt_path && html`<div class="ws-receipt">
            ${receipt && !isPdf ? html`<a href=${receipt} target="_blank" rel="noopener"><img src=${receipt} alt="Payment receipt" /></a>`
              : html`<a class="btn btn-sm" href=${receipt || '#'} target="_blank" rel="noopener"><${Icon} name="file" size=${14} />Open receipt</a>`}
            <span class="muted small">Receipt from the customer — check it against your bank / e-wallet before marking as paid.</span>
          </div>`}
          ${!o.receipt_path && o.payment_method !== 'cash' && o.payment_status !== 'paid' && html`<p class="muted small">No receipt yet. The customer can send it from their order page.</p>`}
          <div class="detail-actions no-print">
            ${o.payment_status !== 'paid' ? html`<button class="btn btn-good" onClick=${() => setPay('paid')}><${Icon} name="check" size=${14} />Mark as paid</button>`
              : html`<button class="btn btn-ghost" onClick=${() => setPay(o.receipt_path ? 'submitted' : 'unpaid')}>Mark as not paid</button>`}
          </div>
        </section>
      </div>
      <div class="stack">
        <section class="card">
          <header class="card-head"><h2>${o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</h2><${Icon} name=${o.fulfilment === 'delivery' ? 'truck' : 'store'} /></header>
          <dl class="facts">
            <dt>When</dt><dd><b>${fmtWhenLong(o)}</b></dd>
            ${o.address && html`<dt>Address</dt><dd>${o.address}<br /><a class="link small" href=${'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address)} target="_blank" rel="noopener">Open in Maps</a></dd>`}
            <dt>Name</dt><dd>${o.customer_name}</dd>
            <dt>Phone</dt><dd><a class="link" href=${'tel:' + phone}>${o.phone}</a>${waTo(o.phone, '', CC) && html` · <a class="link" href=${waTo(o.phone, '', CC)} target="_blank" rel="noopener">WhatsApp</a>`}</dd>
            ${o.email && html`<dt>Email</dt><dd><a class="link" href=${'mailto:' + o.email}>${o.email}</a></dd>`}
          </dl>
        </section>
        <section class="card no-print">
          <header class="card-head"><h2>Internal notes</h2><span class="muted small">Only your team sees these</span></header>
          <textarea rows="3" value=${notes} placeholder="e.g. Paid via DuitNow, packed in the gold box" onInput=${(e) => setNotes(e.target.value)} onBlur=${saveNotes}></textarea>
        </section>
        <section class="card no-print">
          <header class="card-head"><h2>History</h2></header>
          <ol class="timeline">${[...(o.history || [])].reverse().map((h, i) => html`<li key=${i} class=${h.event === 'whatsapp' ? 'wa' : h.event === 'payment' || h.event === 'receipt' ? 'tone-good' : 'tone-' + (ORDER_STATUS[h.status]?.tone || 'neutral')}>
            <b>${h.event === 'whatsapp' ? `WhatsApp opened — “${h.kind === 'confirmed' ? 'order confirmed' : 'ready'}” message`
              : h.event === 'receipt' ? 'Customer sent a payment receipt'
              : h.event === 'payment' ? (h.payment === 'paid' ? 'Marked as paid' : 'Marked as not paid')
              : h.status === 'new' ? (h.by === 'customer' ? 'Order placed online' : 'Moved back to New') : 'Moved to ' + (h.status === 'ready' ? readyLabel(o) : ORDER_STATUS[h.status]?.label)}</b>
            <span class="muted small">${fmtDate(h.at)} ${new Date(h.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${h.by && h.by !== 'customer' ? ' · by ' + h.by : ''}</span>
          </li>`)}</ol>
        </section>
      </div>
    </div>`;
}
