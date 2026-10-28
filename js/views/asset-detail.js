// Detail view for one item: preview, approval, info, usage history, download/share/delete.
import { html, useState, useEffect } from '../lib.js';
import { useStore, api, updateRow, deleteAssets, closeAsset, refreshAsset, refreshStorage, talentById, getState } from '../store.js';
import { ASSET_STATUS, CATEGORIES, MEDIA, CHANNELS, fmtBytes, fmtDate, timeAgo, parseTags, today, copyText, hrefFor, uid, safeName } from '../util.js';
import { Icon, Modal, MediaPreview, Field, SeasonSelect, TalentSelect, CoverPicker, useSignedUrls, confirmDialog, toast, toastError, downloadAsset, canPrint, printFile } from '../ui.js';
import { makePreviews, previewsOn } from '../previews.js';
import { PhotoPicker } from './photo-picker.js';
import { FramePicker } from './frame-picker.js';

// A video's cover photo: shown as its thumbnail in the library and before it plays.
// Its small grid copy (thumb_path) is made from the cover, so it's replaced or removed together with it.
function CoverBox({ asset }) {
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false); // 'library' | 'video'
  const videoUrls = useSignedUrls(choosing === 'video' && asset.storage_path ? [asset.storage_path] : []);
  const videoUrl = videoUrls[asset.storage_path];
  const direct = asset.cover_path && api.media?.({ storage_path: asset.cover_path });
  const urls = useSignedUrls(asset.cover_path && !direct ? [asset.cover_path] : []);
  const src = direct ? direct.thumb : asset.cover_path ? urls[asset.cover_path] : null;
  const pick = async (file) => {
    setBusy(true);
    try {
      const path = `library/${asset.category}/${uid()}-cover-${safeName(file.name)}`;
      const stored = await api.uploadFile(path, file, { category: asset.category }) || path;
      const old = [asset.cover_path, asset.thumb_path].filter(Boolean);
      const patch = { cover_path: stored };
      if (previewsOn()) { // a new small copy from the new cover (none if it can't be made — the grid then uses the cover)
        patch.thumb_path = null;
        try { patch.thumb_path = (await makePreviews({ ...asset, cover_path: stored, thumb_path: null }, { cover: file })).thumb_path || null; } catch { /* keep going */ }
      }
      try { await updateRow('assets', asset.id, patch); } catch (e) { api.removeFiles([stored, patch.thumb_path].filter(Boolean)).catch(() => {}); throw e; }
      if (old.length) api.removeFiles(old).catch(() => {});
      refreshStorage();
      toast('Cover photo saved.');
    } catch (e) { toastError(e); }
    setBusy(false);
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Remove the cover photo?', message: 'The video will show its first frame instead.', confirmLabel: 'Remove' }))) return;
    const old = [asset.cover_path, asset.thumb_path].filter(Boolean);
    try {
      await updateRow('assets', asset.id, previewsOn() ? { cover_path: null, thumb_path: null } : { cover_path: null });
      api.removeFiles(old).catch(() => {});
      refreshStorage();
      toast('Cover photo removed.');
    } catch (e) { return toastError(e); }
    // A video without a cover gets a small copy of a frame near the start instead.
    if (previewsOn() && asset.media_type === 'video' && asset.storage_path) {
      try { const small = await makePreviews({ ...asset, cover_path: null, thumb_path: null }); if (small.thumb_path) await updateRow('assets', asset.id, small); } catch { /* the grid falls back to the video itself */ }
    }
  };
  return html`<section class="side-section">
    <h3>Cover photo</h3>
    <p class="muted small">Shown as the video's thumbnail and before it plays.</p>
    <${CoverPicker} src=${src} busy=${busy} onPick=${pick} onRemove=${asset.cover_path ? remove : null}
      onLibrary=${previewsOn() ? () => setChoosing('library') : null}
      onVideo=${previewsOn() && asset.storage_path && !asset.external_url ? () => setChoosing('video') : null} />
    ${choosing === 'library' && html`<${PhotoPicker} onPick=${pick} onClose=${() => setChoosing(false)} />`}
    ${choosing === 'video' && videoUrl && html`<${FramePicker} src=${videoUrl} name=${asset.file_name || asset.title} onPick=${pick} onClose=${() => setChoosing(false)} />`}
  </section>`;
}

function ApprovalBox({ asset }) {
  const [note, setNote] = useState(asset.review_note || '');
  const setStatus = async (status) => {
    try {
      await updateRow('assets', asset.id, { status, review_note: note.trim() || null, reviewed_at: new Date().toISOString() });
      toast(`Status: ${ASSET_STATUS[status].label}`);
    } catch (e) { toastError(e); }
  };
  return html`<section class="side-section">
    <h3>Approval</h3>
    <div class="segmented">
      ${Object.entries(ASSET_STATUS).map(([id, s]) => html`<button class=${'seg-btn tone-' + s.tone + (asset.status === id ? ' on' : '')}
          aria-pressed=${asset.status === id} onClick=${() => setStatus(id)}>
        <${Icon} name=${s.icon} size=${14} />${s.label}</button>`)}
    </div>
    <textarea rows="2" value=${note} placeholder="Review note (team only)" onInput=${(e) => setNote(e.target.value)}
      onBlur=${() => note !== (asset.review_note || '') && updateRow('assets', asset.id, { review_note: note.trim() || null }).catch(toastError)}></textarea>
    ${asset.reviewed_at && html`<p class="muted small">Last reviewed ${timeAgo(asset.reviewed_at)}</p>`}
  </section>`;
}

function InfoForm({ asset }) {
  const initial = {
    title: asset.title, description: asset.description || '', category: asset.category,
    season_id: asset.season_id || '', talent_id: asset.talent_id || '', tags: (asset.tags || []).join(', '),
    caption: asset.caption || '', external_url: asset.external_url || '',
  };
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const save = async () => {
    setBusy(true);
    try {
      await updateRow('assets', asset.id, {
        title: d.title.trim() || asset.title, description: d.description.trim() || null, category: d.category,
        season_id: d.season_id || null, talent_id: d.talent_id || null, tags: parseTags(d.tags),
        caption: d.caption.trim() || null,
        ...(asset.external_url ? { external_url: d.external_url.trim() } : {}),
      });
      toast('Saved.');
    } catch (e) { toastError(e); }
    setBusy(false);
  };
  return html`<section class="side-section">
    <h3>Details</h3>
    <div class="form-grid">
      <${Field} label="Title" wide><input value=${d.title} onInput=${set('title')} /><//>
      ${asset.external_url && html`<${Field} label="Link" wide><input type="url" value=${d.external_url} onInput=${set('external_url')} /><//>`}
      <${Field} label="File under">
        <select value=${d.category} onChange=${set('category')}>${CATEGORIES.map((c) => html`<option value=${c.id}>${c.label}</option>`)}</select>
      <//>
      <${Field} label="Season"><${SeasonSelect} value=${d.season_id} onChange=${set('season_id')} /><//>
      <${Field} label="Talent" wide><${TalentSelect} value=${d.talent_id} onChange=${set('talent_id')} /><//>
      <${Field} label="Tags" wide hint="Comma separated"><input value=${d.tags} onInput=${set('tags')} /><//>
      <${Field} label="Caption" wide hint="Optional — the text to post with it"><textarea rows="3" value=${d.caption} onInput=${set('caption')}></textarea><//>
      <${Field} label="Description / notes" wide><textarea rows="3" value=${d.description} onInput=${set('description')}></textarea><//>
    </div>
    ${dirty && html`<div class="row-end"><button class="btn" onClick=${() => setD(initial)}>Undo</button>
      <button class="btn btn-primary" disabled=${busy} onClick=${save}>Save changes</button></div>`}
  </section>`;
}

function UsageBox({ asset }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ channel: '', used_on: today(), note: '' });
  const load = () => api.list('asset_usage', { eq: { asset_id: asset.id }, order: ['used_on', false] }).then(setRows).catch(toastError);
  useEffect(() => { load(); }, [asset.id]);
  const add = async () => {
    try {
      await api.insert('asset_usage', { asset_id: asset.id, channel: form.channel || null, used_on: form.used_on || today(), note: form.note.trim() || null, created_by: getState().user?.email || getState().user?.name });
      setForm({ channel: '', used_on: today(), note: '' });
      await Promise.all([load(), refreshAsset(asset.id)]);
      toast('Marked as used.');
    } catch (e) { toastError(e); }
  };
  const del = async (id) => {
    try { await api.remove('asset_usage', id); await Promise.all([load(), refreshAsset(asset.id)]); } catch (e) { toastError(e); }
  };
  return html`<section class="side-section">
    <h3>Usage <span class="muted">· ${asset.use_count ? `used ${asset.use_count}×, last on ${fmtDate(asset.last_used_on)}` : 'not used yet'}</span></h3>
    ${rows?.length > 0 && html`<ul class="usage-list">
      ${rows.map((u) => html`<li key=${u.id}>
        <span><b>${u.channel || 'Used'}</b> · ${fmtDate(u.used_on)}${u.note && html`<span class="muted"> — ${u.note}</span>`}</span>
        <button class="icon-btn" aria-label="Remove" data-tip="Remove this entry" onClick=${() => del(u.id)}><${Icon} name="x" size=${14} /></button>
      </li>`)}
    </ul>`}
    <div class="usage-form">
      <input list="channels-detail" placeholder="Where? e.g. Instagram post" value=${form.channel} onInput=${(e) => setForm({ ...form, channel: e.target.value })} />
      <datalist id="channels-detail">${CHANNELS.map((c) => html`<option value=${c} />`)}</datalist>
      <input type="date" value=${form.used_on} onInput=${(e) => setForm({ ...form, used_on: e.target.value })} aria-label="Date used" />
      <input placeholder="Note (optional)" value=${form.note} onInput=${(e) => setForm({ ...form, note: e.target.value })} />
      <button class="btn btn-primary" onClick=${add}><${Icon} name="check" size=${16} />Mark as used</button>
    </div>
  </section>`;
}

export function AssetDetail({ id }) {
  const { assets } = useStore();
  const asset = assets.find((a) => a.id === id);
  useEffect(() => { if (!asset) closeAsset(); }, [asset]);
  if (!asset) return null;
  const talent = talentById(asset.talent_id);

  const share = async () => {
    try {
      if (asset.external_url) { await copyText(asset.external_url); return toast('Link copied.'); }
      const url = await api.shareUrl(asset.storage_path, 7);
      await copyText(url);
      toast(api.shareNote || 'Share link copied — it works for 7 days.');
    } catch (e) { toastError(e); }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Delete this item?', message: asset.external_url ? `“${asset.title}” is removed from the library (the link itself isn't affected).` : `“${asset.title}” and its file will be permanently deleted.`, confirmLabel: 'Delete', danger: true }))) return;
    try { await deleteAssets([asset]); toast('Deleted.'); closeAsset(); } catch (e) { toastError(e); }
  };

  return html`<${Modal} title=${asset.title} size="xl" onClose=${closeAsset}>
    <div class="detail">
      <div class="detail-media">
        <${MediaPreview} key=${asset.id} asset=${asset} />
        <div class="detail-actions">
          <button class="btn btn-primary" onClick=${() => downloadAsset(asset)}><${Icon} name=${asset.external_url ? 'external' : 'download'} size=${16} />${asset.external_url ? 'Open link' : 'Download'}</button>
          <button class="btn" onClick=${share}><${Icon} name="link" size=${16} />${asset.external_url ? 'Copy link' : 'Copy share link'}</button>
          ${!asset.external_url && asset.storage_path && !api.media?.(asset) && canPrint(asset.mime_type, asset.file_name) && html`<button class="btn"
            data-tip="Opens the print window — choose your printer, paper size and copies"
            onClick=${async () => { try { await printFile({ url: (await api.signedUrls([asset.storage_path]))[asset.storage_path], name: asset.file_name, mime: asset.mime_type }); } catch (e) { toastError(e); } }}>
            <${Icon} name="printer" size=${16} />Print</button>`}
          ${api.media?.(asset)?.open && html`<a class="btn btn-ghost" href=${api.media(asset).open} target="_blank" rel="noopener"><${Icon} name="external" size=${16} />Open in Drive</a>`}
          <span class="spacer"></span>
          <button class="btn btn-ghost-danger" onClick=${remove}><${Icon} name="trash" size=${16} />Delete</button>
        </div>
        <dl class="facts">
          ${asset.external_url
            ? html`<dt>Type</dt><dd>${MEDIA[asset.media_type]?.label} link</dd>
              <dt>Link</dt><dd class="break"><a class="link" href=${asset.external_url} target="_blank" rel="noopener noreferrer">${asset.external_url}</a></dd>`
            : html`<dt>Type</dt><dd>${MEDIA[asset.media_type]?.label} · ${fmtBytes(asset.size_bytes)}</dd>
              <dt>File</dt><dd class="break">${asset.file_name || '—'}</dd>`}
          <dt>Uploaded</dt><dd>${fmtDate(asset.created_at)} by ${asset.uploaded_by || '—'}</dd>
          <dt>Source</dt><dd>${asset.source === 'talent' ? 'Creator upload link' : 'Team upload'}</dd>
          ${asset.caption && html`<dt>Caption</dt><dd class="caption-text">${asset.caption}</dd>`}
          ${talent && html`<dt>Talent</dt><dd><a class="link" href=${hrefFor('talents/' + talent.id)} onClick=${closeAsset}>${talent.name}</a></dd>`}
        </dl>
      </div>
      <div class="detail-side">
        <${ApprovalBox} key=${'a' + asset.id} asset=${asset} />
        ${asset.media_type === 'video' && html`<${CoverBox} key=${'c' + asset.id} asset=${asset} />`}
        <${UsageBox} key=${'u' + asset.id} asset=${asset} />
        <${InfoForm} key=${'i' + asset.id} asset=${asset} />
      </div>
    </div>
  <//>`;
}
