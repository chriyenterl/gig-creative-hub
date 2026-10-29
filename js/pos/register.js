// The sell screen: products on the left, the order on the right (a sheet on phones).
// Tap a product → choose its options (size, sugar, toppings…) → Charge.
import { html, useState, useEffect, useMemo, useRef } from '../lib.js';
import { Icon, Modal, Pill, Empty, confirmDialog, toast, toastError } from '../ui.js';
import { hrefFor } from '../util.js';
import * as POS from './model.js';
import { api, usePos, getS, currentStore, money, setCart, newCart, addToCart, updateLine, removeLine, priceOf, orderPayload,
  refreshOpenOrders, cartFromOrder } from './state.js';
import { Stepper, Segmented, MoneyInput, tileColor, ago } from './ui.js';
import { PayDialog } from './pay.js';
import { OpenShiftDialog } from './shift.js';

const groupsOf = (p, catalog) => (p.modifier_ids || []).map((id) => catalog.modifiers.find((m) => m.id === id)).filter(Boolean);

export function Register() {
  const s = usePos();
  const store = currentStore();
  const catalog = s.catalog;
  const cart = s.cart;
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState(null); // { product, line? }
  const [editing, setEditing] = useState(null);
  const [dialog, setDialog] = useState(null); // customer | discount | note | pay | shift | orders | custom
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef({ buf: '', at: 0 });

  const products = useMemo(() => { // in category order, then the menu's own order
    const rank = new Map((catalog?.categories || []).map((c, i) => [c.id, i]));
    return (catalog?.products || []).filter((p) => p.is_active)
      .sort((a, b) => (rank.get(a.category_id) ?? 1e3) - (rank.get(b.category_id) ?? 1e3) || (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
  }, [catalog]);
  const cats = useMemo(() => (catalog?.categories || []).filter((c) => products.some((p) => p.category_id === c.id)), [catalog, products]);
  const catById = useMemo(() => new Map((catalog?.categories || []).map((c) => [c.id, c])), [catalog]);
  const shown = products.filter((p) => (!cat || p.category_id === cat || (cat === 'none' && !p.category_id))
    && (!q || `${p.name} ${p.sku || ''}`.toLowerCase().includes(q.toLowerCase())));
  const bySku = (code) => products.find((p) => p.sku && p.sku.toLowerCase() === code.toLowerCase());

  const tap = (p) => {
    if (groupsOf(p, catalog).length) return setPicker({ product: p });
    addToCart({ product_id: p.id, name: p.name, price: p.price });
    if (p.track_stock && p.stock <= 0) toast(`${p.name}: the system shows none left — please check the shelf.`, 'error');
  };

  // Barcode scanners type the code and press Enter — catch that anywhere on the sell screen.
  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('.modal-backdrop') || (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !e.target.classList.contains('reg-search'))) return;
      const r = scanRef.current, t = Date.now();
      if (e.key === 'Enter') {
        if (r.buf.length >= 4 && t - r.at < 120) {
          const p = bySku(r.buf);
          e.preventDefault();
          if (p) { tap(p); setQ(''); } else toast(`No product has the code ${r.buf}.`, 'error');
        }
        r.buf = '';
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { r.buf = t - r.at > 80 ? e.key : r.buf + e.key; r.at = t; }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [products]);

  if (!store) return null;
  if (!catalog) return html`<div class="loading"><div class="spinner"></div></div>`;
  const st = store.settings;
  const priced = priceOf(cart);
  const items = priced.items;

  const charge = () => {
    if (!cart.items.length) return toast('Add something to the order first.', 'error');
    if (s.shift === null) return setDialog('shift');
    setDialog('pay');
  };
  const saveOpen = async () => {
    if (!cart.items.length) return toast('Add something to the order first.', 'error');
    setBusy(true);
    try {
      const o = await api.pos.saveOpen({ ...orderPayload(), send: true });
      toast(`Order #${o.order_no} saved${o.table_no ? ' — ' + (o.order_type === 'dine_in' ? 'table ' : '') + o.table_no : ''}${o.kitchen === 'new' && st.kitchen ? ' and sent to the kitchen' : ''}.`);
      newCart();
      setSheet(false);
      refreshOpenOrders().catch(() => {});
    } catch (e) { toastError(e); }
    setBusy(false);
  };
  const clear = async () => {
    if (cart.open) {
      if (!(await confirmDialog({ title: 'Close this order?', message: `Order #${cart.order_no} stays saved as it was — any changes you haven't saved are dropped.`, confirmLabel: 'Close order' }))) return;
    } else if (cart.items.length && !(await confirmDialog({ title: 'Clear this order?', message: 'Everything in the cart is removed.', confirmLabel: 'Clear', danger: true }))) return;
    newCart();
  };

  const cartPanel = html`<aside class=${'reg-cart' + (sheet ? ' open' : '')} aria-label="Order">
    <div class="cart-head">
      <div class="cart-title">
        <button class="icon-btn sheet-close" aria-label="Back to products" onClick=${() => setSheet(false)}><${Icon} name="back" /></button>
        <b>${cart.open ? `Order #${cart.order_no}` : 'New sale'}</b>${cart.open && html`<${Pill} tone="info">Open order<//>`}
        <span class="spacer"></span>
        <button class="btn btn-sm btn-ghost" onClick=${clear} disabled=${!cart.items.length && !cart.open}>${cart.open ? 'Close' : 'Clear'}</button>
      </div>
      ${st.orderTypes.length > 1 && html`<${Segmented} small value=${cart.order_type} onChange=${(v) => setCart({ order_type: v })}
        items=${st.orderTypes.map((t) => ({ id: t, label: POS.ORDER_TYPES[t] }))} />`}
      <div class="cart-meta">
        <input class="cart-tag" value=${cart.table_no} maxlength="20" placeholder=${cart.order_type === 'dine_in' ? 'Table no.' : 'Name / tag (optional)'}
          aria-label=${cart.order_type === 'dine_in' ? 'Table number' : 'Name or tag'} onInput=${(e) => setCart({ table_no: e.target.value })} />
        <button class=${'btn btn-sm cart-cust' + (cart.customer ? ' btn-active' : '')} onClick=${() => setDialog('customer')}>
          <${Icon} name="users" size=${14} />${cart.customer ? html`<span class="ellipsis">${cart.customer.name || POS.fmtPhone(cart.customer.phone)}</span>
            ${cart.customer.cashback > 0 && html`<span class="cb-chip">${money(cart.customer.cashback)}</span>`}` : 'Customer'}</button>
      </div>
    </div>
    ${cart.items.length ? html`<ul class="cart-lines">
      ${priced.lines.map((l) => html`<li key=${l.key} class="cart-line" onClick=${() => setEditing(l.key)} role="button" tabindex="0"
          onKeyDown=${(e) => e.key === 'Enter' && setEditing(l.key)}>
        <div class="cl-main">
          <span class="cl-name">${l.name}</span>
          ${l.mods?.length > 0 && html`<span class="cl-sub">${POS.modText(l.mods)}</span>`}
          ${l.note && html`<span class="cl-sub cl-note">“${l.note}”</span>`}
          ${l.discount > 0 && html`<span class="cl-sub cl-disc">− ${money(l.discount)} discount</span>`}
          ${l.sent_at && html`<span class="cl-sub cl-sent"><${Icon} name="check" size=${11} />Sent to kitchen</span>`}
        </div>
        <${Stepper} value=${l.qty} min=${0} onChange=${(v) => (v ? updateLine(l.key, { qty: v }) : removeLine(l.key))} size="sm" />
        <span class="cl-price">${money(l.gross - l.line_discount)}</span>
      </li>`)}
    </ul>` : html`<div class="cart-empty"><${Icon} name="tag" size=${28} /><p>Tap a product to start${products.some((p) => p.sku) ? ', or scan a barcode' : ''}.</p></div>`}
    <div class="cart-foot">
      <div class="cart-totals">
        <div><span>Subtotal</span><span>${money(priced.subtotal)}</span></div>
        ${priced.discount > 0 && html`<div class="tot-disc"><span>Discount${cart.discount?.type === 'percent' ? ` (${cart.discount.value}% off)` : ''}</span><span>−${money(priced.discount)}</span></div>`}
        ${priced.service > 0 && html`<div><span>Service charge ${st.service.rate}%</span><span>${money(priced.service)}</span></div>`}
        ${priced.tax > 0 && html`<div><span>${st.tax.name} ${st.tax.rate}%${priced.tax_included ? ' (incl.)' : ''}</span><span>${money(priced.tax)}</span></div>`}
      </div>
      <div class="cart-tools">
        <button class="btn btn-sm" onClick=${() => setDialog('discount')} disabled=${!cart.items.length}><${Icon} name="tag" size=${14} />${cart.discount ? 'Edit discount' : 'Discount'}</button>
        <button class="btn btn-sm" onClick=${() => setDialog('note')}><${Icon} name="edit" size=${14} />${cart.note ? 'Edit note' : 'Note'}</button>
        <button class="btn btn-sm" onClick=${saveOpen} disabled=${busy || !cart.items.length}
          data-tip=${st.kitchen ? 'Save the order to pay later, and send new items to the kitchen' : 'Save the order to pay later (e.g. a table that may order more)'}>
          <${Icon} name="clock" size=${14} />${cart.open ? 'Update order' : 'Pay later'}</button>
      </div>
      <button class="btn btn-primary btn-lg btn-block charge-btn" onClick=${charge} disabled=${!cart.items.length}>
        <span>Charge</span><b>${money(priced.total)}</b></button>
    </div>
  </aside>`;

  return html`<div class="reg">
    <section class="reg-products">
      <div class="reg-tools">
        <label class="search"><${Icon} name="search" size=${16} />
          <input class="reg-search" type="search" placeholder=${products.some((p) => p.sku) ? 'Search or scan…' : 'Search products…'} value=${q}
            onInput=${(e) => setQ(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter') { const p = bySku(q.trim()) || (shown.length === 1 ? shown[0] : null); if (p) { e.preventDefault(); tap(p); setQ(''); } } }} /></label>
        <button class="btn" onClick=${() => setDialog('custom')} data-tip="Sell something that isn't on the menu (e.g. a custom cake deposit)"><${Icon} name="plus" size=${16} />Custom item</button>
        <button class="btn" onClick=${() => setDialog('orders')}><${Icon} name="clock" size=${16} />Open orders${s.openOrders.length > 0 && html`<span class="nav-badge">${s.openOrders.length}</span>`}</button>
      </div>
      ${cats.length > 0 && html`<div class="reg-cats" role="tablist">
        <button role="tab" aria-selected=${!cat} class=${'chip' + (!cat ? ' on' : '')} onClick=${() => setCat('')}>All</button>
        ${cats.map((c) => html`<button role="tab" key=${c.id} aria-selected=${cat === c.id} class=${'chip' + (cat === c.id ? ' on' : '')} onClick=${() => setCat(cat === c.id ? '' : c.id)}>
          <span class="dot" style=${{ background: c.color || 'var(--muted)' }}></span>${c.name}</button>`)}
        ${products.some((p) => !p.category_id) && html`<button role="tab" aria-selected=${cat === 'none'} class=${'chip' + (cat === 'none' ? ' on' : '')} onClick=${() => setCat(cat === 'none' ? '' : 'none')}>Other</button>`}
      </div>`}
      ${shown.length ? html`<div class="reg-grid">
        ${shown.map((p) => {
          const low = p.track_stock && p.low_stock != null && p.stock <= p.low_stock;
          const out = p.track_stock && p.stock <= 0;
          return html`<button key=${p.id} class=${'tile' + (out ? ' tile-out' : '')} style=${{ '--tile': tileColor(p, catById.get(p.category_id)) }} onClick=${() => tap(p)}>
            <span class="tile-name">${p.name}</span>
            <span class="tile-foot"><span class="tile-price">${money(p.price)}</span>
              ${out ? html`<span class="tile-badge bad">Out</span>` : low ? html`<span class="tile-badge">${p.stock} left</span>` : groupsOf(p, catalog).length ? html`<span class="tile-opts" aria-label="Has options">•••</span>` : null}</span>
          </button>`;
        })}
      </div>` : html`<${Empty} icon="search" title=${products.length ? 'Nothing matches' : 'No products yet'}>
        ${products.length ? 'Try another search or category.' : html`Add your menu in <a class="link" href=${hrefFor('menu')}>Menu</a> (or import it from a spreadsheet).`}<//>`}
    </section>
    ${cartPanel}
    ${!sheet && html`<button class="reg-bar" onClick=${() => setSheet(true)} disabled=${!cart.items.length && !cart.open}>
      <span>${cart.open ? `Order #${cart.order_no}` : 'View order'} · ${items} ${items === 1 ? 'item' : 'items'}</span><b>${money(priced.total)}</b></button>`}

    ${picker && html`<${OptionPicker} product=${picker.product} line=${picker.line} groups=${groupsOf(picker.product, catalog)} onClose=${() => setPicker(null)} />`}
    ${editing && cart.items.find((x) => x.key === editing) && html`<${LineEditor} line=${cart.items.find((x) => x.key === editing)} onClose=${() => setEditing(null)}
      onOptions=${(line) => { const p = products.find((x) => x.id === line.product_id); setEditing(null); if (p) setPicker({ product: p, line }); }}
      hasOptions=${(line) => { const p = products.find((x) => x.id === line.product_id); return !!(p && groupsOf(p, catalog).length); }} />`}
    ${dialog === 'customer' && html`<${CustomerDialog} onClose=${() => setDialog(null)} />`}
    ${dialog === 'discount' && html`<${DiscountDialog} onClose=${() => setDialog(null)} />`}
    ${dialog === 'note' && html`<${NoteDialog} onClose=${() => setDialog(null)} />`}
    ${dialog === 'custom' && html`<${CustomItemDialog} onClose=${() => setDialog(null)} />`}
    ${dialog === 'orders' && html`<${OpenOrdersDialog} onClose=${() => setDialog(null)} onOpen=${() => { setDialog(null); setSheet(true); }} />`}
    ${dialog === 'shift' && html`<${OpenShiftDialog} onClose=${() => setDialog(null)} onOpened=${() => setDialog('pay')}
      intro="A shift needs to be open before you take payments. Count the cash in the drawer to start." />`}
    ${dialog === 'pay' && html`<${PayDialog} onClose=${() => setDialog(null)} onDone=${() => { setDialog(null); setSheet(false); }}
      onNeedShift=${() => setDialog('shift')} />`}
  </div>`;
}

// ── Choosing options (size, sugar, toppings…) ───────────────────────────────
function OptionPicker({ product, groups, line, onClose }) {
  const init = () => Object.fromEntries(groups.map((g) => {
    const had = line ? g.options.filter((o) => line.mods.some((m) => m.group === g.name && m.name === o.name)).map((o) => o.id) : null;
    return [g.id, had && had.length ? had : g.min_select >= 1 && g.max_select === 1 ? [g.options[0].id] : []];
  }));
  const [sel, setSel] = useState(init);
  const [qty, setQty] = useState(line?.qty || 1);
  const [note, setNote] = useState(line?.note || '');
  const toggle = (g, o) => setSel((x) => {
    const cur = x[g.id] || [];
    if (g.max_select === 1) return { ...x, [g.id]: cur[0] === o.id && g.min_select === 0 ? [] : [o.id] };
    if (cur.includes(o.id)) return { ...x, [g.id]: cur.filter((i) => i !== o.id) };
    if (cur.length >= g.max_select) { toast(`Up to ${g.max_select} for ${g.name}.`, 'error'); return x; }
    return { ...x, [g.id]: [...cur, o.id] };
  });
  const mods = groups.flatMap((g) => g.options.filter((o) => (sel[g.id] || []).includes(o.id)).map((o) => ({ group: g.name, name: o.name, price: o.price })));
  const missing = groups.filter((g) => (sel[g.id] || []).length < g.min_select);
  const unit = product.price + mods.reduce((t, m) => t + m.price, 0);
  const done = () => {
    if (missing.length) return toast(`Choose ${missing.map((g) => g.name).join(', ')}.`, 'error');
    if (line) updateLine(line.key, { mods, qty, note: note.trim() || null });
    else addToCart({ product_id: product.id, name: product.name, price: product.price, mods, qty, note: note.trim() || null });
    onClose();
  };
  return html`<${Modal} title=${product.name} onClose=${onClose} footer=${html`
      <${Stepper} value=${qty} min=${1} onChange=${setQty} />
      <span class="spacer"></span>
      <button class="btn btn-primary btn-lg" onClick=${done}>${line ? 'Update' : 'Add'} · ${money(unit * qty)}</button>`}>
    <div class="opt-groups">
      ${groups.map((g) => html`<div class="opt-group" key=${g.id}>
        <div class="opt-head"><b>${g.name}</b><span class="muted small">${g.min_select >= 1 ? (g.max_select === 1 ? 'Pick 1' : `Pick ${g.min_select}–${g.max_select}`) : g.max_select === 1 ? 'Optional' : `Optional · up to ${g.max_select}`}</span>
          ${missing.includes(g) && html`<${Pill} tone="warn">Required<//>`}</div>
        <div class="opt-choices">${g.options.map((o) => {
          const on = (sel[g.id] || []).includes(o.id);
          return html`<button type="button" key=${o.id} class=${'opt' + (on ? ' on' : '')} aria-pressed=${on} onClick=${() => toggle(g, o)}>
            <span>${o.name}</span>${o.price > 0 && html`<span class="opt-price">+${money(o.price)}</span>`}</button>`;
        })}</div>
      </div>`)}
      <label class="field"><span class="field-label">Note for this item</span>
        <input value=${note} maxlength="200" placeholder="e.g. less sweet, no straw" onInput=${(e) => setNote(e.target.value)} /></label>
    </div>
  <//>`;
}

function LineEditor({ line, onClose, onOptions, hasOptions }) {
  const [qty, setQty] = useState(line.qty);
  const [note, setNote] = useState(line.note || '');
  const [dtype, setDtype] = useState(line.discount?.type || 'none');
  const [dval, setDval] = useState(line.discount ? (line.discount.type === 'percent' ? line.discount.value * 100 : line.discount.value) : null); // % kept ×100
  const unit = line.price + (line.mods || []).reduce((t, m) => t + m.price, 0);
  const save = () => {
    const discount = dtype === 'none' || !dval ? null : dtype === 'percent' ? { type: 'percent', value: Math.min(100, dval / 100) } : { type: 'amount', value: Math.min(dval, unit * qty) };
    updateLine(line.key, { qty, note: note.trim() || null, discount });
    onClose();
  };
  return html`<${Modal} title=${line.name} size="sm" onClose=${onClose} footer=${html`
      <button class="btn btn-ghost-danger" onClick=${() => { removeLine(line.key); onClose(); }}><${Icon} name="trash" size=${16} />Remove</button>
      <span class="spacer"></span><button class="btn btn-primary" onClick=${save}>Done</button>`}>
    <div class="stack">
      ${line.sent_at && html`<p class="muted small"><${Icon} name="check" size=${12} /> Already sent to the kitchen.</p>`}
      <div class="row-between"><span class="field-label">Quantity</span><${Stepper} value=${qty} min=${1} onChange=${setQty} /></div>
      ${hasOptions(line) && html`<button class="btn" onClick=${() => onOptions({ ...line, qty, note })}><${Icon} name="list" size=${16} />Change options${line.mods?.length ? ` (${POS.modText(line.mods)})` : ''}</button>`}
      <div class="field"><span class="field-label">Discount on this item</span>
        <${Segmented} small value=${dtype} onChange=${(v) => { setDtype(v); setDval(null); }} items=${[{ id: 'none', label: 'None' }, { id: 'percent', label: '% off' }, { id: 'amount', label: 'Amount off' }]} />
        ${dtype === 'percent' && html`<div class="quick-row">${[10, 20, 50, 100].map((p) => html`<button class=${'chip' + (dval === p * 100 ? ' on' : '')} onClick=${() => setDval(p * 100)}>${p}%</button>`)}
          <span class="pct-input"><input inputmode="decimal" value=${dval == null ? '' : dval / 100} placeholder="%" onInput=${(e) => setDval(Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) * 100) || null)} />%</span></div>`}
        ${dtype === 'amount' && html`<${MoneyInput} value=${dval} onChange=${setDval} autofocus />`}
      </div>
      <label class="field"><span class="field-label">Note</span><input value=${note} maxlength="200" placeholder="e.g. less sweet" onInput=${(e) => setNote(e.target.value)} /></label>
    </div>
  <//>`;
}

function DiscountDialog({ onClose }) {
  const { cart } = getS();
  const [type, setType] = useState(cart.discount?.type || 'percent');
  const [val, setVal] = useState(cart.discount ? (cart.discount.type === 'percent' ? cart.discount.value * 100 : cart.discount.value) : null);
  const [reason, setReason] = useState(cart.discount?.reason || '');
  const save = (clear) => {
    setCart({ discount: clear || !val ? null : { type, value: type === 'percent' ? Math.min(100, val / 100) : val, reason: reason.trim() || null } });
    onClose();
  };
  return html`<${Modal} title="Discount on the whole order" size="sm" onClose=${onClose} footer=${html`
      ${cart.discount && html`<button class="btn btn-ghost-danger" onClick=${() => save(true)}>Remove discount</button>`}
      <span class="spacer"></span><button class="btn btn-primary" onClick=${() => save(false)}>Apply</button>`}>
    <div class="stack">
      <${Segmented} value=${type} onChange=${(v) => { setType(v); setVal(null); }} items=${[{ id: 'percent', label: '% off' }, { id: 'amount', label: 'Amount off' }]} />
      ${type === 'percent' ? html`<div class="quick-row">${[5, 10, 15, 20, 30, 50].map((p) => html`<button class=${'chip chip-lg' + (val === p * 100 ? ' on' : '')} onClick=${() => setVal(p * 100)}>${p}%</button>`)}
        <span class="pct-input"><input inputmode="decimal" value=${val == null ? '' : val / 100} placeholder="Other" onInput=${(e) => setVal(Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) * 100) || null)} />%</span></div>`
      : html`<${MoneyInput} value=${val} onChange=${setVal} autofocus onEnter=${() => save(false)} />`}
      <label class="field"><span class="field-label">Reason (shows in reports)</span>
        <input value=${reason} maxlength="80" placeholder="e.g. Staff, Birthday, Promo 11.11" onInput=${(e) => setReason(e.target.value)} list="disc-reasons" />
        <datalist id="disc-reasons"><option value="Staff" /><option value="Birthday" /><option value="Loyal customer" /><option value="Promo" /><option value="Damaged item" /></datalist></label>
    </div>
  <//>`;
}

function NoteDialog({ onClose }) {
  const [note, setNote] = useState(getS().cart.note || '');
  return html`<${Modal} title="Note for this order" size="sm" onClose=${onClose} footer=${html`<button class="btn btn-primary" onClick=${() => { setCart({ note: note.trim() }); onClose(); }}>Save</button>`}>
    <textarea rows="3" maxlength="300" value=${note} placeholder="e.g. Pickup at 3pm · birthday candle" onInput=${(e) => setNote(e.target.value)} autofocus></textarea>
    <p class="muted small">Prints on the receipt and shows in the kitchen.</p>
  <//>`;
}

function CustomItemDialog({ onClose }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState(null);
  const add = () => {
    if (!name.trim()) return toast('Type what it is.', 'error');
    if (price == null) return toast('Enter the price.', 'error');
    addToCart({ product_id: null, name: name.trim(), price });
    onClose();
  };
  return html`<${Modal} title="Custom item" size="sm" onClose=${onClose} footer=${html`<button class="btn btn-primary" onClick=${add}>Add to order</button>`}>
    <div class="stack">
      <label class="field"><span class="field-label">What is it?</span><input value=${name} maxlength="80" autofocus placeholder="e.g. Custom cake deposit" onInput=${(e) => setName(e.target.value)} /></label>
      <div class="field"><span class="field-label">Price</span><${MoneyInput} value=${price} onChange=${setPrice} onEnter=${add} /></div>
    </div>
  <//>`;
}

// ── Customer: find by phone or name, or add them (for cashback and the customer list) ──
export function CustomerDialog({ onClose }) {
  const { cart, storeId } = getS();
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 3) { setList(null); return; }
    const t = setTimeout(() => api.pos.findCustomers(q.trim(), storeId).then(setList).catch(toastError), 250);
    return () => clearTimeout(t);
  }, [q]);
  const pick = (c) => { setCart({ customer: { id: c.id, name: c.name, phone: c.phone, cashback: c.cashback || 0 } }); toast(`${c.name || POS.fmtPhone(c.phone)} added to the order.`); onClose(); };
  const startAdd = () => { setAdding(true); if (/^[\d\s+-]+$/.test(q)) setPhone(q.trim()); else setName(q.trim()); };
  const save = async () => {
    setBusy(true);
    try { pick({ ...(await api.pos.saveCustomer({ phone, name })), cashback: 0 }); } catch (e) { toastError(e); }
    setBusy(false);
  };
  return html`<${Modal} title=${adding ? 'New customer' : 'Customer'} size="sm" onClose=${onClose} footer=${adding ? html`
      <button class="btn" onClick=${() => setAdding(false)}>Back</button><span class="spacer"></span>
      <button class="btn btn-primary" disabled=${busy} onClick=${save}>Save & add</button>` : cart.customer ? html`
      <button class="btn btn-ghost-danger" onClick=${() => { setCart({ customer: null }); onClose(); }}>Remove ${cart.customer.name || 'customer'} from the order</button>` : null}>
    ${adding ? html`<div class="stack">
      <label class="field"><span class="field-label">Phone (WhatsApp)</span><input type="tel" inputmode="tel" value=${phone} placeholder="012-345 6789" onInput=${(e) => setPhone(e.target.value)} autofocus /></label>
      <label class="field"><span class="field-label">Name</span><input value=${name} maxlength="60" placeholder="e.g. Nurul" onInput=${(e) => setName(e.target.value)} /></label>
      <p class="muted small">They'll collect cashback on every visit${currentStore()?.settings.cashback.rate ? ` (${currentStore().settings.cashback.rate}% here)` : ''}, and you can send their receipts on WhatsApp.</p>
    </div>` : html`<div class="stack">
      <label class="search"><${Icon} name="search" size=${16} /><input type="search" value=${q} autofocus placeholder="Phone number or name" onInput=${(e) => setQ(e.target.value)} /></label>
      ${list && (list.length ? html`<ul class="pick-list">${list.map((c) => html`<li key=${c.id}><button onClick=${() => pick(c)}>
          <span><b>${c.name || 'No name'}</b><span class="muted small block">${POS.fmtPhone(c.phone)} · ${c.visits || 0} visits</span></span>
          ${c.cashback > 0 && html`<span class="cb-chip">${money(c.cashback)} cashback</span>`}</button></li>`)}</ul>`
        : html`<p class="muted small">No customer found.</p>`)}
      <button class="btn" onClick=${startAdd}><${Icon} name="plus" size=${16} />New customer${q.trim() ? ` “${q.trim()}”` : ''}</button>
    </div>`}
  <//>`;
}

// ── Open orders (saved bills) ───────────────────────────────────────────────
function OpenOrdersDialog({ onClose, onOpen }) {
  const { openOrders, cart } = usePos();
  useEffect(() => { refreshOpenOrders().catch(toastError); }, []);
  const open = async (o) => {
    if (cart.items.length && cart.id !== o.id && !(await confirmDialog({ title: 'Put this sale aside?', message: 'The items in the cart now will be cleared.', confirmLabel: `Open order #${o.order_no}` }))) return;
    cartFromOrder(o);
    onOpen();
  };
  return html`<${Modal} title="Open orders" onClose=${onClose}>
    ${openOrders.length ? html`<ul class="pick-list">${openOrders.map((o) => html`<li key=${o.id}><button onClick=${() => open(o)}>
        <span><b>#${o.order_no}${o.table_no ? ` · ${o.order_type === 'dine_in' ? 'Table ' : ''}${o.table_no}` : ''}</b>
          <span class="muted small block">${POS.ORDER_TYPES[o.order_type]} · ${o.items.reduce((t, l) => t + l.qty, 0)} items · ${ago(o.created_at)} ago · ${o.cashier}${o.customer_name ? ' · ' + o.customer_name : ''}</span></span>
        <b>${money(o.total)}</b></button></li>`)}</ul>`
    : html`<${Empty} icon="clock" title="No open orders">Use <b>Pay later</b> on a sale to keep it open — handy for tables that order more.<//>`}
    <p class="muted small">Tap an order to add items or take payment. <a class="link" href=${hrefFor('orders')} onClick=${onClose}>See all open orders →</a></p>
  <//>`;
}
