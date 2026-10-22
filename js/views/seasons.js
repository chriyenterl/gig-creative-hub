import { html, useState } from '../lib.js';
import { useStore, insertRow, updateRow, deleteAndUnlink } from '../store.js';
import { hrefFor, EVERGREEN, fmtNum } from '../util.js';
import { Icon, PageHead, Modal, Field, confirmDialog, toast, toastError } from '../ui.js';

// 15 colour families in a light, a bright and a dark shade — or any colour at all (colour wheel or a colour code).
const FAMILIES = [
  ['Red', '#fca5a5', '#ef4444', '#991b1b'], ['Rose', '#fda4af', '#f43f5e', '#9f1239'], ['Pink', '#f9a8d4', '#ec4899', '#9d174d'],
  ['Purple', '#d8b4fe', '#a855f7', '#6b21a8'], ['Indigo', '#a5b4fc', '#6366f1', '#3730a3'], ['Blue', '#93c5fd', '#3b82f6', '#1e40af'],
  ['Sky', '#7dd3fc', '#0ea5e9', '#075985'], ['Teal', '#5eead4', '#14b8a6', '#115e59'], ['Green', '#86efac', '#22c55e', '#166534'],
  ['Lime', '#bef264', '#84cc16', '#3f6212'], ['Yellow', '#fde047', '#eab308', '#854d0e'], ['Amber', '#fcd34d', '#f59e0b', '#92400e'],
  ['Orange', '#fdba74', '#f97316', '#9a3412'], ['Brown', '#e7c9a9', '#a0703e', '#5c3a1e'], ['Grey', '#d4d4d8', '#71717a', '#27272a'],
];
const SHADES = ['Light', 'Bright', 'Dark'];
const PALETTE = FAMILIES.flatMap((f) => f.slice(1));
const toHex = (v) => {
  let c = String(v || '').trim().toLowerCase();
  if (c && !c.startsWith('#')) c = '#' + c;
  if (/^#[0-9a-f]{3}$/.test(c)) c = '#' + [...c.slice(1)].map((x) => x + x).join('');
  return /^#[0-9a-f]{6}$/.test(c) ? c : null;
};

function SeasonForm({ season, onClose }) {
  const { seasons } = useStore();
  const [name, setName] = useState(season?.name || '');
  const [color, setColor] = useState(toHex(season?.color) || FAMILIES[seasons.length % FAMILIES.length][2]);
  const [code, setCode] = useState(color);
  const [busy, setBusy] = useState(false);
  const choose = (c) => { setColor(c); setCode(c); };
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
  const custom = !PALETTE.includes(color);
  return html`<${Modal} title=${season ? 'Edit season' : 'New season'} size="md" onClose=${onClose}
    footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn btn-primary" disabled=${busy} onClick=${save}>Save</button>`}>
    <div class="form-grid">
      <${Field} label="Name" wide><input value=${name} autofocus placeholder="e.g. Chinese New Year 2027" onInput=${(e) => setName(e.target.value)}
        onKeyDown=${(e) => e.key === 'Enter' && save()} /><//>
      <div class="field field-wide"><span class="field-label">Colour</span>
        <div class="palette" role="radiogroup" aria-label="Colour">
          ${SHADES.map((shade, i) => html`<div class="palette-row" key=${shade}>
            <span class="palette-label">${shade}</span>
            <div class="swatch-pick">${FAMILIES.map((f) => html`<button type="button" class=${'swatch-btn' + (f[i + 1] === color ? ' on' : '')}
              style=${{ background: f[i + 1] }} role="radio" aria-checked=${f[i + 1] === color} aria-label=${`${shade} ${f[0].toLowerCase()}`}
              data-tip=${`${shade} ${f[0].toLowerCase()}`} onClick=${() => choose(f[i + 1])}></button>`)}</div>
          </div>`)}
        </div>
      </div>
      <div class="field field-wide"><span class="field-label">Or any colour you like</span>
        <div class="custom-colour">
          <label class=${'swatch-btn swatch-custom' + (custom ? ' on' : '')} style=${{ background: color }} data-tip="Pick any colour">
            <input type="color" value=${color} aria-label="Pick any colour" onInput=${(e) => choose(e.target.value)} />
            <${Icon} name="edit" size=${13} />
          </label>
          <input class="hex-input" value=${code} maxlength="7" spellcheck="false" autocapitalize="off" aria-label="Colour code"
            placeholder="#ff3d7f" onInput=${(e) => { setCode(e.target.value); const c = toHex(e.target.value); if (c) setColor(c); }} />
          <span class="muted small">Tap the circle for the colour wheel, or type a colour code (e.g. your brand colour).</span>
        </div>
      </div>
      <div class="field field-wide"><span class="field-label">Preview</span>
        <div class="season-preview">
          <span class="season-preview-stripe" style=${{ background: color }}></span>
          <b>${name.trim() || 'New season'}</b>
          <span class="season-tag"><span class="dot" style=${{ background: color }}></span>${name.trim() || 'New season'}</span>
        </div>
      </div>
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
