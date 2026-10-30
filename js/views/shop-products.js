// Webstore → Products: the menu customers order from. Changes show on the store straight away.
import { html, useState, useRef } from '../lib.js';
import { api } from '../store.js';
import { Icon, Pill, PageHead, Empty, Modal, Field, Progress, confirmDialog, toast, toastError } from '../ui.js';
import { uid } from '../util.js';
import { money, plusMoney, groupRule, BADGES, SAMPLE_PRODUCTS, SAMPLE_CATEGORIES } from '../shop/model.js';
import { useShop, setShop, shopState, replaceProduct, storeUrl, uploadShopPhoto } from './shop-data.js';

// Categories in the order set in Store settings, then any others the products use.
export function categoriesOf(products, settings) {
  const out = [...(settings.categories || [])];
  for (const p of products) if (p.category && !out.includes(p.category)) out.push(p.category);
  return out;
}

export function Products({ query }) {
  const { products, settings, urls } = useShop();
  const [editing, setEditing] = useState(null); // a product, or {} for a new one
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const cats = categoriesOf(products, settings);
  const groups = [...cats, null].map((c) => ({ name: c, list: products.filter((p) => (p.category || null) === c) })).filter((g) => g.list.length);
  const match = (p) => !q || `${p.name} ${p.description || ''} ${p.category || ''}`.toLowerCase().includes(q.toLowerCase());

  const toggle = async (p, patch, msg) => {
    try { replaceProduct(await api.shop.saveProduct({ ...p, ...patch })); toast(msg); } catch (e) { toastError(e); }
  };
  // Moves a product up or down within its category.
  const move = async (p, dir) => {
    const list = groups.find((g) => g.name === (p.category || null)).list;
    const i = list.indexOf(p), j = i + dir;
    if (j < 0 || j >= list.length) return;
    const order = groups.flatMap((g) => (g.list === list ? list.map((x, k) => (k === i ? list[j] : k === j ? list[i] : x)) : g.list));
    setShop({ products: order });
    try { setShop({ products: await api.shop.sortProducts(order.map((x) => x.id)) }); } catch (e) { toastError(e); }
  };
  const addSamples = async () => {
    setAdding(true);
    try {
      for (const p of SAMPLE_PRODUCTS) replaceProduct(await api.shop.saveProduct(p));
      if (shopState().owner && !settings.categories.length) setShop({ settings: await api.shop.saveSettings({ ...settings, categories: SAMPLE_CATEGORIES }) });
      toast('Sample products added — edit or delete them before you share your store link.');
    } catch (e) { toastError(e); }
    setAdding(false);
  };

  return html`
    <${PageHead} title="Products" sub="Your webstore menu. Changes show on the store straight away.">
      <button class="btn btn-primary" onClick=${() => setEditing({})}><${Icon} name="plus" size=${16} />Add product</button>
      <a class="btn" href=${storeUrl()} target="_blank" rel="noopener"><${Icon} name="external" size=${16} />Open store</a>
    <//>
    ${products.length ? html`
      <div class="filters"><label class="search"><${Icon} name="search" size=${16} />
        <input type="search" placeholder="Search products…" value=${q} onInput=${(e) => setQ(e.target.value)} /></label></div>
      ${groups.map((g) => g.list.some(match) && html`<section key=${g.name || '-'} class="card ws-cat">
        <header class="card-head"><h2>${g.name || 'No category'}</h2><span class="muted small">${g.list.length} product${g.list.length === 1 ? '' : 's'}</span></header>
        <ul class="ws-products">${g.list.filter(match).map((p, i) => html`<li key=${p.id} class=${p.is_hidden ? 'is-hidden' : ''}>
          <button class="ws-thumb" onClick=${() => setEditing(p)} aria-label=${'Edit ' + p.name}>
            ${p.image_path && urls[p.image_path] ? html`<img src=${urls[p.image_path]} alt="" />` : html`<${Icon} name="image" size=${18} />`}</button>
          <button class="ws-prod-main" onClick=${() => setEditing(p)}>
            <b>${p.name}</b>
            <span class="muted small">${money(p.price)}${p.compare_price ? html` <s>${money(p.compare_price)}</s>` : ''}${p.options?.length ? ` · ${p.options.map((o) => o.name).join(', ')}` : ''}</span>
            <span class="ws-pills">${p.badge && html`<${Pill} tone="info">${p.badge}<//>`}${!p.is_available && html`<${Pill} tone="warn">Sold out<//>`}
              ${p.is_hidden && html`<${Pill} tone="neutral" icon="eyeOff">Hidden<//>`}</span>
          </button>
          <label class="switch-row ws-avail" data-tip=${p.is_available ? 'In stock — tap to mark as sold out' : 'Sold out — tap to put back on sale'}>
            <span class="muted small">${p.is_available ? 'In stock' : 'Sold out'}</span>
            <span class="switch"><input type="checkbox" checked=${p.is_available} aria-label=${'In stock: ' + p.name}
              onChange=${(e) => toggle(p, { is_available: e.target.checked }, e.target.checked ? `${p.name} is back on sale.` : `${p.name} marked as sold out.`)} /><span></span></span>
          </label>
          <span class="ws-move">
            <button class="icon-btn" disabled=${!!q || i === 0} onClick=${() => move(p, -1)} aria-label="Move up"><${Icon} name="up" size=${16} /></button>
            <button class="icon-btn" disabled=${!!q || i === g.list.length - 1} onClick=${() => move(p, 1)} aria-label="Move down"><${Icon} name="down" size=${16} /></button>
          </span>
        </li>`)}</ul>
      </section>`)}`
    : html`<section class="card"><${Empty} icon="bag" title="No products yet">
        Add your first product — a photo, a name and a price is all it takes. Or start with a few sample products and edit them.
      <//><div class="ws-empty-actions">
        <button class="btn btn-primary" onClick=${() => setEditing({})}><${Icon} name="plus" size=${16} />Add product</button>
        <button class="btn" onClick=${addSamples} disabled=${adding}>${adding ? 'Adding…' : 'Add sample products'}</button>
      </div></section>`}
    ${editing && html`<${ProductEditor} product=${editing} cats=${cats} onClose=${() => setEditing(null)} />`}`;
}

const blankGroup = () => ({ id: uid().slice(0, 8), name: '', min: 1, max: 1, choices: [{ id: uid().slice(0, 8), name: '', price: 0 }] });

function ProductEditor({ product, cats, onClose }) {
  const { urls } = useShop();
  const isNew = !product.id;
  const [p, setP] = useState(() => ({ name: '', description: '', category: cats[0] || '', price: '', compare_price: '', badge: '', image_path: null,
    is_available: true, is_hidden: false, ...JSON.parse(JSON.stringify(product)), options: JSON.parse(JSON.stringify(product.options || [])) }));
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState({ preview: null, progress: null });
  const input = useRef();
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setGroup = (i, patch) => setP((x) => ({ ...x, options: x.options.map((g, k) => (k === i ? { ...g, ...patch } : g)) }));
  const setChoice = (i, j, patch) => setGroup(i, { choices: p.options[i].choices.map((c, k) => (k === j ? { ...c, ...patch } : c)) });

  const pickPhoto = async (file) => {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setPhoto({ preview, progress: 0 });
    try {
      const key = await uploadShopPhoto(file, (n) => setPhoto((x) => ({ ...x, progress: n })));
      setP((x) => ({ ...x, image_path: key }));
      setPhoto({ preview, progress: null });
    } catch (e) { toastError(e); setPhoto({ preview: null, progress: null }); }
  };
  const save = async () => {
    if (!p.name.trim()) return toast('Give the product a name.', 'error');
    if (p.price === '' || !(Number(p.price) >= 0)) return toast('Enter a price.', 'error');
    setBusy(true);
    try {
      const saved = await api.shop.saveProduct({ ...p, price: Number(p.price), compare_price: p.compare_price === '' ? null : Number(p.compare_price) });
      replaceProduct(saved);
      toast(isNew ? `${saved.name} added to your store.` : 'Saved.');
      onClose();
    } catch (e) { toastError(e); }
    setBusy(false);
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete ${product.name}?`, message: 'It disappears from the store (orders already placed keep it). To take it off the menu for a while, mark it as Sold out or Hidden instead.', confirmLabel: 'Delete product', danger: true }))) return;
    try { await api.shop.deleteProduct(product.id); setShop({ products: shopState().products.filter((x) => x.id !== product.id) }); toast('Product deleted.'); onClose(); } catch (e) { toastError(e); }
  };
  const img = photo.preview || (p.image_path && urls[p.image_path]);

  return html`<${Modal} title=${isNew ? 'Add product' : 'Edit product'} size="lg" onClose=${onClose} footer=${html`
      ${!isNew && html`<button class="btn btn-ghost-danger" onClick=${remove} disabled=${busy}><${Icon} name="trash" size=${16} />Delete</button>`}
      <span class="spacer"></span>
      <button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn btn-primary" onClick=${save} disabled=${busy || photo.progress != null}>${busy ? 'Saving…' : isNew ? 'Add product' : 'Save'}</button>`}>
    <div class="ws-editor">
      <div class="ws-photo">
        <button type="button" class="ws-photo-box" onClick=${() => input.current.click()}>
          ${img ? html`<img src=${img} alt="" />` : html`<span><${Icon} name="image" size=${26} /><b>Add a photo</b><span class="muted small">Square photos look best</span></span>`}
        </button>
        ${photo.progress != null && html`<${Progress} value=${photo.progress} />`}
        <div class="ws-photo-actions">
          <button type="button" class="btn btn-sm" onClick=${() => input.current.click()}><${Icon} name="upload" size=${14} />${img ? 'Change photo' : 'Upload photo'}</button>
          ${img && html`<button type="button" class="btn btn-sm btn-ghost" onClick=${() => { setP((x) => ({ ...x, image_path: null })); setPhoto({ preview: null, progress: null }); }}>Remove</button>`}
        </div>
        <input ref=${input} type="file" accept="image/*" hidden onChange=${(e) => { const f = e.target.files[0]; e.target.value = ''; pickPhoto(f); }} />
      </div>
      <div class="ws-fields">
        <${Field} label="Name"><input value=${p.name} onInput=${set('name')} placeholder="e.g. Classic Chocolate Chip" /><//>
        <div class="form-row">
          <${Field} label="Price (RM)"><input type="number" inputmode="decimal" min="0" step="0.1" value=${p.price} onInput=${set('price')} placeholder="7.90" /><//>
          <${Field} label="Original price (optional)" hint="Shown crossed out, for a promo."><input type="number" inputmode="decimal" min="0" step="0.1" value=${p.compare_price ?? ''} onInput=${set('compare_price')} /><//>
        </div>
        <div class="form-row">
          <${Field} label="Category"><input list="ws-cats" value=${p.category || ''} onInput=${set('category')} placeholder="e.g. Cookie boxes" />
            <datalist id="ws-cats">${cats.map((c) => html`<option value=${c} />`)}</datalist><//>
          <${Field} label="Label"><select value=${p.badge || ''} onChange=${set('badge')}>
            <option value="">None</option>${[...new Set([...BADGES, ...(p.badge ? [p.badge] : [])])].map((b) => html`<option value=${b}>${b}</option>`)}</select><//>
        </div>
        <${Field} label="Description"><textarea rows="3" value=${p.description || ''} onInput=${set('description')} placeholder="What makes it special — flavour, size, how many pieces…"></textarea><//>
        <div class="switch-list">
          <label class="switch-row"><span class="switch"><input type="checkbox" checked=${p.is_available} onChange=${set('is_available')} /><span></span></span>
            <span class="grow"><b>In stock</b><br /><span class="muted small">Turn off to show it as “Sold out”.</span></span></label>
          <label class="switch-row"><span class="switch"><input type="checkbox" checked=${p.is_hidden} onChange=${set('is_hidden')} /><span></span></span>
            <span class="grow"><b>Hide from the store</b><br /><span class="muted small">Keep it here without customers seeing it (e.g. a seasonal item).</span></span></label>
        </div>
      </div>
    </div>

    <div class="ws-options">
      <div class="section-head"><div><h3>Options</h3><span class="muted small">Choices like box size, flavour or add-ons. Each choice can add to the price.</span></div>
        <button class="btn btn-sm" onClick=${() => setP((x) => ({ ...x, options: [...x.options, blankGroup()] }))}><${Icon} name="plus" size=${14} />Add option</button></div>
      ${p.options.map((g, i) => html`<div key=${g.id} class="ws-group">
        <div class="ws-group-top">
          <input class="ws-group-name" value=${g.name} onInput=${(e) => setGroup(i, { name: e.target.value })} placeholder="Option name, e.g. Box size" aria-label="Option name" />
          <button class="icon-btn" onClick=${() => setP((x) => ({ ...x, options: x.options.filter((_, k) => k !== i) }))} aria-label="Remove option"><${Icon} name="trash" size=${16} /></button>
        </div>
        <div class="ws-group-rules">
          <label class="check-row"><input type="checkbox" checked=${g.min > 0} onChange=${(e) => setGroup(i, { min: e.target.checked ? 1 : 0 })} />Customer must choose</label>
          <label class="check-row">Can pick up to
            <input type="number" min="1" max=${g.choices.length} value=${g.max} class="ws-max" onInput=${(e) => setGroup(i, { max: Math.max(1, Math.min(g.choices.length, Number(e.target.value) || 1)) })} /></label>
          <span class="muted small">Shows as “${groupRule(g)}”</span>
        </div>
        ${g.choices.map((c, j) => html`<div key=${c.id} class="ws-choice">
          <input value=${c.name} onInput=${(e) => setChoice(i, j, { name: e.target.value })} placeholder=${j === 0 ? 'e.g. Box of 6' : 'Another choice'} aria-label="Choice" />
          <label class="ws-extra"><span class="muted small">+RM</span><input type="number" inputmode="decimal" step="0.1" value=${c.price} onInput=${(e) => setChoice(i, j, { price: e.target.value })} aria-label="Extra price" /></label>
          <button class="icon-btn" disabled=${g.choices.length === 1} onClick=${() => setGroup(i, { choices: g.choices.filter((_, k) => k !== j), max: Math.min(g.max, g.choices.length - 1) })} aria-label="Remove choice"><${Icon} name="x" size=${16} /></button>
        </div>`)}
        <button class="link small" onClick=${() => setGroup(i, { choices: [...g.choices, { id: uid().slice(0, 8), name: '', price: 0 }] })}>+ Add a choice</button>
      </div>`)}
      ${p.options.length > 0 && html`<p class="muted small">Price on the store: ${money(p.price || 0)} ${p.options.some((g) => g.choices.some((c) => Number(c.price))) ? '+ chosen extras (' + p.options.flatMap((g) => g.choices.filter((c) => Number(c.price)).map((c) => `${c.name || '…'} ${plusMoney(c.price)}`)).join(', ') + ')' : ''}</p>`}
    </div>
  <//>`;
}
