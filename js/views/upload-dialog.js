// Team upload: add files to the library (brand kit, raw footage, final content).
import { html, useState, useEffect } from '../lib.js';
import { api, insertRow, getState, useStore, refreshStorage } from '../store.js';
import { CATEGORIES, mediaTypeFor, safeName, stripExt, uid, parseTags, fmtBytes, MEDIA } from '../util.js';
import { Icon, Modal, Dropzone, Progress, Field, SeasonSelect, TalentSelect, StorageWarning, CoverPicker, toast } from '../ui.js';

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
          });
        } catch (e) {
          await api.removeFiles([stored]).catch(() => {});
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

  return html`<${Modal} title="Upload to the library" size="lg" onClose=${() => !running && onClose()}
    footer=${html`
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

    <${Dropzone} onFiles=${addFiles}>
      <${Icon} name="upload" size=${28} />
      <b>Drop files here or click to choose</b>
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
            onPick=${(f) => patchItem(it.id, { cover: f })} onRemove=${() => patchItem(it.id, { cover: null })} />`}
          ${it.state === 'uploading' && html`<${Progress} value=${it.progress} />`}
          ${it.error && html`<span class="error-text small">${it.error}</span>`}
        </div>
        ${it.state === 'done' ? html`<span class="ok-icon"><${Icon} name="check" /></span>`
          : it.state === 'uploading' ? html`<span class="muted small">${Math.round(it.progress * 100)}%</span>`
          : html`<button class="icon-btn" aria-label="Remove" onClick=${() => setItems((xs) => xs.filter((x) => x.id !== it.id))}><${Icon} name="x" size=${16} /></button>`}
      </li>`)}
    </ul>`}
  <//>`;
}
