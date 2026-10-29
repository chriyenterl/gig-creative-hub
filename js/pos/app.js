// GIG POS — the till for the shops and cafés. Sign in (team: name + passcode; owners: email + password),
// pick the store this device is at, and sell. Menu, stock, customers and reports for managers and owners.
import { html, render, useState, useEffect } from '../lib.js';
import { loadBackend, MODE } from '../api.js';
import { setApi } from '../store.js';
import { CONFIG } from '../../config.js';
import { parseHash, hrefFor, go } from '../util.js';
import { Icon, Pill, DialogHost, ToastHost, TooltipHost, InstallButton, InstallHelpHost, PasscodeInput, confirmDialog, toastError } from '../ui.js';
import { setPosApi, api, usePos, getS, boot, chooseStore, currentStore, isManager, isOwner, recentNames, rememberName, forgetName,
  refreshOpenOrders, refreshCatalog, refreshShift, syncOutbox } from './state.js';
import { Register } from './register.js';
import { ShiftPage, ShiftsPage } from './shift.js';
import { SalesPage, SaleDetail, OpenOrdersPage, Outbox } from './sales.js';
import { KitchenPage } from './kitchen.js';
import { CustomersPage, CustomerDetail } from './customers.js';
import { MenuPage } from './menu.js';
import { StockPage } from './stock.js';
import { ReportsPage } from './reports.js';
import { StoresPage, StoreForm, TeamPage } from './admin.js';
import { fmtTime } from './ui.js';

const backend = await loadBackend();
setApi(backend);
setPosApi(backend);
const POS_TITLE = CONFIG.POS_NAME || 'GIG POS';
if ('serviceWorker' in navigator && MODE !== 'demo') navigator.serviceWorker.register('sw.js').catch(() => {}); // lets the till open without internet

function useRoute() {
  const [r, setR] = useState(parseHash);
  useEffect(() => { const on = () => setR(parseHash()); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  return r;
}

function PosBrand() {
  const words = CONFIG.BRAND_NAME.trim().split(/\s+/);
  const initials = /^[A-Z0-9]{2,3}$/.test(words[0]) ? words[0] : words.map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return html`<span class="brand">${CONFIG.LOGO_URL ? html`<img src=${CONFIG.LOGO_URL} alt="" />` : html`<span class="brand-mark">${initials}</span>`}<span class="brand-name">${POS_TITLE}</span></span>`;
}

// ── Signing in ──────────────────────────────────────────────────────────────
function SignIn({ message }) {
  const [tab, setTab] = useState('team');
  const [name, setName] = useState(recentNames()[0] || '');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const names = recentNames();
  const team = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.auth.signInWithPasscode(name.trim(), code); rememberName(name.trim()); location.reload(); }
    catch (err) { toastError(err); setCode(''); setBusy(false); }
  };
  const owner = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.auth.signIn(email.trim(), password); location.reload(); } catch (err) { toastError(err); setBusy(false); }
  };
  return html`<div class="auth-page"><div class="auth-card card">
    <${PosBrand} />
    <h1>Sign in to the till</h1>
    ${message && html`<p class="warn-text small">${message}</p>`}
    <div class="segment auth-tabs" role="tablist">
      <button role="tab" aria-selected=${tab === 'team'} class=${tab === 'team' ? 'on' : ''} onClick=${() => setTab('team')}>Team</button>
      <button role="tab" aria-selected=${tab === 'owner'} class=${tab === 'owner' ? 'on' : ''} onClick=${() => setTab('owner')}>Owner</button>
    </div>
    ${tab === 'team' ? html`<form class="team-signin" onSubmit=${team}>
      ${names.length > 0 && html`<div class="chips name-chips">${names.map((n) => html`<span key=${n} class=${'chip' + (name === n ? ' on' : '')}>
        <button type="button" onClick=${() => { setName(n); setCode(''); }}>${n}</button>
        <button type="button" class="chip-x" aria-label=${'Forget ' + n} onClick=${() => { forgetName(n); setName(''); }}><${Icon} name="x" size=${11} /></button></span>`)}</div>`}
      <label class="field"><span class="field-label">Your name</span><input autocomplete="username" value=${name} onInput=${(e) => setName(e.target.value)} /></label>
      <${PasscodeInput} label="Passcode" value=${code} onInput=${setCode} autocomplete="current-password" autofocus=${!!name} />
      <button class="btn btn-primary btn-block btn-lg" disabled=${busy || !name.trim() || code.length !== 6}>${busy ? 'One moment…' : 'Sign in'}</button>
      ${api.auth.requestPasscodeReset && html`<a class="link small center" href="../reset.html">Forgot your passcode?</a>`}
    </form>` : html`<form class="team-signin" onSubmit=${owner}>
      <label class="field"><span class="field-label">Email</span><input type="email" autocomplete="username" value=${email} onInput=${(e) => setEmail(e.target.value)} /></label>
      <label class="field"><span class="field-label">Password</span><input type="password" autocomplete="current-password" value=${password} onInput=${(e) => setPassword(e.target.value)} /></label>
      <button class="btn btn-primary btn-block btn-lg" disabled=${busy || !email || !password}>${busy ? 'One moment…' : 'Sign in'}</button>
    </form>`}
    <p class="muted small center">New to the team? Ask the owner for the join link.</p>
  </div></div>`;
}

async function signOut() {
  if (getS().outbox.length && !(await confirmDialog({ title: 'Sales are still waiting to sync', message: 'They stay on this device and are sent when the next person signs in and the internet is back.', confirmLabel: 'Sign out anyway' }))) return;
  await api.auth.signOut();
  location.replace(location.pathname + '#/');
  location.reload();
}

// ── The shell ───────────────────────────────────────────────────────────────
const NAV = [
  { id: '', label: 'Sell', icon: 'tag' },
  { id: 'orders', label: 'Open orders', icon: 'clock', badge: (s) => s.openOrders.length },
  { id: 'kitchen', label: 'Kitchen', icon: 'list', show: (st) => st?.settings.kitchen },
  { id: 'sales', label: 'Transactions', icon: 'inbox', match: ['sale'] },
  { id: 'shift', label: 'Shift', icon: 'cash', match: ['shifts'] },
  { id: 'customers', label: 'Customers', icon: 'users', match: ['customer'] },
  { divider: true, manager: true },
  { id: 'menu', label: 'Menu', icon: 'grid', manager: true },
  { id: 'stock', label: 'Stock', icon: 'layers', manager: true, badge: (s) => (s.catalog?.products || []).filter((p) => p.track_stock && p.low_stock != null && p.stock <= p.low_stock).length },
  { id: 'reports', label: 'Reports', icon: 'chart', manager: true },
  { divider: true, owner: true },
  { id: 'stores', label: 'Stores', icon: 'store', owner: true },
  { id: 'team', label: 'Team', icon: 'users', owner: true },
];

function StatusChip() {
  const { online, outbox, syncing } = usePos();
  if (online && !outbox.length) return null;
  return html`<a class=${'net-chip' + (online ? '' : ' off')} href=${hrefFor('sales')} data-tip=${online ? 'Sending the sales made offline…' : 'No internet — sales are saved on this device and sent when it\'s back'}>
    <${Icon} name=${online ? 'refresh' : 'alert'} size=${14} />${online ? (syncing ? 'Syncing' : 'Waiting') : 'Offline'}${outbox.length ? ` · ${outbox.length}` : ''}</a>`;
}

function Shell() {
  const route = useRoute();
  const s = usePos();
  const store = currentStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [p0 = '', p1] = route.parts;
  useEffect(() => { setMenuOpen(false); if (p0) window.scrollTo(0, 0); }, [route.parts.join('/')]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') { refreshOpenOrders().catch(() => {}); if (p0 === 'shift') refreshShift().catch(() => {}); } }, 20000);
    const onFocus = () => { refreshCatalog().catch(() => {}); refreshOpenOrders().catch(() => {}); syncOutbox(); };
    addEventListener('focus', onFocus);
    return () => { clearInterval(t); removeEventListener('focus', onFocus); };
  }, [p0]);
  useEffect(() => { document.title = `${store ? store.name + ' · ' : ''}${POS_TITLE}`; }, [store?.name]);

  if (!store) {
    if (isOwner()) return html`<main class="main main-narrow"><${StoreForm} first /></main>`;
    return html`<div class="auth-page"><div class="auth-card card"><${PosBrand} /><h1>No store yet</h1>
      <p class="muted">${s.stores.length ? 'The stores you work at are switched off.' : "You haven't been given a store yet."} Ask the owner to set you up in POS → Team.</p>
      <button class="btn btn-block" onClick=${signOut}>Sign out</button></div></div>`;
  }
  const manager = isManager(), owner = isOwner();
  const need = (fn, page) => (fn() ? page : html`<${Register} />`);
  const pages = {
    '': () => html`<${Register} />`,
    orders: () => html`<${OpenOrdersPage} />`,
    kitchen: () => html`<${KitchenPage} />`,
    sales: () => html`<${SalesPage} query=${route.query} />`,
    sale: () => html`<${SaleDetail} id=${p1} />`,
    shift: () => html`<${ShiftPage} />`,
    shifts: () => need(isManager, html`<${ShiftsPage} id=${p1} />`),
    customers: () => html`<${CustomersPage} query=${route.query} />`,
    customer: () => html`<${CustomerDetail} id=${p1} />`,
    menu: () => need(isManager, html`<${MenuPage} query=${route.query} />`),
    stock: () => need(isManager, html`<${StockPage} query=${route.query} />`),
    reports: () => need(isManager, html`<${ReportsPage} query=${route.query} />`),
    stores: () => need(isOwner, html`<${StoresPage} id=${p1} />`),
    team: () => need(isOwner, html`<${TeamPage} />`),
  };
  const page = (pages[p0] || pages[''])();
  const register = !pages[p0] || p0 === '';
  const active = (n) => n.id === p0 || (n.match || []).includes(p0);
  const shiftLine = s.shift === undefined ? null : s.shift ? html`<${Pill} tone="good">Shift open · ${fmtTime(s.shift.opened_at)}<//>` : html`<a href=${hrefFor('shift')}><${Pill} tone="warn">No shift open<//></a>`;
  return html`<div class=${'shell pos-shell' + (register ? ' shell-drawer' : '') + (menuOpen ? ' menu-open' : '')}>
    <header class="topbar no-print">
      <button class="icon-btn" aria-label="Menu" onClick=${() => setMenuOpen(!menuOpen)}><${Icon} name="menu" /></button>
      <span class="top-store"><b>${store.name}</b>${shiftLine}</span>
      <span class="spacer"></span>
      <${StatusChip} />
      <span class="top-user muted small">${s.me.name}</span>
    </header>
    <aside class="sidebar no-print">
      <a href=${hrefFor('')} class="sidebar-brand"><${PosBrand} /></a>
      ${s.stores.filter((x) => x.is_active).length > 1 ? html`<label class="store-pick"><span class="sr-only">Store</span>
        <select value=${s.storeId} onChange=${(e) => { chooseStore(e.target.value).catch(toastError); go(''); }}>
          ${s.stores.filter((x) => x.is_active).map((x) => html`<option value=${x.id}>${x.name}</option>`)}</select></label>`
        : html`<div class="store-pick store-one">${store.name}</div>`}
      <nav>
        ${NAV.filter((n) => (!n.manager || manager) && (!n.owner || owner) && (!n.show || n.show(store))).map((n, i) => n.divider
          ? html`<div class="nav-divider" key=${'d' + i}></div>`
          : html`<a key=${n.id} href=${hrefFor(n.id)} class=${'nav-item' + (active(n) ? ' active' : '')} aria-current=${active(n) ? 'page' : undefined}>
              <${Icon} name=${n.icon} /><span>${n.label}</span>${n.badge && n.badge(s) > 0 && html`<span class="nav-badge">${n.badge(s)}</span>`}</a>`)}
      </nav>
      <div class="sidebar-foot">
        <${InstallButton} appName=${POS_TITLE} />
        ${(owner || s.me.hub) && html`<a class="nav-item" href="../index.html"><${Icon} name="back" /><span>Creative Hub</span></a>`}
        <button class="nav-item" onClick=${signOut}><${Icon} name="users" /><span>Switch cashier</span></button>
        <div class="user-chip"><span class="avatar">${(s.me.name || '?').charAt(0).toUpperCase()}</span>
          <span class="user-email">${s.me.name} · ${{ owner: 'Owner', manager: 'Manager', cashier: 'Cashier' }[s.me.role]}</span>
          <button class="icon-btn" data-tip="Sign out" aria-label="Sign out" onClick=${signOut}><${Icon} name="logout" size=${16} /></button></div>
      </div>
    </aside>
    <div class="scrim" onClick=${() => setMenuOpen(false)}></div>
    <main class=${'main' + (register ? ' main-register' : '')}>
      ${MODE === 'demo' && !register && html`<div class="demo-banner no-print"><${Icon} name="alert" size=${16} />
        <span><b>Demo mode</b> — sample stores and sales, saved only in this browser. <button class="link" onClick=${resetDemo}>Start the demo again</button></span></div>`}
      ${!register && p0 !== 'sales' && html`<${Outbox} />`}
      ${page}
    </main>
  </div>`;
}
async function resetDemo() {
  if (!(await confirmDialog({ title: 'Start the demo again?', message: 'All demo sales, shifts and changes are cleared and the sample data comes back.', confirmLabel: 'Start again' }))) return;
  await api.pos.reset();
  try { Object.keys(localStorage).filter((k) => k.startsWith('gig-pos-')).forEach((k) => localStorage.removeItem(k)); } catch {}
  location.reload();
}

// A personal POS sign-in link (index.html#k=…) — e.g. opened once on the shop's tablet.
async function signInFromLink() {
  const m = /^#k=([A-Za-z0-9_-]{16,})/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search + '#/');
  if (!api.auth.signInWithLink) return 'Sign-in links need the Cloudflare setup.';
  try { await api.auth.signInWithLink(m[1], 'pos'); return null; } catch (e) { return e.message; }
}

function App() {
  const [phase, setPhase] = useState({ id: 'loading' });
  useEffect(() => {
    (async () => {
      if (!api.pos) return setPhase({ id: 'unsupported' });
      const linkError = await signInFromLink();
      const user = await api.auth.getUser().catch(() => null);
      if (!user) {
        // Offline with a device that was signed in before: open the till from what's saved on it.
        if (!navigator.onLine && localStorage.getItem('gig-cloudflare-token')) {
          try { await boot(); return setPhase({ id: 'ready' }); } catch {}
        }
        return setPhase({ id: 'signin', message: linkError });
      }
      try {
        await boot();
        setPhase({ id: 'ready' });
        syncOutbox();
      } catch (e) {
        setPhase(e.code === 'POS_AUTH' ? { id: 'noaccess', name: user.name || user.email, message: e.message } : e.code === 'AUTH' ? { id: 'signin' }
          : /Unknown action: pos/.test(e.message) ? { id: 'error', message: 'The server needs updating for the POS: in the cloudflare folder run "npx wrangler deploy" (see README → GIG POS).' }
          : { id: 'error', message: e.message });
      }
    })();
  }, []);
  let body;
  if (phase.id === 'loading') body = html`<div class="loading"><div class="spinner"></div></div>`;
  else if (phase.id === 'signin') body = html`<${SignIn} message=${phase.message} />`;
  else if (phase.id === 'unsupported') body = html`<div class="auth-page"><div class="auth-card card"><${PosBrand} /><h1>Not available</h1>
    <p class="muted">The POS works with the Cloudflare setup (or the demo). See README.md.</p></div></div>`;
  else if (phase.id === 'noaccess') body = html`<div class="auth-page"><div class="auth-card card"><${PosBrand} /><h1>No POS access</h1>
    <p class="muted">${phase.name}, ${phase.message.charAt(0).toLowerCase() + phase.message.slice(1)}</p>
    <button class="btn btn-block" onClick=${signOut}>Sign in as someone else</button>
    <a class="btn btn-ghost btn-block" href="../index.html">Go to the Creative Hub</a></div></div>`;
  else if (phase.id === 'error') body = html`<div class="auth-page"><div class="auth-card card"><${PosBrand} /><h1>Couldn't load</h1><p>${phase.message}</p>
    <button class="btn btn-primary btn-block" onClick=${() => location.reload()}>Try again</button></div></div>`;
  else body = html`<${Shell} />`;
  return html`${body}<${DialogHost} /><${InstallHelpHost} /><${ToastHost} /><${TooltipHost} />`;
}

render(html`<${App} />`, document.getElementById('app'));
