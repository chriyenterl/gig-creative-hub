// Transactions: every sale by day, its receipt (reprint / WhatsApp) and refunds.
// A cashier's refund needs a manager there to type their name and passcode.
import { html, useState, useEffect } from '../lib.js';
import { Icon, Modal, PageHead, Empty, Pill, Tabs, PasscodeInput, confirmDialog, toast, toastError } from '../ui.js';
import { hrefFor, go, downloadCSV } from '../util.js';
import * as POS from './model.js';
import { api, usePos, currentStore, money, isManager, refreshShift, refreshOpenOrders, cartFromOrder, dropFromOutbox, retryOutbox } from './state.js';
import { Receipt, Stepper, printReceipt, whatsappReceipt, fmtTime, fmtDay, ago } from './ui.js';

const today = () => POS.localParts(new Date()).date;
const StatusPill = ({ s }) => html`<${Pill} tone=${POS.SALE_STATUS[s]?.tone || 'neutral'}>${POS.SALE_STATUS[s]?.label || s}<//>`;

export function SalesPage({ query }) {
  const s = usePos();
  const store = currentStore();
  const date = query.date || today();
  const status = query.status || 'sold';
  const [list, setList] = useState(null);
  const [q, setQ] = useState(query.q || '');
  const set = (patch) => go('sales', { ...query, ...patch }, { replace: true });
  const load = () => api.pos.sales({ storeId: store.id, from: date, to: date, status, q: q.trim() }).then(setList).catch((e) => { setList([]); toastError(e); });
  useEffect(() => { setList(null); const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [s.storeId, date, status, q]);
  const sum = (list || []).reduce((t, x) => t + x.total + (x.rounding || 0) - (x.refunded || 0), 0);
  const exportCsv = () => downloadCSV(`${store.code}-sales-${date}.csv`, list, [
    { label: 'Time', value: (x) => new Date(x.paid_at || x.created_at).toLocaleString('en-MY') }, { label: 'Receipt', value: 'receipt_no' }, { label: 'Order', value: 'order_no' },
    { label: 'Type', value: (x) => POS.ORDER_TYPES[x.order_type] }, { label: 'Customer', value: 'customer_name' }, { label: 'Phone', value: 'customer_phone' },
    { label: 'Items', value: (x) => x.items.map((l) => `${l.qty} x ${l.name}${l.mods?.length ? ' (' + POS.modText(l.mods) + ')' : ''}`).join('; ') },
    { label: 'Subtotal', value: (x) => POS.toRM(x.subtotal) }, { label: 'Discount', value: (x) => POS.toRM(x.discount) }, { label: 'Service', value: (x) => POS.toRM(x.service) },
    { label: 'Tax', value: (x) => POS.toRM(x.tax) }, { label: 'Rounding', value: (x) => POS.toRM(x.rounding) }, { label: 'Paid', value: (x) => POS.toRM(x.total + x.rounding) },
    { label: 'Refunded', value: (x) => POS.toRM(x.refunded) }, { label: 'Payment', value: (x) => x.payments.map((p) => `${p.method} ${POS.toRM(p.amount)}`).join(' + ') },
    { label: 'Cashier', value: 'cashier' }, { label: 'Status', value: (x) => POS.SALE_STATUS[x.status]?.label }]);
  return html`
    <${PageHead} title="Transactions" sub=${`${store.name} · ${fmtDay(date)}${list ? ` · ${list.length} ${status === 'open' ? 'open' : 'sales'}${status === 'sold' ? ' · ' + money(sum) + ' after refunds' : ''}` : ''}`}>
      ${list?.length > 0 && isManager() && html`<button class="btn btn-ghost" onClick=${exportCsv}><${Icon} name="download" size=${16} />Export</button>`}
    <//>
    <${Outbox} />
    <div class="filters">
      <div class="day-pick">
        <button class="icon-btn" aria-label="Day before" onClick=${() => set({ date: POS.addDays(date, -1) })}><${Icon} name="back" /></button>
        <input type="date" value=${date} max=${today()} onChange=${(e) => e.target.value && set({ date: e.target.value })} aria-label="Day" />
        <button class="icon-btn" aria-label="Next day" disabled=${date >= today()} onClick=${() => set({ date: POS.addDays(date, 1) })}><${Icon} name="chevron" /></button>
      </div>
      <label class="search"><${Icon} name="search" size=${16} /><input type="search" placeholder="Receipt no., order #, customer name or phone" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>
    </div>
    <${Tabs} value=${status} onChange=${(v) => set({ status: v })} items=${[{ id: 'sold', label: 'Sales' }, { id: 'refunds', label: 'Refunds' }, { id: 'open', label: 'Open orders' }, { id: 'cancelled', label: 'Cancelled' }]} />
    ${!list ? html`<div class="loading"><div class="spinner"></div></div>` : list.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Time</th><th>Receipt</th><th>Order</th><th>Items</th><th>Customer</th><th>Payment</th><th class="num">Total</th><th></th></tr></thead>
      <tbody>${list.map((x) => html`<tr key=${x.id} onClick=${() => go('sale/' + x.id)}>
        <td data-label="Time">${fmtTime(x.paid_at || x.created_at)}</td>
        <td data-label="Receipt"><b>${x.receipt_no || '—'}</b></td>
        <td data-label="Order">#${x.order_no}${x.table_no ? html`<span class="muted small"> · ${x.table_no}</span>` : ''}</td>
        <td data-label="Items" class="ellipsis-cell">${x.items.map((l) => `${l.qty}× ${l.name}`).join(', ')}</td>
        <td data-label="Customer">${x.customer_name || (x.customer_phone ? POS.fmtPhone(x.customer_phone) : html`<span class="muted">—</span>`)}</td>
        <td data-label="Payment">${x.payments.map((p) => p.method).join(' + ') || html`<span class="muted">—</span>`}</td>
        <td data-label="Total" class="num"><b>${money(x.total + (x.rounding || 0))}</b>${x.refunded > 0 && html`<div class="small bad-text">−${money(x.refunded)}</div>`}</td>
        <td data-label="">${x.status !== 'paid' && html`<${StatusPill} s=${x.status} />`}</td>
      </tr>`)}</tbody></table></div>`
    : html`<${Empty} icon="inbox" title=${q ? 'No matches' : status === 'sold' ? 'No sales on this day' : 'Nothing here'} />`}`;
}

// Sales made offline that haven't reached the server yet.
export function Outbox() {
  const { outbox, syncing, online } = usePos();
  if (!outbox.length) return null;
  const stuck = outbox.filter((x) => x.error);
  const discard = async (x) => {
    if (await confirmDialog({ title: 'Discard this sale?', message: `It was ${money(x.sale.client_total)} taken ${ago(x.sale.offline_at)} ago and never reached the server. Only discard it if you've entered it again.`, confirmLabel: 'Discard', danger: true })) dropFromOutbox(x.sale.id);
  };
  return html`<section class=${'card outbox' + (stuck.length ? ' outbox-stuck' : '')}>
    <div class="row-between"><span><${Icon} name=${stuck.length ? 'alert' : 'refresh'} size=${16} />
      <b> ${outbox.length} ${outbox.length === 1 ? 'sale' : 'sales'} waiting to sync</b>
      <span class="muted small"> — ${syncing ? 'sending now…' : online ? 'they\'ll be sent automatically.' : 'you\'re offline; they\'ll be sent when the internet is back.'}</span></span>
      <button class="btn btn-sm" disabled=${syncing} onClick=${() => retryOutbox().then((n) => n && toast(`${n} sent.`))}><${Icon} name="refresh" size=${14} />Send now</button></div>
    ${stuck.length > 0 && html`<ul class="outbox-list">${stuck.map((x) => html`<li key=${x.sale.id}><span><b>${money(x.sale.client_total)}</b> · ${new Date(x.sale.offline_at).toLocaleString('en-MY')}
        <span class="bad-text small block">${x.error}</span></span>
      <button class="btn btn-sm btn-ghost-danger" onClick=${() => discard(x)}>Discard</button></li>`)}</ul>`}
  </section>`;
}

export function SaleDetail({ id }) {
  const s = usePos();
  const store = s.stores.find((x) => x.id === s.storeId);
  const [sale, setSale] = useState(null);
  const [refunding, setRefunding] = useState(false);
  const [phone, setPhone] = useState('');
  useEffect(() => { setSale(null); api.pos.sale(id).then(setSale).catch(toastError); }, [id]);
  if (!sale) return html`<div class="loading"><div class="spinner"></div></div>`;
  const saleStore = s.stores.find((x) => x.id === sale.store_id) || store;
  const canRefund = ['paid', 'partially_refunded'].includes(sale.status);
  const resume = () => { cartFromOrder(sale); go(''); };
  const cancel = async () => {
    const reason = prompt(`Cancel order #${sale.order_no}? Why?`, '');
    if (reason == null) return;
    try { setSale(await api.pos.cancelOpen(sale.id, reason)); refreshOpenOrders().catch(() => {}); toast('Order cancelled.'); } catch (e) { toastError(e); }
  };
  return html`
    <${PageHead} title=${sale.receipt_no ? `Receipt ${sale.receipt_no}` : `Order #${sale.order_no}`}
        sub=${`${saleStore?.name} · ${new Date(sale.paid_at || sale.created_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })} · ${sale.cashier}`}
        back=${{ href: hrefFor('sales', { date: sale.local_date, status: sale.status === 'open' ? 'open' : sale.status === 'cancelled' ? 'cancelled' : undefined }), label: 'Transactions' }}>
      <${StatusPill} s=${sale.status} />
    <//>
    <div class="sale-layout">
      <section class="card receipt-card"><${Receipt} sale=${sale} store=${saleStore} /></section>
      <div class="stack">
        <section class="card stack">
          ${sale.status === 'open' ? html`
            <button class="btn btn-primary btn-lg" onClick=${resume}><${Icon} name="play" size=${14} />Open in the till (add items or take payment)</button>
            <button class="btn" onClick=${() => printReceipt(sale, saleStore, true)}><${Icon} name="printer" size=${16} />Print kitchen docket</button>
            <button class="btn btn-ghost-danger" onClick=${cancel}><${Icon} name="x" size=${16} />Cancel order</button>`
          : sale.status === 'cancelled' ? html`<p class="muted">${sale.note}</p>` : html`
            <button class="btn" onClick=${() => printReceipt(sale, saleStore)}><${Icon} name="printer" size=${16} />Print receipt</button>
            ${sale.customer_phone ? html`<button class="btn btn-wa" onClick=${() => whatsappReceipt(sale, saleStore)}><${Icon} name="whatsapp" size=${16} />WhatsApp receipt to ${sale.customer_name || POS.fmtPhone(sale.customer_phone)}</button>`
              : html`<span class="wa-send"><input type="tel" placeholder="WhatsApp no." value=${phone} onInput=${(e) => setPhone(e.target.value)} aria-label="WhatsApp number" />
                <button class="btn btn-wa" onClick=${() => whatsappReceipt(sale, saleStore, phone) || toast('Type the phone number first.', 'error')}><${Icon} name="whatsapp" size=${16} />Send receipt</button></span>`}
            ${canRefund && html`<button class="btn btn-ghost-danger" onClick=${() => setRefunding(true)}><${Icon} name="refresh" size=${16} />Refund${sale.status === 'partially_refunded' ? ' more' : ''}</button>`}`}
        </section>
        ${sale.refunds?.length > 0 && html`<section class="card"><h2>Refunds</h2><ul class="plain-list">${sale.refunds.map((r) => html`<li key=${r.id}>
          <div class="row-between"><b>−${money(r.amount)} · ${r.method}</b><span class="muted small">${new Date(r.at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
          <div class="small">${r.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}${r.restock ? ' · back in stock' : ''}</div>
          <div class="muted small">“${r.reason}” — ${r.by}${r.approved_by ? `, approved by ${r.approved_by}` : ''}${r.cashback_reversed ? ` · ${money(r.cashback_reversed)} cashback taken back` : ''}</div></li>`)}</ul></section>`}
        ${sale.offline_at && html`<p class="muted small">Taken offline at ${new Date(sale.offline_at).toLocaleString('en-MY')} and synced later.</p>`}
      </div>
    </div>
    ${refunding && html`<${RefundDialog} sale=${sale} store=${saleStore} onClose=${(u) => { setRefunding(false); if (u) setSale(u); }} />`}`;
}

function RefundDialog({ sale, store, onClose }) {
  const st = store.settings;
  const left = (it) => it.qty - (it.refunded_qty || 0);
  const [qty, setQty] = useState(() => Object.fromEntries(sale.items.map((it, i) => [i, left(it)])));
  const [method, setMethod] = useState(sale.payments?.[0]?.method && (st.methods.includes(sale.payments[0].method) || sale.payments[0].method === POS.CASHBACK) ? sale.payments[0].method : POS.CASH);
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [mgr, setMgr] = useState({ name: '', passcode: '' });
  const [busy, setBusy] = useState(false);
  const picks = Object.entries(qty).filter(([, n]) => n > 0).map(([i, n]) => ({ index: Number(i), qty: n }));
  let quote = null, err = '';
  try { quote = picks.length ? POS.refundQuote(sale, picks, { method, settings: st }) : null; } catch (e) { err = e.message; }
  const needMgr = !isManager();
  const methods = [...st.methods, ...(sale.customer_id ? [POS.CASHBACK] : [])];
  const submit = async () => {
    if (!reason.trim()) return toast('Add a reason for the refund.', 'error');
    setBusy(true);
    try {
      const u = await api.pos.refund({ id: sale.id, lines: picks, method, reason, restock, approver: needMgr ? mgr : undefined });
      refreshShift().catch(() => {});
      toast(`Refunded ${money(quote.amount)} (${method}).`);
      onClose(u);
    } catch (e) { toastError(e); }
    setBusy(false);
  };
  return html`<${Modal} title=${'Refund ' + (sale.receipt_no || '')} size="md" onClose=${() => onClose(null)} footer=${html`
      <span class="refund-total">${quote ? html`Refund <b>${money(quote.amount)}</b>` : ''}</span><span class="spacer"></span>
      <button class="btn btn-danger" disabled=${busy || !quote || (needMgr && (!mgr.name || mgr.passcode.length !== 6))} onClick=${submit}>${busy ? 'Refunding…' : 'Refund'}</button>`}>
    <div class="stack">
      <ul class="refund-lines">${sale.items.map((it, i) => left(it) > 0 && html`<li key=${i}>
        <span><b>${it.name}</b>${it.mods?.length > 0 && html`<span class="muted small block">${POS.modText(it.mods)}</span>`}
          <span class="muted small block">${left(it)} of ${it.qty} can be refunded · ${money(Math.round(it.net / it.qty))} each</span></span>
        <${Stepper} value=${qty[i]} min=${0} max=${left(it)} onChange=${(v) => setQty({ ...qty, [i]: v })} size="sm" /></li>`)}</ul>
      ${err && html`<p class="error-text small">${err}</p>`}
      <div class="field"><span class="field-label">Money goes back by</span>
        <div class="quick-row">${methods.map((m) => html`<button class=${'chip' + (method === m ? ' on' : '')} onClick=${() => setMethod(m)}>${m === POS.CASHBACK ? 'Cashback (store credit)' : m}</button>`)}</div></div>
      <label class="field"><span class="field-label">Reason</span><input value=${reason} maxlength="200" placeholder="e.g. Wrong order, spilt, customer changed mind" onInput=${(e) => setReason(e.target.value)} list="refund-reasons" />
        <datalist id="refund-reasons"><option value="Wrong order" /><option value="Spilt / damaged" /><option value="Customer changed mind" /><option value="Quality issue" /><option value="Charged twice" /></datalist></label>
      <label class="check-row"><input type="checkbox" checked=${restock} onChange=${(e) => setRestock(e.target.checked)} /> Put the items back in stock (for products that track stock)</label>
      ${quote && (quote.service || quote.tax) ? html`<p class="muted small">Includes ${quote.service ? `${money(quote.service)} service charge` : ''}${quote.service && quote.tax ? ' and ' : ''}${quote.tax ? `${money(quote.tax)} ${st.tax.name}` : ''}.</p>` : null}
      ${needMgr && html`<div class="approve-box"><b><${Icon} name="key" size=${14} /> Manager approval</b>
        <span class="muted small">Ask a manager to type their name and passcode.</span>
        <div class="form-row"><label class="field"><span class="field-label">Manager's name</span><input value=${mgr.name} autocomplete="off" onInput=${(e) => setMgr({ ...mgr, name: e.target.value })} /></label>
          <${PasscodeInput} label="Their passcode" value=${mgr.passcode} onInput=${(v) => setMgr({ ...mgr, passcode: v })} autocomplete="off" /></div></div>`}
    </div>
  <//>`;
}

// Open orders across the store (the till's "Open orders" button shows the same list).
export function OpenOrdersPage() {
  const s = usePos();
  useEffect(() => { refreshOpenOrders().catch(toastError); const t = setInterval(() => refreshOpenOrders().catch(() => {}), 20000); return () => clearInterval(t); }, [s.storeId]);
  return html`<${PageHead} title="Open orders" sub="Saved to pay later — tables that may order more, or orders being prepared." />
    ${s.openOrders.length ? html`<div class="order-cards">${s.openOrders.map((o) => html`<button key=${o.id} class="card order-card" onClick=${() => { cartFromOrder(o); go(''); }}>
      <div class="row-between"><b class="big-num">#${o.order_no}</b><b>${money(o.total)}</b></div>
      <div>${POS.ORDER_TYPES[o.order_type]}${o.table_no ? ` · ${o.order_type === 'dine_in' ? 'Table ' : ''}${o.table_no}` : ''}${o.customer_name ? ' · ' + o.customer_name : ''}</div>
      <div class="muted small">${o.items.map((l) => `${l.qty}× ${l.name}`).join(', ')}</div>
      <div class="muted small">${ago(o.created_at)} ago · ${o.cashier}</div>
    </button>`)}</div>` : html`<${Empty} icon="clock" title="No open orders">On the till, <b>Pay later</b> saves an order here.<//>`}`;
}
