import { html, useState, useMemo } from '../lib.js';
import { useStore, insertRow, updateRow, deleteAndUnlink } from '../store.js';
import {
  go, hrefFor, TALENT_STATUS, PLATFORMS, TIERS, TALENT_TYPES, LANGUAGES, fmtNum, fmtDate, timeAgo, parseTags, downloadCSV, today,
  talentStatus, linkState, normalizePlatforms, joinList, handleFromUrl, platformFromUrl, parseFollowers,
} from '../util.js';
import { Icon, PageHead, Tabs, Modal, Field, Empty, Pill, MultiChips, useSignedUrls, confirmDialog, toast, toastError } from '../ui.js';
import { AssetCard } from './library.js';
import { LinkForm } from './links.js';
import { UploadDialog } from './upload-dialog.js';
import { TalentImport } from './talent-import.js';

const blank = {
  name: '', handle: '', platforms: [], profile_url: '', followers: '', engagement_rate: '', niche: '', location: '',
  email: '', phone: '', rate: '', status: 'prospect', tags: '', notes: '', brand: '', tier: '', talent_type: '', languages: [],
};
const distinct = (rows, key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort();

export function TalentForm({ talent, onClose }) {
  const { talents } = useStore();
  const [d, setD] = useState(() => (talent ? {
    ...blank, ...Object.fromEntries(Object.entries(talent).map(([k, v]) => [k, v ?? ''])),
    tags: (talent.tags || []).join(', '), platforms: normalizePlatforms(talent.platform), languages: talent.languages || [],
  } : blank));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  // Paste a profile link → fill in the handle and platform automatically.
  const fromProfile = () => setD((x) => ({
    ...x,
    handle: x.handle || handleFromUrl(x.profile_url) || '',
    platforms: x.platforms.length ? x.platforms : [platformFromUrl(x.profile_url)].filter(Boolean),
  }));
  const save = async () => {
    if (!d.name.trim()) return toast('Name is required.', 'error');
    setBusy(true);
    const row = {
      name: d.name.trim(), handle: d.handle.trim() || null, platform: joinList(d.platforms) || null, profile_url: d.profile_url.trim() || null,
      followers: d.followers === '' ? null : parseFollowers(d.followers),
      engagement_rate: d.engagement_rate === '' ? null : Number(String(d.engagement_rate).replace('%', '')) || null,
      niche: d.niche.trim() || null, location: d.location.trim() || null, email: d.email.trim() || null, phone: d.phone.trim() || null,
      rate: d.rate.trim() || null, status: d.status, tags: parseTags(d.tags), notes: d.notes.trim() || null,
      brand: d.brand.trim() || null, tier: d.tier.trim() || null, talent_type: d.talent_type.trim() || null, languages: d.languages,
    };
    try {
      const saved = talent ? await updateRow('talents', talent.id, row) : await insertRow('talents', row);
      toast('Saved.');
      onClose(saved);
    } catch (e) { toastError(e); setBusy(false); }
  };
  return html`<${Modal} title=${talent ? 'Edit talent' : 'Add a talent'} size="lg" onClose=${() => onClose()}
    footer=${html`<button class="btn" onClick=${() => onClose()}>Cancel</button><button class="btn btn-primary" disabled=${busy} onClick=${save}>Save</button>`}>
    <div class="form-grid">
      <${Field} label="Name *"><input value=${d.name} onInput=${set('name')} autofocus /><//>
      <${Field} label="Status">
        <select value=${d.status} onChange=${set('status')}>${TALENT_STATUS.map((s) => html`<option value=${s.id}>${s.label}</option>`)}</select>
      <//>
      <${Field} label="Profile link" hint="Paste it and we fill in the handle & platform" wide>
        <input type="url" value=${d.profile_url} onInput=${set('profile_url')} onBlur=${fromProfile} placeholder="https://www.tiktok.com/@…" />
      <//>
      <${Field} label="Handle"><input value=${d.handle} onInput=${set('handle')} placeholder="@handle" /><//>
      <${Field} label="Followers"><input inputmode="numeric" value=${d.followers} onInput=${set('followers')} placeholder="e.g. 12000 or 12k" /><//>
      <${Field} label="Platforms" wide><${MultiChips} options=${PLATFORMS} value=${d.platforms} onChange=${set('platforms')} /><//>
      <${Field} label="Tier">
        <input list="tier-options" value=${d.tier} onInput=${set('tier')} placeholder="e.g. Micro KOL" />
        <datalist id="tier-options">${[...new Set([...TIERS, ...distinct(talents, 'tier')])].map((x) => html`<option value=${x} />`)}</datalist>
      <//>
      <${Field} label="Type">
        <input list="type-options" value=${d.talent_type} onInput=${set('talent_type')} placeholder="e.g. Creator" />
        <datalist id="type-options">${[...new Set([...TALENT_TYPES, ...distinct(talents, 'talent_type')])].map((x) => html`<option value=${x} />`)}</datalist>
      <//>
      <${Field} label="Brand">
        <input list="brand-options" value=${d.brand} onInput=${set('brand')} placeholder="e.g. Noms" />
        <datalist id="brand-options">${distinct(talents, 'brand').map((x) => html`<option value=${x} />`)}</datalist>
      <//>
      <${Field} label="Engagement rate (%)"><input inputmode="decimal" value=${d.engagement_rate} onInput=${set('engagement_rate')} placeholder="e.g. 4.5" /><//>
      <${Field} label="Languages" wide><${MultiChips} options=${LANGUAGES} value=${d.languages} onChange=${set('languages')} /><//>
      <${Field} label="Niche / content"><input value=${d.niche} onInput=${set('niche')} placeholder="Food reviews, beauty, tech…" /><//>
      <${Field} label="Location"><input value=${d.location} onInput=${set('location')} placeholder="e.g. Kota Kinabalu" /><//>
      <${Field} label="Email"><input type="email" value=${d.email} onInput=${set('email')} /><//>
      <${Field} label="Phone / WhatsApp"><input value=${d.phone} onInput=${set('phone')} /><//>
      <${Field} label="Rate"><input value=${d.rate} onInput=${set('rate')} placeholder="e.g. RM500 per video" /><//>
      <${Field} label="Tags" hint="Comma separated"><input value=${d.tags} onInput=${set('tags')} /><//>
      <${Field} label="Notes" wide><textarea rows="4" value=${d.notes} onInput=${set('notes')}></textarea><//>
    </div>
  <//>`;
}

// Kanban-style board: one column per status, drag a card to move it.
function Board({ rows, contentCount }) {
  const [over, setOver] = useState(null);
  const move = async (t, status) => {
    try { await updateRow('talents', t.id, { status }); toast(`${t.name}: ${talentStatus(status).label}`); } catch (e) { toastError(e); }
  };
  return html`<div class="board">
    ${TALENT_STATUS.map((s) => {
      const items = rows.filter((t) => t.status === s.id);
      return html`<section key=${s.id} class=${'board-col' + (over === s.id ? ' over' : '')}
          onDragOver=${(e) => { e.preventDefault(); if (over !== s.id) setOver(s.id); }}
          onDragLeave=${(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
          onDrop=${(e) => {
            e.preventDefault(); setOver(null);
            const t = rows.find((x) => x.id === e.dataTransfer.getData('text/plain'));
            if (t && t.status !== s.id) move(t, s.id);
          }}>
        <header class="board-head"><span class=${'status-dot tone-' + s.tone}></span><b>${s.label}</b><span class="tab-count">${items.length}</span></header>
        <div class="board-cards">
          ${items.map((t) => html`<article key=${t.id} class="board-card" draggable="true" tabindex="0"
              onDragStart=${(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }}
              onClick=${() => go('talents/' + t.id)} onKeyDown=${(e) => e.key === 'Enter' && go('talents/' + t.id)}>
            <div class="board-name">${t.name}</div>
            ${t.handle && html`<div class="muted small">${t.handle}</div>`}
            <div class="board-meta">
              ${normalizePlatforms(t.platform).map((p) => html`<span class="mini-pill">${p}</span>`)}
              ${t.tier && html`<span class="mini-pill mini-accent">${t.tier}</span>`}
            </div>
            <div class="board-foot muted small">
              <span>${t.followers ? fmtNum(t.followers) + ' followers' : ''}</span>
              ${contentCount[t.id] > 0 && html`<span><${Icon} name="image" size=${12} /> ${contentCount[t.id]}</span>`}
            </div>
          </article>`)}
          ${!items.length && html`<div class="board-empty">Drop here</div>`}
        </div>
      </section>`;
    })}
  </div>`;
}

export function Talents({ query }) {
  const { talents, assets } = useStore();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const view = query.view === 'board' ? 'board' : 'table';
  const status = view === 'board' ? '' : query.status || '';
  const set = (patch) => go('talents', { ...query, ...patch }, { replace: true });
  const counts = Object.fromEntries(TALENT_STATUS.map((s) => [s.id, talents.filter((t) => t.status === s.id).length]));
  const contentCount = useMemo(() => {
    const m = {};
    assets.forEach((a) => a.talent_id && (m[a.talent_id] = (m[a.talent_id] || 0) + 1));
    return m;
  }, [assets]);
  const tiers = distinct(talents, 'tier');
  const brands = distinct(talents, 'brand');
  const langs = [...new Set(talents.flatMap((t) => t.languages || []))].sort();

  const text = (query.q || '').toLowerCase();
  const rows = talents
    .filter((t) => !status || t.status === status)
    .filter((t) => !query.platform || normalizePlatforms(t.platform).includes(query.platform))
    .filter((t) => !query.tier || t.tier === query.tier)
    .filter((t) => !query.brand || t.brand === query.brand)
    .filter((t) => !query.lang || (t.languages || []).includes(query.lang))
    .filter((t) => !text || [t.name, t.handle, t.niche, t.location, t.email, t.notes, t.brand, t.tier, ...(t.tags || [])].join(' ').toLowerCase().includes(text))
    .sort((a, b) => (query.sort === 'followers' ? (b.followers || 0) - (a.followers || 0)
      : query.sort === 'name' ? a.name.localeCompare(b.name)
      : a.updated_at < b.updated_at ? 1 : -1));

  const quickStatus = async (t, s) => {
    try { await updateRow('talents', t.id, { status: s }); toast(`${t.name}: ${talentStatus(s).label}`); } catch (e) { toastError(e); }
  };
  const exportCsv = () => downloadCSV(`talents-${today()}.csv`, rows, [
    { label: 'Name', value: 'name' }, { label: 'Handle', value: 'handle' }, { label: 'Platforms', value: 'platform' },
    { label: 'Profile', value: 'profile_url' }, { label: 'Followers', value: 'followers' }, { label: 'Engagement %', value: 'engagement_rate' },
    { label: 'Tier', value: 'tier' }, { label: 'Type', value: 'talent_type' }, { label: 'Brand', value: 'brand' }, { label: 'Languages', value: 'languages' },
    { label: 'Niche', value: 'niche' }, { label: 'Location', value: 'location' }, { label: 'Email', value: 'email' }, { label: 'Phone', value: 'phone' },
    { label: 'Rate', value: 'rate' }, { label: 'Status', value: (t) => talentStatus(t.status).label }, { label: 'Tags', value: 'tags' },
    { label: 'Content items', value: (t) => contentCount[t.id] || 0 }, { label: 'Notes', value: 'notes' },
  ]);

  return html`
    <${PageHead} title="Talents" sub="Scout influencers and creators, track them from first look to delivered content — and whether they're approved to go ahead.">
      <button class="btn btn-ghost" onClick=${exportCsv}><${Icon} name="download" size=${16} />Export</button>
      <button class="btn" onClick=${() => setImporting(true)}><${Icon} name="upload" size=${16} />Import from Notion / CSV</button>
      <button class="btn btn-primary" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${16} />Add talent</button>
    <//>

    <div class="view-row">
      <div class="segmented-toggle" role="tablist" aria-label="View">
        <button role="tab" aria-selected=${view === 'table'} class=${view === 'table' ? 'on' : ''} onClick=${() => set({ view: '' })}><${Icon} name="menu" size=${15} />Table</button>
        <button role="tab" aria-selected=${view === 'board'} class=${view === 'board' ? 'on' : ''} onClick=${() => set({ view: 'board', status: '' })}><${Icon} name="grid" size=${15} />Board</button>
      </div>
      <span class="muted small">${talents.length} talents${view === 'board' ? ' · drag a card to change its status' : ''}</span>
    </div>

    ${view === 'table' && html`<${Tabs} value=${status} onChange=${(v) => set({ status: v })} items=${[
      { id: '', label: 'All', count: talents.length },
      ...TALENT_STATUS.map((s) => ({ id: s.id, label: s.label, count: counts[s.id] })),
    ]} />`}
    <div class="filters">
      <label class="search"><${Icon} name="search" size=${16} />
        <input type="search" placeholder="Search name, handle, niche, notes…" value=${query.q || ''} onInput=${(e) => set({ q: e.target.value })} />
      </label>
      <select value=${query.platform || ''} onChange=${(e) => set({ platform: e.target.value })} aria-label="Platform">
        <option value="">All platforms</option>${PLATFORMS.map((p) => html`<option>${p}</option>`)}
      </select>
      ${tiers.length > 0 && html`<select value=${query.tier || ''} onChange=${(e) => set({ tier: e.target.value })} aria-label="Tier">
        <option value="">All tiers</option>${tiers.map((x) => html`<option>${x}</option>`)}</select>`}
      ${langs.length > 0 && html`<select value=${query.lang || ''} onChange=${(e) => set({ lang: e.target.value })} aria-label="Language">
        <option value="">All languages</option>${langs.map((x) => html`<option>${x}</option>`)}</select>`}
      ${brands.length > 1 && html`<select value=${query.brand || ''} onChange=${(e) => set({ brand: e.target.value })} aria-label="Brand">
        <option value="">All brands</option>${brands.map((x) => html`<option>${x}</option>`)}</select>`}
      <select value=${query.sort || ''} onChange=${(e) => set({ sort: e.target.value })} aria-label="Sort">
        <option value="">Recently updated</option><option value="followers">Most followers</option><option value="name">Name A–Z</option>
      </select>
    </div>

    ${!talents.length ? html`<${Empty} icon="users" title="No talents yet">Add the first influencer you're looking at — or import your list from Notion.<//>`
      : view === 'board' ? html`<${Board} rows=${rows} contentCount=${contentCount} />`
      : rows.length ? html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Platforms</th><th class="num">Followers</th><th>Tier</th><th>Language</th><th>Status</th><th class="num">Content</th><th>Updated</th></tr></thead>
      <tbody>${rows.map((t) => html`<tr key=${t.id} onClick=${(e) => e.target.tagName !== 'SELECT' && go('talents/' + t.id)}>
        <td data-label="Name"><b>${t.name}</b>${(t.handle || t.niche) && html`<div class="muted small">${[t.handle, t.niche].filter(Boolean).join(' · ')}</div>`}</td>
        <td data-label="Platforms">${normalizePlatforms(t.platform).join(', ') || '—'}</td>
        <td data-label="Followers" class="num">${t.followers ? fmtNum(t.followers) : '—'}</td>
        <td data-label="Tier">${t.tier ? html`<span class="mini-pill mini-accent">${t.tier}</span>` : '—'}</td>
        <td data-label="Language">${(t.languages || []).join(', ') || '—'}</td>
        <td data-label="Status" onClick=${(e) => e.stopPropagation()}>
          <select class=${'status-select tone-' + talentStatus(t.status).tone} value=${t.status} onChange=${(e) => quickStatus(t, e.target.value)} aria-label="Status">
            ${TALENT_STATUS.map((s) => html`<option value=${s.id}>${s.label}</option>`)}
          </select>
        </td>
        <td data-label="Content" class="num">${contentCount[t.id] || 0}</td>
        <td data-label="Updated" class="muted">${timeAgo(t.updated_at)}</td>
      </tr>`)}</tbody>
    </table></div>` : html`<${Empty} icon="users" title="No talents match">Try a different filter.<//>`}
    ${adding && html`<${TalentForm} onClose=${(saved) => { setAdding(false); if (saved) go('talents/' + saved.id); }} />`}
    ${importing && html`<${TalentImport} onClose=${() => setImporting(false)} />`}`;
}

export function TalentDetail({ id }) {
  const { talents, assets, upload_links } = useStore();
  const t = talents.find((x) => x.id === id);
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const content = assets.filter((a) => a.talent_id === id);
  const urls = useSignedUrls(content.slice(0, 24).map((a) => a.storage_path));
  if (!t) return html`<${Empty} icon="users" title="Talent not found"><a class="link" href=${hrefFor('talents')}>Back to talents</a><//>`;
  const links = upload_links.filter((l) => l.talent_id === id);

  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete ${t.name}?`, message: 'Their profile is removed. Their content stays in the library (just no longer linked to them).', confirmLabel: 'Delete', danger: true }))) return;
    try { await deleteAndUnlink('talents', t.id); toast('Deleted.'); go('talents'); } catch (e) { toastError(e); }
  };
  const info = [
    ['Platforms', normalizePlatforms(t.platform).join(', ')], ['Handle', t.handle],
    ['Profile', t.profile_url && html`<a class="link break" href=${t.profile_url} target="_blank" rel="noopener">${t.profile_url.replace(/^https?:\/\//, '')}</a>`],
    ['Followers', t.followers && fmtNum(t.followers)], ['Engagement', t.engagement_rate != null && `${t.engagement_rate}%`],
    ['Tier', t.tier], ['Type', t.talent_type], ['Brand', t.brand], ['Languages', (t.languages || []).join(', ')],
    ['Niche', t.niche], ['Location', t.location],
    ['Email', t.email && html`<a class="link" href=${'mailto:' + t.email}>${t.email}</a>`], ['Phone', t.phone], ['Rate', t.rate],
    ['Added', fmtDate(t.created_at)],
  ].filter(([, v]) => v);

  return html`
    <${PageHead} title=${t.name} sub=${[t.handle, t.tier, t.niche].filter(Boolean).join(' · ')} back=${{ href: hrefFor('talents'), label: 'Talents' }}>
      <button class="btn btn-ghost-danger" onClick=${remove}><${Icon} name="trash" size=${16} />Delete</button>
      <button class="btn" onClick=${() => setEditing(true)}><${Icon} name="edit" size=${16} />Edit</button>
    <//>
    <div class="talent-layout">
      <section class="card">
        <header class="card-head"><h2>Decision</h2></header>
        <div class="status-steps">
          ${TALENT_STATUS.map((s) => html`<button class=${'step tone-' + s.tone + (t.status === s.id ? ' on' : '')} aria-pressed=${t.status === s.id}
            onClick=${() => updateRow('talents', t.id, { status: s.id }).then(() => toast(`Status: ${s.label}`)).catch(toastError)}>${s.label}</button>`)}
        </div>
        <dl class="facts">${info.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
        ${t.tags?.length > 0 && html`<div class="chips">${t.tags.map((x) => html`<span class="chip">${x}</span>`)}</div>`}
        ${t.notes && html`<div class="notes">${t.notes}</div>`}
      </section>

      <section class="card">
        <header class="card-head"><h2>Private upload links</h2>
          <button class="btn btn-sm" onClick=${() => setLinking(true)}><${Icon} name="plus" size=${14} />New link</button></header>
        ${links.length ? html`<ul class="plain-list">${links.map((l) => {
          const st = linkState(l);
          return html`<li key=${l.id}><span><b>${l.label}</b><span class="muted small"> · ${l.upload_count} uploads</span></span>
            <${Pill} tone=${st.tone}>${st.label}<//></li>`;
        })}</ul><a class="link" href=${hrefFor('links')}>Manage links →</a>`
        : html`<p class="muted">No link yet. Create one and send it to ${t.name.split(' ')[0]} — they'll only be able to upload files.</p>`}
      </section>
    </div>

    <div class="section-head">
      <h2>Their content <span class="muted">(${content.length})</span></h2>
      <div class="page-actions">
        ${content.length > 24 && html`<a class="btn btn-ghost" href=${hrefFor('library', { talent: t.id })}>See all in library</a>`}
        <button class="btn" onClick=${() => setUploading(true)}><${Icon} name="upload" size=${16} />Upload for ${t.name.split(' ')[0]}</button>
      </div>
    </div>
    ${content.length ? html`<div class="asset-grid">${content.slice(0, 24).map((a) => html`<${AssetCard} key=${a.id} asset=${a} url=${urls[a.storage_path]} />`)}</div>`
      : html`<${Empty} icon="image" title="No content yet" />`}

    ${editing && html`<${TalentForm} talent=${t} onClose=${() => setEditing(false)} />`}
    ${linking && html`<${LinkForm} defaults=${{ talent_id: t.id, label: t.name }} onClose=${() => setLinking(false)} />`}
    ${uploading && html`<${UploadDialog} defaults=${{ talent_id: t.id }} onClose=${() => setUploading(false)} />`}`;
}
