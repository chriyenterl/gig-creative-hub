// Reusable UI pieces: icons, pills, modal, confirm dialog, toasts, tooltips,
// media thumbnails/previews, drag-and-drop zone, form fields.
import { html, useState, useEffect, useRef } from './lib.js';
import { ASSET_STATUS, MEDIA, talentStatus, EVERGREEN, fmtGB } from './util.js';
import { api, useStore } from './store.js';

// ── Icons (inline SVG, stroke = currentColor) ─────────────────────────────
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4V8z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 15V9M14 15V9"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>',
  play: '<path d="m7 4 13 8-13 8V4z" fill="currentColor"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  tag: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  whatsapp: '<path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  select: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 12 3 3 5-6"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
};
export function Icon({ name, size = 18 }) {
  return html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}></svg>`;
}

// ── Pills ─────────────────────────────────────────────────────────────────
export function Pill({ tone = 'neutral', icon, children }) {
  return html`<span class=${'pill pill-' + tone}>${icon && html`<${Icon} name=${icon} size=${12} />`}${children}</span>`;
}
export function StatusPill({ status }) {
  const s = ASSET_STATUS[status] || ASSET_STATUS.pending;
  return html`<${Pill} tone=${s.tone} icon=${s.icon}>${s.label}<//>`;
}
export function TalentStatusPill({ status }) {
  const s = talentStatus(status);
  return html`<${Pill} tone=${s.tone}>${s.label}<//>`;
}
export function UsagePill({ asset }) {
  return asset.use_count > 0
    ? html`<${Pill} tone="info" icon="check">Used ${asset.use_count}×<//>`
    : html`<${Pill} tone="neutral">Not used yet<//>`;
}
export function SeasonTag({ season }) {
  const s = season || EVERGREEN;
  return html`<span class="season-tag"><span class="dot" style=${{ background: s.color }}></span>${s.name}</span>`;
}

// ── Modal (Escape / backdrop closes only the top-most one) ────────────────
const modalStack = [];
export function Modal({ title, onClose, children, footer, size = 'md' }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const id = Symbol();
    modalStack.push(id);
    document.body.classList.add('modal-open');
    const onKey = (e) => { if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) closeRef.current?.(); };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(id), 1);
      if (!modalStack.length) document.body.classList.remove('modal-open');
    };
  }, []);
  return html`
    <div class="modal-backdrop" onMouseDown=${(e) => e.target === e.currentTarget && closeRef.current?.()}>
      <div class=${'modal modal-' + size} role="dialog" aria-modal="true" aria-label=${title}>
        <header class="modal-head">
          <h2>${title}</h2>
          <button class="icon-btn" onClick=${() => closeRef.current?.()} aria-label="Close"><${Icon} name="x" /></button>
        </header>
        <div class="modal-body">${children}</div>
        ${footer && html`<footer class="modal-foot">${footer}</footer>`}
      </div>
    </div>`;
}

// ── Confirm dialog: `if (await confirmDialog({...})) …` ───────────────────
let showDialog = null;
export function confirmDialog({ title = 'Are you sure?', message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => showDialog ? showDialog({ title, message, confirmLabel, danger, resolve }) : resolve(confirm(message)));
}
export function DialogHost() {
  const [d, setD] = useState(null);
  showDialog = setD;
  if (!d) return null;
  const close = (v) => { d.resolve(v); setD(null); };
  return html`<${Modal} title=${d.title} size="sm" onClose=${() => close(false)} footer=${html`
      <button class="btn" onClick=${() => close(false)}>Cancel</button>
      <button class=${'btn ' + (d.danger ? 'btn-danger' : 'btn-primary')} onClick=${() => close(true)} autofocus>${d.confirmLabel}</button>`}>
    <p class="dialog-msg">${d.message}</p>
  <//>`;
}

// ── Toasts: toast('Saved') / toast('Oops', 'error') ───────────────────────
let pushToast = null;
export function toast(message, tone = 'ok') { pushToast?.({ id: Math.random(), message, tone }); }
export const toastError = (e) => toast(e?.message || String(e), 'error');
export function ToastHost() {
  const [items, setItems] = useState([]);
  pushToast = (t) => {
    setItems((xs) => [...xs, t]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.tone === 'error' ? 6000 : 3000);
  };
  return html`<div class="toasts" role="status" aria-live="polite">
    ${items.map((t) => html`<div key=${t.id} class=${'toast toast-' + t.tone}>
      <${Icon} name=${t.tone === 'error' ? 'alert' : 'check'} size=${16} /><span>${t.message}</span></div>`)}
  </div>`;
}

// ── Tooltip: add data-tip="…" to any element ──────────────────────────────
export function TooltipHost() {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    const move = (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (!el) return setTip(null);
      setTip({ text: el.getAttribute('data-tip'), x: e.clientX, y: e.clientY });
    };
    const hide = () => setTip(null);
    document.addEventListener('mousemove', move);
    document.addEventListener('scroll', hide, true);
    return () => { document.removeEventListener('mousemove', move); document.removeEventListener('scroll', hide, true); };
  }, []);
  if (!tip) return null;
  const left = Math.min(tip.x + 14, innerWidth - 260);
  const top = tip.y + 18 > innerHeight - 60 ? tip.y - 44 : tip.y + 18;
  return html`<div class="tooltip" style=${{ left: left + 'px', top: top + 'px' }}>${tip.text}</div>`;
}

// ── Signed file URLs (batched + cached for ~50 min) ───────────────────────
const urlCache = new Map();
export function useSignedUrls(paths) {
  const key = paths.join('|');
  // Value per path: a URL, null (no file found), or missing (still loading).
  const read = () => Object.fromEntries(paths.filter((p) => urlCache.has(p)).map((p) => [p, urlCache.get(p).url]));
  const [map, setMap] = useState(read);
  useEffect(() => {
    let alive = true;
    const now = Date.now();
    const need = paths.filter((p) => p && !(urlCache.get(p)?.exp > now));
    if (!need.length) { setMap(read()); return; }
    api.signedUrls(need, 3600).then((res) => {
      const t = Date.now();
      for (const p of need) urlCache.set(p, { url: res[p] || null, exp: t + (res[p] ? 50 * 60e3 : 5 * 60e3) });
      if (alive) setMap(read());
    }).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return map;
}

// ── Media ─────────────────────────────────────────────────────────────────
const extOf = (a) => (a.file_name || a.storage_path || '').split('.').pop().slice(0, 5).toUpperCase();

export function MediaThumb({ asset, url }) {
  const ref = useRef();
  const [seen, setSeen] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!ref.current || !('IntersectionObserver' in window)) return setSeen(true);
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  const kind = asset.media_type;
  const direct = api?.media?.(asset); // Google Drive: ready-made thumbnail links (videos included)
  if (direct) url = direct.thumb;
  const show = url && seen && !broken;
  let inner;
  // Images use the browser's own lazy loading; videos wait until scrolled into view (they're heavier).
  if (url && !broken && (kind === 'image' || direct)) inner = html`<img src=${url} alt="" loading="lazy" decoding="async" onError=${() => setBroken(true)} />`;
  else if (show && kind === 'video') inner = html`<video src=${url + '#t=0.5'} preload="metadata" muted playsinline onError=${() => setBroken(true)}></video>`;
  else inner = html`<div class="thumb-ph"><${Icon} name=${MEDIA[kind]?.icon || 'file'} size=${26} /><span>${extOf(asset)}</span></div>`;
  return html`<div class="thumb" ref=${ref}>
    ${inner}
    ${kind === 'video' && html`<span class="thumb-badge"><${Icon} name="play" size=${11} /> Video</span>`}
  </div>`;
}

export function MediaPreview({ asset }) {
  const direct = api?.media?.(asset);
  const urls = useSignedUrls(direct ? [] : [asset.storage_path]);
  const url = urls[asset.storage_path];
  const kind = asset.media_type;
  if (direct && kind === 'image') return html`<div class="preview"><img src=${direct.full} alt=${asset.title} /></div>`;
  if (direct) return html`<div class="preview"><iframe src=${direct.embed} title=${asset.title} allow="autoplay; fullscreen" allowfullscreen></iframe></div>`;
  if (url && kind === 'image') return html`<div class="preview"><img src=${url} alt=${asset.title} /></div>`;
  if (url && kind === 'video') return html`<div class="preview"><video src=${url} controls playsinline preload="metadata"></video></div>`;
  if (url && kind === 'audio') return html`<div class="preview preview-pad"><audio src=${url} controls></audio></div>`;
  if (url && asset.mime_type === 'application/pdf') return html`<div class="preview"><iframe src=${url} title=${asset.title}></iframe></div>`;
  return html`<div class="preview preview-pad"><div class="thumb-ph big">
    <${Icon} name=${MEDIA[kind]?.icon || 'file'} size=${40} />
    <span>${url === undefined ? 'Loading preview…' : url ? 'No preview for this file type — use Download.' : 'No file available to preview.'}</span>
  </div></div>`;
}

export async function downloadAsset(asset) {
  try {
    const url = await api.downloadUrl(asset.storage_path, asset.file_name);
    const a = Object.assign(document.createElement('a'), { href: url, download: asset.file_name || '' });
    if (api.mode === 'google') a.target = '_blank'; // Drive shows its own download page for big files
    document.body.append(a); a.click(); a.remove();
  } catch (e) { toastError(e); }
}

// ── Storage limit warning (shown from 80% full; uploads stop at 100%) ─────
export function StorageWarning({ storage, settingsHref = '#/settings', print = false }) {
  if (!storage || !storage.limit) return null;
  const ratio = storage.used / storage.limit;
  if (ratio < 0.8) return null;
  const full = ratio >= 1;
  const nums = `${fmtGB(storage.used)} of ${fmtGB(storage.limit)}`;
  const fix = html`Delete old files or raise the limit in <a href=${settingsHref}>Settings</a>.`;
  let text;
  if (print) text = full
    ? html`<b>Storage is full (${nums}).</b> Customers can't attach files to new orders until space is freed in the Creative Hub (Settings → Storage).`
    : html`<b>Storage is ${Math.round(ratio * 100)}% full (${nums}).</b> When it's full, customers won't be able to attach files to orders.`;
  else text = full
    ? html`<b>Storage is full (${nums}).</b> New uploads are paused — including creator links and print order files. ${fix}`
    : html`<b>Storage is ${Math.round(ratio * 100)}% full (${nums}).</b> New uploads stop at ${fmtGB(storage.limit)}. ${fix}`;
  return html`<div class=${'storage-banner' + (full ? ' full' : '')} role="status"><${Icon} name="alert" size=${16} /><span>${text}</span></div>`;
}

// ── Drag-and-drop file picker ─────────────────────────────────────────────
export function Dropzone({ onFiles, multiple = true, accept, children }) {
  const [over, setOver] = useState(false);
  const input = useRef();
  const pick = () => input.current.click();
  return html`<div class=${'dropzone' + (over ? ' over' : '')} role="button" tabindex="0"
      onClick=${pick}
      onKeyDown=${(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick())}
      onDragOver=${(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave=${() => setOver(false)}
      onDrop=${(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); }}>
    <input ref=${input} type="file" hidden multiple=${multiple} accept=${accept}
      onChange=${(e) => { onFiles([...e.target.files]); e.target.value = ''; }} />
    ${children}
  </div>`;
}

export function Progress({ value, tone }) {
  return html`<div class=${'progress' + (tone ? ' progress-' + tone : '')} role="progressbar" aria-valuenow=${Math.round(value * 100)} aria-valuemin="0" aria-valuemax="100">
    <div style=${{ width: Math.round(value * 100) + '%' }}></div></div>`;
}

// ── Forms ─────────────────────────────────────────────────────────────────
export function Field({ label, hint, children, wide }) {
  return html`<label class=${'field' + (wide ? ' field-wide' : '')}>
    <span class="field-label">${label}</span>${children}${hint && html`<span class="field-hint">${hint}</span>`}
  </label>`;
}

export function SeasonSelect({ value, onChange, allowAll, placeholder }) {
  const { seasons } = useStore();
  return html`<select value=${value ?? ''} onChange=${(e) => onChange(e.target.value)}>
    ${allowAll && html`<option value="">${placeholder || 'All seasons'}</option>`}
    <option value=${allowAll ? 'none' : ''}>Evergreen (no season)</option>
    ${seasons.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
  </select>`;
}

export function TalentSelect({ value, onChange, placeholder = 'No talent' }) {
  const { talents } = useStore();
  const sorted = [...talents].sort((a, b) => a.name.localeCompare(b.name));
  return html`<select value=${value ?? ''} onChange=${(e) => onChange(e.target.value)}>
    <option value="">${placeholder}</option>
    ${sorted.map((t) => html`<option value=${t.id}>${t.name}${t.handle ? ' · ' + t.handle : ''}</option>`)}
  </select>`;
}

// Pick several options by tapping chips (e.g. platforms, languages).
export function MultiChips({ options, value = [], onChange }) {
  const all = [...new Set([...options, ...value])];
  return html`<div class="chip-picker">
    ${all.map((o) => {
      const on = value.includes(o);
      return html`<button type="button" key=${o} class=${'chip' + (on ? ' on' : '')} aria-pressed=${on}
        onClick=${() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>${on && html`<${Icon} name="check" size=${12} />`}${o}</button>`;
    })}
  </div>`;
}

export function Tabs({ items, value, onChange }) {
  return html`<div class="tabs" role="tablist">
    ${items.map((it) => html`<button role="tab" aria-selected=${value === it.id} class=${'tab' + (value === it.id ? ' active' : '')}
        onClick=${() => onChange(it.id)}>
      ${it.label}${it.count != null && html`<span class="tab-count">${it.count}</span>`}
    </button>`)}
  </div>`;
}

export function Empty({ icon = 'inbox', title, children }) {
  return html`<div class="empty"><${Icon} name=${icon} size=${32} /><h3>${title}</h3>${children && html`<p>${children}</p>`}</div>`;
}

export function PageHead({ title, sub, children, back }) {
  return html`<div class="page-head">
    <div>
      ${back && html`<a class="back-link" href=${back.href}><${Icon} name="back" size=${16} />${back.label}</a>`}
      <h1>${title}</h1>${sub && html`<p class="page-sub">${sub}</p>`}
    </div>
    ${children && html`<div class="page-actions">${children}</div>`}
  </div>`;
}

// ── "Install app" (add to home screen) ────────────────────────────────────
let installPrompt = null; // Chrome / Edge / Android give us a one-tap install prompt
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; dispatchEvent(new Event('gig-install')); });
addEventListener('appinstalled', () => { installPrompt = null; dispatchEvent(new Event('gig-install')); });
export const isInstalledApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let showInstallHelp = null;
export function InstallButton({ appName }) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); addEventListener('gig-install', f); return () => removeEventListener('gig-install', f); }, []);
  if (isInstalledApp()) return null;
  const install = async () => {
    if (!installPrompt) return showInstallHelp?.(appName);
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice.catch(() => ({}));
    installPrompt = null;
    force((n) => n + 1);
    if (outcome === 'accepted') toast(`${appName} installed — find it on your home screen or in your apps.`);
  };
  return html`<button class="nav-item install-btn" onClick=${install}><${Icon} name="download" /><span>Install app</span></button>`;
}

// Rendered once at the top of the page (not inside the sidebar, so nothing can cover it).
export function InstallHelpHost() {
  const [appName, setAppName] = useState(null);
  showInstallHelp = setAppName;
  if (!appName) return null;
  const close = () => setAppName(null);
  return html`<${Modal} title=${'Install ' + appName} size="sm" onClose=${close}
      footer=${html`<button class="btn btn-primary" onClick=${close}>Got it</button>`}>
    <div class="install-help">
      <p>Put <b>${appName}</b> on your home screen — it opens full-screen like a normal app. No app store needed.</p>
      <div class=${'install-way' + (isIPhone() ? ' first' : '')}><b>iPhone / iPad</b> (use Safari)
        <ol><li>Tap the <b>Share</b> button <span class="kbd">⬆︎</span> at the bottom of Safari.</li>
            <li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li></ol></div>
      <div class="install-way"><b>Android</b> (use Chrome)
        <ol><li>Tap the <b>⋮</b> menu at the top right.</li><li>Tap <b>Install app</b> (or <b>Add to Home screen</b>).</li></ol></div>
      <div class="install-way"><b>Computer</b>
        <ol><li><b>Chrome / Edge:</b> click the install icon at the right of the address bar.</li>
            <li><b>Safari (Mac):</b> File → <b>Add to Dock</b>.</li></ol></div>
    </div>
  <//>`;
}
