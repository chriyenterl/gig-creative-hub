import { html, useState } from '../lib.js';
import { useStore, insertRow, updateRow, deleteAndUnlink } from '../store.js';
import { hrefFor, EVERGREEN, fmtNum } from '../util.js';
import { Icon, PageHead, Modal, Field, confirmDialog, toast, toastError } from '../ui.js';

const SWATCHES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948', '#0b0b0b', '#898781'];

function SeasonForm({ season, onClose }) {
  const { seasons } = useStore();
  const [name, setName] = useState(season?.name || '');
  const [color, setColor] = useState(season?.color || SWATCHES[seasons.length % SWATCHES.length]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return toast('Give the season a name.', 'error');
    setBusy(true);
    try {
      if (season) await updateRow('seasons', season.id, { name: name.trim(), color });
      else await insertRow('seasons', { name: name.trim(), color, sort_order: Math.max(0, ...seasons.map((s) => s.sort_order)) + 1 });
      toast('Saved.');
      onClose();
    } catch (e) { toastError(e); setBusy(false); }
  };
  return html`<${Modal} title=${season ? 'Edit season' : 'New season'} size="sm" onClose=${onClose}
    footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn btn-primary" disabled=${busy} onClick=${save}>Save</button>`}>
    <div class="form-grid">
      <${Field} label="Name" wide><input value=${name} autofocus placeholder="e.g. Chinese New Year 2027" onInput=${(e) => setName(e.target.value)}
        onKeyDown=${(e) => e.key === 'Enter' && save()} /><//>
      <${Field} label="Colour" wide>
        <div class="swatch-pick">
          ${SWATCHES.map((c) => html`<button type="button" class=${'swatch-btn' + (c === color ? ' on' : '')} style=${{ background: c }}
            aria-label=${c} aria-pressed=${c === color} onClick=${() => setColor(c)}></button>`)}
        </div>
      <//>
    </div>
  <//>`;
}

function SeasonCard({ season, rows, evergreen, onEdit, onDelete, onMove, first, last }) {
  const live = rows.filter((a) => a.status !== 'rejected');
  const used = live.filter((a) => a.use_count > 0).length;
  const photos = rows.filter((a) => a.media_type === 'image').length;
  const videos = rows.filter((a) => a.media_type === 'video').length;
  const pct = live.length ? Math.round((used / live.length) * 100) : 0;
  return html`<div class="season-card card">
    <div class="season-stripe" style=${{ background: season.color }}></div>
    <div class="season-top">
      <h3>${evergreen && html`<${Icon} name="leaf" size=${16} />`}${season.name}</h3>
      ${!evergreen && html`<div class="season-tools">
        <button class="icon-btn" data-tip="Move up" disabled=${first} onClick=${() => onMove(-1)}>↑</button>
        <button class="icon-btn" data-tip="Move down" disabled=${last} onClick=${() => onMove(1)}>↓</button>
        <button class="icon-btn" data-tip="Edit" onClick=${onEdit}><${Icon} name="edit" size=${15} /></button>
        <button class="icon-btn" data-tip="Delete" onClick=${onDelete}><${Icon} name="trash" size=${15} /></button>
      </div>`}
    </div>
    ${evergreen && html`<p class="muted small">Regular content that isn't tied to any season.</p>`}
    <div class="season-nums">
      <span><b>${fmtNum(rows.length)}</b> ${rows.length === 1 ? 'item' : 'items'}</span>
      <span><b>${fmtNum(photos)}</b> photos</span>
      <span><b>${fmtNum(videos)}</b> videos</span>
    </div>
    <div class="meter" data-tip=${`${used} used · ${live.length - used} not used yet`}><span class="meter-fill" style=${{ width: pct + '%' }}></span></div>
    <p class="muted small">${used} used · ${live.length - used} not used yet</p>
    <a class="btn btn-block" href=${hrefFor('library', { season: season.id ?? 'none' })}>View content →</a>
  </div>`;
}

export function Seasons() {
  const { seasons, assets } = useStore();
  const [editing, setEditing] = useState(null); // null | 'new' | season
  const sorted = [...seasons].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const remove = async (s) => {
    const n = assets.filter((a) => a.season_id === s.id).length;
    const ok = await confirmDialog({
      title: `Delete “${s.name}”?`,
      message: n ? `${n} item(s) in this season will move to Evergreen. No files are deleted.` : 'This season has no content.',
      confirmLabel: 'Delete season', danger: true,
    });
    if (!ok) return;
    try { await deleteAndUnlink('seasons', s.id); toast('Season deleted.'); } catch (e) { toastError(e); }
  };
  const move = async (i, dir) => {
    const a = sorted[i], b = sorted[i + dir];
    try {
      // Re-number everything so the order is always clean.
      const order = [...sorted];
      order[i] = b; order[i + dir] = a;
      await Promise.all(order.map((s, idx) => (s.sort_order !== idx + 1 ? updateRow('seasons', s.id, { sort_order: idx + 1 }) : null)));
    } catch (e) { toastError(e); }
  };

  return html`
    <${PageHead} title="Seasons" sub="Content sorted by campaign season. Anything without a season lives in Evergreen.">
      <button class="btn btn-primary" onClick=${() => setEditing('new')}><${Icon} name="plus" size=${16} />New season</button>
    <//>
    <div class="season-grid">
      <${SeasonCard} evergreen season=${{ ...EVERGREEN, id: null }} rows=${assets.filter((a) => !a.season_id)} />
      ${sorted.map((s, i) => html`<${SeasonCard} key=${s.id} season=${s} rows=${assets.filter((a) => a.season_id === s.id)}
        first=${i === 0} last=${i === sorted.length - 1}
        onEdit=${() => setEditing(s)} onDelete=${() => remove(s)} onMove=${(d) => move(i, d)} />`)}
    </div>
    ${editing && html`<${SeasonForm} season=${editing === 'new' ? null : editing} onClose=${() => setEditing(null)} />`}`;
}
