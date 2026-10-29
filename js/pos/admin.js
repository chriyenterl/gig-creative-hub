// Owners: stores (tax, service charge, payments, cashback, receipt) and who can use the POS.
import { html, useState, useEffect } from '../lib.js';
import { Icon, PageHead, Empty, Pill, toast, toastError } from '../ui.js';
import { hrefFor, go, copyText, timeAgo } from '../util.js';
import * as POS from './model.js';
import { api, usePos, refreshMe, chooseStore } from './state.js';
import { MoneyInput, Switch } from './ui.js';

const SITE = new URL('../../', import.meta.url).href;

export function StoresPage({ id }) {
  const s = usePos();
  if (id) return html`<${StoreForm} store=${id === 'new' ? null : s.stores.find((x) => x.id === id)} />`;
  return html`
    <${PageHead} title="Stores" sub="Each outlet has its own menu, tax and receipt. Outlets with the same brand share customers' cashback.">
      <a class="btn btn-primary" href=${hrefFor('stores/new')}><${Icon} name="plus" size=${16} />Add store</a><//>
    ${s.stores.length ? html`<div class="store-cards">${s.stores.map((x) => html`<a key=${x.id} class=${'card store-card' + (x.is_active ? '' : ' inactive')} href=${hrefFor('stores/' + x.id)}>
      <div class="row-between"><b>${x.name}</b>${x.is_active ? x.id === s.storeId && html`<${Pill} tone="good">This till<//>` : html`<${Pill}>Off<//>`}</div>
      <span class="muted small">${x.brand || 'No brand'} · receipts ${x.code}-000001…</span>
      <span class="small">${[x.settings.tax.rate ? `${x.settings.tax.name} ${x.settings.tax.rate}%${x.settings.tax.inclusive ? ' incl.' : ''}` : 'No tax',
        x.settings.service.rate ? `Service ${x.settings.service.rate}%` : null, x.settings.cashback.rate ? `Cashback ${x.settings.cashback.rate}%` : null,
        x.settings.kitchen ? 'Kitchen screen' : null].filter(Boolean).join(' · ')}</span>
    </a>`)}</div>` : html`<${Empty} icon="grid" title="No stores yet" />`}`;
}

export function StoreForm({ store, first }) {
  const s = usePos();
  const [f, setF] = useState(() => store ? JSON.parse(JSON.stringify(store)) : { name: '', brand: '', code: '', address: '', phone: '', is_active: true, settings: POS.cleanSettings({}) });
  const [newMethod, setNewMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setSt = (key, patch) => setF((x) => ({ ...x, settings: { ...x.settings, [key]: typeof patch === 'object' && !Array.isArray(patch) ? { ...x.settings[key], ...patch } : patch } }));
  const st = f.settings;
  const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.pos.saveStore(f);
      await refreshMe();
      toast(store ? 'Store saved.' : `${saved.name} is ready — add its menu next.`);
      if (!store) { await chooseStore(saved.id); go('menu'); } else go('stores');
    } catch (e) { toastError(e); }
    setBusy(false);
  };
  const brands = [...new Set(s.stores.map((x) => x.brand).filter(Boolean))];
  return html`
    <${PageHead} title=${first ? 'Set up your first store' : store ? store.name : 'New store'}
      sub=${first ? 'A store is one outlet with its own till, menu and receipt. You can add more later.' : 'Changes apply to new sales straight away.'}
      back=${first ? null : { href: hrefFor('stores'), label: 'Stores' }} />
    <div class="settings-cols">
      <section class="card"><h2>Details</h2>
        <div class="form-grid">
          <label class="field"><span class="field-label">Store name</span><input value=${f.name} maxlength="60" autofocus=${!store} onInput=${(e) => set({ name: e.target.value })} placeholder="e.g. Chajo SS15" /></label>
          <label class="field"><span class="field-label">Brand</span><input value=${f.brand || ''} maxlength="60" list="brands" onInput=${(e) => set({ brand: e.target.value })} placeholder="e.g. Chajo" />
            <datalist id="brands">${brands.map((b) => html`<option value=${b} />`)}</datalist><span class="field-hint">Outlets of the same brand share cashback.</span></label>
          <label class="field"><span class="field-label">Receipt code</span><input value=${f.code || ''} maxlength="6" onInput=${(e) => set({ code: e.target.value.toUpperCase() })} placeholder="e.g. CHJ" />
            <span class="field-hint">Receipts are numbered ${(f.code || 'CODE').toUpperCase()}-000001, -000002…</span></label>
          <label class="field"><span class="field-label">Phone</span><input value=${f.phone || ''} maxlength="40" onInput=${(e) => set({ phone: e.target.value })} /></label>
          <label class="field field-wide"><span class="field-label">Address</span><input value=${f.address || ''} maxlength="300" onInput=${(e) => set({ address: e.target.value })} /></label>
        </div>
        ${store && html`<${Switch} checked=${f.is_active} onChange=${(v) => set({ is_active: v })} label="Store is open for business" hint="Switch off a store that has closed — its sales stay in the reports." />`}
      </section>

      <section class="card"><h2>Tax & charges</h2>
        <div class="form-grid">
          <label class="field"><span class="field-label">Tax name</span><input value=${st.tax.name} maxlength="20" onInput=${(e) => setSt('tax', { name: e.target.value })} /></label>
          <label class="field"><span class="field-label">Tax rate %</span><input inputmode="decimal" value=${st.tax.rate} onInput=${(e) => setSt('tax', { rate: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} />
            <span class="field-hint">0 if you don't charge SST. F&B service tax is 6%.</span></label>
          <label class="field"><span class="field-label">SST registration no.</span><input value=${st.tax.regNo} maxlength="40" onInput=${(e) => setSt('tax', { regNo: e.target.value })} placeholder="Printed on receipts" /></label>
          <div class="field"><${Switch} checked=${st.tax.inclusive} onChange=${(v) => setSt('tax', { inclusive: v })} label="Menu prices already include tax" /></div>
          <label class="field"><span class="field-label">Service charge %</span><input inputmode="decimal" value=${st.service.rate} onInput=${(e) => setSt('service', { rate: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} /></label>
          <div class="field"><span class="field-label">Service charge on</span><div class="chip-picker">${Object.entries(POS.ORDER_TYPES).map(([k, label]) => html`<button type="button" class=${'chip' + (st.service.types.includes(k) ? ' on' : '')}
            onClick=${() => setSt('service', { types: toggleIn(st.service.types, k) })}>${label}</button>`)}</div></div>
        </div>
        <${Switch} checked=${st.rounding} onChange=${(v) => setSt('rounding', v)} label="Round cash payments to 5 sen" hint="Malaysia's rounding rule for cash (e.g. RM 12.32 → RM 12.30). Card and e-wallet stay exact." />
      </section>

      <section class="card"><h2>Selling</h2>
        <div class="field"><span class="field-label">Order types</span><div class="chip-picker">${Object.entries(POS.ORDER_TYPES).map(([k, label]) => html`<button type="button" class=${'chip' + (st.orderTypes.includes(k) ? ' on' : '')}
          onClick=${() => setSt('orderTypes', toggleIn(st.orderTypes, k))}>${label}</button>`)}</div><span class="field-hint">Pick only one (e.g. Takeaway) for a shop that doesn't need it — the choice is hidden on the till.</span></div>
        <div class="field"><span class="field-label">Payment methods</span>
          <div class="chip-picker">${st.methods.map((m) => html`<span class="chip on">${m}${m !== POS.CASH && html`<button type="button" class="chip-x" aria-label=${'Remove ' + m} onClick=${() => setSt('methods', st.methods.filter((x) => x !== m))}><${Icon} name="x" size=${12} /></button>`}</span>`)}</div>
          <span class="inline-form"><input value=${newMethod} maxlength="30" placeholder="Add a method (e.g. Boost, Grab Food)" onInput=${(e) => setNewMethod(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter' && newMethod.trim()) { setSt('methods', [...st.methods, newMethod.trim()]); setNewMethod(''); } }} />
            <button class="btn btn-sm" disabled=${!newMethod.trim()} onClick=${() => { setSt('methods', [...st.methods, newMethod.trim()]); setNewMethod(''); }}>Add</button></span></div>
        <${Switch} checked=${st.kitchen} onChange=${(v) => setSt('kitchen', v)} label="Kitchen screen" hint="Orders show on the Kitchen page (on a tablet in the kitchen or at the bar) until they're ready." />
      </section>

      <section class="card"><h2>Cashback (loyalty)</h2>
        <p class="muted small">Customers give their phone number at the till and get a share of what they spend back, to use on their next visit at any ${f.brand || 'outlet of this brand'}.</p>
        <div class="form-grid">
          <label class="field"><span class="field-label">Cashback %</span><input inputmode="decimal" value=${st.cashback.rate} onInput=${(e) => setSt('cashback', { rate: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} />
            <span class="field-hint">0 turns it off. 3–5% is common.</span></label>
          <div class="field"><span class="field-label">Only when they spend at least</span><${MoneyInput} value=${st.cashback.minSpend || null} onChange=${(v) => setSt('cashback', { minSpend: v || 0 })} /></div>
        </div>
      </section>

      <section class="card"><h2>Receipt</h2>
        <div class="form-grid">
          <label class="field field-wide"><span class="field-label">Top of the receipt</span><textarea rows="2" maxlength="500" value=${st.receipt.header} onInput=${(e) => setSt('receipt', { header: e.target.value })} placeholder="e.g. Company name (registration no.)"></textarea></label>
          <label class="field field-wide"><span class="field-label">Bottom of the receipt</span><textarea rows="2" maxlength="500" value=${st.receipt.footer} onInput=${(e) => setSt('receipt', { footer: e.target.value })} placeholder="e.g. Thank you! Follow us @…"></textarea></label>
          <div class="field"><span class="field-label">Paper width</span><div class="chip-picker">${[80, 58].map((w) => html`<button type="button" class=${'chip' + (st.receipt.width === w ? ' on' : '')} onClick=${() => setSt('receipt', { width: w })}>${w} mm</button>`)}</div></div>
          <div class="field"><${Switch} checked=${st.receipt.autoPrint} onChange=${(v) => setSt('receipt', { autoPrint: v })} label="Print the receipt after every sale" /></div>
        </div>
      </section>
    </div>
    <div class="save-bar"><span class="spacer"></span>${!first && html`<a class="btn" href=${hrefFor('stores')}>Cancel</a>`}
      <button class="btn btn-primary btn-lg" disabled=${busy || !f.name.trim()} onClick=${save}>${first ? 'Create store' : 'Save store'}</button></div>`;
}

export function TeamPage() {
  const s = usePos();
  const [team, setTeam] = useState(null);
  useEffect(() => { api.pos.team().then(setTeam).catch(toastError); }, []);
  const update = async (p, patch, msg) => {
    try { setTeam(await api.pos.teamSet(p.id, patch)); if (msg) toast(msg); } catch (e) { toastError(e); }
  };
  const posLink = (p) => SITE + 'pos/index.html#k=' + p.key;
  return html`
    <${PageHead} title="Team" sub="Give each person a POS role. Cashiers sell, run shifts and open orders; managers can also refund, change the menu and stock, and see reports.">
      <a class="btn btn-ghost" href=${SITE + 'index.html#/access'}><${Icon} name="key" size=${16} />Join link & approvals</a><//>
    <p class="muted small">New people join with the team join link (Creative Hub → Links & access → Team) and pick a 6-digit passcode. Approve them as <b>POS only</b> for cashiers who should only see the till, then set their role here. They sign in on the till with their name and passcode.</p>
    ${!team ? html`<div class="loading"><div class="spinner"></div></div>` : team.length ? html`<ul class="team-list">${team.map((p) => html`<li key=${p.id} class=${'card' + (p.active ? '' : ' inactive')}>
      <div class="row-between"><span><b>${p.name}</b> ${!p.active && html`<${Pill}>Turned off<//>`} ${p.posOnly && html`<${Pill} tone="info">POS only<//>`}</span>
        <span class="muted small">${p.last_used_at ? 'last in ' + timeAgo(p.last_used_at) : 'not signed in yet'}</span></div>
      <div class="team-row">
        <label class="field"><span class="field-label">POS role</span><select value=${p.pos || ''} onChange=${(e) => update(p, { pos: e.target.value || null }, e.target.value ? `${p.name} is now a ${e.target.value}.` : `${p.name} can't use the POS any more.`)}>
          <option value="">No POS access</option><option value="cashier">Cashier</option><option value="manager">Manager</option></select></label>
        ${p.pos && html`<div class="field"><span class="field-label">Stores</span><div class="chip-picker">
          <button type="button" class=${'chip' + (!p.stores.length ? ' on' : '')} onClick=${() => update(p, { stores: [] })}>All stores</button>
          ${s.stores.map((x) => html`<button type="button" class=${'chip' + (p.stores.includes(x.id) ? ' on' : '')}
            onClick=${() => update(p, { stores: p.stores.includes(x.id) ? p.stores.filter((i) => i !== x.id) : [...p.stores, x.id] })}>${x.name}</button>`)}</div></div>`}
      </div>
      ${p.pos && html`<div class="page-actions">
        <${Switch} checked=${p.posOnly} onChange=${(v) => update(p, { posOnly: v }, v ? `${p.name} now only has the POS (no Print Hub or Creative Hub).` : `${p.name} has the Print Hub again.`)} label="POS only" hint="They don't see the Print Hub or the Creative Hub." />
        <button class="btn btn-sm btn-ghost" disabled=${!p.active} onClick=${async () => { await copyText(posLink(p)); toast(`${p.name}'s POS sign-in link copied — open it once on the shop's tablet to sign in without the passcode.`); }}>
          <${Icon} name="link" size=${14} />Copy POS sign-in link</button></div>`}
    </li>`)}</ul>` : html`<${Empty} icon="users" title="Nobody on the team yet">Share the join link from the Creative Hub (Links & access → Team).<//>`}`;
}
