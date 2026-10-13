// Team app: login → load data → sidebar + pages.
import { html, render, useState, useEffect } from './lib.js';
import { loadBackend, DEMO } from './api.js';
import { setApi, api, loadAll, useStore, setState } from './store.js';
import { parseHash, hrefFor } from './util.js';
import { CONFIG } from '../config.js';
import { Icon, DialogHost, ToastHost, TooltipHost, InstallButton, InstallHelpHost } from './ui.js';
import { Login, NotTeam, Brand } from './views/login.js';
import { Dashboard } from './views/dashboard.js';
import { Review } from './views/review.js';
import { Library } from './views/library.js';
import { Seasons } from './views/seasons.js';
import { Talents, TalentDetail } from './views/talents.js';
import { Links } from './views/links.js';
import { Settings } from './views/settings.js';
import { AssetDetail } from './views/asset-detail.js';

setApi(await loadBackend());

function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'review', label: 'Review', icon: 'inbox' },
  { group: 'content', label: 'Content', icon: 'image', items: [
    { id: 'library', label: 'All content' },
    { id: 'library', cat: 'final', label: 'Final content' },
    { id: 'library', cat: 'raw', label: 'Raw footage' },
    { id: 'library', cat: 'brand', label: 'Brand kit' },
    { id: 'seasons', label: 'Seasons' },
  ] },
  { group: 'people', label: 'People', icon: 'users', items: [
    { id: 'talents', label: 'Talents' },
    { id: 'links', label: 'Upload links' },
  ] },
];
const PAGE_LABELS = { library: 'Library', seasons: 'Seasons', talents: 'Talents', links: 'Upload links', settings: 'Settings' };

// Which sidebar groups are unfolded (remembered in this browser).
const GROUPS_KEY = 'gig-nav-groups';
const readGroups = () => { try { return JSON.parse(localStorage.getItem(GROUPS_KEY)) || {}; } catch { return {}; } };
const saveGroups = (g) => { try { localStorage.setItem(GROUPS_KEY, JSON.stringify(g)); } catch {} };

function NavLink({ n, active, sub, badge }) {
  return html`<a href=${hrefFor(n.id, n.cat ? { cat: n.cat } : {})} class=${'nav-item' + (sub ? ' nav-sub' : '') + (active ? ' active' : '')}
      aria-current=${active ? 'page' : undefined}>
    ${n.icon && html`<${Icon} name=${n.icon} />`}<span>${n.label}</span>
    ${badge > 0 && html`<span class="nav-badge">${badge}</span>`}
  </a>`;
}

function Shell() {
  const route = useRoute();
  const s = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [p0 = 'dashboard', p1] = route.parts;
  const pathKey = route.parts.join('/');
  useEffect(() => { setMenuOpen(false); window.scrollTo(0, 0); }, [pathKey]);

  const pending = s.assets.filter((a) => a.status === 'pending').length;
  const pages = {
    dashboard: () => html`<${Dashboard} />`,
    review: () => html`<${Review} query=${route.query} />`,
    library: () => html`<${Library} query=${route.query} />`,
    seasons: () => html`<${Seasons} />`,
    talents: () => (p1 ? html`<${TalentDetail} id=${p1} />` : html`<${Talents} query=${route.query} />`),
    links: () => html`<${Links} query=${route.query} />`,
    settings: () => html`<${Settings} />`,
  };
  const page = (pages[p0] || pages.dashboard)();
  const pageLabel = PAGE_LABELS[p0] || NAV.find((n) => n.id === p0)?.label || 'Dashboard';
  useEffect(() => { document.title = `${pageLabel} · ${CONFIG.BRAND_NAME}`; }, [pageLabel]);

  const isActive = (n) => n.id === p0 && (n.id !== 'library' || (n.cat || '') === (route.query.cat || ''));
  const groupHasPage = (g) => g.items.some((n) => n.id === p0);
  const [groups, setGroups] = useState(readGroups);
  const toggleGroup = (key) => setGroups((g) => { const next = { ...g, [key]: !isOpen(key) }; saveGroups(next); return next; });
  const isOpen = (key) => groups[key] ?? groupHasPage(NAV.find((n) => n.group === key));
  // Arriving on a page inside a folded group unfolds it.
  useEffect(() => {
    const g = NAV.find((n) => n.group && groupHasPage(n));
    if (g && groups[g.group] === false) setGroups((x) => { const next = { ...x, [g.group]: true }; saveGroups(next); return next; });
  }, [p0]);

  return html`<div class=${'shell' + (menuOpen ? ' menu-open' : '')}>
    <header class="topbar">
      <button class="icon-btn" aria-label="Menu" onClick=${() => setMenuOpen(!menuOpen)}><${Icon} name="menu" /></button>
      <${Brand} small />
    </header>
    <aside class="sidebar">
      <a href=${hrefFor('dashboard')} class="sidebar-brand"><${Brand} /></a>
      <nav>
        ${NAV.map((n) => {
          if (!n.group) return html`<${NavLink} key=${n.id} n=${n} active=${isActive(n)} badge=${n.id === 'review' ? pending : 0} />`;
          const open = isOpen(n.group);
          return html`<div key=${n.group} class=${'nav-group' + (open ? ' open' : '')}>
            <button class=${'nav-item nav-group-btn' + (!open && groupHasPage(n) ? ' has-active' : '')}
                aria-expanded=${open} aria-controls=${'nav-' + n.group} onClick=${() => toggleGroup(n.group)}>
              <${Icon} name=${n.icon} /><span>${n.label}</span><span class="nav-chevron"><${Icon} name="chevron" size=${16} /></span>
            </button>
            <div class="nav-group-body" id=${'nav-' + n.group}>
              <div class="nav-group-inner">
                ${n.items.map((c) => html`<${NavLink} key=${c.label} n=${c} sub active=${isActive(c)} />`)}
              </div>
            </div>
          </div>`;
        })}
        <div class="nav-divider"></div>
        <a class="nav-item" href="print/index.html"><${Icon} name="printer" /><span>Print Hub</span><span class="nav-ext"><${Icon} name="external" size=${14} /></span></a>
      </nav>
      <div class="sidebar-foot">
        <${InstallButton} appName=${CONFIG.BRAND_NAME} />
        <a href=${hrefFor('settings')} class=${'nav-item' + (p0 === 'settings' ? ' active' : '')}><${Icon} name="settings" /><span>Settings</span></a>
        <div class="user-chip">
          <span class="avatar">${(s.user?.email || '?').slice(0, 1).toUpperCase()}</span>
          <span class="user-email">${s.user?.email}</span>
        </div>
      </div>
    </aside>
    <div class="scrim" onClick=${() => setMenuOpen(false)}></div>
    <main class="main">
      ${DEMO && html`<div class="demo-banner"><${Icon} name="alert" size=${16} />
        <span><b>Demo mode</b> — sample data, saved only in this browser. See README.md to connect your own database.</span></div>`}
      ${page}
    </main>
    ${s.openAssetId && html`<${AssetDetail} id=${s.openAssetId} />`}
  </div>`;
}

function App() {
  const [phase, setPhase] = useState({ id: 'loading' });

  useEffect(() => {
    let lastKey;
    const evaluate = async (user) => {
      if (!user) return setPhase({ id: 'signedOut' });
      setPhase({ id: 'loading' });
      try {
        if (!(await api.auth.isTeam())) return setPhase({ id: 'notTeam', email: user.email });
        setState({ user });
        await loadAll();
        setPhase({ id: 'ready' });
      } catch (e) {
        setPhase({ id: 'error', message: e.message });
      }
    };
    return api.auth.onChange((user) => {
      const key = user ? user.id || user.email : '';
      if (key === lastKey) return;
      lastKey = key;
      setTimeout(() => evaluate(user), 0); // don't call the auth client from inside its own callback
    });
  }, []);

  let body;
  if (phase.id === 'loading') body = html`<div class="loading"><div class="spinner"></div></div>`;
  else if (phase.id === 'signedOut') body = html`<${Login} />`;
  else if (phase.id === 'notTeam') body = html`<${NotTeam} email=${phase.email} />`;
  else if (phase.id === 'error') body = html`<div class="auth-page"><div class="auth-card card">
      <${Brand} /><h1>Couldn't load</h1><p>${phase.message}</p>
      <p class="muted small">Check your internet connection and the Supabase details in config.js.</p>
      <button class="btn btn-primary btn-block" onClick=${() => location.reload()}>Try again</button></div></div>`;
  else body = html`<${Shell} />`;

  return html`${body}<${DialogHost} /><${InstallHelpHost} /><${ToastHost} /><${TooltipHost} />`;
}

render(html`<${App} />`, document.getElementById('app'));
