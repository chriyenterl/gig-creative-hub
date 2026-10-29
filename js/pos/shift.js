// Shifts: open with the cash float → pay in / pay out during the day → count the drawer at close.
// Expected cash = float + cash sales − cash refunds + pay ins − pay outs; the report shows any difference.
import { html, useState, useEffect } from '../lib.js';
import { Icon, Modal, PageHead, Empty, Pill, toast, toastError } from '../ui.js';
import { hrefFor, go } from '../util.js';
import * as POS from './model.js';
import { api, usePos, getS, currentStore, money, isManager, refreshShift } from './state.js';
import { MoneyInput, Segmented, printView, fmtTime } from './ui.js';

export function OpenShiftDialog({ onClose, onOpened, intro }) {
  const store = currentStore();
  const [float, setFloat] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      await api.pos.openShift(store.id, float || 0);
      await refreshShift();
      toast(`Shift open at ${store.name}.`);
      onOpened?.();
      if (!onOpened) onClose();
    } catch (e) { toastError(e); refreshShift().catch(() => {}); }
    setBusy(false);
  };
  return html`<${Modal} title="Open a shift" size="sm" onClose=${onClose} footer=${html`<button class="btn btn-primary btn-lg btn-block" disabled=${busy} onClick=${open}>Open shift</button>`}>
    <div class="stack">
      <p class="muted">${intro || 'Count the cash in the drawer before the first sale.'}</p>
      <div class="field"><span class="field-label">Cash in the drawer (float)</span>
        <div class="quick-row">${[0, 10000, 20000, 30000].map((v) => html`<button class=${'chip chip-lg' + (float === v ? ' on' : '')} onClick=${() => setFloat(v)}>${money(v)}</button>`)}</div>
        <${MoneyInput} value=${float} onChange=${setFloat} autofocus onEnter=${open} /></div>
    </div>
  <//>`;
}

function CashMoveDialog({ shift, type, onClose }) {
  const [amount, setAmount] = useState(null);
  const [reason, setReason] = useState(POS.PAY_REASONS[type][0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.pos.cashMove(shift.id, { type, amount, reason, note }); await refreshShift(); toast(type === 'in' ? 'Pay in recorded.' : 'Pay out recorded.'); onClose(); }
    catch (e) { toastError(e); }
    setBusy(false);
  };
  return html`<${Modal} title=${type === 'in' ? 'Pay in — cash into the drawer' : 'Pay out — cash out of the drawer'} size="sm" onClose=${onClose}
      footer=${html`<button class="btn btn-primary" disabled=${busy || !amount} onClick=${save}>Save</button>`}>
    <div class="stack">
      <div class="field"><span class="field-label">Amount</span><${MoneyInput} value=${amount} onChange=${setAmount} autofocus /></div>
      <div class="field"><span class="field-label">Reason</span>
        <div class="quick-row">${POS.PAY_REASONS[type].map((r) => html`<button class=${'chip' + (reason === r ? ' on' : '')} onClick=${() => setReason(r)}>${r}</button>`)}</div></div>
      <label class="field"><span class="field-label">Note</span><input value=${note} maxlength="200" placeholder=${type === 'out' ? 'e.g. Ice from 99 Speedmart' : 'e.g. Change from the bank'} onInput=${(e) => setNote(e.target.value)} /></label>
      <p class="muted small">This doesn't change your sales — it keeps the cash count right at the end of the shift.</p>
    </div>
  <//>`;
}

// Count by notes and coins (optional) — or just type the total.
const DENOMS = [10000, 5000, 2000, 1000, 500, 100, 50, 20, 10, 5];
function CloseShiftDialog({ shift, onClose }) {
  const [mode, setMode] = useState('count');
  const [counts, setCounts] = useState({});
  const [typed, setTyped] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const counted = mode === 'count' ? DENOMS.reduce((t, d) => t + d * (Number(counts[d]) || 0), 0) : typed;
  const diff = counted == null ? null : counted - shift.totals.expected;
  const { outbox } = getS();
  const close = async () => {
    if (outbox.some((x) => x.sale.store_id === shift.store_id)) return toast('Some sales are still waiting to sync — reconnect to the internet first.', 'error');
    setBusy(true);
    try {
      const done = await api.pos.closeShift(shift.id, counted, note);
      onClose(done); // before refreshing: the open shift is gone after that
      refreshShift().catch(() => {});
    } catch (e) { toastError(e); }
    setBusy(false);
  };
  return html`<${Modal} title="Close shift — count the drawer" size="md" onClose=${() => onClose(null)} footer=${html`
      <span class=${'diff ' + (diff == null ? '' : diff === 0 ? 'good' : diff > 0 ? 'warn' : 'bad')}>${diff == null ? '' : diff === 0 ? 'Drawer matches' : diff > 0 ? `${money(diff)} over` : `${money(-diff)} short`}</span>
      <span class="spacer"></span><button class="btn btn-primary" disabled=${busy || counted == null} onClick=${close}>Close shift</button>`}>
    <div class="stack">
      <div class="row-between"><span>Expected in the drawer</span><b class="big-num">${money(shift.totals.expected)}</b></div>
      <${Segmented} value=${mode} onChange=${setMode} items=${[{ id: 'count', label: 'Count notes & coins' }, { id: 'total', label: 'Type the total' }]} />
      ${mode === 'count' ? html`<div class="denoms">${DENOMS.map((d) => html`<label key=${d} class="denom"><span>${d >= 100 ? 'RM ' + d / 100 : d + ' sen'}</span>
          <input inputmode="numeric" placeholder="0" value=${counts[d] || ''} onInput=${(e) => setCounts({ ...counts, [d]: e.target.value.replace(/\D/g, '') })} /></label>`)}</div>
        <div class="row-between"><span>Counted</span><b>${money(counted || 0)}</b></div>`
      : html`<${MoneyInput} value=${typed} onChange=${setTyped} autofocus />`}
      <label class="field"><span class="field-label">Note (optional)</span><input value=${note} maxlength="300" placeholder="e.g. RM 2 coin given as change twice" onInput=${(e) => setNote(e.target.value)} /></label>
    </div>
  <//>`;
}

// The end-of-shift report (also printed on the receipt printer).
export function ShiftReport({ shift, store, print }) {
  const t = shift.totals || shift.summary;
  if (!t) return null;
  const row = (label, v, cls) => html`<div class=${cls || ''}><span>${label}</span><span>${v}</span></div>`;
  const m = (v) => POS.fmtMoney(v, print ? '' : store?.settings.currency || 'RM');
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
  return html`<div class=${print ? 'receipt receipt-' + (store?.settings.receipt.width || 80) : 'shift-report'}>
    ${print && html`<div class="r-center"><div class="r-store">${store?.name}</div><div>Shift report${shift.status === 'open' ? ' (still open)' : ''}</div></div><div class="r-line"></div>`}
    <div class="r-rows">
      ${row('Opened', `${when(shift.opened_at)} · ${shift.opened_by}`)}
      ${row('Closed', shift.closed_at ? `${when(shift.closed_at)} · ${shift.closed_by}` : 'Still open')}
    </div>
    <h3 class="rep-h">Cash drawer</h3>
    <div class="r-rows">
      ${row('Opening float', m(t.float))}
      ${row('+ Cash sales', m(t.cashSales))}
      ${row('− Cash refunds', m(t.cashRefunds))}
      ${row('+ Pay in', m(t.payIn))}
      ${row('− Pay out', m(t.payOut))}
      ${row('Expected', m(t.expected), 'r-total')}
      ${t.counted != null && row('Counted', m(t.counted))}
      ${t.difference != null && row(t.difference === 0 ? 'Difference' : t.difference > 0 ? 'Over' : 'Short', m(t.difference), t.difference ? 'r-warn' : '')}
    </div>
    <h3 class="rep-h">Sales</h3>
    <div class="r-rows">
      ${row('Sales', String(t.salesCount))}
      ${row('Items sold', String(t.items))}
      ${row('Net sales', m(t.net))}
      ${t.discount ? row('Discounts given', m(t.discount)) : null}
      ${t.service ? row('Service charge', m(t.service)) : null}
      ${t.tax ? row(store?.settings.tax.name || 'Tax', m(t.tax)) : null}
      ${t.rounding ? row('Rounding', m(t.rounding)) : null}
      ${t.refundCount ? row(`Refunds (${t.refundCount})`, m(t.refunds)) : null}
    </div>
    <h3 class="rep-h">By payment method</h3>
    <div class="r-rows">
      ${t.methods.length ? t.methods.map((x) => row(`${x.method} (${x.count})`, m(x.net))) : row('No payments yet', '')}
      ${row('Collected', m(t.collected), 'r-total')}
    </div>
    ${shift.moves?.length > 0 && html`<h3 class="rep-h">Pay in / pay out</h3><div class="r-rows">
      ${shift.moves.map((x) => row(`${fmtTime(x.at)} ${x.type === 'in' ? 'In' : 'Out'} · ${x.reason}${x.note ? ' — ' + x.note : ''}`, (x.type === 'in' ? '+' : '−') + m(x.amount)))}</div>`}
    ${shift.note && html`<p class="r-small">Note: ${shift.note}</p>`}
  </div>`;
}
const printShift = (shift, store) => printView(html`<${ShiftReport} shift=${shift} store=${store} print />`, store.settings.receipt.width);

export function ShiftPage() {
  const s = usePos();
  const store = currentStore();
  const [dlg, setDlg] = useState(null);
  const [closed, setClosed] = useState(null);
  useEffect(() => { refreshShift().catch(toastError); }, [s.storeId]);
  const sh = s.shift;
  if (closed) {
    return html`<${PageHead} title="Shift closed" sub=${`${store.name} · ${closed.summary.difference === 0 ? 'the drawer matched.' : closed.summary.difference > 0 ? money(closed.summary.difference) + ' over.' : money(-closed.summary.difference) + ' short.'}`}>
        <button class="btn" onClick=${() => printShift(closed, store)}><${Icon} name="printer" size=${16} />Print report</button>
        <button class="btn btn-primary" onClick=${() => { setClosed(null); setDlg('open'); }}>Open next shift</button><//>
      <section class="card"><${ShiftReport} shift=${closed} store=${store} /></section>`;
  }
  return html`
    <${PageHead} title="Shift" sub=${sh ? `${store.name} · open since ${fmtTime(sh.opened_at)} (${sh.opened_by})` : `${store.name} · no shift open`}>
      ${isManager() && html`<a class="btn btn-ghost" href=${hrefFor('shifts')}><${Icon} name="clock" size=${16} />Past shifts</a>`}
      ${sh && html`<button class="btn" onClick=${() => printShift(sh, store)}><${Icon} name="printer" size=${16} />Print so far</button>`}
    <//>
    ${sh === undefined ? html`<div class="loading"><div class="spinner"></div></div>`
    : !sh ? html`<section class="card center-card">
        <${Empty} icon="clock" title="No shift open">Open a shift at the start of the day: count the cash float in the drawer. Payments can be taken once a shift is open.<//>
        <button class="btn btn-primary btn-lg" onClick=${() => setDlg('open')}><${Icon} name="play" size=${14} />Open shift</button></section>`
    : !sh.totals ? html`<section class="card"><${Empty} icon="alert" title="You're offline">The shift is open. Its totals show again when the internet is back.<//></section>`
    : html`<div class="stats stats-3">
        <div class="stat stat-1"><span class="stat-label">Expected in drawer</span><span class="stat-value">${money(sh.totals.expected)}</span><span class="stat-sub">Float ${money(sh.totals.float)} + cash in − cash out</span></div>
        <div class="stat stat-2"><span class="stat-label">Sales this shift</span><span class="stat-value">${sh.totals.salesCount}</span><span class="stat-sub">${money(sh.totals.collected)} collected</span></div>
        <div class="stat stat-3"><span class="stat-label">Net sales</span><span class="stat-value">${money(sh.totals.net)}</span><span class="stat-sub">${sh.totals.items} items · after discounts & refunds</span></div>
      </div>
      <div class="page-actions shift-actions">
        <button class="btn" onClick=${() => setDlg('in')}><${Icon} name="plus" size=${16} />Pay in</button>
        <button class="btn" onClick=${() => setDlg('out')}><${Icon} name="download" size=${16} />Pay out</button>
        <span class="spacer"></span>
        <button class="btn btn-primary" onClick=${() => setDlg('close')}><${Icon} name="check" size=${16} />Close shift</button>
      </div>
      <section class="card"><${ShiftReport} shift=${sh} store=${store} /></section>`}
    ${dlg === 'open' && html`<${OpenShiftDialog} onClose=${() => setDlg(null)} />`}
    ${(dlg === 'in' || dlg === 'out') && sh && html`<${CashMoveDialog} shift=${sh} type=${dlg} onClose=${() => setDlg(null)} />`}
    ${dlg === 'close' && sh?.totals && html`<${CloseShiftDialog} shift=${sh} onClose=${(done) => { setDlg(null); if (done) { setClosed(done); toast('Shift closed.'); } }} />`}`;
}

export function ShiftsPage({ id }) {
  const s = usePos();
  const store = currentStore();
  const [list, setList] = useState(null);
  const [one, setOne] = useState(null);
  useEffect(() => { setList(null); api.pos.shifts(store.id).then(setList).catch(toastError); }, [s.storeId]);
  useEffect(() => { setOne(null); if (id) api.pos.shiftReport(id).then(setOne).catch(toastError); }, [id]);
  if (id) {
    return html`<${PageHead} title="Shift report" back=${{ href: hrefFor('shifts'), label: 'Past shifts' }}>
        ${one && html`<button class="btn" onClick=${() => printShift(one, store)}><${Icon} name="printer" size=${16} />Print</button>`}<//>
      ${one ? html`<section class="card"><${ShiftReport} shift=${one} store=${store} /></section>` : html`<div class="loading"><div class="spinner"></div></div>`}`;
  }
  return html`<${PageHead} title="Past shifts" sub=${store.name} back=${{ href: hrefFor('shift'), label: 'Shift' }} />
    ${!list ? html`<div class="loading"><div class="spinner"></div></div>` : list.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Opened</th><th>By</th><th>Closed</th><th class="num">Expected</th><th class="num">Counted</th><th class="num">Difference</th></tr></thead>
      <tbody>${list.map((x) => {
        const d = x.summary?.difference;
        return html`<tr key=${x.id} onClick=${() => go('shifts/' + x.id)}>
          <td data-label="Opened"><b>${new Date(x.opened_at).toLocaleString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</b></td>
          <td data-label="By">${x.opened_by}${x.closed_by && x.closed_by !== x.opened_by ? ' → ' + x.closed_by : ''}</td>
          <td data-label="Closed">${x.status === 'open' ? html`<${Pill} tone="info">Open<//>` : fmtTime(x.closed_at)}</td>
          <td data-label="Expected" class="num">${x.summary ? money(x.summary.expected) : '—'}</td>
          <td data-label="Counted" class="num">${x.counted != null ? money(x.counted) : '—'}</td>
          <td data-label="Difference" class="num">${d == null ? '—' : html`<span class=${'diff ' + (d === 0 ? 'good' : d > 0 ? 'warn' : 'bad')}>${d === 0 ? 'Matched' : (d > 0 ? '+' : '') + money(d)}</span>`}</td>
        </tr>`;
      })}</tbody></table></div>` : html`<${Empty} icon="clock" title="No shifts yet" />`}`;
}
