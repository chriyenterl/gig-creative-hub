// Team upload: add files to the library (essentials, raw footage, final content) — or add a link
// (Google Drive, Dropbox, WeTransfer…) instead of uploading.
import { html, useState, useEffect } from '../lib.js';
import { api, insertRow, getState, useStore, refreshStorage } from '../store.js';
import { CATEGORIES, mediaTypeFor, safeName, stripExt, uid, parseTags, fmtBytes, MEDIA } from '../util.js';
import { Icon, Modal, Dropzone, Progress, Field, SeasonSelect, TalentSelect, StorageWarning, CoverPicker, Tabs, toast, toastError } from '../ui.js';
import { normalizeLink } from '../print/model.js';
import { previewsForUpload, previewsOn } from '../previews.js';
import { PhotoPicker } from './photo-picker.js';
import { FramePicker } from './frame-picker.js';

const LINK_KINDS = [['video', 'Video'], ['image', 'Photo'], ['document', 'Document'], ['other', 'Other']];

export function UploadDialog({ onClose, defaults = {} }) {
  const [items, setItems] = useState([]); // { id, file, title, progress, state, error }
  const [meta, setMeta] = useState({
    category: defaults.category || 'final',
    season_id: defaults.season_id || '',
    talent_id: defaults.talent_id || '',
    tags: '',
    status: 'approved',
  });
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState('files'); // 'files' | 'link'
  const [pickFor, setPickFor] = useState(null); // which upload is choosing a cover from the library ('link' for the link form)
  const fromLibrary = (id) => (previewsOn() ? () => setPickFor(id) : null);
  const [frameFor, setFrameFor] = useState(null); // which upload is taking its cover from a moment in the video
  const frameItem = items.find((x) => x.id === frameFor);
  const [link, setLink] = useState({ url: '', title: '', kind: 'video', caption: '', cover: null });
  const setL = (k) => (v) => setLink((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const { storage } = useStore();
  const patchItem = (id, p) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const setM = (k) => (v) => setMeta((m) => ({ ...m, [k]: v?.target ? v.target.value : v }));

  const addFiles = (files) => setItems((xs) => [...xs, ...files.map((file) => ({
    id: uid(), file, title: stripExt(file.name), caption: '', cover: null, progress: 0, state: 'ready', error: null,
  }))]);

  const todo = items.filter((x) => x.state === 'ready' || x.state === 'error');
  const done = items.filter((x) => x.state === 'done').length;

  const start = async () => {
    setRunning(true);
    const month = new Date().toISOString().slice(0, 7);
    for (const it of todo) {
      const path = `library/${meta.category}/${month}/${uid()}-${safeName(it.file.name)}`;
      patchItem(it.id, { state: 'uploading', progress: 0, error: null });
      let cover = null; // a video's cover photo goes up first
      try {
        if (it.cover && mediaTypeFor(it.file.type, it.file.name) === 'video') {
          const coverPath = `library/${meta.category}/${month}/${uid()}-cover-${safeName(it.cover.name)}`;
          cover = await api.uploadFile(coverPath, it.cover, { category: meta.category }) || coverPath;
        }
        const stored = await api.uploadFile(path, it.file, { category: meta.category, onProgress: (p) => patchItem(it.id, { progress: p }) }) || path;
        // Small copies for fast loading (made from the file on this device — the original isn't changed).
        const small = await previewsForUpload(it.file, mediaTypeFor(it.file.type, it.file.name), { cover: cover && it.cover });
        try {
          await insertRow('assets', {
            title: it.title.trim() || it.file.name,
            category: meta.category,
            media_type: mediaTypeFor(it.file.type, it.file.name),
            season_id: meta.season_id || null,
            talent_id: meta.talent_id || null,
            source: 'team',
            storage_path: stored,
            file_name: it.file.name,
            mime_type: it.file.type || null,
            size_bytes: it.file.size,
            cover_path: cover,
            caption: it.caption.trim() || null,
            tags: parseTags(meta.tags),
            status: meta.status,
            reviewed_at: meta.status === 'approved' ? new Date().toISOString() : null,
            uploaded_by: getState().user?.email || getState().user?.name || null,
            ...small,
          });
        } catch (e) {
          await api.removeFiles([stored, small.thumb_path, small.preview_path].filter(Boolean)).catch(() => {});
          throw e;
        }
        patchItem(it.id, { state: 'done', progress: 1 });
      } catch (e) {
        if (cover) api.removeFiles([cover]).catch(() => {});
        patchItem(it.id, { state: 'error', error: e.message });
        if (/storage is full/i.test(e.message)) break; // nothing else will fit either
      }
    }
    setRunning(false);
    refreshStorage();
  };

  const allDone = items.length > 0 && done === items.length;
  useEffect(() => {
    if (!allDone || running) return;
    const t = setTimeout(() => { toast(`${done} file${done === 1 ? '' : 's'} added to the library.`); onClose(); }, 400);
    return () => clearTimeout(t);
  }, [allDone, running]);

  // Add a link instead of a file: no upload, no storage used, nothing compressed.
  const addLink = async () => {
    const url = normalizeLink(link.url);
    if (!url) return toastError(new Error("Paste the whole link (it usually starts with https://)."));
    setRunning(true);
    let cover = null;
    try {
      let small = {};
      if (link.cover && link.kind === 'video') {
        const coverPath = `library/${meta.category}/${uid()}-cover-${safeName(link.cover.name)}`;
        cover = await api.uploadFile(coverPath, link.cover, { category: meta.category }) || coverPath;
        small = await previewsForUpload(link.cover, 'video', { cover: link.cover });
      }
      await insertRow('assets', {
        title: link.title.trim() || url.replace(/^https?:\/\//, '').slice(0, 80), category: meta.category, media_type: link.kind,
        season_id: meta.season_id || null, talent_id: meta.talent_id || null, source: 'team', external_url: url, storage_path: null,
        cover_path: cover, caption: link.caption.trim() || null, tags: parseTags(meta.tags), status: meta.status,
        reviewed_at: meta.status === 'approved' ? new Date().toISOString() : null, uploaded_by: getState().user?.email || getState().user?.name || null,
        ...small,
      });
      toast('Link added to the library.');
      onClose();
    } catch (e) {
      if (cover) api.removeFiles([cover]).catch(() => {});
      toastError(e);
      setRunning(false);
    }
  };

  return html`<${Modal} title="Add to the library" size="lg" onClose=${() => !running && onClose()}
    footer=${mode === 'link' ? html`
      <span class="muted small">A link uses no storage and is never compressed.</span>
      <span class="spacer"></span>
      <button class="btn" disabled=${running} onClick=${onClose}>Cancel</button>
      <button class="btn btn-primary" disabled=${running || !link.url.trim()} onClick=${addLink}>
        <${Icon} name="link" size=${16} />${running ? 'Adding…' : 'Add link'}</button>` : html`
      <span class="muted small">${items.length ? `${done} of ${items.length} uploaded` : ''}</span>
      <span class="spacer"></span>
      <button class="btn" disabled=${running} onClick=${onClose}>Cancel</button>
      <button class="btn btn-primary" disabled=${running || !todo.length} onClick=${start}>
        <${Icon} name="upload" size=${16} />${running ? 'Uploading…' : `Upload ${todo.length || ''} file${todo.length === 1 ? '' : 's'}`}
      </button>`}>
    <${StorageWarning} storage=${storage} settingsHref="#/settings" />
    <div class="form-grid">
      <${Field} label="File under">
        <select value=${meta.category} onChange=${setM('category')} disabled=${running}>
          ${CATEGORIES.map((c) => html`<option value=${c.id}>${c.label}</option>`)}
        </select>
      <//>
      <${Field} label="Season"><${SeasonSelect} value=${meta.season_id} onChange=${setM('season_id')} /><//>
      <${Field} label="Talent (optional)"><${TalentSelect} value=${meta.talent_id} onChange=${setM('talent_id')} /><//>
      <${Field} label="Approval">
        <select value=${meta.status} onChange=${setM('status')}>
          <option value="approved">Approved — ready to use</option>
          <option value="pending">Needs review first</option>
        </select>
      <//>
      <${Field} label="Tags (optional)" hint="Separate with commas, e.g. logo, mascot, product" wide>
        <input value=${meta.tags} onInput=${setM('tags')} placeholder="logo, mascot" />
      <//>
    </div>

    <div class="upload-mode"><${Tabs} value=${mode} onChange=${(m) => !running && setMode(m)}
      items=${[{ id: 'files', label: 'Upload from Files' }, { id: 'link', label: 'Add a link' }]} /></div>

    ${mode === 'link' ? html`<div class="form-grid">
      <${Field} label="Link" hint="Google Drive, Dropbox, WeTransfer, YouTube… make sure anyone with the link can open it" wide>
        <input type="url" inputmode="url" placeholder="https://…" value=${link.url} onInput=${setL('url')} autocomplete="off" /><//>
      <${Field} label="Title" wide><input value=${link.title} onInput=${setL('title')} placeholder="e.g. Raya campaign — full video" /><//>
      <${Field} label="It's a">
        <select value=${link.kind} onChange=${setL('kind')}>${LINK_KINDS.map(([id, label]) => html`<option value=${id}>${label}</option>`)}</select><//>
      <${Field} label="Caption (optional)" wide><textarea rows="2" value=${link.caption} onInput=${setL('caption')} placeholder="e.g. the post text"></textarea><//>
      ${link.kind === 'video' && html`<div class="field field-wide"><span class="field-label">Cover photo (optional)</span>
        <${CoverPicker} file=${link.cover} disabled=${running} onPick=${(f) => setL('cover')(f)} onRemove=${() => setL('cover')(null)}
          onLibrary=${fromLibrary('link')} /></div>`}
    </div>` : html`
    <${Dropzone} onFiles=${addFiles}>
      <${Icon} name="upload" size=${28} />
      <b>Choose from Files, or drop files here</b>
      <span class="muted small">Photos, videos, logos, PDFs — any file type</span>
    <//>

    ${items.length > 0 && html`<ul class="file-list">
      ${items.map((it) => html`<li key=${it.id} class=${'file-item file-' + it.state}>
        <${Icon} name=${MEDIA[mediaTypeFor(it.file.type, it.file.name)]?.icon || 'file'} />
        <div class="file-main">
          <input class="file-title" value=${it.title} disabled=${it.state !== 'ready' && it.state !== 'error'}
            onInput=${(e) => patchItem(it.id, { title: e.target.value })} aria-label="Title" />
          <span class="muted small">${it.file.name} · ${fmtBytes(it.file.size)}</span>
          <textarea class="file-caption" rows="2" value=${it.caption} disabled=${it.state !== 'ready' && it.state !== 'error'}
            placeholder="Caption (optional) — e.g. the post text" aria-label="Caption" onInput=${(e) => patchItem(it.id, { caption: e.target.value })}></textarea>
          ${mediaTypeFor(it.file.type, it.file.name) === 'video' && html`<${CoverPicker} file=${it.cover} disabled=${it.state !== 'ready' && it.state !== 'error'}
            onPick=${(f) => patchItem(it.id, { cover: f })} onRemove=${() => patchItem(it.id, { cover: null })} onLibrary=${fromLibrary(it.id)}
            onVideo=${previewsOn() ? () => setFrameFor(it.id) : null} />`}
          ${it.state === 'uploading' && html`<${Progress} value=${it.progress} />`}
          ${it.error && html`<span class="error-text small">${it.error}</span>`}
        </div>
        ${it.state === 'done' ? html`<span class="ok-icon"><${Icon} name="check" /></span>`
          : it.state === 'uploading' ? html`<span class="muted small">${Math.round(it.progress * 100)}%</span>`
          : html`<button class="icon-btn" aria-label="Remove" onClick=${() => setItems((xs) => xs.filter((x) => x.id !== it.id))}><${Icon} name="x" size=${16} /></button>`}
      </li>`)}
    </ul>`}`}
    ${pickFor && html`<${PhotoPicker} onClose=${() => setPickFor(null)}
      onPick=${(f) => (pickFor === 'link' ? setL('cover')(f) : patchItem(pickFor, { cover: f }))} />`}
    ${frameItem && html`<${FramePicker} src=${frameItem.file} name=${frameItem.file.name} onClose=${() => setFrameFor(null)}
      onPick=${(f) => patchItem(frameItem.id, { cover: f })} />`}
  <//>`;
}
