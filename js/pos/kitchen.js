// Kitchen display: orders to make (newest items marked), then ready to collect. Refreshes on its own.
import { html, useState, useEffect, useRef } from '../lib.js';
import { Icon, PageHead, Empty, toastError } from '../ui.js';
import * as POS from './model.js';
import { api, usePos, currentStore } from './state.js';
import { chime, ago, printReceipt, fmtTime } from './ui.js';

export function KitchenPage() {
  const s = usePos();
  const store = currentStore();
  const [list, setList] = useState(null);
  const [, tick] = useState(0);
  const seen = useRef(null);
  const load = () => api.pos.kitchen(store.id).then((rows) => {
    const ids = new Set(rows.filter((r) => r.kitchen === 'new').map((r) => r.id + '|' + r.updated_at));
    if (seen.current && [...ids].some((k) => !seen.current.has(k))) chime();
    seen.current = ids;
    setList(rows);
  }).catch((e) => { if (!list) toastError(e); });
  useEffect(() => {
    seen.current = null;
    load();
    const t = setInterval(load, 8000), c = setInterval(() => tick((n) => n + 1), 30000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [s.storeId]);
  const set = async (o, status) => {
    setList((l) => l.map((x) => (x.id === o.id ? { ...x, kitchen: status } : x)).filter((x) => x.kitchen !== 'done'));
    try { await api.pos.kitchenSet(o.id, status); } catch (e) { toastError(e); load(); }
  };
  const making = (list || []).filter((x) => x.kitchen === 'new');
  const ready = (list || []).filter((x) => x.kitchen === 'ready');
  return html`
    <${PageHead} title="Kitchen" sub=${store.settings.kitchen ? `${store.name} · updates every few seconds and chimes for new orders` : 'The kitchen screen is off for this store — an owner can switch it on in Stores.'}>
      <button class="btn btn-ghost" onClick=${load}><${Icon} name="refresh" size=${16} />Refresh</button>
    <//>
    ${!list ? html`<div class="loading"><div class="spinner"></div></div>` : html`<div class="kds">
      <section><h2 class="kds-h">Preparing <span class="tab-count">${making.length}</span></h2>
        ${making.length ? html`<div class="kds-grid">${making.map((o) => html`<${Ticket} key=${o.id} o=${o} store=${store} onNext=${() => set(o, 'ready')} next="Ready" />`)}</div>`
          : html`<${Empty} icon="check" title="All caught up" />`}</section>
      <section><h2 class="kds-h">Ready to collect <span class="tab-count">${ready.length}</span></h2>
        ${ready.length ? html`<div class="kds-ready">${ready.map((o) => html`<button key=${o.id} class="ready-chip" onClick=${() => set(o, 'done')} data-tip="Tap when collected">
          <b>#${o.order_no}</b><span>${o.table_no || POS.ORDER_TYPES[o.order_type]}</span></button>`)}</div>`
          : html`<p class="muted small">Orders marked ready show here — tap one when it's collected or served.</p>`}</section>
    </div>`}`;
}

function Ticket({ o, store, onNext, next }) {
  const lastSent = o.items.reduce((m, l) => (l.sent_at && l.sent_at > m ? l.sent_at : m), '');
  const added = o.items.some((l) => l.sent_at && l.sent_at < lastSent);
  const age = (Date.now() - new Date(lastSent || o.created_at)) / 60000;
  return html`<article class=${'ticket' + (age > 15 ? ' late' : age > 8 ? ' slow' : '')}>
    <header><b>#${o.order_no}</b><span>${POS.ORDER_TYPES[o.order_type]}${o.table_no ? ` · ${o.order_type === 'dine_in' ? 'Table ' : ''}${o.table_no}` : ''}</span>
      <span class="ticket-age" title=${'Sent at ' + fmtTime(lastSent || o.created_at)}>${ago(lastSent || o.created_at)}</span></header>
    <ul>${o.items.filter((l) => l.sent_at).map((l) => html`<li class=${added && l.sent_at === lastSent ? 'new-item' : ''}>
      <b>${l.qty}×</b> <span>${l.name}${added && l.sent_at === lastSent ? html` <em>added</em>` : ''}
      ${l.mods?.length > 0 && html`<small>${POS.modText(l.mods)}</small>`}${l.note && html`<small class="note">“${l.note}”</small>`}</span></li>`)}</ul>
    ${o.note && html`<p class="ticket-note">${o.note}</p>`}
    <footer>
      ${o.status === 'open' ? html`<span class="muted small">Not paid yet</span>` : html`<span class="muted small">Paid</span>`}
      <span class="spacer"></span>
      <button class="icon-btn" aria-label="Print docket" data-tip="Print kitchen docket" onClick=${() => printReceipt(o, store, true)}><${Icon} name="printer" size=${16} /></button>
      <button class="btn btn-good" onClick=${onNext}><${Icon} name="check" size=${16} />${next}</button>
    </footer>
  </article>`;
}
