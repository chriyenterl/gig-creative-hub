// POS building blocks: steppers, toggles, money boxes, the receipt / kitchen docket and printing them.
import { html, render, useState, useEffect, useRef } from '../lib.js';
import { Icon } from '../ui.js';
import { waLink } from '../print/model.js';
import * as POS from './model.js';
import { getS } from './state.js';

export function Stepper({ value, onChange, min = 0, max = 9999, size }) {
  return html`<span class=${'stepper' + (size ? ' stepper-' + size : '')}>
    <button type="button" aria-label="Less" disabled=${value <= min} onClick=${(e) => { e.stopPropagation(); onChange(Math.max(min, value - 1)); }}>−</button>
    <b>${value}</b>
    <button type="button" aria-label="More" disabled=${value >= max} onClick=${(e) => { e.stopPropagation(); onChange(Math.min(max, value + 1)); }}>+</button>
  </span>`;
}

export function Segmented({ items, value, onChange, small }) {
  return html`<div class=${'segment' + (small ? ' segment-sm' : '')} role="radiogroup">
    ${items.map((it) => html`<button type="button" key=${it.id} role="radio" aria-checked=${value === it.id} class=${value === it.id ? 'on' : ''}
      onClick=${() => onChange(it.id)}>${it.icon && html`<${Icon} name=${it.icon} size=${14} />`}${it.label}</button>`)}
  </div>`;
}

// A money box: shows what's typed, reports sen (or null when empty).
export function MoneyInput({ value, onChange, placeholder = '0.00', autofocus, id, invalid, currency = 'RM', onEnter }) {
  const [text, setText] = useState(value == null ? '' : POS.moneyInput(value));
  const ref = useRef();
  useEffect(() => { // keep in step when changed from outside (e.g. a quick-cash button)
    if (POS.parseMoney(text) !== value) setText(value == null ? '' : POS.moneyInput(value));
  }, [value]);
  useEffect(() => { if (autofocus) setTimeout(() => ref.current?.focus(), 30); }, []);
  return html`<span class=${'money-input' + (invalid ? ' invalid' : '')}><span class="money-cur">${currency}</span>
    <input ref=${ref} id=${id} inputmode="decimal" autocomplete="off" placeholder=${placeholder} value=${text}
      onInput=${(e) => { const t = e.target.value.replace(/[^\d.]/g, ''); setText(t); onChange(POS.parseMoney(t)); }}
      onKeyDown=${(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }} /></span>`;
}

export function Switch({ checked, onChange, label, hint }) {
  return html`<label class="switch-row"><span class="switch"><input type="checkbox" checked=${!!checked} onChange=${(e) => onChange(e.target.checked)} /><span></span></span>
    <span>${label}${hint && html`<span class="field-hint block">${hint}</span>`}</span></label>`;
}

export const Money = ({ v, cls }) => html`<span class=${'money' + (cls ? ' ' + cls : '')}>${POS.fmtMoney(v, getS().stores.find((s) => s.id === getS().storeId)?.settings.currency || 'RM')}</span>`;

// Colour for a product tile: its own, its category's, or one picked from its name.
const TILE = ['#e2557a', '#b07a4f', '#3f6fb5', '#14a37f', '#e08a2e', '#6b5bd6', '#1f8fb5', '#c2410c', '#0f766e', '#9d4edd'];
export function tileColor(p, cat) {
  if (p.color) return p.color;
  if (cat?.color) return cat.color;
  let h = 0;
  for (const ch of p.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE[h % TILE.length];
}

// ── Receipts ───────────────────────────────────────────────────────────────
const when = (iso) => new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export function Receipt({ sale, store, docket = false }) {
  const st = POS.cleanSettings(store?.settings);
  const m = (v) => POS.fmtMoney(v, '');
  const types = st.orderTypes.length > 1 || sale.order_type === 'dine_in';
  const paid = sale.total + (sale.rounding || 0);
  return html`<div class=${'receipt receipt-' + st.receipt.width + (docket ? ' docket' : '')}>
    ${docket ? html`<div class="r-center"><div class="r-big">${sale.order_no ? '#' + sale.order_no : 'Order'}</div>
        <div>${POS.ORDER_TYPES[sale.order_type] || ''}${sale.table_no ? ' · ' + (sale.order_type === 'dine_in' ? 'Table ' : '') + sale.table_no : ''}</div>
        <div class="r-small">${when(sale.updated_at || sale.created_at)}</div></div>`
      : html`<div class="r-center">
        <div class="r-store">${store?.name}</div>
        ${store?.address && html`<div class="r-small">${store.address}</div>`}
        ${store?.phone && html`<div class="r-small">Tel ${store.phone}</div>`}
        ${st.receipt.header && html`<div class="r-small r-pre">${st.receipt.header}</div>`}
        ${st.tax.regNo && html`<div class="r-small">${st.tax.name} reg. no. ${st.tax.regNo}</div>`}
      </div>
      ${sale.order_no && html`<div class="r-center r-order">Order <b>#${sale.order_no}</b></div>`}
      <div class="r-rows r-small">
        <div><span>Receipt</span><span>${sale.receipt_no || (sale.offline ? 'Offline — number to follow' : '—')}</span></div>
        <div><span>Date</span><span>${when(sale.paid_at || sale.created_at)}</span></div>
        ${sale.cashier && html`<div><span>Cashier</span><span>${sale.cashier}</span></div>`}
        ${(types || sale.table_no) && html`<div><span>${POS.ORDER_TYPES[sale.order_type] || ''}</span><span>${sale.table_no ? (sale.order_type === 'dine_in' ? 'Table ' : '') + sale.table_no : ''}</span></div>`}
        ${sale.customer_name || sale.customer_phone ? html`<div><span>Customer</span><span>${sale.customer_name || POS.fmtPhone(sale.customer_phone)}</span></div>` : null}
      </div>`}
    <div class="r-line"></div>
    ${(sale.items || []).map((l) => html`<div class="r-item">
      <div class="r-row"><span>${l.qty} × ${l.name}</span>${!docket && html`<span>${m(l.gross ?? l.qty * (l.unit ?? l.price))}</span>`}</div>
      ${l.mods?.length > 0 && html`<div class="r-sub">${POS.modText(l.mods)}</div>`}
      ${l.note && html`<div class="r-sub">“${l.note}”</div>`}
      ${!docket && l.discount > 0 && html`<div class="r-row r-sub"><span>Discount</span><span>-${m(l.discount)}</span></div>`}
    </div>`)}
    ${docket ? (sale.note && html`<div class="r-line"></div><div class="r-pre">${sale.note}</div>`) : html`
      <div class="r-line"></div>
      <div class="r-rows">
        <div><span>Subtotal</span><span>${m(sale.subtotal)}</span></div>
        ${sale.service > 0 && html`<div><span>Service charge ${st.service.rate}%</span><span>${m(sale.service)}</span></div>`}
        ${sale.tax > 0 && html`<div><span>${st.tax.name} ${st.tax.rate}%${sale.tax_included ? ' (included)' : ''}</span><span>${m(sale.tax)}</span></div>`}
        ${sale.rounding ? html`<div><span>Rounding</span><span>${m(sale.rounding)}</span></div>` : null}
        <div class="r-total"><span>TOTAL ${st.currency}</span><span>${m(paid)}</span></div>
        ${(sale.payments || []).map((p) => html`<div><span>${p.method}${p.tendered && p.tendered !== p.amount ? ` (given ${m(p.tendered)})` : ''}</span><span>${m(p.amount)}</span></div>`)}
        ${sale.change_due > 0 && html`<div><span>Change</span><span>${m(sale.change_due)}</span></div>`}
        ${sale.discount > 0 && html`<div class="r-small"><span>You saved</span><span>${m(sale.discount)}</span></div>`}
      </div>
      ${(sale.refunds || []).map((r) => html`<div class="r-line"></div><div class="r-rows"><div><span>REFUNDED ${new Date(r.at).toLocaleDateString('en-MY')} (${r.method})</span><span>-${m(r.amount)}</span></div>
        <div class="r-small"><span>${r.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</span><span></span></div></div>`)}
      ${sale.cashback_earned > 0 && html`<div class="r-line"></div><div class="r-center r-small">You earned <b>${st.currency} ${m(sale.cashback_earned)}</b> cashback — use it on your next visit!</div>`}
      ${sale.note && html`<div class="r-small r-pre">${sale.note}</div>`}
      ${st.receipt.footer && html`<div class="r-line"></div><div class="r-center r-small r-pre">${st.receipt.footer}</div>`}`}
  </div>`;
}

// Prints only the receipt (or a report), on its own, at the store's paper width.
export function printView(vnode, width = 80) {
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.append(root); }
  render(vnode, root);
  root.dataset.width = String(width);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); render(null, root); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);
}
export const printReceipt = (sale, store, docket = false) => printView(html`<${Receipt} sale=${sale} store=${store} docket=${docket} />`, POS.cleanSettings(store?.settings).receipt.width);

// WhatsApp with the receipt typed out (the cashier presses Send).
export function whatsappReceipt(sale, store, phone) {
  const link = waLink(phone || sale.customer_phone, POS.receiptText(sale, store), getS().me?.countryCode || '60');
  if (link) window.open(link, '_blank', 'noopener');
  return !!link;
}

// A short sound when something needs attention (new kitchen ticket).
let audio = null;
export function chime() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume?.();
    const t = audio.currentTime;
    [[988, 0], [1319, 0.14]].forEach(([f, d]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.2, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
      o.connect(g).connect(audio.destination); o.start(t + d); o.stop(t + d + 0.3);
    });
  } catch {}
}

export const ago = (iso) => {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
  return min < 1 ? 'just now' : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
};
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (ymd) => new Date(ymd + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short' });
