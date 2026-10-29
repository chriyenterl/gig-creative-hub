// Stock: products that count down with every sale. Receive deliveries, write off wastage, do stock counts.
import { html, useState, useEffect } from '../lib.js';
import { Icon, PageHead, Empty, Modal, Tabs, toast, toastError } from '../ui.js';
import { go, timeAgo } from '../util.js';
import * as POS from './model.js';
import { api, usePos, currentStore, refreshCatalog } from './state.js';
import { Segmented } from './ui.js';

export function StockPage({ query }) {
  const s = usePos();
  const store = currentStore();
  const tab = query.tab || 'levels';
  const [adjust, setAdjust] = useState(null);
  const [moves, setMoves] = useState(null);
  useEffect(() => { if (tab === 'history') { setMoves(null); api.pos.stockMoves(store.id).then(setMoves).catch(toastError); } }, [tab, s.storeId]);
  if (!s.catalog) return html`<div class="loading"><div class="spinner"></div></div>`;
  const tracked = s.catalog.products.filter((p) => p.track_stock).sort((a, b) => {
    const la = a.low_stock != null && a.stock <= a.low_stock, lb = b.low_stock != null && b.stock <= b.low_stock;
    return lb - la || a.stock - b.stock || a.name.localeCompare(b.name);
  });
  const low = tracked.filter((p) => p.low_stock != null && p.stock <= p.low_stock);
  return html`
    <${PageHead} title="Stock" sub=${`${store.name} · ${tracked.length} products tracked${low.length ? ` · ${low.length} running low` : ''}`} />
    <${Tabs} value=${tab} onChange=${(t) => go('stock', { tab: t === 'levels' ? undefined : t }, { replace: true })} items=${[{ id: 'levels', label: 'Stock levels', count: tracked.length }, { id: 'history', label: 'History' }]} />
    ${tab === 'levels' ? (tracked.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Product</th><th class="num">In stock</th><th class="num">Warn at</th><th></th></tr></thead>
      <tbody>${tracked.map((p) => {
        const isLow = p.low_stock != null && p.stock <= p.low_stock;
        return html`<tr key=${p.id} onClick=${() => setAdjust({ p, mode: 'add' })}>
          <td data-label="Product"><b>${p.name}</b>${!p.is_active && html`<span class="muted small"> · hidden from till</span>`}</td>
          <td data-label="In stock" class="num"><b class=${p.stock <= 0 ? 'bad-text' : isLow ? 'warn-text' : ''}>${p.stock}</b></td>
          <td data-label="Warn at" class="num">${p.low_stock ?? '—'}</td>
          <td data-label="" class="row-action" onClick=${(e) => e.stopPropagation()}>
            <button class="btn btn-sm" onClick=${() => setAdjust({ p, mode: 'add' })}><${Icon} name="plus" size=${14} />Received</button>
            <button class="btn btn-sm btn-ghost" onClick=${() => setAdjust({ p, mode: 'remove' })}>Wastage</button>
            <button class="btn btn-sm btn-ghost" onClick=${() => setAdjust({ p, mode: 'set' })}>Count</button></td>
        </tr>`;
      })}</tbody></table></div>`
      : html`<${Empty} icon="layers" title="No products track stock">Turn on <b>Track stock</b> for a product in Menu (bottled drinks, merchandise, whole cakes…). Freshly made items usually don't need it.<//>`)
    : !moves ? html`<div class="loading"><div class="spinner"></div></div>` : moves.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>When</th><th>Product</th><th>What</th><th class="num">Change</th><th class="num">After</th><th>By</th></tr></thead>
      <tbody>${moves.map((m) => html`<tr key=${m.id}>
        <td data-label="When">${timeAgo(m.created_at)}</td><td data-label="Product"><b>${m.product_name}</b></td>
        <td data-label="What">${POS.STOCK_REASONS[m.reason] || m.reason}${m.note ? html`<span class="muted small"> · ${m.note}</span>` : ''}</td>
        <td data-label="Change" class="num"><b class=${m.qty_change < 0 ? 'bad-text' : 'good-text'}>${m.qty_change > 0 ? '+' : ''}${m.qty_change}</b></td>
        <td data-label="After" class="num">${m.stock_after ?? '—'}</td><td data-label="By">${m.who}</td></tr>`)}</tbody></table></div>`
      : html`<${Empty} icon="clock" title="No stock changes yet" />`}
    ${adjust && html`<${AdjustDialog} p=${adjust.p} mode=${adjust.mode} onClose=${() => setAdjust(null)} />`}`;
}

function AdjustDialog({ p, mode: m0, onClose }) {
  const [mode, setMode] = useState(m0);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Number(qty);
  const after = qty === '' ? null : mode === 'set' ? n : mode === 'add' ? p.stock + n : p.stock - n;
  const save = async () => {
    setBusy(true);
    try { await api.pos.stockAdjust({ productId: p.id, mode, qty: n, note }); await refreshCatalog(); toast(`${p.name}: ${after} in stock.`); onClose(); } catch (e) { toastError(e); }
    setBusy(false);
  };
  return html`<${Modal} title=${p.name} size="sm" onClose=${onClose} footer=${html`<span class="muted">${after != null ? `Stock after: ${after}` : `In stock now: ${p.stock}`}</span><span class="spacer"></span>
      <button class="btn btn-primary" disabled=${busy || qty === ''} onClick=${save}>Save</button>`}>
    <div class="stack">
      <${Segmented} value=${mode} onChange=${setMode} items=${[{ id: 'add', label: 'Received' }, { id: 'remove', label: 'Wastage' }, { id: 'set', label: 'Count' }]} />
      <label class="field"><span class="field-label">${mode === 'set' ? 'How many are there now?' : mode === 'add' ? 'How many came in?' : 'How many to write off?'}</span>
        <input inputmode="numeric" value=${qty} autofocus onInput=${(e) => setQty(e.target.value.replace(/\D/g, ''))} onKeyDown=${(e) => e.key === 'Enter' && qty !== '' && save()} /></label>
      <label class="field"><span class="field-label">Note</span><input value=${note} maxlength="200" placeholder=${mode === 'add' ? 'e.g. Supplier invoice #123' : mode === 'remove' ? 'e.g. Expired, dropped' : 'e.g. Monthly count'} onInput=${(e) => setNote(e.target.value)} /></label>
    </div>
  <//>`;
}
