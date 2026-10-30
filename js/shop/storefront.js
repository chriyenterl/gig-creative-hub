// Webstore — what customers see (shop/index.html). Browse the menu, choose pickup or delivery and a time,
// add to the cart, check out, then follow the order on its own page. No login: orders go to the team's
// Webstore page in the Creative Hub. Prices shown here are worked out again by the server.
import { html, render, useState, useEffect, useRef, useMemo } from '../lib.js';
import { loadBackend, DEMO } from '../api.js';
import { CONFIG } from '../../config.js';
import { Icon } from '../ui.js';
import { uid, copyText } from '../util.js';
import {
  withDefaults, priceItem, cartTotals, groupRule, money, plusMoney, optionText, orderDays, fmtTime, fmtDay, fmtWhenLong,
  toMin, fromMin, openState, storeNow, weekday, DAYS, CUSTOMER_STEPS, PAYMENT_STATUS, paymentLabel, customerMessage, waTo,
} from './model.js';

const api = await loadBackend({ portal: true });
const shop = api.shop;
const CC = CONFIG.WHATSAPP_COUNTRY_CODE || '60';

// ── Remembered in this browser: the cart, pickup / delivery choice, contact details, recent orders ──
const K = { cart: `webstore-${api.mode}-cart`, mode: `webstore-${api.mode}-mode`, me: `webstore-${api.mode}-me`, orders: `webstore-${api.mode}-orders` };
const saved = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ── Tiny hash router: #/ (menu), #/p/<product>, #/checkout, #/order/<id>.<secret> ──
const parseRoute = () => {
  const [path, q = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(q)) };
};
function useRoute() {
  const [r, setR] = useState(parseRoute);
  useEffect(() => {
    const on = () => setR(parseRoute());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}
const go = (path) => { location.hash = '#/' + path; };

// ── Toasts ──
let pushToast = null;
const toast = (message, tone = 'ok') => pushToast?.({ id: Math.random(), message, tone });
function Toasts() {
  const [t, setT] = useState(null);
  const timer = useRef();
  pushToast = (x) => { setT(x); clearTimeout(timer.current); timer.current = setTimeout(() => setT(null), x.tone === 'error' ? 6000 : 2200); };
  return html`<div class="sf-toasts" role="status" aria-live="polite">${t && html`<div key=${t.id} class=${'sf-toast ' + t.tone}>${t.message}</div>`}</div>`;
}

// The store's own colour on buttons and highlights (dark text on light colours).
function applyBrand(s) {
  const root = document.documentElement.style;
  root.setProperty('--accent', s.accent);
  const n = parseInt(s.accent.slice(1).replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3'), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  root.setProperty('--on-accent', lum > 0.62 ? '#2b1d14' : '#ffffff');
  document.title = `${s.name} · Order online`;
}

// Cookie / gift-box drawing for products without a photo yet.
const PALETTES = [
  [/double|cocoa|brownie|dark|choc(olate)? fudge/i, ['#efe2d8', '#6b3f26', '#2e1a10', '#8a5636']],
  [/matcha|pandan|pistachio/i, ['#e8f0dc', '#9bb36a', '#f5f0e4', '#b7c98c']],
  [/red velvet|strawberry|raspberry/i, ['#f7e1e1', '#b8323b', '#fbf3ea', '#cf4e55']],
  [/caramel|biscoff|butterscotch|gula/i, ['#f7e9d6', '#c98a3e', '#7a4a1c', '#dba35a']],
];
function ProductArt({ product }) {
  const name = `${product.name} ${product.category || ''}`;
  if (/box|tub|gift|pack|set|hamper/i.test(name)) {
    return html`<svg class="sf-art" viewBox="0 0 200 200" aria-hidden="true">
      <rect width="200" height="200" fill="var(--art-bg)" />
      <ellipse cx="100" cy="164" rx="62" ry="9" fill="#000" opacity=".08" />
      <rect x="44" y="82" width="112" height="80" rx="8" fill="var(--accent)" />
      <rect x="38" y="66" width="124" height="24" rx="6" fill="var(--accent)" />
      <rect x="38" y="66" width="124" height="24" rx="6" fill="#fff" opacity=".14" />
      <rect x="92" y="66" width="16" height="96" fill="#f3d27a" />
      <path d="M100 66c-14-22-38-20-36-6 2 12 24 10 36 6zm0 0c14-22 38-20 36-6-2 12-24 10-36 6z" fill="#f3d27a" stroke="#d9b04f" stroke-width="2" />
    </svg>`;
  }
  const [bg, dough, chip, edge] = (PALETTES.find(([re]) => re.test(name)) || [null, ['#f6e7d3', '#d9a066', '#5b3720', '#c48a4f']])[1];
  return html`<svg class="sf-art" viewBox="0 0 200 200" aria-hidden="true">
    <rect width="200" height="200" fill=${bg} />
    <ellipse cx="104" cy="160" rx="60" ry="9" fill="#000" opacity=".08" />
    <path d="M100 40c27-2 50 14 59 36 10 23 4 50-13 66-17 17-44 22-67 15-24-7-41-28-42-53-1-24 13-48 34-59 9-4 19-5 29-5z" fill=${edge} />
    <path d="M100 46c24-1 44 13 52 32 8 20 3 43-12 57-15 14-38 18-58 12-20-6-35-24-36-45-1-21 11-41 29-50 8-4 16-6 25-6z" fill=${dough} />
    <g fill=${chip}>
      <rect x="70" y="70" width="17" height="13" rx="5" transform="rotate(-18 78 76)" /><rect x="112" y="62" width="15" height="12" rx="5" transform="rotate(12 119 68)" />
      <rect x="128" y="98" width="17" height="14" rx="5" transform="rotate(-8 136 105)" /><rect x="92" y="104" width="16" height="13" rx="5" transform="rotate(22 100 110)" />
      <rect x="64" y="118" width="15" height="12" rx="5" transform="rotate(-25 71 124)" /><rect x="108" y="134" width="14" height="11" rx="5" transform="rotate(8 115 139)" />
      <rect x="56" y="94" width="11" height="9" rx="4" /><rect x="140" y="128" width="10" height="9" rx="4" />
    </g>
    <path d="M70 60c10-7 22-10 34-9" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none" opacity=".25" />
  </svg>`;
}

function ProductImage({ product, urls }) {
  const url = product.image_path && urls[product.image_path];
  return url ? html`<img src=${url} alt="" loading="lazy" />` : html`<${ProductArt} product=${product} />`;
}

// ── Sheet: slides up on phones, a centred panel on computers ──
function Sheet({ onClose, label, children, size = 'md', footer, flush }) {
  const panel = useRef();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    document.body.classList.add('sf-locked');
    panel.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    addEventListener('keydown', onKey);
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('sf-locked'); prev?.focus?.(); };
  }, []);
  return html`<div class="sf-backdrop" onMouseDown=${(e) => e.target === e.currentTarget && closeRef.current()}>
    <div class=${'sf-sheet sf-sheet-' + size} role="dialog" aria-modal="true" aria-label=${label} tabindex="-1" ref=${panel}>
      <button class="sf-close" onClick=${() => closeRef.current()} aria-label="Close"><${Icon} name="x" size=${20} /></button>
      <div class=${'sf-sheet-body' + (flush ? ' flush' : '')}>${children}</div>
      ${footer && html`<div class="sf-sheet-foot">${footer}</div>`}
    </div>
  </div>`;
}

function Stepper({ value, onChange, min = 1, max = 99, small, removeAt }) {
  const dec = value <= min && removeAt;
  return html`<div class=${'sf-stepper' + (small ? ' small' : '')}>
    <button type="button" onClick=${() => onChange(value - 1)} disabled=${value <= min && !removeAt} aria-label=${dec ? 'Remove' : 'Less'}>
      <${Icon} name=${dec ? 'trash' : 'minus'} size=${small ? 14 : 16} /></button>
    <span aria-live="polite">${value}</span>
    <button type="button" onClick=${() => onChange(value + 1)} disabled=${value >= max} aria-label="More"><${Icon} name="plus" size=${small ? 14 : 16} /></button>
  </div>`;
}

// ── Grouping the menu by category (the order set in Store settings, then any others) ──
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'more';
function groupMenu(products, categories) {
  const groups = new Map(categories.map((c) => [c, []]));
  for (const p of products) {
    const c = p.category || 'More';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(p);
  }
  if (groups.has('More')) { const more = groups.get('More'); groups.delete('More'); groups.set('More', more); }
  return [...groups].filter(([, list]) => list.length).map(([name, list]) => ({ name, id: 'cat-' + slug(name), products: list }));
}

// ════════════════════════════════════════════════════════════════════════════
function App() {
  const route = useRoute();
  const [info, setInfo] = useState(undefined); // undefined = loading, { error } = couldn't load
  const [urls, setUrls] = useState({});
  const [cart, setCartRaw] = useState(() => saved.get(K.cart, []));
  const [mode, setModeRaw] = useState(() => saved.get(K.mode, { fulfilment: 'pickup', date: null, time: null }));
  const [sheet, setSheet] = useState(null);
  const [tick, setTick] = useState(0); // re-checks the available times every minute
  const setCart = (fn) => setCartRaw((c) => { const n = typeof fn === 'function' ? fn(c) : fn; saved.set(K.cart, n); return n; });
  const setMode = (patch) => setModeRaw((m) => { const n = { ...m, ...patch }; saved.set(K.mode, n); return n; });

  const load = async () => {
    try {
      const d = await shop.info();
      d.settings = withDefaults(d.settings);
      applyBrand(d.settings);
      const keys = [...d.products.map((p) => p.image_path), d.settings.logo_path, d.settings.cover_path, d.settings.payments.duitnow.qr_path];
      setUrls(await shop.fileUrls(keys.filter(Boolean)).catch(() => ({})));
      setInfo(d);
      return d;
    } catch (e) {
      setInfo({ error: e.code === 'AUTH' ? "This store isn't switched on yet. Please check back soon." : e.message });
    }
  };
  useEffect(() => { load(); const t = setInterval(() => setTick((n) => n + 1), 60e3); return () => clearInterval(t); }, []);

  const s = info?.settings;
  const products = info?.products || [];
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  // Pickup or delivery: only what the store offers.
  const fulfilment = s && !s[mode.fulfilment]?.enabled ? (s.pickup.enabled ? 'pickup' : 'delivery') : mode.fulfilment;
  // Times: keep the customer's choice while it's still offered, otherwise the earliest one.
  const days = useMemo(() => (s ? orderDays(s) : []), [s, tick]);
  const chosenOk = mode.date && mode.time && days.some((d) => d.ymd === mode.date && d.slots.includes(toMin(mode.time)));
  const slot = chosenOk ? { date: mode.date, time: mode.time, picked: true } : days[0] ? { date: days[0].ymd, time: fromMin(days[0].slots[0]), picked: false } : null;

  const lines = cart.map((item) => ({ item, product: byId[item.product_id], ...priceItem(byId[item.product_id], item) }));
  const okLines = lines.filter((l) => l.ok);
  const totals = cartTotals(okLines, s, fulfilment);
  const count = cart.reduce((n, i) => n + i.qty, 0);

  const addToCart = (product, { qty, choices, note }, key) => {
    setCart((c) => {
      if (key) return c.map((x) => (x.key === key ? { ...x, qty, choices, note } : x));
      const same = c.find((x) => x.product_id === product.id && JSON.stringify(x.choices) === JSON.stringify(choices) && (x.note || '') === (note || ''));
      if (same) return c.map((x) => (x === same ? { ...x, qty: Math.min(99, x.qty + qty) } : x));
      return [...c, { key: uid(), product_id: product.id, qty, choices, note }];
    });
    toast(key ? 'Cart updated' : `Added ${qty > 1 ? qty + '× ' : ''}${product.name}`);
  };
  const setQty = (key, qty) => setCart((c) => (qty < 1 ? c.filter((x) => x.key !== key) : c.map((x) => (x.key === key ? { ...x, qty: Math.min(99, qty) } : x))));
  const openProduct = (product, line) => setSheet({ type: 'product', product, line });

  // A shared product link (#/p/<id>) opens that product over the menu.
  useEffect(() => {
    if (route.parts[0] === 'p' && info?.products) {
      const p = byId[route.parts[1]];
      history.replaceState(null, '', location.pathname + location.search + '#/');
      if (p) openProduct(p);
    }
  }, [route.parts.join('/'), !!info?.products]);
  useEffect(() => { window.scrollTo(0, 0); }, [route.parts[0]]);

  if (info === undefined) return html`<div class="sf-boot"><div class="sf-spinner"></div></div>`;
  if (info.error) {
    return html`<div class="sf-state"><span class="sf-state-icon"><${Icon} name="store" size=${28} /></span>
      <h1>We couldn't open the store</h1><p>${info.error}</p>
      <button class="sf-btn sf-btn-primary" onClick=${() => { setInfo(undefined); load(); }}>Try again</button></div>`;
  }

  const ctx = { s, products, urls, cart, lines, okLines, totals, count, fulfilment, slot, days, setMode, addToCart, setQty, openProduct, setSheet, setCart, reload: load };
  const page = route.parts[0] === 'checkout' ? html`<${Checkout} ...${ctx} />`
    : route.parts[0] === 'order' ? html`<${OrderPage} key=${route.parts[1]} ref_=${route.parts[1]} justPlaced=${route.query.new === '1'} s=${s} urls=${urls} />`
    : html`<${Menu} ...${ctx} />`;

  return html`
    ${DEMO && html`<div class="sf-demo"><${Icon} name="info" size=${14} /> Demo store — orders are saved only in this browser.</div>`}
    <${Header} s=${s} urls=${urls} count=${count} onCart=${() => setSheet({ type: 'cart' })} onOrders=${() => setSheet({ type: 'orders' })} checkout=${route.parts[0] === 'checkout'} />
    ${page}
    ${sheet?.type === 'product' && html`<${ProductSheet} product=${sheet.product} line=${sheet.line} urls=${urls} s=${s}
        onAdd=${(sel) => { addToCart(sheet.product, sel, sheet.line?.key); setSheet(null); }} onClose=${() => setSheet(null)} />`}
    ${sheet?.type === 'cart' && html`<${Sheet} label="Your cart" onClose=${() => setSheet(null)} size="sm">
        <${CartPanel} ...${ctx} onClose=${() => setSheet(null)} onCheckout=${() => { setSheet(null); go('checkout'); }} onEdit=${(l) => setSheet({ type: 'product', product: l.product, line: l.item })} /><//>`}
    ${sheet?.type === 'time' && html`<${TimeSheet} s=${s} days=${days} slot=${slot} fulfilment=${fulfilment}
        onPick=${(date, time) => { setMode({ date, time }); setSheet(null); }} onClose=${() => setSheet(null)} />`}
    ${sheet?.type === 'info' && html`<${InfoSheet} s=${s} onClose=${() => setSheet(null)} />`}
    ${sheet?.type === 'orders' && html`<${MyOrdersSheet} onClose=${() => setSheet(null)} />`}
    <${Toasts} />`;
}

// ── Header ──
function Logo({ s, urls, size = 40 }) {
  const url = s.logo_path && urls[s.logo_path];
  return html`<span class="sf-logo" style=${{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.46) + 'px' }}>
    ${url ? html`<img src=${url} alt="" />` : (s.name || '?').trim().slice(0, 1).toUpperCase()}</span>`;
}

function Header({ s, urls, count, onCart, onOrders, checkout }) {
  const hasOrders = saved.get(K.orders, []).length > 0;
  return html`<header class="sf-header">
    <div class="sf-header-in">
      <a class="sf-brand" href="#/"><${Logo} s=${s} urls=${urls} size=${36} /><span>${s.name}</span></a>
      <div class="sf-header-actions">
        ${hasOrders && html`<button class="sf-btn sf-btn-ghost sf-hide-xs" onClick=${onOrders}><${Icon} name="list" size=${16} />My orders</button>`}
        ${hasOrders && html`<button class="sf-icon-btn sf-show-xs" onClick=${onOrders} aria-label="My orders"><${Icon} name="list" /></button>`}
        ${!checkout && html`<button class="sf-cart-btn" onClick=${onCart} aria-label=${`Cart, ${count} item${count === 1 ? '' : 's'}`}>
          <${Icon} name="bag" size=${20} />${count > 0 && html`<span class="sf-count">${count}</span>`}</button>`}
      </div>
    </div>
  </header>`;
}

// ── Menu page ──
function Menu(ctx) {
  const { s, products, urls, cart, count, totals, fulfilment, slot, setMode, setSheet, openProduct, addToCart } = ctx;
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(null);
  const groups = useMemo(() => groupMenu(products, s.categories), [products, s.categories]);
  const q = query.trim().toLowerCase();
  const found = q ? products.filter((p) => `${p.name} ${p.description || ''} ${p.category || ''}`.toLowerCase().includes(q)) : null;
  const inCart = useMemo(() => cart.reduce((m, i) => ({ ...m, [i.product_id]: (m[i.product_id] || 0) + i.qty }), {}), [cart]);
  const st = openState(s);
  const cover = s.cover_path && urls[s.cover_path];
  const catBar = useRef();
  const lock = useRef(0);

  // Highlight the category being looked at (a tapped chip stays highlighted while the page scrolls to it).
  useEffect(() => {
    if (q) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (Date.now() < lock.current) return;
        let cur = null;
        for (const g of groups) { const el = document.getElementById(g.id); if (el && el.getBoundingClientRect().top <= 150) cur = g.id; }
        if (cur && innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = groups[groups.length - 1].id;
        setActive(cur);
      });
    };
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    return () => { removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [groups, q]);
  useEffect(() => { catBar.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [active]);

  const quickAdd = (p) => ((p.options || []).some((g) => g.min > 0) ? openProduct(p) : addToCart(p, { qty: 1, choices: {}, note: '' }));
  const card = (p) => html`<${ProductCard} key=${p.id} p=${p} urls=${urls} qty=${inCart[p.id] || 0} onOpen=${() => openProduct(p)} onAdd=${() => quickAdd(p)} />`;

  return html`<div class="sf-wrap">
    <section class="sf-hero" style=${cover ? { backgroundImage: `url("${cover}")` } : null}></section>
    <section class="sf-store sf-card">
      <${Logo} s=${s} urls=${urls} size=${76} />
      <div class="sf-store-main">
        <h1>${s.name}</h1>
        ${s.tagline && html`<p class="sf-tagline">${s.tagline}</p>`}
        <div class="sf-store-meta">
          <span class=${'sf-open ' + (st.open ? 'yes' : 'no')}><span class="dot"></span>${st.label}</span>
          ${s.address && html`<span class="sf-meta-item"><${Icon} name="pin" size=${14} />${s.address}</span>`}
        </div>
      </div>
      <div class="sf-store-actions">
        ${waTo(s.phone, '', CC) && html`<a class="sf-icon-btn" href=${waTo(s.phone, `Hi ${s.name}! `, CC)} target="_blank" rel="noopener" aria-label="WhatsApp us"><${Icon} name="whatsapp" /></a>`}
        ${s.instagram && html`<a class="sf-icon-btn" href=${'https://instagram.com/' + s.instagram} target="_blank" rel="noopener" aria-label="Instagram"><${Icon} name="instagram" /></a>`}
        <button class="sf-icon-btn" onClick=${() => setSheet({ type: 'info' })} aria-label="Store info and opening hours"><${Icon} name="info" /></button>
      </div>
    </section>

    ${!s.open && html`<div class="sf-notice warn"><${Icon} name="clock" size=${18} /><div><b>We're not taking orders right now.</b> ${s.closedMessage}</div></div>`}

    <div class="sf-layout">
      <div class="sf-main">
        <${ModeCard} s=${s} fulfilment=${fulfilment} slot=${slot} setMode=${setMode} onTime=${() => setSheet({ type: 'time' })} />

        <nav class="sf-cats" aria-label="Menu categories">
          ${searching ? html`<div class="sf-search">
              <${Icon} name="search" size=${18} />
              <input type="search" placeholder="Search the menu" value=${query} autofocus onInput=${(e) => setQuery(e.target.value)} aria-label="Search the menu" />
              <button class="sf-icon-btn small" onClick=${() => { setQuery(''); setSearching(false); }} aria-label="Close search"><${Icon} name="x" size=${16} /></button>
            </div>`
          : html`<button class="sf-icon-btn small" onClick=${() => setSearching(true)} aria-label="Search the menu"><${Icon} name="search" size=${18} /></button>
            <div class="sf-chips" ref=${catBar}>
              ${groups.map((g) => html`<a key=${g.id} href=${'#' + g.id} class=${'sf-chip' + (active === g.id ? ' on' : '')}
                onClick=${(e) => { e.preventDefault(); lock.current = Date.now() + 1200; setActive(g.id); document.getElementById(g.id)?.scrollIntoView({ behavior: 'smooth' }); }}>${g.name}</a>`)}
            </div>`}
        </nav>

        ${found ? html`<section class="sf-section">
            <h2 class="sf-section-title">${found.length} result${found.length === 1 ? '' : 's'} for “${query.trim()}”</h2>
            ${found.length ? html`<div class="sf-grid">${found.map(card)}</div>` : html`<p class="sf-muted">Nothing matches — try another word.</p>`}
          </section>`
        : groups.length ? groups.map((g) => html`<section key=${g.id} class="sf-section" id=${g.id}>
            <h2 class="sf-section-title">${g.name}</h2>
            <div class="sf-grid">${g.products.map(card)}</div>
          </section>`)
        : html`<div class="sf-empty"><${Icon} name="bag" size=${30} /><h2>Our menu is coming soon</h2><p>Check back shortly — we're getting things ready.</p></div>`}
      </div>
      <aside class="sf-side">
        <div class="sf-card sf-side-card"><${CartPanel} ...${ctx} onCheckout=${() => go('checkout')} onEdit=${(l) => openProduct(l.product, l.item)} /></div>
      </aside>
    </div>

    ${count > 0 && html`<div class="sf-cartbar">
      <button class="sf-btn sf-btn-primary sf-btn-lg" onClick=${() => setSheet({ type: 'cart' })}>
        <span class="sf-cartbar-count">${count}</span><span>View cart</span><b>${money(totals.subtotal)}</b>
      </button>
    </div>`}
    <${Footer} s=${s} />
  </div>`;
}

function ProductCard({ p, urls, qty, onOpen, onAdd }) {
  return html`<article class=${'sf-product' + (p.is_available ? '' : ' soldout')}>
    <button class="sf-product-img" onClick=${onOpen} aria-label=${p.name}>
      <${ProductImage} product=${p} urls=${urls} />
      ${p.badge && p.is_available && html`<span class="sf-badge">${p.badge}</span>`}
      ${!p.is_available && html`<span class="sf-soldout">Sold out</span>`}
      ${qty > 0 && html`<span class="sf-incart">${qty} in cart</span>`}
    </button>
    <div class="sf-product-body">
      <button class="sf-product-name" onClick=${onOpen}>${p.name}</button>
      ${p.description && html`<p class="sf-product-desc">${p.description}</p>`}
      <div class="sf-product-foot">
        <span class="sf-price">${p.options?.some((g) => g.min > 0 && g.choices.some((c) => c.price > 0)) ? html`<small>from </small>` : ''}${money(p.price)}
          ${p.compare_price > p.price && html`<s>${money(p.compare_price)}</s>`}</span>
        ${p.is_available && html`<button class="sf-add" onClick=${onAdd} aria-label=${'Add ' + p.name}><${Icon} name="plus" size=${18} /></button>`}
      </div>
    </div>
  </article>`;
}

// Pickup or delivery, and when.
function ModeCard({ s, fulfilment, slot, setMode, onTime }) {
  const both = s.pickup.enabled && s.delivery.enabled;
  return html`<section class="sf-card sf-mode">
    ${both && html`<div class="sf-seg" role="radiogroup" aria-label="Pickup or delivery">
      ${['pickup', 'delivery'].map((f) => html`<button key=${f} role="radio" aria-checked=${fulfilment === f} class=${fulfilment === f ? 'on' : ''}
        onClick=${() => setMode({ fulfilment: f })}><${Icon} name=${f === 'pickup' ? 'store' : 'truck'} size=${16} />${f === 'pickup' ? 'Self pickup' : 'Delivery'}</button>`)}
    </div>`}
    <button class="sf-when" onClick=${onTime} disabled=${!slot}>
      <span class="sf-when-icon"><${Icon} name=${!both ? (fulfilment === 'pickup' ? 'store' : 'truck') : 'clock'} size=${18} /></span>
      <span class="sf-when-text">
        <small>${fulfilment === 'pickup' ? 'Pickup time' : 'Delivery time'}${!both ? ` · ${fulfilment === 'pickup' ? 'self pickup only' : 'delivery only'}` : ''}</small>
        <b>${slot ? `${fmtDay(slot.date)}, ${fmtTime(toMin(slot.time))}` : 'No times available right now'}</b>
      </span>
      ${slot && html`<span class="sf-link">Change</span>`}
    </button>
    ${fulfilment === 'delivery' && (s.delivery.note || s.delivery.fee > 0 || s.delivery.minOrder > 0) && html`<p class="sf-mode-note">
      ${[s.delivery.note, s.delivery.fee > 0 ? `Delivery fee ${money(s.delivery.fee)}${s.delivery.freeOver > 0 ? ` · free over ${money(s.delivery.freeOver)}` : ''}` : 'Free delivery',
        s.delivery.minOrder > 0 ? `Minimum order ${money(s.delivery.minOrder)}` : ''].filter(Boolean).join(' · ')}</p>`}
    ${fulfilment === 'pickup' && (s.pickup.address || s.pickup.note) && html`<p class="sf-mode-note"><${Icon} name="pin" size=${13} /> ${[s.pickup.address, s.pickup.note].filter(Boolean).join(' · ')}</p>`}
  </section>`;
}

function TimeSheet({ days, slot, fulfilment, onPick, onClose }) {
  const [day, setDay] = useState(slot?.date || days[0]?.ymd);
  const d = days.find((x) => x.ymd === day) || days[0];
  return html`<${Sheet} label="Choose a time" onClose=${onClose} size="sm">
    <h2 class="sf-sheet-title">${fulfilment === 'pickup' ? 'When will you pick up?' : 'When should we deliver?'}</h2>
    ${!days.length ? html`<p class="sf-muted">There are no times available in the next few days. Please check back soon.</p>` : html`
      <div class="sf-days">${days.map((x) => html`<button key=${x.ymd} class=${'sf-day' + (x.ymd === d.ymd ? ' on' : '')} onClick=${() => setDay(x.ymd)}>
        <b>${fmtDay(x.ymd)}</b><small>${new Date(x.ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })}</small></button>`)}</div>
      <div class="sf-slots">${d.slots.map((m) => {
        const on = slot?.picked && slot.date === d.ymd && toMin(slot.time) === m;
        return html`<button key=${m} class=${'sf-slot' + (on ? ' on' : '')} onClick=${() => onPick(d.ymd, fromMin(m))}>${fmtTime(m)}</button>`;
      })}</div>`}
  <//>`;
}

function InfoSheet({ s, onClose }) {
  const today = weekday(storeNow().ymd);
  return html`<${Sheet} label="Store info" onClose=${onClose} size="sm">
    <h2 class="sf-sheet-title">${s.name}</h2>
    ${s.about && html`<p class="sf-about">${s.about}</p>`}
    <h3 class="sf-sub">Opening hours</h3>
    <table class="sf-hours"><tbody>${DAYS.map((d, i) => html`<tr key=${d} class=${i === today ? 'today' : ''}>
      <th>${d}${i === today ? html` <small>today</small>` : ''}</th>
      <td>${s.hours[i].closed ? 'Closed' : `${fmtTime(toMin(s.hours[i].open))} – ${fmtTime(toMin(s.hours[i].close))}`}</td></tr>`)}</tbody></table>
    ${(s.address || s.pickup.address) && html`<h3 class="sf-sub">Find us</h3>
      <p><a class="sf-link" href=${'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s.pickup.address || s.address)} target="_blank" rel="noopener">
        <${Icon} name="pin" size=${14} /> ${s.pickup.address || s.address}</a></p>`}
    <div class="sf-contact">
      ${waTo(s.phone, '', CC) && html`<a class="sf-btn" href=${waTo(s.phone, `Hi ${s.name}! `, CC)} target="_blank" rel="noopener"><${Icon} name="whatsapp" size=${16} />WhatsApp</a>`}
      ${s.phone && html`<a class="sf-btn" href=${'tel:' + s.phone.replace(/[^\d+]/g, '')}><${Icon} name="phone" size=${16} />Call</a>`}
      ${s.instagram && html`<a class="sf-btn" href=${'https://instagram.com/' + s.instagram} target="_blank" rel="noopener"><${Icon} name="instagram" size=${16} />@${s.instagram}</a>`}
    </div>
  <//>`;
}

function MyOrdersSheet({ onClose }) {
  const list = saved.get(K.orders, []);
  return html`<${Sheet} label="My orders" onClose=${onClose} size="sm">
    <h2 class="sf-sheet-title">My orders</h2>
    <p class="sf-muted small">Orders placed on this device.</p>
    <ul class="sf-myorders">${list.map((o) => html`<li key=${o.ref}><a href=${'#/order/' + o.ref} onClick=${onClose}>
      <span><b>${o.order_no}</b><small>${new Date(o.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</small></span>
      <span>${money(o.total)}<${Icon} name="chevron" size=${16} /></span></a></li>`)}</ul>
  <//>`;
}

function Footer({ s }) {
  return html`<footer class="sf-footer">
    <span>© ${new Date().getFullYear()} ${s.name}</span>
    ${s.instagram && html`<a href=${'https://instagram.com/' + s.instagram} target="_blank" rel="noopener">@${s.instagram}</a>`}
  </footer>`;
}

// ── Product details: options, quantity, note ──
function ProductSheet({ product: p, line, urls, s, onAdd, onClose }) {
  const [choices, setChoices] = useState(() => {
    if (line) return line.choices || {};
    // Required single choices start on the first one that's free, so most people can just tap Add.
    return Object.fromEntries((p.options || []).filter((g) => g.min > 0 && g.max === 1).map((g) => [g.id, [(g.choices.find((c) => !(c.price > 0)) || g.choices[0]).id]]));
  });
  const [qty, setQty] = useState(line?.qty || 1);
  const [note, setNote] = useState(line?.note || '');
  const [missing, setMissing] = useState(null);
  const r = priceItem({ ...p, is_available: true }, { qty, choices });
  const unit = (p.options || []).reduce((n, g) => n + g.choices.filter((c) => (choices[g.id] || []).includes(c.id)).reduce((m, c) => m + Number(c.price || 0), 0), Number(p.price));

  const toggle = (g, c) => {
    setMissing(null);
    setChoices((cur) => {
      const list = cur[g.id] || [];
      if (g.max === 1) return { ...cur, [g.id]: list[0] === c.id && g.min === 0 ? [] : [c.id] };
      if (list.includes(c.id)) return { ...cur, [g.id]: list.filter((x) => x !== c.id) };
      if (list.length >= g.max) { toast(`You can choose up to ${g.max}.`, 'error'); return cur; }
      return { ...cur, [g.id]: [...list, c.id] };
    });
  };
  const add = () => {
    if (!r.ok) {
      setMissing(r.group || null);
      document.getElementById('grp-' + r.group)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return toast(r.error, 'error');
    }
    onAdd({ qty, choices, note: note.trim() });
  };
  const share = async () => {
    const url = location.href.split('#')[0] + '#/p/' + p.id;
    if (navigator.share) { try { await navigator.share({ title: `${p.name} · ${s.name}`, url }); return; } catch { return; } }
    if (await copyText(url)) toast('Link copied');
  };

  return html`<${Sheet} label=${p.name} onClose=${onClose} size="product" flush footer=${p.is_available ? html`
      <${Stepper} value=${qty} onChange=${setQty} />
      <button class="sf-btn sf-btn-primary sf-btn-lg sf-grow" onClick=${add}>${line ? 'Update cart' : 'Add to cart'} · ${money(unit * qty)}</button>`
    : html`<button class="sf-btn sf-btn-lg sf-grow" disabled>Sold out</button>`}>
    <div class="sf-pd">
      <div class="sf-pd-img"><${ProductImage} product=${p} urls=${urls} />${p.badge && html`<span class="sf-badge">${p.badge}</span>`}</div>
      <div class="sf-pd-info">
        <div class="sf-pd-head">
          <h2>${p.name}</h2>
          <button class="sf-icon-btn small" onClick=${share} aria-label="Share"><${Icon} name="share" size=${16} /></button>
        </div>
        <p class="sf-pd-price">${money(p.price)}${p.compare_price > p.price && html` <s>${money(p.compare_price)}</s>`}</p>
        ${p.description && html`<p class="sf-pd-desc">${p.description}</p>`}
        ${(p.options || []).map((g) => html`<fieldset key=${g.id} id=${'grp-' + g.id} class=${'sf-group' + (missing === g.id ? ' missing' : '')}>
          <legend><span>${g.name}</span><span class=${'sf-rule' + (g.min > 0 ? ' req' : '')}>${groupRule(g)}</span></legend>
          ${g.choices.map((c) => {
            const on = (choices[g.id] || []).includes(c.id);
            return html`<label key=${c.id} class=${'sf-choice' + (on ? ' on' : '')}>
              <input type=${g.max === 1 ? 'radio' : 'checkbox'} name=${'g-' + g.id} checked=${on} onClick=${(e) => { e.preventDefault(); toggle(g, c); }} />
              <span class=${'sf-tick ' + (g.max === 1 ? 'radio' : 'box')}>${on && g.max > 1 && html`<${Icon} name="check" size=${12} />`}</span>
              <span class="sf-choice-name">${c.name}</span><span class="sf-choice-price">${plusMoney(c.price)}</span>
            </label>`;
          })}
        </fieldset>`)}
        ${p.is_available && html`<label class="sf-field">
          <span class="sf-label">Special instructions <small>(optional)</small></span>
          <textarea rows="2" maxlength="300" placeholder="e.g. Please write “Happy Birthday Mia” on the card" value=${note} onInput=${(e) => setNote(e.target.value)}></textarea>
        </label>`}
      </div>
    </div>
  <//>`;
}

// ── Cart (sidebar on computers, a sheet on phones) ──
function CartPanel({ s, lines, totals, count, fulfilment, setQty, setCart, onCheckout, onEdit, onClose }) {
  const bad = lines.filter((l) => !l.ok);
  const short = totals.short > 0;
  return html`<div class="sf-cart">
    <div class="sf-cart-head"><h2>Your cart</h2>${count > 0 && html`<span class="sf-muted small">${count} item${count === 1 ? '' : 's'}</span>`}</div>
    ${!lines.length ? html`<div class="sf-cart-empty"><${Icon} name="bag" size=${28} /><p>Your cart is empty.<br />Add something delicious!</p></div>` : html`
      <ul class="sf-lines">${lines.map((l) => html`<li key=${l.item.key} class=${l.ok ? '' : 'bad'}>
        <div class="sf-line-main">
          <button class="sf-line-name" onClick=${() => l.product && l.ok && onEdit(l)} disabled=${!l.ok}>${l.product?.name || 'Item no longer available'}</button>
          ${l.ok && l.options.length > 0 && html`<small>${optionText(l.options)}</small>`}
          ${l.item.note && html`<small class="sf-line-note">“${l.item.note}”</small>`}
          ${!l.ok && html`<small class="sf-error">${l.error}</small>`}
        </div>
        <div class="sf-line-side">
          ${l.ok ? html`<b>${money(l.total)}</b>` : html`<button class="sf-link" onClick=${() => setCart((c) => c.filter((x) => x.key !== l.item.key))}>Remove</button>`}
          ${l.ok && html`<${Stepper} small value=${l.item.qty} onChange=${(n) => setQty(l.item.key, n)} removeAt=${1} />`}
        </div>
      </li>`)}</ul>
      <dl class="sf-totals">
        <div><dt>Subtotal</dt><dd>${money(totals.subtotal)}</dd></div>
        ${fulfilment === 'delivery' && html`<div><dt>Delivery</dt><dd>${totals.delivery_fee > 0 ? money(totals.delivery_fee) : 'Free'}</dd></div>`}
        <div class="total"><dt>Total</dt><dd>${money(totals.total)}</dd></div>
      </dl>
      ${short && html`<p class="sf-notice small warn">Add ${money(totals.short)} more for delivery (minimum ${money(s.delivery.minOrder)}).</p>`}
      ${fulfilment === 'delivery' && s.delivery.freeOver > 0 && totals.delivery_fee > 0 && html`<p class="sf-muted small center">Spend ${money(s.delivery.freeOver - totals.subtotal)} more for free delivery.</p>`}
      <button class="sf-btn sf-btn-primary sf-btn-lg sf-btn-block" onClick=${onCheckout} disabled=${!s.open || bad.length > 0 || short || !count}>
        ${s.open ? 'Checkout' : 'Ordering is paused'}</button>`}
    ${onClose && lines.length > 0 && html`<button class="sf-btn sf-btn-ghost sf-btn-block" onClick=${onClose}>Keep shopping</button>`}
  </div>`;
}

// ── Checkout ──
function Checkout(ctx) {
  const { s, lines, okLines, totals, count, fulfilment, slot, setMode, setSheet, setCart, reload } = ctx;
  const me = saved.get(K.me, {});
  const [f, setF] = useState({ name: me.name || '', phone: me.phone || '', email: me.email || '', address: me.address || '', notes: '' });
  const methods = ['duitnow', 'bank', 'cash'].filter((m) => s.payments[m].enabled);
  const [method, setMethod] = useState(methods[0]);
  const [receipt, setReceipt] = useState(null); // File
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: null })); };
  useEffect(() => { if (!methods.includes(method)) setMethod(methods[0]); }, [methods.join()]);

  if (!count) {
    return html`<div class="sf-wrap sf-narrow"><div class="sf-state"><span class="sf-state-icon"><${Icon} name="bag" size=${28} /></span>
      <h1>Your cart is empty</h1><p>Add a few treats first, then come back to check out.</p>
      <a class="sf-btn sf-btn-primary" href="#/">Browse the menu</a></div></div>`;
  }

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!f.name.trim()) errs.name = 'Please enter your name.';
    if (f.phone.replace(/\D/g, '').length < 8) errs.phone = 'Please enter your phone number.';
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) errs.email = "That email doesn't look right.";
    if (fulfilment === 'delivery' && f.address.trim().length < 8) errs.address = 'Please enter your full delivery address.';
    if (!slot) errs.slot = 'There are no times available right now.';
    if (s.receiptRequired && method !== 'cash' && !receipt) errs.receipt = 'Please attach your payment receipt.';
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) { document.getElementById('co-' + first)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    setBusy(true);
    try {
      let receiptKey = null;
      if (receipt && method !== 'cash') {
        setProgress(0);
        receiptKey = await shop.uploadReceipt(receipt, { onProgress: setProgress });
      }
      const o = await shop.placeOrder({
        fulfilment, slot_date: slot.date, slot_time: slot.time, customer_name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(),
        address: fulfilment === 'delivery' ? f.address.trim() : '', notes: f.notes.trim(), payment_method: method, receipt: receiptKey,
        items: okLines.map((l) => ({ product_id: l.item.product_id, qty: l.item.qty, choices: l.item.choices, note: l.item.note || '' })),
        expectedTotal: totals.total,
      });
      saved.set(K.me, { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), address: f.address.trim() });
      saved.set(K.orders, [{ ref: `${o.id}.${o.secret}`, order_no: o.order_no, total: o.total, at: o.created_at }, ...saved.get(K.orders, [])].slice(0, 20));
      sessionStorage.setItem('webstore-just-placed', JSON.stringify(o));
      setCart([]);
      setMode({ date: null, time: null });
      location.replace(`#/order/${o.id}.${o.secret}?new=1`);
    } catch (err) {
      if (['PRICE_CHANGED', 'CART', 'SLOT', 'SHOP_CLOSED', 'MIN'].includes(err.code)) await reload();
      if (err.code === 'SLOT') setSheet({ type: 'time' });
      setErrors((x) => ({ ...x, form: err.message }));
      toast(err.message, 'error');
    }
    setBusy(false);
    setProgress(null);
  };

  const both = s.pickup.enabled && s.delivery.enabled;
  return html`<form class="sf-wrap sf-narrow sf-checkout" onSubmit=${submit} novalidate>
    <a class="sf-back" href="#/"><${Icon} name="back" size=${16} />Back to menu</a>
    <h1 class="sf-page-title">Checkout</h1>

    <section class="sf-card sf-co" id="co-slot">
      <h2><span class="sf-num">1</span>${both ? 'Pickup or delivery' : fulfilment === 'pickup' ? 'Self pickup' : 'Delivery'}</h2>
      ${both && html`<div class="sf-seg">${['pickup', 'delivery'].map((x) => html`<button type="button" key=${x} class=${fulfilment === x ? 'on' : ''} aria-pressed=${fulfilment === x}
        onClick=${() => setMode({ fulfilment: x })}><${Icon} name=${x === 'pickup' ? 'store' : 'truck'} size=${16} />${x === 'pickup' ? 'Self pickup' : 'Delivery'}</button>`)}</div>`}
      <button type="button" class="sf-when" onClick=${() => setSheet({ type: 'time' })} disabled=${!slot}>
        <span class="sf-when-icon"><${Icon} name="clock" size=${18} /></span>
        <span class="sf-when-text"><small>${fulfilment === 'pickup' ? 'Pickup time' : 'Delivery time'}</small>
          <b>${slot ? fmtWhenLong({ slot_date: slot.date, slot_time: slot.time }) : 'No times available right now'}</b></span>
        ${slot && html`<span class="sf-link">Change</span>`}
      </button>
      ${errors.slot && html`<p class="sf-error">${errors.slot}</p>`}
      ${fulfilment === 'pickup' && s.pickup.address && html`<p class="sf-mode-note"><${Icon} name="pin" size=${13} /> Pick up at: ${s.pickup.address}</p>`}
      ${fulfilment === 'delivery' && s.delivery.note && html`<p class="sf-mode-note"><${Icon} name="truck" size=${13} /> ${s.delivery.note}</p>`}
    </section>

    <section class="sf-card sf-co">
      <h2><span class="sf-num">2</span>Your details</h2>
      <div class="sf-fields">
        <label class=${'sf-field' + (errors.name ? ' has-error' : '')} id="co-name"><span class="sf-label">Name</span>
          <input autocomplete="name" value=${f.name} onInput=${set('name')} />${errors.name && html`<span class="sf-error">${errors.name}</span>`}</label>
        <label class=${'sf-field' + (errors.phone ? ' has-error' : '')} id="co-phone"><span class="sf-label">Phone (WhatsApp)</span>
          <input type="tel" inputmode="tel" autocomplete="tel" placeholder="012-345 6789" value=${f.phone} onInput=${set('phone')} />
          ${errors.phone ? html`<span class="sf-error">${errors.phone}</span>` : html`<span class="sf-hint">We'll message you about your order here.</span>`}</label>
        <label class=${'sf-field sf-span' + (errors.email ? ' has-error' : '')} id="co-email"><span class="sf-label">Email <small>(optional)</small></span>
          <input type="email" autocomplete="email" value=${f.email} onInput=${set('email')} />${errors.email && html`<span class="sf-error">${errors.email}</span>`}</label>
        ${fulfilment === 'delivery' && html`<label class=${'sf-field sf-span' + (errors.address ? ' has-error' : '')} id="co-address"><span class="sf-label">Delivery address</span>
          <textarea rows="3" autocomplete="street-address" placeholder="Unit / house number, street, area, postcode" value=${f.address} onInput=${set('address')}></textarea>
          ${errors.address && html`<span class="sf-error">${errors.address}</span>`}</label>`}
      </div>
    </section>

    <section class="sf-card sf-co" id="co-receipt">
      <h2><span class="sf-num">3</span>Payment</h2>
      <div class="sf-pay-options" role="radiogroup" aria-label="Payment method">
        ${methods.map((m) => html`<label key=${m} class=${'sf-pay' + (method === m ? ' on' : '')}>
          <input type="radio" name="pay" checked=${method === m} onChange=${() => setMethod(m)} />
          <span class="sf-tick radio"></span><span>${paymentLabel(m, fulfilment)}</span>
        </label>`)}
      </div>
      <${PayDetails} s=${s} method=${method} total=${totals.total} fulfilment=${fulfilment} urls=${ctx.urls} />
      ${method !== 'cash' && html`<${ReceiptPicker} file=${receipt} onFile=${(x) => { setReceipt(x); setErrors((e) => ({ ...e, receipt: null })); }}
        required=${s.receiptRequired} error=${errors.receipt} progress=${progress} disabled=${busy} />`}
    </section>

    <section class="sf-card sf-co">
      <h2><span class="sf-num">4</span>Review your order</h2>
      <ul class="sf-review">${lines.filter((l) => l.ok).map((l) => html`<li key=${l.item.key}>
        <span class="sf-review-qty">${l.item.qty}×</span>
        <span class="sf-review-name">${l.product.name}${l.options.length > 0 && html`<small>${optionText(l.options)}</small>`}${l.item.note && html`<small>“${l.item.note}”</small>`}</span>
        <span>${money(l.total)}</span></li>`)}</ul>
      <a class="sf-link small" href="#/">Edit cart</a>
      <label class="sf-field"><span class="sf-label">Note for the store <small>(optional)</small></span>
        <textarea rows="2" maxlength="1000" placeholder=${fulfilment === 'delivery' ? 'e.g. Please call when you arrive at the lobby' : 'e.g. My sister will collect it'} value=${f.notes} onInput=${set('notes')}></textarea></label>
      <dl class="sf-totals">
        <div><dt>Subtotal</dt><dd>${money(totals.subtotal)}</dd></div>
        ${fulfilment === 'delivery' && html`<div><dt>Delivery</dt><dd>${totals.delivery_fee > 0 ? money(totals.delivery_fee) : 'Free'}</dd></div>`}
        <div class="total"><dt>Total</dt><dd>${money(totals.total)}</dd></div>
      </dl>
      ${totals.short > 0 && html`<p class="sf-notice small warn">Add ${money(totals.short)} more for delivery (minimum ${money(s.delivery.minOrder)}).</p>`}
      ${errors.form && html`<p class="sf-notice small bad" role="alert">${errors.form}</p>`}
    </section>

    <div class="sf-place">
      <button class="sf-btn sf-btn-primary sf-btn-lg sf-btn-block" disabled=${busy || !s.open || totals.short > 0 || !slot}>
        ${busy ? (progress != null && progress < 1 ? `Sending your receipt… ${Math.round(progress * 100)}%` : 'Placing your order…') : `Place order · ${money(totals.total)}`}</button>
    </div>
  </form>`;
}

function PayDetails({ s, method, total, fulfilment, urls, orderNo }) {
  if (method === 'cash') {
    return html`<p class="sf-pay-info">${fulfilment === 'delivery' ? 'Pay in cash when your order arrives.' : 'Pay when you collect your order.'}</p>`;
  }
  if (method === 'duitnow') {
    const qr = s.payments.duitnow.qr_path && urls[s.payments.duitnow.qr_path];
    return html`<div class="sf-pay-info">
      ${qr ? html`<div class="sf-qr"><img src=${qr} alt="DuitNow QR code" /><a class="sf-link small" href=${qr} target="_blank" rel="noopener" download>Open QR to save it</a></div>`
        : html`<p>We'll send you our DuitNow QR on WhatsApp after you order.</p>`}
      <p>Scan with your banking or e-wallet app and pay <b>${money(total)}</b>${s.payments.duitnow.name ? html` to <b>${s.payments.duitnow.name}</b>` : ''}${orderNo ? html`, reference <b>${orderNo}</b>` : ''}.</p>
    </div>`;
  }
  const b = s.payments.bank;
  const copy = async () => { if (await copyText(b.account_no.replace(/\s/g, ''))) toast('Account number copied'); };
  return html`<div class="sf-pay-info">
    <dl class="sf-bank">
      ${b.bank && html`<div><dt>Bank</dt><dd>${b.bank}</dd></div>`}
      ${b.account_name && html`<div><dt>Account name</dt><dd>${b.account_name}</dd></div>`}
      <div><dt>Account number</dt><dd><b>${b.account_no}</b> <button type="button" class="sf-link" onClick=${copy}><${Icon} name="copy" size=${13} /> Copy</button></dd></div>
      <div><dt>Amount</dt><dd><b>${money(total)}</b></dd></div>
      ${orderNo && html`<div><dt>Reference</dt><dd>${orderNo}</dd></div>`}
    </dl>
  </div>`;
}

function ReceiptPicker({ file, onFile, required, error, progress, disabled }) {
  const input = useRef();
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return html`<div class=${'sf-receipt' + (error ? ' has-error' : '')}>
    <span class="sf-label">Payment receipt ${required ? '' : html`<small>(optional — you can also send it later)</small>`}</span>
    ${file ? html`<div class="sf-receipt-file">
        ${preview ? html`<img src=${preview} alt="" />` : html`<span class="sf-receipt-icon"><${Icon} name="file" /></span>`}
        <span class="sf-receipt-name">${file.name}${progress != null && html`<span class="sf-bar"><span style=${{ width: Math.round(progress * 100) + '%' }}></span></span>`}</span>
        ${!disabled && html`<button type="button" class="sf-icon-btn small" onClick=${() => onFile(null)} aria-label="Remove receipt"><${Icon} name="x" size=${16} /></button>`}
      </div>`
    : html`<button type="button" class="sf-upload" onClick=${() => input.current.click()} disabled=${disabled}>
        <${Icon} name="upload" size=${18} />Upload screenshot of your payment</button>`}
    <input ref=${input} type="file" accept="image/*,application/pdf" hidden onChange=${(e) => { const x = e.target.files[0]; e.target.value = ''; if (x) onFile(x); }} />
    ${error && html`<span class="sf-error">${error}</span>`}
  </div>`;
}

// ── The customer's order page (bookmarkable; refreshes itself while the order is open) ──
function OrderPage({ ref_, justPlaced, s, urls }) {
  const [o, setO] = useState(() => {
    try { const x = JSON.parse(sessionStorage.getItem('webstore-just-placed')); return x && `${x.id}.${x.secret}` === ref_ ? x : undefined; } catch { return undefined; }
  });
  const [err, setErr] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const fetchIt = () => shop.order(ref_).then((x) => { setO(x); setErr(null); }).catch((e) => setErr(e.message));
  useEffect(() => {
    sessionStorage.removeItem('webstore-just-placed');
    fetchIt();
    const t = setInterval(() => { if (document.visibilityState === 'visible') fetchIt(); }, 30e3);
    return () => clearInterval(t);
  }, [ref_]);

  if (err && !o) return html`<div class="sf-wrap sf-narrow"><div class="sf-state"><span class="sf-state-icon"><${Icon} name="alert" size=${28} /></span>
    <h1>Order not found</h1><p>${err}</p><a class="sf-btn sf-btn-primary" href="#/">Back to the menu</a></div></div>`;
  if (!o) return html`<div class="sf-boot"><div class="sf-spinner"></div></div>`;

  const steps = CUSTOMER_STEPS(o);
  const at = steps.findIndex((x) => x.id === o.status);
  const cancelled = o.status === 'cancelled';
  const sendReceipt = async () => {
    setBusy(true);
    try {
      setProgress(0);
      const key = await shop.uploadReceipt(file, { onProgress: setProgress });
      setO(await shop.attachReceipt(ref_, key));
      setFile(null);
      toast('Receipt sent — thank you!');
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
    setProgress(null);
  };
  const wa = waTo(s.phone, customerMessage(o, s.name), CC);
  const first = String(o.customer_name || '').split(/\s+/)[0];

  return html`<div class="sf-wrap sf-narrow sf-orderpage">
    <section class="sf-card sf-done">
      ${justPlaced ? html`<span class="sf-done-icon"><${Icon} name="check" size=${30} /></span>
        <h1>Thank you${first ? ', ' + first : ''}!</h1><p>Your order is in. We'll get baking.</p>`
      : html`<h1>Your order</h1>`}
      <div class="sf-orderno"><small>Order number</small><b>${o.order_no}</b></div>
      ${justPlaced && wa && html`<a class="sf-btn sf-btn-wa sf-btn-block" href=${wa} target="_blank" rel="noopener"><${Icon} name="whatsapp" size=${18} />Send your order to us on WhatsApp</a>`}
      ${justPlaced && html`<p class="sf-muted small">Bookmark this page to check on your order any time.</p>`}
    </section>

    <section class="sf-card">
      <h2 class="sf-card-title">Status</h2>
      ${cancelled ? html`<p class="sf-notice bad">This order was cancelled. Please contact us if you have any questions.</p>` : html`
        <ol class="sf-steps">${steps.map((x, i) => html`<li key=${x.id} class=${i < at ? 'done' : i === at ? 'now' : ''}>
          <span class="sf-step-dot">${i <= at && html`<${Icon} name="check" size=${12} />`}</span>
          <span><b>${x.label}</b>${o.times?.[x.id] && html`<small>${new Date(o.times[x.id]).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small>`}</span>
        </li>`)}</ol>`}
      <dl class="sf-facts">
        <div><dt>${o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</dt><dd>${fmtWhenLong(o)}</dd></div>
        ${o.fulfilment === 'pickup' && s.pickup.address && html`<div><dt>Pick up at</dt><dd>${s.pickup.address}</dd></div>`}
        ${o.address && html`<div><dt>Deliver to</dt><dd>${o.address}</dd></div>`}
        <div><dt>Name</dt><dd>${o.customer_name} · ${o.phone}</dd></div>
      </dl>
    </section>

    <section class="sf-card">
      <h2 class="sf-card-title">Payment <span class=${'sf-pill ' + PAYMENT_STATUS[o.payment_status].tone}>${o.payment_method === 'cash' && o.payment_status === 'unpaid' ? paymentLabel('cash', o.fulfilment) : PAYMENT_STATUS[o.payment_status].label}</span></h2>
      ${o.payment_status === 'paid' ? html`<p>Paid — thank you!</p>`
      : o.payment_method === 'cash' ? html`<${PayDetails} s=${s} method="cash" total=${o.total} fulfilment=${o.fulfilment} urls=${urls} />`
      : o.payment_status === 'submitted' ? html`<p>We've got your receipt and will confirm your payment shortly.</p>`
      : !cancelled && html`<p class="sf-muted small">Paying by ${paymentLabel(o.payment_method, o.fulfilment)}:</p>
        <${PayDetails} s=${s} method=${o.payment_method} total=${o.total} fulfilment=${o.fulfilment} urls=${urls} orderNo=${o.order_no} />
        <${ReceiptPicker} file=${file} onFile=${setFile} required progress=${progress} disabled=${busy} />
        ${file && html`<button class="sf-btn sf-btn-primary sf-btn-block" onClick=${sendReceipt} disabled=${busy}>${busy ? 'Sending…' : 'Send receipt'}</button>`}`}
    </section>

    <section class="sf-card">
      <h2 class="sf-card-title">Items</h2>
      <ul class="sf-review">${o.items.map((it, i) => html`<li key=${i}>
        <span class="sf-review-qty">${it.qty}×</span>
        <span class="sf-review-name">${it.name}${it.options?.length > 0 && html`<small>${optionText(it.options)}</small>`}${it.note && html`<small>“${it.note}”</small>`}</span>
        <span>${money(it.total)}</span></li>`)}</ul>
      <dl class="sf-totals">
        <div><dt>Subtotal</dt><dd>${money(o.subtotal)}</dd></div>
        ${o.fulfilment === 'delivery' && html`<div><dt>Delivery</dt><dd>${o.delivery_fee > 0 ? money(o.delivery_fee) : 'Free'}</dd></div>`}
        <div class="total"><dt>Total</dt><dd>${money(o.total)}</dd></div>
      </dl>
      ${o.notes && html`<p class="sf-muted small">Your note: “${o.notes}”</p>`}
    </section>

    <div class="sf-row-actions">
      ${wa && html`<a class="sf-btn" href=${waTo(s.phone, `Hi ${s.name}! About my order ${o.order_no}: `, CC)} target="_blank" rel="noopener"><${Icon} name="whatsapp" size=${16} />Message us</a>`}
      <a class="sf-btn sf-btn-primary" href="#/">Back to the menu</a>
    </div>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
