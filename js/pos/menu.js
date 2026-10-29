// Menu: products, categories and option groups (Size, Sugar level, Toppings…) for the store this till is at.
// Add products one by one, import them from a spreadsheet, or copy another outlet's menu.
import { html, useState } from '../lib.js';
import { Icon, PageHead, Empty, Modal, Tabs, Pill, Dropzone, confirmDialog, toast, toastError } from '../ui.js';
import { go, parseCSV } from '../util.js';
import * as POS from './model.js';
import { api, usePos, getS, setS, currentStore, money, refreshCatalog } from './state.js';
import { MoneyInput, Switch, tileColor } from './ui.js';

const COLORS = ['#e2557a', '#b07a4f', '#e08a2e', '#eda100', '#14a37f', '#1f8fb5', '#3f6fb5', '#6b5bd6', '#9d4edd', '#5e4f74'];
const setCatalog = (c) => { setS({ catalog: c }); try { localStorage.setItem('gig-pos-catalog:' + c.store_id, JSON.stringify(c)); } catch {} };

export function MenuPage({ query }) {
  const s = usePos();
  const store = currentStore();
  const c = s.catalog;
  const tab = query.tab || 'products';
  const [dlg, setDlg] = useState(null); // { kind, row } | 'import' | 'copy'
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  if (!c) return html`<div class="loading"><div class="spinner"></div></div>`;
  const catName = (id) => c.categories.find((x) => x.id === id)?.name;
  const products = c.products.filter((p) => (!cat || (cat === 'none' ? !p.category_id : p.category_id === cat)) && (!q || `${p.name} ${p.sku || ''}`.toLowerCase().includes(q.toLowerCase())));
  const save = async (kind, row) => {
    try { await api.pos.saveItem(kind, { ...row, store_id: store.id }); await refreshCatalog(); return true; } catch (e) { toastError(e); return false; }
  };
  const remove = async (kind, row) => {
    const what = { product: `“${row.name}” is removed from the menu. Past sales keep it.`, category: `Products in “${row.name}” stay, without a category.`,
      modifier: `“${row.name}” is taken off every product that uses it.` }[kind];
    if (!(await confirmDialog({ title: `Delete ${row.name}?`, message: what, confirmLabel: 'Delete', danger: true }))) return false;
    try { setCatalog(await api.pos.deleteItem(kind, row.id)); toast('Deleted.'); return true; } catch (e) { toastError(e); return false; }
  };
  const move = async (list, i, dir) => {
    const a = list[i], b = list[i + dir];
    if (!b) return;
    await Promise.all([api.pos.saveItem('category', { ...a, sort_order: i + dir + 1 }), api.pos.saveItem('category', { ...b, sort_order: i + 1 })]).catch(toastError);
    await refreshCatalog();
  };

  return html`
    <${PageHead} title="Menu" sub=${`${store.name} · ${c.products.length} products. Changes show on the till straight away.`}>
      ${tab === 'products' && html`
        <button class="btn btn-ghost" onClick=${() => setDlg('copy')}><${Icon} name="copy" size=${16} />Copy from another store</button>
        <button class="btn" onClick=${() => setDlg('import')}><${Icon} name="upload" size=${16} />Import from spreadsheet</button>`}
      <button class="btn btn-primary" onClick=${() => setDlg({ kind: { products: 'product', categories: 'category', options: 'modifier' }[tab], row: null })}>
        <${Icon} name="plus" size=${16} />${{ products: 'Add product', categories: 'Add category', options: 'Add option group' }[tab]}</button>
    <//>
    <${Tabs} value=${tab} onChange=${(t) => go('menu', { tab: t === 'products' ? undefined : t }, { replace: true })} items=${[
      { id: 'products', label: 'Products', count: c.products.length }, { id: 'categories', label: 'Categories', count: c.categories.length },
      { id: 'options', label: 'Options', count: c.modifiers.length }]} />

    ${tab === 'products' && html`
      <div class="filters">
        <label class="search"><${Icon} name="search" size=${16} /><input type="search" placeholder="Search by name or code" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>
        <select value=${cat} onChange=${(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>
          ${c.categories.map((x) => html`<option value=${x.id}>${x.name}</option>`)}<option value="none">No category</option></select>
      </div>
      ${products.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Cost</th><th>Options</th><th class="num">Stock</th><th>On the till</th></tr></thead>
        <tbody>${products.map((p) => html`<tr key=${p.id} onClick=${() => setDlg({ kind: 'product', row: p })} class=${p.is_active ? '' : 'inactive'}>
          <td data-label="Product"><span class="dot dot-lg" style=${{ background: tileColor(p, c.categories.find((x) => x.id === p.category_id)) }}></span> <b>${p.name}</b>${p.sku && html`<span class="muted small"> · ${p.sku}</span>`}</td>
          <td data-label="Category">${catName(p.category_id) || html`<span class="muted">—</span>`}</td>
          <td data-label="Price" class="num">${money(p.price)}</td>
          <td data-label="Cost" class="num">${p.cost != null ? html`${money(p.cost)}${p.price > 0 && html`<span class="muted small block">${Math.round(((p.price - p.cost) / p.price) * 100)}% margin</span>`}` : html`<span class="muted">—</span>`}</td>
          <td data-label="Options" class="small">${(p.modifier_ids || []).map((id) => c.modifiers.find((m) => m.id === id)?.name).filter(Boolean).join(', ') || html`<span class="muted">—</span>`}</td>
          <td data-label="Stock" class="num">${p.track_stock ? html`<span class=${p.low_stock != null && p.stock <= p.low_stock ? 'bad-text' : ''}>${p.stock}</span>` : html`<span class="muted">—</span>`}</td>
          <td data-label="On the till" onClick=${(e) => e.stopPropagation()}><label class="switch"><input type="checkbox" checked=${p.is_active} aria-label="Show on the till"
            onChange=${(e) => save('product', { ...p, is_active: e.target.checked }).then((ok) => ok && toast(e.target.checked ? `${p.name} is back on the till.` : `${p.name} is hidden (sold out for today?).`))} /><span></span></label></td>
        </tr>`)}</tbody></table></div>`
      : html`<${Empty} icon="tag" title=${c.products.length ? 'Nothing matches' : 'No products yet'}>${c.products.length ? '' : 'Add your first product, import your menu from a spreadsheet, or copy another outlet\'s menu.'}<//>`}`}

    ${tab === 'categories' && (c.categories.length ? html`<ul class="menu-list">${c.categories.map((x, i, all) => html`<li key=${x.id}>
        <span class="dot dot-lg" style=${{ background: x.color || 'var(--muted)' }}></span><b>${x.name}</b>
        <span class="muted small">${c.products.filter((p) => p.category_id === x.id).length} products</span><span class="spacer"></span>
        <button class="icon-btn" aria-label="Move up" disabled=${!i} onClick=${() => move(all, i, -1)}>↑</button>
        <button class="icon-btn" aria-label="Move down" disabled=${i === all.length - 1} onClick=${() => move(all, i, 1)}>↓</button>
        <button class="btn btn-sm" onClick=${() => setDlg({ kind: 'category', row: x })}><${Icon} name="edit" size=${14} />Edit</button></li>`)}</ul>`
      : html`<${Empty} icon="layers" title="No categories yet">Categories are the tabs at the top of the till (e.g. Milk Tea, Cakes, Drinks).<//>`)}

    ${tab === 'options' && (c.modifiers.length ? html`<ul class="menu-list">${c.modifiers.map((m) => html`<li key=${m.id}>
        <span><b>${m.name}</b><span class="muted small block">${m.options.map((o) => o.name + (o.price ? ` +${money(o.price)}` : '')).join(' · ')}</span></span>
        <span class="spacer"></span><${Pill} tone=${m.min_select ? 'info' : 'neutral'}>${m.min_select ? (m.max_select === 1 ? 'Pick 1' : `Pick ${m.min_select}–${m.max_select}`) : `Optional, up to ${m.max_select}`}<//>
        <span class="muted small">${c.products.filter((p) => (p.modifier_ids || []).includes(m.id)).length} products</span>
        <button class="btn btn-sm" onClick=${() => setDlg({ kind: 'modifier', row: m })}><${Icon} name="edit" size=${14} />Edit</button></li>`)}</ul>`
      : html`<${Empty} icon="list" title="No option groups yet">Option groups are choices for a product — e.g. <b>Size</b> (Regular / Large +RM1), <b>Sugar level</b>, <b>Toppings</b> (Pearl +RM1.50). Make a group once and add it to many products.<//>`)}

    ${dlg?.kind === 'product' && html`<${ProductDialog} row=${dlg.row} catalog=${c} onClose=${() => setDlg(null)} save=${save} remove=${remove} />`}
    ${dlg?.kind === 'category' && html`<${CategoryDialog} row=${dlg.row} count=${c.categories.length} onClose=${() => setDlg(null)} save=${save} remove=${remove} />`}
    ${dlg?.kind === 'modifier' && html`<${ModifierDialog} row=${dlg.row} onClose=${() => setDlg(null)} save=${save} remove=${remove} />`}
    ${dlg === 'import' && html`<${ImportDialog} store=${store} onClose=${() => setDlg(null)} />`}
    ${dlg === 'copy' && html`<${CopyDialog} store=${store} onClose=${() => setDlg(null)} />`}`;
}

function ColorPick({ value, onChange }) {
  return html`<div class="swatch-pick">${[null, ...COLORS].map((col) => html`<button type="button" class=${'swatch-btn' + (value === col ? ' on' : '')}
    style=${{ background: col || 'repeating-linear-gradient(45deg, var(--sunken), var(--sunken) 4px, var(--surface) 4px, var(--surface) 8px)' }}
    aria-label=${col || 'Automatic'} onClick=${() => onChange(col)}></button>`)}</div>`;
}

function ProductDialog({ row, catalog, onClose, save, remove }) {
  const [f, setF] = useState(row ? { ...row } : { name: '', price: null, cost: null, category_id: catalog.categories[0]?.id || '', sku: '', modifier_ids: [], track_stock: false, stock: 0, low_stock: null, is_active: true, color: null });
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF({ ...f, ...patch });
  const ok = async () => {
    if (!f.name.trim()) return toast('Give the product a name.', 'error');
    if (f.price == null) return toast('Give it a price (0 is fine).', 'error');
    setBusy(true);
    if (await save('product', f)) { toast(row ? 'Product saved.' : `${f.name} added to the menu.`); onClose(); }
    setBusy(false);
  };
  return html`<${Modal} title=${row ? 'Edit product' : 'New product'} onClose=${onClose} footer=${html`
      ${row && html`<button class="btn btn-ghost-danger" onClick=${() => remove('product', row).then((d) => d && onClose())}><${Icon} name="trash" size=${16} />Delete</button>`}
      <span class="spacer"></span><button class="btn" onClick=${onClose}>Cancel</button><button class="btn btn-primary" disabled=${busy} onClick=${ok}>Save</button>`}>
    <div class="form-grid">
      <label class="field field-wide"><span class="field-label">Name</span><input value=${f.name} maxlength="80" autofocus onInput=${(e) => set({ name: e.target.value })} placeholder="e.g. Brown Sugar Boba" /></label>
      <div class="field"><span class="field-label">Price</span><${MoneyInput} value=${f.price} onChange=${(v) => set({ price: v })} /></div>
      <div class="field"><span class="field-label">Cost (optional — for margins)</span><${MoneyInput} value=${f.cost} onChange=${(v) => set({ cost: v })} /></div>
      <label class="field"><span class="field-label">Category</span><select value=${f.category_id || ''} onChange=${(e) => set({ category_id: e.target.value || null })}>
        <option value="">No category</option>${catalog.categories.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select></label>
      <label class="field"><span class="field-label">Barcode / code (optional)</span><input value=${f.sku || ''} maxlength="40" onInput=${(e) => set({ sku: e.target.value })} placeholder="Scan or type" /></label>
      <div class="field field-wide"><span class="field-label">Options customers choose</span>
        ${catalog.modifiers.length ? html`<div class="chip-picker">${catalog.modifiers.map((m) => {
          const on = (f.modifier_ids || []).includes(m.id);
          return html`<button type="button" class=${'chip' + (on ? ' on' : '')} aria-pressed=${on}
            onClick=${() => set({ modifier_ids: on ? f.modifier_ids.filter((x) => x !== m.id) : [...(f.modifier_ids || []), m.id] })}>${on && html`<${Icon} name="check" size=${12} />`}${m.name}</button>`;
        })}</div>` : html`<span class="muted small">No option groups yet — add them under Menu → Options (e.g. Size, Sugar level).</span>`}</div>
      <div class="field field-wide"><span class="field-label">Tile colour on the till</span><${ColorPick} value=${f.color} onChange=${(v) => set({ color: v })} /></div>
      <div class="field-wide"><${Switch} checked=${f.track_stock} onChange=${(v) => set({ track_stock: v })} label="Track stock" hint="Counts down with every sale — for bottled drinks, merchandise, whole cakes…" /></div>
      ${f.track_stock && html`
        ${!row ? html`<label class="field"><span class="field-label">Stock now</span><input inputmode="numeric" value=${f.stock} onInput=${(e) => set({ stock: Number(e.target.value.replace(/[^\d-]/g, '')) || 0 })} /></label>`
          : html`<div class="field"><span class="field-label">Stock now</span><b>${row.stock}</b><span class="field-hint">Change it in Stock (so it's in the history).</span></div>`}
        <label class="field"><span class="field-label">Warn when it's down to</span><input inputmode="numeric" value=${f.low_stock ?? ''} placeholder="e.g. 5" onInput=${(e) => set({ low_stock: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')) })} /></label>`}
      <div class="field-wide"><${Switch} checked=${f.is_active} onChange=${(v) => set({ is_active: v })} label="Show on the till" hint="Turn off when it's sold out for the day or off the menu for a while." /></div>
    </div>
  <//>`;
}

function CategoryDialog({ row, count, onClose, save, remove }) {
  const [name, setName] = useState(row?.name || '');
  const [color, setColor] = useState(row?.color || COLORS[count % COLORS.length]);
  const ok = async () => { if (await save('category', { ...(row || { sort_order: count + 1 }), name, color })) { toast('Category saved.'); onClose(); } };
  return html`<${Modal} title=${row ? 'Edit category' : 'New category'} size="sm" onClose=${onClose} footer=${html`
      ${row && html`<button class="btn btn-ghost-danger" onClick=${() => remove('category', row).then((d) => d && onClose())}>Delete</button>`}
      <span class="spacer"></span><button class="btn btn-primary" onClick=${ok}>Save</button>`}>
    <div class="stack">
      <label class="field"><span class="field-label">Name</span><input value=${name} maxlength="40" autofocus onInput=${(e) => setName(e.target.value)} placeholder="e.g. Milk Tea" /></label>
      <div class="field"><span class="field-label">Colour</span><${ColorPick} value=${color} onChange=${setColor} /></div>
    </div>
  <//>`;
}

function ModifierDialog({ row, onClose, save, remove }) {
  const [name, setName] = useState(row?.name || '');
  const [opts, setOpts] = useState(row ? row.options.map((o) => ({ ...o })) : [{ name: '', price: 0 }, { name: '', price: 0 }]);
  const [required, setRequired] = useState(row ? row.min_select > 0 : true);
  const [multi, setMulti] = useState(row ? row.max_select > 1 : false);
  const [max, setMax] = useState(row?.max_select > 1 ? row.max_select : 3);
  const setOpt = (i, patch) => setOpts(opts.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const ok = async () => {
    const clean = opts.filter((o) => o.name.trim());
    if (await save('modifier', { ...(row || {}), name, options: clean, min_select: required ? 1 : 0, max_select: multi ? Math.max(2, max) : 1 })) { toast('Options saved.'); onClose(); }
  };
  return html`<${Modal} title=${row ? 'Edit option group' : 'New option group'} onClose=${onClose} footer=${html`
      ${row && html`<button class="btn btn-ghost-danger" onClick=${() => remove('modifier', row).then((d) => d && onClose())}>Delete</button>`}
      <span class="spacer"></span><button class="btn btn-primary" onClick=${ok}>Save</button>`}>
    <div class="stack">
      <label class="field"><span class="field-label">Group name</span><input value=${name} maxlength="40" autofocus onInput=${(e) => setName(e.target.value)} placeholder="e.g. Size, Sugar level, Toppings" /></label>
      <div class="field"><span class="field-label">Choices (and any extra price)</span>
        <ul class="opt-edit">${opts.map((o, i) => html`<li key=${i}>
          <input value=${o.name} maxlength="40" placeholder=${['Regular', 'Large', 'Pearl', 'Pudding'][i] || 'Choice'} onInput=${(e) => setOpt(i, { name: e.target.value })} aria-label="Choice name" />
          <${MoneyInput} value=${o.price || null} placeholder="+0.00" onChange=${(v) => setOpt(i, { price: v || 0 })} />
          <button class="icon-btn" aria-label="Remove" onClick=${() => setOpts(opts.filter((_, j) => j !== i))}><${Icon} name="x" size=${16} /></button></li>`)}</ul>
        <button class="btn btn-sm" onClick=${() => setOpts([...opts, { name: '', price: 0 }])}><${Icon} name="plus" size=${14} />Add a choice</button></div>
      <${Switch} checked=${required} onChange=${setRequired} label="Customers must choose" hint=${required ? 'The first choice is picked for them to start with (e.g. Regular).' : 'They can skip it (e.g. toppings).'} />
      <${Switch} checked=${multi} onChange=${setMulti} label="They can pick more than one" />
      ${multi && html`<label class="field"><span class="field-label">Up to how many?</span><input inputmode="numeric" value=${max} onInput=${(e) => setMax(Number(e.target.value.replace(/\D/g, '')) || 2)} /></label>`}
    </div>
  <//>`;
}

// Import from a spreadsheet (CSV): name, category, price, cost, code, stock.
function ImportDialog({ store, onClose }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const read = async (files) => {
    const f = files[0];
    if (!f) return;
    const table = parseCSV(await f.text());
    if (table.length < 2) return toast('That file has no rows.', 'error');
    const head = table[0].map((h) => String(h).toLowerCase().trim());
    const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
    const ix = { name: col('name', 'product', 'item'), category: col('category', 'group'), price: col('price', 'selling'), cost: col('cost'), sku: col('sku', 'barcode', 'code'), stock: col('stock', 'quantity', 'qty') };
    if (ix.name < 0 || ix.price < 0) return toast('The first row needs at least a "name" and a "price" column.', 'error');
    const get = (r, k) => (ix[k] >= 0 ? String(r[ix[k]] ?? '').trim() : '');
    setRows(table.slice(1).filter((r) => get(r, 'name')).map((r) => ({ name: get(r, 'name'), category: get(r, 'category'), price: POS.parseMoney(get(r, 'price')),
      cost: POS.parseMoney(get(r, 'cost')), sku: get(r, 'sku'), stock: get(r, 'stock') === '' ? null : Number(get(r, 'stock')) })));
  };
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.pos.importProducts(store.id, rows);
      setCatalog(r.catalog);
      toast(`${r.added} products added${r.skipped ? ` · ${r.skipped} skipped (no price, or already on the menu)` : ''}.`);
      onClose();
    } catch (e) { toastError(e); }
    setBusy(false);
  };
  return html`<${Modal} title="Import products from a spreadsheet" size="lg" onClose=${onClose} footer=${rows && html`
      <button class="btn" onClick=${() => setRows(null)}>Choose another file</button><span class="spacer"></span>
      <button class="btn btn-primary" disabled=${busy || !rows.length} onClick=${go}>Add ${rows.length} products</button>`}>
    ${!rows ? html`<div class="stack">
      <p>In Google Sheets or Excel, make columns <b>name</b>, <b>price</b> and (optional) <b>category</b>, <b>cost</b>, <b>code</b>, <b>stock</b>.
        Then <b>File → Download → CSV</b> and drop the file here. Categories are created for you; products already on the menu are skipped.</p>
      <${Dropzone} onFiles=${read} multiple=${false} accept=".csv,text/csv"><${Icon} name="upload" size=${24} /><b>Drop the CSV file here or click to choose</b><//>
      <pre class="csv-sample">name,category,price,cost,stock\nWalnut Brownie,Cakes,8.50,3.00,30\nSourdough,Breads,14.00,4.50,</pre>
    </div>` : html`<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Category</th><th class="num">Price</th><th class="num">Cost</th><th>Code</th><th class="num">Stock</th></tr></thead>
      <tbody>${rows.slice(0, 200).map((r, i) => html`<tr key=${i} class=${r.price == null ? 'inactive' : ''}><td>${r.name}</td><td>${r.category || '—'}</td>
        <td class="num">${r.price == null ? html`<span class="bad-text">missing</span>` : money(r.price)}</td><td class="num">${r.cost == null ? '—' : money(r.cost)}</td>
        <td>${r.sku || '—'}</td><td class="num">${r.stock ?? '—'}</td></tr>`)}</tbody></table></div>
      ${rows.length > 200 && html`<p class="muted small">…and ${rows.length - 200} more.</p>`}`}
  <//>`;
}

function CopyDialog({ store, onClose }) {
  const others = getS().stores.filter((s) => s.id !== store.id);
  const [from, setFrom] = useState(others[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const r = await api.pos.copyMenu(from, store.id); setCatalog(r.catalog); toast(`${r.added} products copied to ${store.name}.`); onClose(); } catch (e) { toastError(e); }
    setBusy(false);
  };
  return html`<${Modal} title=${'Copy a menu into ' + store.name} size="sm" onClose=${onClose} footer=${html`<button class="btn btn-primary" disabled=${busy || !from} onClick=${go}>Copy menu</button>`}>
    ${others.length ? html`<div class="stack">
      <label class="field"><span class="field-label">Copy from</span><select value=${from} onChange=${(e) => setFrom(e.target.value)}>${others.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
      <p class="muted small">Categories, option groups and products are copied (stock starts at 0). Products ${store.name} already has are skipped. After this, each store's menu is changed on its own.</p>
    </div>` : html`<p class="muted">There's no other store to copy from yet.</p>`}
  <//>`;
}
