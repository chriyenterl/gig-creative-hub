// Webstore → Store settings (owners): how the store looks, when it's open, pickup / delivery, payment, messages.
import { html, useState, useRef } from '../lib.js';
import { api } from '../store.js';
import { Icon, PageHead, Empty, Field, Progress, toast, toastError } from '../ui.js';
import { copyText } from '../util.js';
import { DAYS, DEFAULT_MESSAGES, withDefaults } from '../shop/model.js';
import { useShop, setShop, storeUrl, uploadShopPhoto } from './shop-data.js';
import { categoriesOf } from './shop-products.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const LEAD = [[0, 'Any time today'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], [360, '6 hours'],
  [720, '12 hours'], [1440, '1 day'], [2880, '2 days'], [4320, '3 days'], [10080, '1 week']];
const STEPS = [10, 15, 20, 30, 45, 60, 90, 120];
const COLOURS = ['#9c4a1f', '#6b3f26', '#c2410c', '#be185d', '#7c3aed', '#1d4ed8', '#0f766e', '#15803d', '#1d1033'];

function Switch({ checked, onChange, label, hint }) {
  return html`<label class="switch-row"><span class="switch"><input type="checkbox" checked=${!!checked} onChange=${(e) => onChange(e.target.checked)} /><span></span></span>
    <span class="grow"><b>${label}</b>${hint && html`<br /><span class="muted small">${hint}</span>`}</span></label>`;
}

// Upload a logo / cover / QR code; the new photo is used once the settings are saved.
function PhotoField({ label, hint, value, urls, onChange, wide, round }) {
  const input = useRef();
  const [local, setLocal] = useState(null);
  const [progress, setProgress] = useState(null);
  const pick = async (file) => {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setLocal(preview);
    setProgress(0);
    try { onChange(await uploadShopPhoto(file, setProgress)); } catch (e) { toastError(e); setLocal(null); }
    setProgress(null);
  };
  const src = local || (value && urls[value]);
  return html`<div class="field ws-photo-field">
    <span class="field-label">${label}</span>
    <div class="ws-photo-row">
      <span class=${'ws-photo-thumb' + (wide ? ' wide' : '') + (round ? ' round' : '')}>${src ? html`<img src=${src} alt="" />` : html`<${Icon} name="image" size=${18} />`}</span>
      <button type="button" class="btn btn-sm" onClick=${() => input.current.click()} disabled=${progress != null}><${Icon} name="upload" size=${14} />${src ? 'Change' : 'Upload'}</button>
      ${src && html`<button type="button" class="btn btn-sm btn-ghost" onClick=${() => { setLocal(null); onChange(null); }}>Remove</button>`}
    </div>
    ${progress != null && html`<${Progress} value=${progress} />`}
    ${hint && html`<span class="field-hint">${hint}</span>`}
    <input ref=${input} type="file" accept="image/*" hidden onChange=${(e) => { const f = e.target.files[0]; e.target.value = ''; pick(f); }} />
  </div>`;
}

export function StoreSettings() {
  const { settings, products, owner, urls } = useShop();
  const [d, setD] = useState(() => clone(settings));
  const [busy, setBusy] = useState(false);
  if (!owner) {
    return html`<${PageHead} title="Store settings" /><section class="card"><${Empty} icon="key" title="Only owners can change the store settings">
      Ask an owner if something about the store needs changing.<//></section>`;
  }
  const dirty = JSON.stringify(d) !== JSON.stringify(settings);
  const set = (path, v) => setD((x) => {
    const n = clone(x);
    const keys = path.split('.');
    let o = n;
    keys.slice(0, -1).forEach((k) => { o = o[k]; });
    o[keys[keys.length - 1]] = v;
    return n;
  });
  const val = (path) => path.split('.').reduce((o, k) => o?.[k], d);
  const text = (path, props = {}) => html`<input value=${val(path) ?? ''} onInput=${(e) => set(path, e.target.value)} ...${props} />`;
  const num = (path, props = {}) => html`<input type="number" inputmode="decimal" min="0" step="0.5" value=${val(path) ?? 0} onInput=${(e) => set(path, e.target.value === '' ? 0 : Number(e.target.value))} ...${props} />`;
  const cats = categoriesOf(products, d);
  const moveCat = (i, dir) => { const c = [...cats]; [c[i], c[i + dir]] = [c[i + dir], c[i]]; set('categories', c); };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.shop.saveSettings(d);
      setShop({ settings: withDefaults(saved) });
      setD(clone(withDefaults(saved)));
      toast('Store settings saved.');
    } catch (e) { toastError(e); }
    setBusy(false);
  };
  const url = storeUrl();

  return html`
    <${PageHead} title="Store settings" sub="How your webstore looks, when customers can order, and how they pay.">
      <a class="btn" href=${url} target="_blank" rel="noopener"><${Icon} name="external" size=${16} />Open store</a>
    <//>
    <div class="settings-grid ws-settings">
      <div class="stack">
        <section class="card">
          <header class="card-head"><h2>Your store link</h2></header>
          <div class="url-box"><code>${url}</code>
            <button class="btn btn-sm" onClick=${async () => { if (await copyText(url)) toast('Store link copied.'); }}><${Icon} name="copy" size=${14} />Copy</button></div>
          <p class="muted small">Put it in your Instagram bio, WhatsApp Business profile and Linktree.</p>
          <div class="switch-list">
            <${Switch} checked=${d.open} onChange=${(v) => set('open', v)} label="Taking orders"
              hint=${d.open ? 'Customers can order now.' : 'Customers can browse, but checkout is paused.'} />
          </div>
          ${!d.open && html`<${Field} label="Message while ordering is paused">${text('closedMessage')}<//>`}
        </section>

        <section class="card">
          <header class="card-head"><h2>Look & details</h2></header>
          <${Field} label="Store name">${text('name')}<//>
          <${Field} label="Tagline" hint="One line under your name.">${text('tagline', { placeholder: 'Freshly baked cookies, made in Sabah' })}<//>
          <${Field} label="About" hint="Shown in “Store info”.">
            <textarea rows="3" value=${d.about} onInput=${(e) => set('about', e.target.value)} placeholder="Your story in two or three sentences"></textarea><//>
          <div class="form-row">
            <${PhotoField} label="Logo" hint="Square, at least 200 × 200 px." value=${d.logo_path} urls=${urls} round onChange=${(k) => set('logo_path', k)} />
            <${PhotoField} label="Cover photo" hint="Wide, e.g. 1600 × 600 px." value=${d.cover_path} urls=${urls} wide onChange=${(k) => set('cover_path', k)} />
          </div>
          <div class="field"><span class="field-label">Brand colour</span>
            <div class="swatch-pick">${COLOURS.map((c) => html`<button type="button" key=${c} class=${'swatch-btn' + (d.accent === c ? ' on' : '')} style=${{ background: c }}
              onClick=${() => set('accent', c)} aria-label=${'Colour ' + c}></button>`)}
              <label class="ws-colour"><input type="color" value=${d.accent} onInput=${(e) => set('accent', e.target.value)} aria-label="Any colour" />
                <input class="hex-input" value=${d.accent} onInput=${(e) => set('accent', e.target.value.trim())} aria-label="Colour code" /></label>
            </div>
            <span class="field-hint">Used for buttons and highlights on your store.</span>
          </div>
        </section>

        <section class="card">
          <header class="card-head"><h2>Contact</h2></header>
          <div class="form-row">
            <${Field} label="WhatsApp number" hint="Customers can message you; orders can be sent to it.">${text('phone', { type: 'tel', placeholder: '012-345 6789' })}<//>
            <${Field} label="Instagram">${text('instagram', { placeholder: 'noms.sabah' })}<//>
          </div>
          <${Field} label="Area / address" hint="Shown under your name, e.g. “Kota Kinabalu, Sabah”.">${text('address')}<//>
        </section>

        <section class="card">
          <header class="card-head"><h2>Opening hours</h2>
            <button class="link small" onClick=${() => set('hours', d.hours.map(() => ({ ...d.hours[0] })))}>Copy Monday to every day</button></header>
          <div class="ws-hours">${DAYS.map((day, i) => html`<div key=${day} class=${'ws-hour' + (d.hours[i].closed ? ' closed' : '')}>
            <label class="check-row"><input type="checkbox" checked=${!d.hours[i].closed} onChange=${(e) => set(`hours.${i}.closed`, !e.target.checked)} />${day}</label>
            ${d.hours[i].closed ? html`<span class="muted small">Closed</span>` : html`<span class="ws-hour-times">
              <input type="time" value=${d.hours[i].open} onInput=${(e) => set(`hours.${i}.open`, e.target.value)} aria-label=${day + ' opens'} />
              <span class="muted">–</span>
              <input type="time" value=${d.hours[i].close} onInput=${(e) => set(`hours.${i}.close`, e.target.value)} aria-label=${day + ' closes'} /></span>`}
          </div>`)}</div>
        </section>

        <section class="card">
          <header class="card-head"><h2>Order times</h2></header>
          <div class="form-row">
            <${Field} label="Earliest order" hint="How much notice you need to bake and pack.">
              <select value=${d.leadMinutes} onChange=${(e) => set('leadMinutes', Number(e.target.value))}>
                ${[...LEAD, ...(LEAD.some(([m]) => m === d.leadMinutes) ? [] : [[d.leadMinutes, d.leadMinutes + ' minutes']])].map(([m, l]) => html`<option value=${m}>${m ? l + ' ahead' : l}</option>`)}</select><//>
            <${Field} label="Time slots every">
              <select value=${d.slotMinutes} onChange=${(e) => set('slotMinutes', Number(e.target.value))}>${STEPS.map((m) => html`<option value=${m}>${m < 60 ? m + ' minutes' : m / 60 + (m === 60 ? ' hour' : ' hours')}</option>`)}</select><//>
          </div>
          <${Field} label="Customers can order up to" hint="days ahead.">${num('daysAhead', { min: 1, max: 90, step: 1 })}<//>
        </section>
      </div>

      <div class="stack">
        <section class="card">
          <header class="card-head"><h2>Self pickup</h2></header>
          <div class="switch-list"><${Switch} checked=${d.pickup.enabled} onChange=${(v) => set('pickup.enabled', v)} label="Customers can pick up" /></div>
          ${d.pickup.enabled && html`<${Field} label="Pickup address">${text('pickup.address', { placeholder: 'Shop / kitchen address' })}<//>
            <${Field} label="Pickup note (optional)">${text('pickup.note', { placeholder: 'e.g. Ring the bell at the side door' })}<//>`}
        </section>

        <section class="card">
          <header class="card-head"><h2>Delivery</h2></header>
          <div class="switch-list"><${Switch} checked=${d.delivery.enabled} onChange=${(v) => set('delivery.enabled', v)} label="We deliver" /></div>
          ${d.delivery.enabled && html`<div class="form-row">
              <${Field} label="Delivery fee (RM)">${num('delivery.fee')}<//>
              <${Field} label="Free delivery from (RM)" hint="0 = never free.">${num('delivery.freeOver')}<//>
            </div>
            <${Field} label="Minimum order for delivery (RM)" hint="0 = no minimum.">${num('delivery.minOrder')}<//>
            <${Field} label="Delivery area / note">${text('delivery.note', { placeholder: 'e.g. Within Kota Kinabalu only' })}<//>`}
        </section>

        <section class="card">
          <header class="card-head"><h2>Payment</h2></header>
          <div class="switch-list"><${Switch} checked=${d.payments.duitnow.enabled} onChange=${(v) => set('payments.duitnow.enabled', v)} label="DuitNow QR" hint="Customers scan your QR code." /></div>
          ${d.payments.duitnow.enabled && html`<div class="ws-sub">
            <${PhotoField} label="DuitNow QR code" hint="A screenshot of your QR from your bank app." value=${d.payments.duitnow.qr_path} urls=${urls} onChange=${(k) => set('payments.duitnow.qr_path', k)} />
            <${Field} label="Name shown with the QR">${text('payments.duitnow.name', { placeholder: 'e.g. Noms Enterprise' })}<//></div>`}
          <div class="switch-list"><${Switch} checked=${d.payments.bank.enabled} onChange=${(v) => set('payments.bank.enabled', v)} label="Bank transfer" /></div>
          ${d.payments.bank.enabled && html`<div class="ws-sub"><div class="form-row">
              <${Field} label="Bank">${text('payments.bank.bank', { placeholder: 'e.g. Maybank' })}<//>
              <${Field} label="Account number">${text('payments.bank.account_no')}<//></div>
            <${Field} label="Account name">${text('payments.bank.account_name')}<//></div>`}
          <div class="switch-list"><${Switch} checked=${d.payments.cash.enabled} onChange=${(v) => set('payments.cash.enabled', v)} label="Pay at pickup / cash on delivery" /></div>
          <div class="switch-list"><${Switch} checked=${d.receiptRequired} onChange=${(v) => set('receiptRequired', v)} label="Ask for the payment receipt at checkout"
            hint=${d.receiptRequired ? 'DuitNow / bank transfer customers must attach a screenshot to order.' : 'Optional — customers can also send it later from their order page.'} /></div>
        </section>

        <section class="card">
          <header class="card-head"><h2>Menu order</h2><span class="muted small">Order of the categories on the store</span></header>
          ${cats.length ? html`<ol class="ws-cat-order">${cats.map((c, i) => html`<li key=${c}><span>${c}</span>
            <span><button class="icon-btn" disabled=${i === 0} onClick=${() => moveCat(i, -1)} aria-label="Move up"><${Icon} name="up" size=${16} /></button>
            <button class="icon-btn" disabled=${i === cats.length - 1} onClick=${() => moveCat(i, 1)} aria-label="Move down"><${Icon} name="down" size=${16} /></button></span></li>`)}</ol>`
          : html`<p class="muted small">Categories appear here once your products have them.</p>`}
        </section>

        <section class="card">
          <header class="card-head"><h2>WhatsApp messages</h2></header>
          <p class="muted small">The green WhatsApp buttons on each order open WhatsApp with these, ready to send. Tags:
            <code>{name}</code> <code>{order_no}</code> <code>{total}</code> <code>{when}</code> <code>{store}</code> <code>{items}</code> <code>{link}</code> (their order page).</p>
          ${[['confirmed', 'Order confirmed'], ['ready_pickup', 'Ready for pickup'], ['ready_delivery', 'On its way (delivery)']].map(([k, l]) => html`<${Field} key=${k} label=${l}>
            <textarea rows="3" value=${d.messages[k]} onInput=${(e) => set('messages.' + k, e.target.value)} placeholder=${DEFAULT_MESSAGES[k]}></textarea><//>`)}
        </section>
      </div>
    </div>
    ${dirty && html`<div class="save-bar"><span>You have unsaved changes</span><span class="spacer"></span>
      <button class="btn" onClick=${() => setD(clone(settings))} disabled=${busy}>Discard</button>
      <button class="btn btn-primary" onClick=${save} disabled=${busy}>${busy ? 'Saving…' : 'Save settings'}</button></div>`}`;
}
