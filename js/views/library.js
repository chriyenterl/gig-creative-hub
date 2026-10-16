import { html, useState, useMemo, useEffect } from '../lib.js';
import { useStore, openAsset, updateRows, deleteAssets, api, talentById, seasonById, getState, reload } from '../store.js';
import { go, CATEGORIES, ASSET_STATUS, MEDIA, fmtBytes, fmtDate, downloadCSV, categoryLabel, today, CHANNELS } from '../util.js';
import {
  Icon, PageHead, Tabs, MediaThumb, useSignedUrls, StatusPill, UsagePill, SeasonTag, SeasonSelect, TalentSelect,
  Empty, Modal, Field, confirmDialog, toast, toastError,
} from '../ui.js';
import { UploadDialog } from './upload-dialog.js';

const PAGE = 60;

export function filterAssets(assets, q) {
  const text = (q.q || '').trim().toLowerCase();
  let rows = assets.filter((a) => {
    if (q.cat && a.category !== q.cat) return false;
    if (q.type && a.media_type !== q.type) return false;
    if (q.season === 'none' ? a.season_id : q.season && a.season_id !== q.season) return false;
    if (q.status && a.status !== q.status) return false;
    if (q.usage === 'used' && !(a.use_count > 0)) return false;
    if (q.usage === 'unused' && a.use_count > 0) return false;
    if (q.talent && a.talent_id !== q.talent) return false;
    if (q.tag && !(a.tags || []).includes(q.tag)) return false;
    if (text) {
      const hay = [a.title, a.description, a.file_name, a.uploaded_by, talentById(a.talent_id)?.name, ...(a.tags || [])]
        .join(' ').toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
  const by = {
    old: (a, b) => (a.created_at > b.created_at ? 1 : -1),
    most: (a, b) => b.use_count - a.use_count,
    least: (a, b) => a.use_count - b.use_count,
    az: (a, b) => a.title.localeCompare(b.title),
  }[q.sort] || ((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return rows.sort(by);
}

// Log that one or more items were used somewhere.
export function UsageDialog({ assets, onClose }) {
  const [channel, setChannel] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      for (const a of assets) await api.insert('asset_usage', { asset_id: a.id, channel: channel || null, used_on: date, note: note.trim() || null, created_by: getState().user?.email || getState().user?.name });
      await reload('assets'); // the database recalculates the usage counts
      toast(assets.length === 1 ? 'Marked as used.' : `${assets.length} items marked as used.`);
      onClose();
    } catch (e) { toastError(e); setBusy(false); }
  };
  return html`<${Modal} title=${assets.length === 1 ? 'Mark as used' : `Mark ${assets.length} items as used`} size="sm" onClose=${onClose}
    footer=${html`<button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn btn-primary" disabled=${busy} onClick=${save}>Save</button>`}>
    <div class="form-grid">
      <${Field} label="Where was it used?">
        <input list="channels" value=${channel} placeholder="e.g. Instagram post" onInput=${(e) => setChannel(e.target.value)} />
        <datalist id="channels">${CHANNELS.map((c) => html`<option value=${c} />`)}</datalist>
      <//>
      <${Field} label="Date"><input type="date" value=${date} onInput=${(e) => setDate(e.target.value)} /><//>
      <${Field} label="Note (optional)" wide><input value=${note} placeholder="Campaign name, post link…" onInput=${(e) => setNote(e.target.value)} /><//>
    </div>
  <//>`;
}

function BulkBar({ selected, clear }) {
  const [usage, setUsage] = useState(false);
  const { assets } = useStore();
  const rows = assets.filter((a) => selected.has(a.id));
  const ids = rows.map((a) => a.id);
  const apply = async (patch, msg) => {
    try { await updateRows('assets', ids, patch); toast(msg); } catch (e) { toastError(e); }
  };
  // Dropdowns act like menus: pick an option → apply → reset.
  const pick = (fn) => (e) => { const v = e.target.value; e.target.value = ''; if (v) fn(v); };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Delete files?', message: `Permanently delete ${rows.length} item(s) and their files? This can't be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    try { await deleteAssets(rows); toast('Deleted.'); clear(); } catch (e) { toastError(e); }
  };
  return html`<div class="bulk-bar">
    <b>${rows.length} selected</b>
    <select value="" onChange=${pick((v) => apply({ status: v, reviewed_at: new Date().toISOString() }, 'Status updated.'))}>
      <option value="">Set status…</option>
      ${Object.entries(ASSET_STATUS).map(([id, s]) => html`<option value=${id}>${s.label}</option>`)}
    </select>
    <select value="" onChange=${pick((v) => apply({ season_id: v === 'none' ? null : v }, 'Season updated.'))}>
      <option value="">Move to season…</option>
      <option value="none">Evergreen (no season)</option>
      ${getState().seasons.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
    </select>
    <select value="" onChange=${pick((v) => apply({ category: v }, 'Moved.'))}>
      <option value="">File under…</option>
      ${CATEGORIES.map((c) => html`<option value=${c.id}>${c.label}</option>`)}
    </select>
    <button class="btn btn-sm" onClick=${() => setUsage(true)}><${Icon} name="check" size=${14} />Mark as used</button>
    <button class="btn btn-sm btn-ghost-danger" onClick=${remove}><${Icon} name="trash" size=${14} />Delete</button>
    <span class="spacer"></span>
    <button class="btn btn-sm btn-ghost" onClick=${clear}>Clear selection</button>
    ${usage && html`<${UsageDialog} assets=${rows} onClose=${() => setUsage(false)} />`}
  </div>`;
}

export function AssetCard({ asset, url, selecting, selected, onToggle }) {
  const talent = talentById(asset.talent_id);
  const click = () => (selecting ? onToggle(asset.id) : openAsset(asset.id));
  return html`<div class=${'asset-card' + (selected ? ' selected' : '')} role="button" tabindex="0"
      onClick=${click} onKeyDown=${(e) => e.key === 'Enter' && click()}>
    <${MediaThumb} asset=${asset} url=${url} />
    <span class="thumb-status"><${StatusPill} status=${asset.status} /></span>
    ${selecting && html`<span class=${'check' + (selected ? ' on' : '')}><${Icon} name="check" size=${14} /></span>`}
    <div class="asset-meta">
      <div class="asset-title" title=${asset.title}>${asset.title}</div>
      <div class="asset-sub"><${SeasonTag} season=${seasonById(asset.season_id)} />${talent && html`<span>· ${talent.name}</span>`}</div>
      <div class="asset-pills"><${UsagePill} asset=${asset} /></div>
    </div>
  </div>`;
}

export function Library({ query }) {
  const s = useStore();
  const qKey = JSON.stringify(query);
  const set = (patch) => go('library', { ...query, ...patch }, { replace: true });
  const filtered = useMemo(() => filterAssets(s.assets, query), [s.assets, s.talents, qKey]);
  const [limit, setLimit] = useState(PAGE);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [uploading, setUploading] = useState(false);
  useEffect(() => setLimit(PAGE), [qKey]);

  const visible = filtered.slice(0, limit);
  const urls = useSignedUrls(visible.map((a) => a.storage_path));

  const inCat = s.assets.filter((a) => !query.cat || a.category === query.cat);
  const tagCounts = {};
  inCat.forEach((a) => (a.tags || []).forEach((t) => (tagCounts[t] = (tagCounts[t] || 0) + 1)));
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 14);
  const catCount = (c) => s.assets.filter((a) => !c || a.category === c).length;
  const activeFilters = ['q', 'type', 'season', 'status', 'usage', 'talent', 'tag'].filter((k) => query[k]).length;

  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };

  const exportCsv = () => downloadCSV(`content-${today()}.csv`, filtered, [
    { label: 'Title', value: 'title' },
    { label: 'Category', value: (a) => categoryLabel(a.category) },
    { label: 'Type', value: (a) => MEDIA[a.media_type]?.label },
    { label: 'Season', value: (a) => seasonById(a.season_id)?.name || 'Evergreen' },
    { label: 'Status', value: (a) => ASSET_STATUS[a.status]?.label },
    { label: 'Times used', value: 'use_count' },
    { label: 'Last used', value: 'last_used_on' },
    { label: 'Talent', value: (a) => talentById(a.talent_id)?.name },
    { label: 'Tags', value: 'tags' },
    { label: 'File name', value: 'file_name' },
    { label: 'Size', value: (a) => fmtBytes(a.size_bytes) },
    { label: 'Uploaded', value: (a) => fmtDate(a.created_at) },
    { label: 'Uploaded by', value: 'uploaded_by' },
  ]);

  const cat = CATEGORIES.find((c) => c.id === query.cat);
  return html`
    <${PageHead} title=${cat ? cat.label : 'Content library'} sub=${cat ? cat.hint : 'Every photo, video and file in one place — search, filter, download and reuse.'}>
      <button class="btn btn-ghost" onClick=${exportCsv}><${Icon} name="download" size=${16} />Export list</button>
      <button class=${'btn' + (selecting ? ' btn-active' : '')} onClick=${() => (selecting ? stopSelecting() : setSelecting(true))}>
        <${Icon} name="select" size=${16} />${selecting ? 'Done' : 'Select'}
      </button>
      <button class="btn btn-primary" onClick=${() => setUploading(true)}><${Icon} name="upload" size=${16} />Upload</button>
    <//>

    <${Tabs} value=${query.cat || ''} onChange=${(c) => set({ cat: c, tag: '' })} items=${[
      { id: '', label: 'All', count: catCount('') },
      ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, count: catCount(c.id) })),
    ]} />

    <div class="filters">
      <label class="search">
        <${Icon} name="search" size=${16} />
        <input type="search" placeholder="Search title, talent, tag…" value=${query.q || ''} onInput=${(e) => set({ q: e.target.value })} />
      </label>
      <select value=${query.type || ''} onChange=${(e) => set({ type: e.target.value })} aria-label="Type">
        <option value="">All types</option>
        ${Object.entries(MEDIA).map(([id, m]) => html`<option value=${id}>${m.plural}</option>`)}
      </select>
      <${SeasonSelect} allowAll value=${query.season || ''} onChange=${(v) => set({ season: v })} />
      <select value=${query.status || ''} onChange=${(e) => set({ status: e.target.value })} aria-label="Status">
        <option value="">Any status</option>
        ${Object.entries(ASSET_STATUS).map(([id, st]) => html`<option value=${id}>${st.label}</option>`)}
      </select>
      <select value=${query.usage || ''} onChange=${(e) => set({ usage: e.target.value })} aria-label="Usage">
        <option value="">Used or not</option>
        <option value="unused">Not used yet</option>
        <option value="used">Already used</option>
      </select>
      <${TalentSelect} value=${query.talent || ''} onChange=${(v) => set({ talent: v })} placeholder="All talents" />
      <select value=${query.sort || ''} onChange=${(e) => set({ sort: e.target.value })} aria-label="Sort">
        <option value="">Newest first</option>
        <option value="old">Oldest first</option>
        <option value="most">Most used</option>
        <option value="least">Least used</option>
        <option value="az">Title A–Z</option>
      </select>
    </div>

    ${topTags.length > 0 && html`<div class="chips">
      <${Icon} name="tag" size=${14} />
      ${topTags.map(([t, n]) => html`<button class=${'chip' + (query.tag === t ? ' on' : '')} onClick=${() => set({ tag: query.tag === t ? '' : t })}>${t} <span>${n}</span></button>`)}
    </div>`}

    <div class="result-line">
      <span>${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}</span>
      ${activeFilters > 0 && html`<button class="link" onClick=${() => go('library', { cat: query.cat }, { replace: true })}>Clear filters</button>`}
      ${selecting && html`<button class="link" onClick=${() => setSelected(new Set(filtered.map((a) => a.id)))}>Select all ${filtered.length}</button>`}
    </div>

    ${selecting && selected.size > 0 && html`<${BulkBar} selected=${selected} clear=${stopSelecting} />`}

    ${visible.length ? html`<div class="asset-grid">
        ${visible.map((a) => html`<${AssetCard} key=${a.id} asset=${a} url=${urls[a.storage_path]}
          selecting=${selecting} selected=${selected.has(a.id)} onToggle=${toggle} />`)}
      </div>
      ${filtered.length > limit && html`<div class="more"><button class="btn" onClick=${() => setLimit(limit + PAGE)}>Show more (${filtered.length - limit} left)</button></div>`}`
    : html`<${Empty} icon="image" title="Nothing matches">${s.assets.length ? 'Try clearing some filters.' : 'Upload your first files to get started.'}<//>`}

    ${uploading && html`<${UploadDialog} onClose=${() => setUploading(false)}
      defaults=${{ category: query.cat, season_id: query.season && query.season !== 'none' ? query.season : '', talent_id: query.talent }} />`}`;
}
