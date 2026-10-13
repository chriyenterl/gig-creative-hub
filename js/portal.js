// Creator upload page (upload.html#<token>). No login, no navigation —
// the person can only upload files and see what they've sent through this link.
import { html, render, useState, useEffect } from './lib.js';
import { loadBackend } from './api.js';
import { CONFIG } from '../config.js';
import { uid, safeName, stripExt, fmtBytes, timeAgo, mediaTypeFor, MEDIA } from './util.js';
import { Icon, Dropzone, Progress, ToastHost } from './ui.js';
import { Brand } from './views/login.js';

const api = await loadBackend({ portal: true });
const token = decodeURIComponent(location.hash.replace(/^#/, '')).trim();

const STATUS_FOR_CREATOR = {
  pending: { label: 'Received — in review', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  changes: { label: 'Changes requested', tone: 'serious' },
  rejected: { label: 'Not used', tone: 'neutral' },
};

function Portal() {
  const [info, setInfo] = useState(undefined); // undefined = loading, null = invalid link
  const [subs, setSubs] = useState([]);
  const [items, setItems] = useState([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(0);

  const loadSubs = () => api.portal.submissions(token).then(setSubs).catch(() => {});
  useEffect(() => {
    document.title = `Upload files · ${CONFIG.BRAND_NAME}`;
    if (!token) return setInfo(null);
    api.portal.linkInfo(token).then((i) => { setInfo(i); if (i) loadSubs(); }).catch((e) => setInfo({ error: e.message }));
  }, []);
  useEffect(() => {
    if (!running) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [running]);

  const patch = (id, p) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const addFiles = (files) => {
    setFinished(0);
    setItems((xs) => [...xs, ...files.map((file) => ({ id: uid(), file, title: stripExt(file.name), note: '', progress: 0, state: 'ready', error: null }))]);
  };
  const todo = items.filter((x) => x.state === 'ready' || x.state === 'error');

  const send = async () => {
    setRunning(true);
    let ok = 0;
    for (const it of todo) {
      const path = `submissions/${token}/${uid()}-${safeName(it.file.name)}`;
      patch(it.id, { state: 'uploading', progress: 0, error: null });
      try {
        const stored = await api.uploadFile(path, it.file, { linkToken: token, onProgress: (p) => patch(it.id, { progress: p }) }) || path;
        await api.portal.submit(token, {
          path: stored, title: it.title, description: it.note, file_name: it.file.name,
          mime_type: it.file.type || null, size_bytes: it.file.size,
        });
        patch(it.id, { state: 'done', progress: 1 });
        ok++;
      } catch (e) {
        patch(it.id, { state: 'error', error: e.message });
      }
    }
    setRunning(false);
    if (ok) {
      setFinished(ok);
      setItems((xs) => xs.filter((x) => x.state !== 'done'));
      loadSubs();
    }
  };

  if (info === undefined) return html`<div class="loading"><div class="spinner"></div></div>`;
  if (!info || info.error) {
    return html`<div class="auth-page"><div class="auth-card card center">
      <${Brand} />
      <h1>This link isn't active</h1>
      <p class="muted">${info?.error || 'The upload link may have been changed, disabled or expired. Please contact the team for a new one.'}</p>
    </div></div>`;
  }

  return html`<div class="portal">
    <header class="portal-head"><${Brand} /></header>
    <main class="portal-main">
      <section class="card portal-card">
        <h1>Hi ${info.talent_name || info.label} 👋</h1>
        <p class="muted">Upload your files below. They go straight to the ${CONFIG.BRAND_NAME} team for review.</p>
        ${info.instructions && html`<div class="instructions"><span class="muted small">Message from the team</span>${info.instructions}</div>`}
        ${info.season_name && html`<p class="muted small">Campaign: <b>${info.season_name}</b></p>`}

        ${finished > 0 && html`<div class="success-box"><${Icon} name="check" size=${20} />
          <div><b>Thank you! ${finished} file${finished === 1 ? '' : 's'} received.</b><br />
          <span class="muted small">You can upload more any time with this same link.</span></div></div>`}

        <${Dropzone} onFiles=${addFiles}>
          <${Icon} name="upload" size=${32} />
          <b>Drop your photos & videos here</b>
          <span class="muted small">or click to choose files · large videos are fine, keep this page open until it's done</span>
        <//>

        ${items.length > 0 && html`<ul class="file-list">
          ${items.map((it) => html`<li key=${it.id} class=${'file-item file-' + it.state}>
            <${Icon} name=${MEDIA[mediaTypeFor(it.file.type, it.file.name)]?.icon || 'file'} />
            <div class="file-main">
              <input class="file-title" value=${it.title} disabled=${running} aria-label="Title"
                onInput=${(e) => patch(it.id, { title: e.target.value })} />
              <input class="file-note" value=${it.note} disabled=${running} placeholder="Add a note for the team (optional)"
                onInput=${(e) => patch(it.id, { note: e.target.value })} />
              <span class="muted small">${it.file.name} · ${fmtBytes(it.file.size)}</span>
              ${it.state === 'uploading' && html`<${Progress} value=${it.progress} />`}
              ${it.error && html`<span class="error-text small">${it.error}</span>`}
            </div>
            ${it.state === 'uploading' ? html`<span class="muted small">${Math.round(it.progress * 100)}%</span>`
              : !running && html`<button class="icon-btn" aria-label="Remove" onClick=${() => setItems((xs) => xs.filter((x) => x.id !== it.id))}><${Icon} name="x" size=${16} /></button>`}
          </li>`)}
        </ul>
        <button class="btn btn-primary btn-block btn-lg" disabled=${running || !todo.length} onClick=${send}>
          <${Icon} name="upload" size=${18} />${running ? 'Uploading… please keep this page open' : `Send ${todo.length} file${todo.length === 1 ? '' : 's'}`}
        </button>`}
      </section>

      ${subs.length > 0 && html`<section class="card portal-card">
        <h2>Already sent through this link</h2>
        <ul class="plain-list">
          ${subs.map((s) => {
            const st = STATUS_FOR_CREATOR[s.status] || STATUS_FOR_CREATOR.pending;
            return html`<li><span><${Icon} name=${MEDIA[s.media_type]?.icon || 'file'} size=${16} /> ${s.title}
              <span class="muted small"> · ${timeAgo(s.created_at)}</span></span>
              <span class=${'pill pill-' + st.tone}>${st.label}</span></li>`;
          })}
        </ul>
      </section>`}
      <p class="muted small center">This is a private link just for you — please don't share it.</p>
    </main>
  </div>`;
}

render(html`<${Portal} /><${ToastHost} />`, document.getElementById('app'));
