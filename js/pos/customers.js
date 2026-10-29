// Customers: everyone who gave their phone at the till — visits, spend, cashback per brand — and the
// list for marketing (export to a spreadsheet, or message them on WhatsApp).
import { html, useState, useEffect } from '../lib.js';
import { Icon, PageHead, Empty, Modal, toast, toastError } from '../ui.js';
import { hrefFor, go, downloadCSV, fmtDate, timeAgo } from '../util.js';
import { waLink } from '../print/model.js';
import * as POS from './model.js';
import { api, usePos, money, isManager } from './state.js';
import { fmtTime } from './ui.js';

const brandName = (key, stores) => stores.find((s) => POS.brandKey(s) === key)?.brand || stores.find((s) => POS.brandKey(s) === key)?.name || key;

export function CustomersPage({ query }) {
  const s = usePos();
  const [all, setAll] = useState(null);
  const [found, setFound] = useState(null);
  const [q, setQ] = useState(query.q || '');
  const [adding, setAdding] = useState(false);
  const manager = isManager();
  useEffect(() => { if (manager) api.pos.customers().then(setAll).catch(toastError); }, []);
  useEffect(() => { // cashiers search (they don't get the whole list)
    if (manager) return;
    if (q.trim().length < 3) return setFound(null);
    const t = setTimeout(() => api.pos.findCustomers(q.trim(), s.storeId).then(setFound).catch(toastError), 250);
    return () => clearTimeout(t);
  }, [q]);
  const ql = q.trim().toLowerCase(), digits = ql.replace(/\D/g, '').replace(/^0/, '');
  const rows = manager ? (all || []).filter((c) => !ql || (c.name || '').toLowerCase().includes(ql) || (digits.length >= 3 && c.phone.includes(digits))) : found || [];
  const exportCsv = () => downloadCSV('gig-pos-customers.csv', all, [
    { label: 'Name', value: 'name' }, { label: 'Phone', value: (c) => POS.fmtPhone(c.phone) }, { label: 'Email', value: 'email' }, { label: 'Birthday', value: 'birthday' },
    { label: 'Visits', value: 'visits' }, { label: 'Total spent (RM)', value: (c) => POS.toRM(c.spent) }, { label: 'Last visit', value: (c) => (c.last_visit_at ? c.last_visit_at.slice(0, 10) : '') },
    { label: 'Last store', value: (c) => s.stores.find((x) => x.id === c.last_store_id)?.name || '' },
    { label: 'Cashback (RM)', value: (c) => c.wallets.map((w) => `${brandName(w.brand, s.stores)} ${POS.toRM(w.balance)}`).join('; ') },
    { label: 'Notes', value: 'notes' }, { label: 'Customer since', value: (c) => c.created_at.slice(0, 10) }]);
  return html`
    <${PageHead} title="Customers" sub=${manager ? `${all ? all.length : '…'} customers across all stores — they join by giving their phone number at the till.` : 'Find a customer by phone or name.'}>
      ${manager && all?.length > 0 && html`<button class="btn btn-ghost" onClick=${exportCsv} data-tip="For WhatsApp broadcasts, email campaigns or ads audiences"><${Icon} name="download" size=${16} />Export for marketing</button>`}
      <button class="btn btn-primary" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${16} />Add customer</button>
    <//>
    <div class="filters"><label class="search"><${Icon} name="search" size=${16} /><input type="search" placeholder="Name or phone number" value=${q} onInput=${(e) => setQ(e.target.value)} autofocus=${!manager} /></label></div>
    ${manager && !all ? html`<div class="loading"><div class="spinner"></div></div>` : rows.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Customer</th><th>Phone</th><th class="num">Visits</th><th class="num">Spent</th><th>Last visit</th><th>Cashback</th></tr></thead>
      <tbody>${rows.slice(0, 500).map((c) => html`<tr key=${c.id} onClick=${() => go('customer/' + c.id)}>
        <td data-label="Customer"><b>${c.name || 'No name'}</b>${c.birthday && c.birthday.slice(5) === POS.localParts(new Date()).date.slice(5) ? html` 🎂` : ''}</td>
        <td data-label="Phone">${POS.fmtPhone(c.phone)}</td>
        <td data-label="Visits" class="num">${c.visits || 0}</td>
        <td data-label="Spent" class="num">${money(c.spent || 0)}</td>
        <td data-label="Last visit">${c.last_visit_at ? timeAgo(c.last_visit_at) : html`<span class="muted">—</span>`}</td>
        <td data-label="Cashback">${(c.wallets || []).filter((w) => w.balance > 0).map((w) => html`<span class="cb-chip">${brandName(w.brand, s.stores)} ${money(w.balance)}</span>`)}
          ${c.cashback > 0 && !c.wallets?.length ? html`<span class="cb-chip">${money(c.cashback)}</span>` : ''}</td>
      </tr>`)}</tbody></table></div>`
    : html`<${Empty} icon="users" title=${q ? 'No customer found' : manager ? 'No customers yet' : 'Search above'}>${manager && !q ? 'Add a customer to a sale on the till (their phone number) to start collecting.' : ''}<//>`}
    ${adding && html`<${CustomerForm} onClose=${(c) => { setAdding(false); if (c) go('customer/' + c.id); }} />`}`;
}

export function CustomerForm({ customer, onClose }) {
  const [f, setF] = useState({ phone: customer ? POS.fmtPhone(customer.phone) : '', name: customer?.name || '', email: customer?.email || '', birthday: customer?.birthday || '', notes: customer?.notes || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try { const c = await api.pos.saveCustomer({ ...f, id: customer?.id }); toast('Customer saved.'); onClose(c); } catch (e) { toastError(e); }
    setBusy(false);
  };
  return html`<${Modal} title=${customer ? 'Edit customer' : 'New customer'} size="sm" onClose=${() => onClose(null)} footer=${html`<button class="btn btn-primary" disabled=${busy} onClick=${save}>Save</button>`}>
    <div class="stack">
      <label class="field"><span class="field-label">Phone (WhatsApp)</span><input type="tel" value=${f.phone} onInput=${set('phone')} placeholder="012-345 6789" autofocus /></label>
      <label class="field"><span class="field-label">Name</span><input value=${f.name} maxlength="60" onInput=${set('name')} /></label>
      <label class="field"><span class="field-label">Email</span><input type="email" value=${f.email} onInput=${set('email')} /></label>
      <label class="field"><span class="field-label">Birthday</span><input type="date" value=${f.birthday} onInput=${set('birthday')} /></label>
      <label class="field"><span class="field-label">Notes</span><textarea rows="2" maxlength="500" value=${f.notes} onInput=${set('notes')} placeholder="e.g. allergic to nuts, prefers oat milk"></textarea></label>
    </div>
  <//>`;
}

export function CustomerDetail({ id }) {
  const s = usePos();
  const [c, setC] = useState(null);
  const [editing, setEditing] = useState(false);
  const load = () => api.pos.customer(id, s.storeId).then(setC).catch(toastError);
  useEffect(() => { setC(null); load(); }, [id]);
  if (!c) return html`<div class="loading"><div class="spinner"></div></div>`;
  const wa = waLink(c.phone, `Hi ${c.name || ''}! `, s.me?.countryCode || '60');
  return html`
    <${PageHead} title=${c.name || POS.fmtPhone(c.phone)} sub=${`${POS.fmtPhone(c.phone)} · customer since ${fmtDate(c.created_at)}`} back=${{ href: hrefFor('customers'), label: 'Customers' }}>
      ${wa && html`<a class="btn btn-wa" href=${wa} target="_blank" rel="noopener"><${Icon} name="whatsapp" size=${16} />WhatsApp</a>`}
      <button class="btn" onClick=${() => setEditing(true)}><${Icon} name="edit" size=${16} />Edit</button>
    <//>
    <div class="stats stats-3">
      <div class="stat stat-1"><span class="stat-label">Visits</span><span class="stat-value">${c.visits || 0}</span><span class="stat-sub">${c.last_visit_at ? 'last ' + timeAgo(c.last_visit_at) : 'not yet'}</span></div>
      <div class="stat stat-2"><span class="stat-label">Total spent</span><span class="stat-value">${money(c.spent || 0)}</span><span class="stat-sub">${c.visits ? money(Math.round((c.spent || 0) / c.visits)) + ' per visit' : ''}</span></div>
      <div class="stat stat-3"><span class="stat-label">Cashback</span><span class="stat-value">${money(c.wallets.reduce((t, w) => t + w.balance, 0))}</span>
        <span class="stat-sub">${c.wallets.filter((w) => w.balance > 0).map((w) => `${brandName(w.brand, s.stores)} ${money(w.balance)}`).join(' · ') || 'Nothing to spend yet'}</span></div>
    </div>
    ${(c.email || c.birthday || c.notes) && html`<section class="card"><dl class="facts">
      ${c.email && html`<dt>Email</dt><dd>${c.email}</dd>`}${c.birthday && html`<dt>Birthday</dt><dd>${fmtDate(c.birthday)}</dd>`}${c.notes && html`<dt>Notes</dt><dd>${c.notes}</dd>`}</dl></section>`}
    <h2 class="list-head">Purchases</h2>
    ${c.sales.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Store</th><th>Items</th><th class="num">Paid</th><th class="num">Cashback</th></tr></thead>
      <tbody>${c.sales.map((x) => html`<tr key=${x.id} onClick=${() => go('sale/' + x.id)}>
        <td data-label="Date">${fmtDate(x.paid_at || x.created_at)} ${fmtTime(x.paid_at || x.created_at)}</td>
        <td data-label="Store">${s.stores.find((st) => st.id === x.store_id)?.name || ''}</td>
        <td data-label="Items" class="ellipsis-cell">${x.items.map((l) => `${l.qty}× ${l.name}`).join(', ')}</td>
        <td data-label="Paid" class="num">${money(x.total + x.rounding - (x.refunded || 0))}</td>
        <td data-label="Cashback" class="num">${x.cashback_earned ? '+' + money(x.cashback_earned) : ''}${x.cashback_used ? ' −' + money(x.cashback_used) : ''}</td>
      </tr>`)}</tbody></table></div>` : html`<${Empty} icon="tag" title="No purchases yet" />`}
    ${editing && html`<${CustomerForm} customer=${c} onClose=${(u) => { setEditing(false); if (u) load(); }} />`}`;
}
