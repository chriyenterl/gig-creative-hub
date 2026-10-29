// Reports: net sales, transactions, average ticket, payment methods, best sellers, busy hours —
// for one store or all of them, over any dates. Every chart has the numbers as a table too.
import { html, useState, useEffect, useRef } from '../lib.js';
import { Icon, PageHead, Empty, toastError } from '../ui.js';
import { go, downloadCSV } from '../util.js';
import * as POS from './model.js';
import { api, usePos, money } from './state.js';
import { fmtDay } from './ui.js';

const today = () => POS.localParts(new Date()).date;
function rangeFor(id) {
  const t = today(), [y, m] = t.split('-').map(Number);
  const first = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  switch (id) {
    case 'today': return [t, t];
    case 'yesterday': return [POS.addDays(t, -1), POS.addDays(t, -1)];
    case '30d': return [POS.addDays(t, -29), t];
    case 'month': return [first(y, m), t];
    case 'lastmonth': { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return [first(py, pm), POS.addDays(first(y, m), -1)]; }
    default: return [POS.addDays(t, -6), t];
  }
}
const PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['lastmonth', 'Last month']];
const span = (from, to) => Math.round((new Date(to) - new Date(from)) / 86400e3) + 1;
const compact = (sen) => { const rm = sen / 100; return rm >= 1e6 ? (rm / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : rm >= 1000 ? (rm / 1000).toFixed(rm >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(Math.round(rm)); };

export function ReportsPage({ query }) {
  const s = usePos();
  const preset = query.range || (query.from ? 'custom' : '7d');
  const [from, to] = preset === 'custom' ? [query.from || today(), query.to || today()] : rangeFor(preset);
  const storeId = query.store === 'all' ? '' : query.store || s.storeId;
  const [rep, setRep] = useState(null);
  const [prev, setPrev] = useState(null);
  const [loading, setLoading] = useState(true);
  const set = (patch) => go('reports', { ...query, ...patch }, { replace: true });
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const n = span(from, to);
    Promise.all([api.pos.report(storeId, from, to), api.pos.report(storeId, POS.addDays(from, -n), POS.addDays(from, -1)).catch(() => null)])
      .then(([r, p]) => { if (alive) { setRep(r); setPrev(p); } }).catch((e) => alive && toastError(e)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [from, to, storeId]);
  const store = s.stores.find((x) => x.id === storeId);
  const t = rep?.totals;
  const days = span(from, to);
  const vs = preset === 'month' || preset === 'lastmonth' ? 'month before' : days === 1 ? 'day before' : `previous ${days} days`;
  const delta = (cur, old) => {
    if (!prev || old == null) return null;
    if (!old) return cur ? { up: true, text: 'new' } : null;
    const p = Math.round(((cur - old) / Math.abs(old)) * 100);
    return { up: p >= 0, text: `${p >= 0 ? '+' : ''}${p}%` };
  };
  const exportCsv = () => {
    downloadCSV(`pos-products-${from}-to-${to}.csv`, rep.products, [{ label: 'Product', value: 'name' }, { label: 'Sold', value: 'qty' }, { label: 'Net sales (RM)', value: (r) => POS.toRM(r.net) }]);
    downloadCSV(`pos-days-${from}-to-${to}.csv`, rep.days, [{ label: 'Date', value: 'date' }, { label: 'Sales', value: 'sales' }, { label: 'Net sales (RM)', value: (r) => POS.toRM(r.net) }]);
  };
  const hours = rep ? trimHours(rep.hours) : [];
  return html`
    <${PageHead} title="Reports" sub=${`${store ? store.name : 'All stores'} · ${from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`}`}>
      ${rep && html`<button class="btn btn-ghost" onClick=${exportCsv}><${Icon} name="download" size=${16} />Export</button>`}
    <//>
    <div class="filters rep-filters">
      <div class="chips">${PRESETS.map(([id, label]) => html`<button key=${id} class=${'chip' + (preset === id ? ' on' : '')} onClick=${() => set({ range: id, from: undefined, to: undefined })}>${label}</button>`)}</div>
      <span class="date-range"><input type="date" value=${from} max=${to} aria-label="From" onChange=${(e) => e.target.value && set({ range: 'custom', from: e.target.value, to })} />
        <span class="muted">to</span><input type="date" value=${to} min=${from} max=${today()} aria-label="To" onChange=${(e) => e.target.value && set({ range: 'custom', from, to: e.target.value })} /></span>
      ${s.stores.length > 1 && html`<select value=${query.store === 'all' ? 'all' : storeId} onChange=${(e) => set({ store: e.target.value })} aria-label="Store">
        ${s.me.allStores || s.stores.length > 1 ? html`<option value="all">All stores</option>` : null}${s.stores.map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select>`}
    </div>
    ${!rep ? html`<div class="loading"><div class="spinner"></div></div>` : html`<div class=${'rep' + (loading ? ' rep-loading' : '')}>
      <div class="stats rep-stats">
        <${Tile} n="1" hero label="Net sales" value=${money(t.net)} sub="After discounts and refunds, before service charge & tax" delta=${delta(t.net, prev?.totals.net)} vs=${vs} />
        <${Tile} n="2" label="Transactions" value=${t.sales.toLocaleString('en-MY')} sub=${`${t.items.toLocaleString('en-MY')} items sold`} delta=${delta(t.sales, prev?.totals.sales)} vs=${vs} />
        <${Tile} n="3" label="Average ticket" value=${money(t.avg)} sub="Paid per transaction" delta=${delta(t.avg, prev?.totals.avg)} vs=${vs} />
        <${Tile} n="4" label="Collected" value=${money(t.collected)} sub=${`All payments − ${money(t.refunds)} refunded`} />
      </div>
      <div class="stats rep-stats rep-stats-sm">
        <${Tile} small label="Discounts given" value=${money(t.discount)} />
        <${Tile} small label="Refunds" value=${money(t.refunds)} />
        ${t.service > 0 && html`<${Tile} small label="Service charge" value=${money(t.service)} />`}
        ${t.tax > 0 && html`<${Tile} small label="Tax (SST)" value=${money(t.tax)} />`}
        ${t.cost > 0 && html`<${Tile} small label="Gross profit" value=${money(t.net - t.cost)} sub=${t.net ? `${Math.round(((t.net - t.cost) / t.net) * 100)}% margin (products with a cost)` : ''} />`}
        ${(t.cashbackEarned > 0 || t.cashbackUsed > 0) && html`<${Tile} small label="Cashback" value=${money(t.cashbackEarned)} sub=${`given · ${money(t.cashbackUsed)} spent`} />`}
      </div>
      ${t.sales === 0 && t.net === 0 ? html`<section class="card"><${Empty} icon="grid" title="No sales in these dates">Pick other dates, or another store.<//></section>` : html`
      <div class="dash-grid rep-grid">
        ${rep.days.length > 1 && html`<section class="card card-span"><header class="card-head"><h2>Net sales by day</h2><span class="muted small">Best day: ${(() => { const b = [...rep.days].sort((a, c) => c.net - a.net)[0]; return `${fmtDay(b.date)} · ${money(b.net)}`; })()}</span></header>
          <${Columns} data=${rep.days.map((d) => ({ key: d.date, label: rep.days.length > 14 ? d.date.slice(8) : fmtDay(d.date).split(' ').slice(0, 2).join(' '), full: fmtDay(d.date), value: d.net, sub: `${d.sales} sales` }))} />
          <${TableView} head=${['Day', 'Sales', 'Net sales']} rows=${rep.days.map((d) => [fmtDay(d.date), d.sales, money(d.net)])} /></section>`}
        <section class="card"><header class="card-head"><h2>Busiest hours</h2><span class="muted small">Net sales by hour of the day</span></header>
          ${hours.length ? html`<${Columns} data=${hours.map((h) => ({ key: h.hour, label: hourLabel(h.hour), full: `${hourLabel(h.hour)} – ${hourLabel((h.hour + 1) % 24)}`, value: h.net, sub: `${h.sales} sales` }))} />
            <${TableView} head=${['Hour', 'Sales', 'Net sales']} rows=${hours.map((h) => [hourLabel(h.hour), h.sales, money(h.net)])} />` : html`<p class="muted">No sales.</p>`}</section>
        <section class="card"><header class="card-head"><h2>Payment methods</h2><span class="muted small">After refunds</span></header>
          <${HBars} rows=${rep.methods.map((m) => ({ label: m.method, value: m.net, text: money(m.net), sub: `${m.count} payments${m.refunds ? ` · ${money(m.refunds)} refunded` : ''}` }))} /></section>
        <section class="card"><header class="card-head"><h2>Best sellers</h2><span class="muted small">By net sales</span></header>
          <${HBars} rows=${rep.products.slice(0, 10).map((p) => ({ label: p.name, value: p.net, text: money(p.net), sub: `${p.qty} sold` }))} />
          ${rep.products.length > 10 && html`<${TableView} label=${`All ${rep.products.length} products`} head=${['Product', 'Sold', 'Net sales']} rows=${rep.products.map((p) => [p.name, p.qty, money(p.net)])} />`}</section>
        ${rep.categories.length > 1 && html`<section class="card"><header class="card-head"><h2>Categories</h2></header>
          <${HBars} rows=${rep.categories.map((c) => ({ label: c.name, value: c.net, text: money(c.net), sub: `${c.qty} sold` }))} /></section>`}
        ${!store && rep.stores.length > 0 && html`<section class="card"><header class="card-head"><h2>Stores</h2></header>
          <${HBars} rows=${rep.stores.map((x) => ({ label: x.name, value: x.net, text: money(x.net), sub: `${x.sales} sales` }))} /></section>`}
        ${rep.cashiers.length > 0 && html`<section class="card"><header class="card-head"><h2>Cashiers</h2><span class="muted small">Who rang up the sales</span></header>
          <table class="mini-table"><thead><tr><th>Cashier</th><th class="num">Sales</th><th class="num">Paid</th></tr></thead>
            <tbody>${rep.cashiers.map((c) => html`<tr><td>${c.name}</td><td class="num">${c.sales}</td><td class="num">${money(c.paid)}</td></tr>`)}</tbody></table></section>`}
      </div>`}
    </div>`}`;
}

const hourLabel = (h) => (h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : h - 12 + 'pm');
// Only the hours the shop actually trades (first to last hour with sales).
function trimHours(hours) {
  const used = hours.filter((h) => h.net || h.sales);
  if (!used.length) return [];
  return hours.slice(used[0].hour, used[used.length - 1].hour + 1);
}

function Tile({ label, value, sub, delta, vs, hero, small, n }) {
  return html`<div class=${'stat' + (n ? ' stat-' + n : ' stat-plain') + (hero ? ' stat-hero' : '') + (small ? ' stat-sm' : '')}>
    <span class="stat-label">${label}</span><span class="stat-value">${value}</span>
    ${delta && html`<span class=${'delta ' + (delta.up ? 'up' : 'down')}><${Icon} name=${delta.up ? 'chevron' : 'back'} size=${12} />${delta.text} <span class="muted">vs ${vs}</span></span>`}
    ${sub && html`<span class="stat-sub">${sub}</span>`}
  </div>`;
}

function TableView({ head, rows, label = 'Show as a table' }) {
  return html`<details class="table-view"><summary>${label}</summary>
    <table class="mini-table"><thead><tr>${head.map((h, i) => html`<th class=${i ? 'num' : ''}>${h}</th>`)}</tr></thead>
      <tbody>${rows.map((r) => html`<tr>${r.map((c, i) => html`<td class=${i ? 'num' : ''}>${c}</td>`)}</tr>`)}</tbody></table></details>`;
}

// Horizontal bars, value at the tip (in ink, never the bar colour).
function HBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return html`<p class="muted">Nothing yet.</p>`;
  return html`<div class="hbars">${rows.map((r) => html`<div class="hbar" key=${r.label} data-tip=${`${r.label}: ${r.text}${r.sub ? ' · ' + r.sub : ''}`}>
    <span class="hbar-label">${r.label}</span>
    <span class="hbar-track"><span class="hbar-fill" style=${{ width: Math.max(0, (r.value / max) * 100) + '%' }}></span><span class="hbar-val">${r.text}</span></span>
  </div>`)}</div>`;
}

// Columns over time (one series): ≤24px wide, rounded tops, compact y ticks, a tooltip per column.
function Columns({ data, height = 190 }) {
  const ref = useRef();
  const [w, setW] = useState(0);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const padL = 40, padB = 22, padT = 8;
  const plotW = Math.max(0, w - padL), plotH = height - padB - padT;
  const maxV = Math.max(...data.map((d) => d.value), 0);
  const step = niceStep(maxV / 3);
  const top = Math.max(step * 3, step);
  const band = data.length ? plotW / data.length : 0;
  const bw = Math.max(2, Math.min(24, band - 2));
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 46))));
  const y = (v) => padT + plotH - (Math.max(0, v) / (top || 1)) * plotH;
  const bar = (x, v) => {
    const h = plotH + padT - y(v);
    if (h <= 0) return '';
    const r = Math.min(4, bw / 2, h);
    const yy = y(v);
    return `M${x},${padT + plotH}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bw - r}Q${x + bw},${yy} ${x + bw},${yy + r}V${padT + plotH}Z`;
  };
  const pick = (e) => {
    const box = ref.current.getBoundingClientRect();
    const i = Math.floor((e.clientX - box.left - padL) / band);
    setHover(i >= 0 && i < data.length ? i : null);
  };
  const hd = hover != null ? data[hover] : null;
  return html`<div class="cols" ref=${ref} onPointerMove=${pick} onPointerLeave=${() => setHover(null)}>
    ${w > 0 && html`<svg width=${w} height=${height} role="img" aria-label="Column chart">
      ${[0, 1, 2, 3].map((k) => html`<g key=${k}><line x1=${padL} x2=${w} y1=${y(step * k)} y2=${y(step * k)} class="grid" />
        <text x=${padL - 6} y=${y(step * k) + 4} class="tick" text-anchor="end">${compact(step * k)}</text></g>`)}
      ${data.map((d, i) => {
        const x = padL + i * band + (band - bw) / 2;
        return html`<g key=${d.key}>
          <rect x=${padL + i * band} y=${padT} width=${band} height=${plotH} fill="transparent" tabindex="0" aria-label=${`${d.full}: ${money(d.value)}, ${d.sub}`}
            onFocus=${() => setHover(i)} onBlur=${() => setHover(null)} />
          <path d=${bar(x, d.value)} class=${'col' + (hover === i ? ' on' : hover != null ? ' dim' : '')} />
          ${i % every === 0 && html`<text x=${x + bw / 2} y=${height - 6} class="tick" text-anchor="middle">${d.label}</text>`}
        </g>`;
      })}
    </svg>`}
    ${hd && html`<div class="col-tip" style=${{ left: Math.min(Math.max(padL + hover * band + band / 2, 70), w - 70) + 'px', top: Math.max(0, y(hd.value) - 52) + 'px' }}>
      <b>${money(hd.value)}</b><span>${hd.full} · ${hd.sub}</span></div>`}
  </div>`;
}
function niceStep(v) {
  if (v <= 0) return 1000;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= v);
}
