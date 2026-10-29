// Taking payment: cash (with change and 5-sen rounding), card / e-wallets, split bills and cashback.
import { html, useState, useEffect } from '../lib.js';
import { Icon, Modal, toast, toastError } from '../ui.js';
import * as POS from './model.js';
import { api, usePos, currentStore, money, priceOf, checkout, setCart } from './state.js';
import { MoneyInput, printReceipt, whatsappReceipt } from './ui.js';

const ICON = { Cash: 'cash', Card: 'card', Cashback: 'star' };
const iconFor = (m) => ICON[m] || (/card|debit|credit|visa|master|amex/i.test(m) ? 'card' : 'qr'); // e-wallets: scan a QR

export function PayDialog({ onClose, onDone, onNeedShift }) {
  const s = usePos();
  const store = currentStore();
  const st = store.settings;
  const cart = s.cart;
  const [payments, setPayments] = useState([]); // card / e-wallet parts of a split bill
  const [method, setMethod] = useState(null);
  const [amount, setAmount] = useState(null);
  const [tendered, setTendered] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [frozen] = useState(() => priceOf(cart)); // what's being paid (stays on screen after the cart is cleared)
  const total = frozen.total;
  const left = POS.remaining(total, payments);
  const cashDue = POS.cashDue(left, st);
  const cbUsed = payments.filter((p) => p.method === POS.CASHBACK).reduce((t, p) => t + p.amount, 0);
  const cbLeft = Math.max(0, (cart.customer?.cashback || 0) - cbUsed);

  // An open order's customer: look up their cashback balance.
  useEffect(() => {
    if (cart.customer && cart.customer.cashback == null) {
      api.pos.customer(cart.customer.id, store.id).then((c) => setCart({ customer: { ...cart.customer, cashback: c.cashback || 0 } })).catch(() => {});
    }
  }, []);

  const finish = async (list) => {
    setBusy(true);
    try {
      const r = await checkout(list);
      setDone(r);
      if (st.receipt.autoPrint) printReceipt(r.sale, store);
    } catch (e) {
      if (e.code === 'NO_SHIFT') { toast('Open a shift first.', 'error'); onNeedShift?.(); } else toastError(e);
    }
    setBusy(false);
  };
  const payPart = (m, amt) => {
    if (!amt || amt <= 0) return toast('Enter the amount.', 'error');
    if (amt > left) return toast(`That's more than the ${money(left)} left to pay.`, 'error');
    const list = [...payments, { method: m, amount: amt }];
    setMethod(null); setAmount(null);
    if (amt === left) finish(list); else setPayments(list);
  };
  const payCash = (given) => {
    if (given == null || given < cashDue) return toast(`The customer needs to give at least ${money(cashDue)}.`, 'error');
    finish([...payments, { method: POS.CASH, amount: cashDue, tendered: given }]);
  };

  if (done) return html`<${Done} result=${done} store=${store} onClose=${onDone} />`;

  return html`<${Modal} title="Take payment" size="md" onClose=${() => !busy && onClose()}>
    <div class="pay">
      <div class="pay-due">
        <span class="muted">${payments.length ? 'Left to pay' : 'Total'}</span>
        <b>${money(method === POS.CASH ? cashDue : left)}</b>
        ${method === POS.CASH && cashDue !== left && html`<span class="muted small">Rounded to 5 sen from ${money(left)}</span>`}
        ${payments.length > 0 && html`<span class="muted small">of ${money(total)}</span>`}
      </div>
      ${payments.length > 0 && html`<ul class="pay-parts">${payments.map((p, i) => html`<li key=${i}><span>${p.method}</span><b>${money(p.amount)}</b>
        <button class="icon-btn" aria-label="Remove" disabled=${busy} onClick=${() => setPayments(payments.filter((_, j) => j !== i))}><${Icon} name="x" size=${14} /></button></li>`)}</ul>`}

      ${!method ? html`
        ${total === 0 ? html`<button class="btn btn-primary btn-lg btn-block" disabled=${busy} onClick=${() => finish([])}>Complete — nothing to pay</button>` : html`
        <div class="pay-methods">
          ${st.methods.map((m) => html`<button key=${m} class=${'pay-method' + (m === POS.CASH ? ' cash' : '')} disabled=${busy}
            onClick=${() => { setMethod(m); setAmount(left); setTendered(null); }}><${Icon} name=${iconFor(m)} size=${20} />${m}</button>`)}
          ${cbLeft > 0 && html`<button class="pay-method cashback" disabled=${busy} onClick=${() => payPart(POS.CASHBACK, Math.min(cbLeft, left))}>
            <${Icon} name="star" size=${20} />Use cashback<small>${money(Math.min(cbLeft, left))} of ${money(cbLeft)}</small></button>`}
        </div>
        <p class="muted small">Split bill? Take the card or e-wallet part first (change the amount), then cash or another method for the rest.</p>`}`

      : method === POS.CASH ? html`<div class="pay-cash">
        <span class="field-label">Cash received</span>
        <div class="quick-cash">${POS.quickCash(cashDue).map((v, i) => html`<button key=${v} class=${'chip chip-lg' + (tendered === v ? ' on' : '')} disabled=${busy}
          onClick=${() => (i === 0 ? payCash(v) : setTendered(v))}>${i === 0 ? 'Exact' : money(v)}</button>`)}</div>
        <${MoneyInput} value=${tendered} onChange=${setTendered} autofocus onEnter=${() => payCash(tendered)} placeholder="Other amount" />
        <div class="change-line"><span>Change</span><b>${tendered != null && tendered >= cashDue ? money(tendered - cashDue) : '—'}</b></div>
        <div class="row-end"><button class="btn" disabled=${busy} onClick=${() => setMethod(null)}>Back</button>
          <button class="btn btn-primary btn-lg" disabled=${busy || tendered == null || tendered < cashDue} onClick=${() => payCash(tendered)}>${busy ? 'Saving…' : 'Complete sale'}</button></div>
      </div>`

      : html`<div class="pay-cash">
        <span class="field-label">${method} amount</span>
        <${MoneyInput} value=${amount} onChange=${setAmount} autofocus onEnter=${() => payPart(method, amount)} />
        <p class="muted small">${amount != null && amount < left ? `${money(left - amount)} will be left to pay with another method.` : 'Take the payment on your card terminal or QR, then confirm here.'}</p>
        <div class="row-end"><button class="btn" disabled=${busy} onClick=${() => setMethod(null)}>Back</button>
          <button class="btn btn-primary btn-lg" disabled=${busy || !amount} onClick=${() => payPart(method, amount)}>${busy ? 'Saving…' : amount === left ? 'Complete sale' : 'Add payment'}</button></div>
      </div>`}
    </div>
  <//>`;
}

function Done({ result, store, onClose }) {
  const { sale, offline } = result;
  const [phone, setPhone] = useState('');
  const paid = sale.total + (sale.rounding || 0);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && !/INPUT/.test(e.target.tagName)) onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const sendWa = () => { if (!whatsappReceipt(sale, store, phone || sale.customer_phone)) toast('Type the customer\'s phone number first.', 'error'); };
  return html`<${Modal} title="Paid" size="sm" onClose=${onClose} footer=${html`<button class="btn btn-primary btn-lg btn-block" onClick=${onClose} autofocus>New sale</button>`}>
    <div class="pay-done">
      <span class="done-check"><${Icon} name="check" size=${30} /></span>
      ${sale.change_due > 0 ? html`<div class="change-big"><span>Change</span><b>${money(sale.change_due)}</b></div>` : html`<div class="change-big"><span>Paid</span><b>${money(paid)}</b></div>`}
      <p class="muted">${sale.change_due > 0 ? `Paid ${money(paid)} · ` : ''}${sale.payments.map((p) => p.method).join(' + ') || 'Free'}
        ${sale.order_no ? html` · Order <b>#${sale.order_no}</b>` : ''}${sale.receipt_no ? ` · ${sale.receipt_no}` : ''}</p>
      ${offline && html`<p class="offline-note"><${Icon} name="alert" size=${14} /> You're offline — this sale is saved on this device and will be sent as soon as the internet is back.</p>`}
      ${sale.cashback_earned > 0 && html`<p class="cb-note"><${Icon} name="star" size=${14} /> ${sale.customer_name || 'The customer'} earned ${money(sale.cashback_earned)} cashback.</p>`}
      <div class="done-actions">
        <button class="btn" onClick=${() => printReceipt(sale, store)}><${Icon} name="printer" size=${16} />Print receipt</button>
        ${sale.customer_phone ? html`<button class="btn btn-wa" onClick=${sendWa}><${Icon} name="whatsapp" size=${16} />WhatsApp receipt</button>`
          : html`<span class="wa-send"><input type="tel" inputmode="tel" placeholder="WhatsApp no." value=${phone} onInput=${(e) => setPhone(e.target.value)} aria-label="Customer's WhatsApp number" />
            <button class="btn btn-wa" onClick=${sendWa} aria-label="Send receipt on WhatsApp"><${Icon} name="whatsapp" size=${16} /></button></span>`}
      </div>
    </div>
  <//>`;
}
