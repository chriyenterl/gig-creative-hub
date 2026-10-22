// "Choose from library": pick one of the Creative Hub's own photos (e.g. as a video's cover photo).
import { html, useState } from '../lib.js';
import { useStore } from '../store.js';
import { Icon, Modal, MediaThumb, useSignedUrls, SeasonSelect, Empty, toastError } from '../ui.js';
import { CATEGORIES } from '../util.js';
import { coverFromLibrary } from '../previews.js';

const PAGE = 48;

export function PhotoPicker({ onPick, onClose, title = 'Choose a cover photo' }) {
  const { assets } = useStore();
  const [q, setQ] = useState('');
  const [season, setSeason] = useState('');
  const [cat, setCat] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(null);
  const text = q.trim().toLowerCase();
  const photos = assets
    .filter((a) => a.media_type === 'image' && a.storage_path && !a.external_url && a.status !== 'rejected')
    .filter((a) => !cat || a.category === cat)
    .filter((a) => !season || (season === 'none' ? !a.season_id : a.season_id === season))
    .filter((a) => !text || [a.title, a.file_name, a.caption, ...(a.tags || [])].join(' ').toLowerCase().includes(text))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const visible = photos.slice(0, limit);
  const urls = useSignedUrls(visible.filter((a) => !a.thumb_path).map((a) => a.storage_path));

  const choose = async (a) => {
    setBusy(a.id);
    try { onPick(await coverFromLibrary(a)); onClose(); } catch (e) { toastError(e); setBusy(null); }
  };

  return html`<${Modal} title=${title} size="lg" onClose=${() => !busy && onClose()}>
    <div class="filters">
      <label class="search"><${Icon} name="search" size=${16} />
        <input type="search" placeholder="Search photos by title, caption or tag…" value=${q} onInput=${(e) => { setQ(e.target.value); setLimit(PAGE); }} autofocus /></label>
      <select value=${cat} onChange=${(e) => { setCat(e.target.value); setLimit(PAGE); }} aria-label="Section">
        <option value="">All sections</option>${CATEGORIES.map((c) => html`<option value=${c.id}>${c.label}</option>`)}</select>
      <${SeasonSelect} allowAll value=${season} onChange=${(v) => { setSeason(v); setLimit(PAGE); }} />
    </div>
    ${!photos.length ? html`<${Empty} icon="image" title=${assets.some((a) => a.media_type === 'image') ? 'No photos match' : 'No photos in the library yet'} />`
      : html`<div class="picker-grid">${visible.map((a) => html`<button type="button" key=${a.id} class=${'picker-tile' + (busy === a.id ? ' busy' : '')}
          disabled=${!!busy} onClick=${() => choose(a)} title=${a.title}>
          <${MediaThumb} asset=${a} url=${urls[a.storage_path]} />
          <span class="picker-name">${a.title}</span>
          ${busy === a.id && html`<span class="picker-busy"><span class="spinner"></span></span>`}
        </button>`)}</div>
        ${photos.length > limit && html`<div class="more"><button class="btn" onClick=${() => setLimit(limit + PAGE)}>Show more (${photos.length - limit} left)</button></div>`}`}
  <//>`;
}
