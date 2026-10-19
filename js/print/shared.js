// Print Hub UI pieces: the customer form field renderer and file links.
import { html, useState, useEffect, useRef, useMemo } from '../lib.js';
import { Icon, Dropzone, Progress } from '../ui.js';
import { fmtBytes } from '../util.js';
export * from './model.js';

const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Record a voice note in the browser (max 5 minutes). value = File | null.
export function VoiceRecorder({ value, onChange, disabled, maxSeconds = 300 }) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState('');
  const rec = useRef(null), stream = useRef(null), chunks = useRef([]), timer = useRef(null), alive = useRef(true);
  const url = useMemo(() => (value ? URL.createObjectURL(value) : null), [value]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { alive.current = false; stop(); }, []);

  function stop() {
    clearInterval(timer.current);
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
    else stream.current?.getTracks().forEach((t) => t.stop());
    rec.current = null;
  }
  async function start() {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      return setErr('Voice recording isn’t supported in this browser — please type instead.');
    }
    try { stream.current = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return setErr('Microphone access was blocked. Allow the microphone for this page, or type instead.'); }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      const type = (r.mimeType || mime || 'audio/webm').split(';')[0];
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const blob = new Blob(chunks.current, { type });
      if (!alive.current) return;
      setRecording(false);
      if (blob.size) onChange(new File([blob], `voice-note-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`, { type }));
    };
    r.start(1000);
    rec.current = r;
    const t0 = Date.now();
    setSecs(0);
    setRecording(true);
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setSecs(s);
      if (s >= maxSeconds) stop();
    }, 250);
  }

  if (recording) {
    return html`<div class="voice-rec is-recording" role="status" aria-live="polite">
      <span class="rec-dot" aria-hidden="true"></span>
      <span class="rec-time"><b>Recording… ${fmtClock(secs)}</b><span class="muted small"> / ${fmtClock(maxSeconds)} max</span></span>
      <${Progress} value=${secs / maxSeconds} />
      <button type="button" class="btn btn-sm btn-danger" onClick=${stop}><${Icon} name="stop" size=${14} />Stop</button>
    </div>`;
  }
  return html`<div class="voice-rec">
    ${value ? html`
      <audio controls src=${url} preload="metadata"></audio>
      <div class="voice-actions">
        <button type="button" class="btn btn-sm" disabled=${disabled} onClick=${start}><${Icon} name="mic" size=${14} />Record again</button>
        <button type="button" class="btn btn-sm btn-ghost-danger" disabled=${disabled} onClick=${() => onChange(null)}><${Icon} name="trash" size=${14} />Delete</button>
      </div>`
    : html`<button type="button" class="btn btn-mic" disabled=${disabled} onClick=${start}><${Icon} name="mic" size=${18} />Record a voice note</button>
      <span class="muted small">Up to ${Math.round(maxSeconds / 60)} minutes</span>`}
    ${err && html`<span class="error-text small">${err}</span>`}
  </div>`;
}

// ── Calendar for date questions: bigger than the browser's, no past dates ──
const pad2 = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fromYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function DatePicker({ id, value, onChange, disabled, invalid }) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = toYmd(today);
  const sel = value ? fromYmd(value) : null;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => { const b = sel || today; return new Date(b.getFullYear(), b.getMonth(), 1); });
  const wrap = useRef(), pop = useRef();
  useEffect(() => {
    if (!open) return;
    pop.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const y = view.getFullYear(), m = view.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // weeks start on Monday
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(y, m, i + 1))];
  const canPrev = new Date(y, m, 1) > new Date(today.getFullYear(), today.getMonth(), 1);
  const shift = (n) => setView(new Date(y, m + n, 1));
  const pick = (d) => { onChange(toYmd(d)); setOpen(false); };
  const label = sel ? sel.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : 'Choose a date';

  return html`<div class="datepick" ref=${wrap}>
    <button type="button" id=${id} class=${'date-field' + (invalid ? ' invalid' : '')} disabled=${disabled}
        aria-haspopup="dialog" aria-expanded=${open} onClick=${() => { if (!open) setView(new Date((sel || today).getFullYear(), (sel || today).getMonth(), 1)); setOpen(!open); }}>
      <${Icon} name="calendar" size=${18} /><span class=${sel ? '' : 'placeholder'}>${label}</span>
    </button>
    ${open && html`<div class="cal-pop" ref=${pop} role="dialog" aria-label="Choose a date">
      <div class="cal-head">
        <button type="button" class="cal-nav" disabled=${!canPrev} onClick=${() => shift(-1)} aria-label="Previous month">‹</button>
        <b>${view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
        <button type="button" class="cal-nav" onClick=${() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div class="cal-grid">
        ${WEEKDAYS.map((w) => html`<span class="cal-wd">${w}</span>`)}
        ${cells.map((d, i) => {
          if (!d) return html`<span key=${'b' + i}></span>`;
          const ds = toYmd(d), past = d < today;
          return html`<button type="button" key=${ds} disabled=${past} onClick=${() => pick(d)}
            class=${'cal-day' + (ds === todayStr ? ' today' : '') + (value === ds ? ' sel' : '')}
            aria-pressed=${value === ds} aria-label=${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>${d.getDate()}</button>`;
        })}
      </div>
      <div class="cal-foot">
        <button type="button" class="btn btn-sm" onClick=${() => pick(today)}>Today</button>
        <span class="muted small">Past dates can’t be chosen</span>
      </div>
    </div>`}
  </div>`;
}

// ── One question on the customer form ──────────────────────────────────────
export function QuestionField({ q, value, onChange, error, files, onFiles, onRemoveFile, busy }) {
  const id = 'f_' + q.id;
  const label = html`<span class="field-label">${q.label}${q.required && html`<span class="req"> *</span>`}</span>`;
  const help = q.help && html`<span class="field-hint">${q.help}</span>`;
  const err = error && html`<span class="error-text small">${error}</span>`;
  const common = { id, disabled: busy, 'aria-invalid': !!error };

  if (q.type === 'file') {
    return html`<div class=${'field q-field' + (error ? ' has-error' : '')}>
      ${label}${help}
      <${Dropzone} onFiles=${onFiles}>
        <${Icon} name="upload" size=${24} />
        <b>Drop files here or click to choose</b>
        <span class="muted small">Large files are fine</span>
      <//>
      ${files?.length > 0 && html`<ul class="file-list">${files.map((f) => html`<li key=${f.key} class=${'file-item file-' + f.state}>
        <${Icon} name="file" />
        <div class="file-main"><b class="small">${f.file.name}</b><span class="muted small">${fmtBytes(f.file.size)}</span>
          ${f.state === 'uploading' && html`<${Progress} value=${f.progress} />`}
          ${f.error && html`<span class="error-text small">${f.error}</span>`}</div>
        ${!busy && html`<button type="button" class="icon-btn" aria-label="Remove" onClick=${() => onRemoveFile(f.key)}><${Icon} name="x" size=${16} /></button>`}
      </li>`)}</ul>`}
      ${err}
    </div>`;
  }
  if (q.type === 'voice_text') {
    const voice = files?.[0];
    return html`<div class=${'field q-field' + (error ? ' has-error' : '')}>
      <label class="field-label" for=${id}>${q.label}${q.required && html`<span class="req"> *</span>`}</label>${help}
      <textarea ...${common} rows="4" value=${value || ''} placeholder="Type here…" onInput=${(e) => onChange(e.target.value)}></textarea>
      <div class="or-line"><span>or</span></div>
      <${VoiceRecorder} value=${voice?.file || null} disabled=${busy}
        onChange=${(f) => onFiles(f ? [f] : [], true)} />
      ${voice?.state === 'uploading' && html`<div class="small muted">Uploading voice note… <${Progress} value=${voice.progress} /></div>`}
      ${voice?.error && html`<span class="error-text small">${voice.error}</span>`}
      ${err}
    </div>`;
  }
  if (q.type === 'date') {
    return html`<div class=${'field q-field' + (error ? ' has-error' : '')}>
      <label class="field-label" for=${id}>${q.label}${q.required && html`<span class="req"> *</span>`}</label>${help}
      <${DatePicker} id=${id} value=${value || ''} onChange=${onChange} disabled=${busy} invalid=${!!error} />
      ${err}
    </div>`;
  }
  if (q.type === 'radio' || q.type === 'checkbox') {
    const multi = q.type === 'checkbox';
    const cur = multi ? value || [] : value;
    return html`<div class=${'field q-field' + (error ? ' has-error' : '')} role="group" aria-label=${q.label}>
      ${label}${help}
      <div class="choice-row">
        ${(q.options || []).map((o) => {
          const on = multi ? cur.includes(o) : cur === o;
          return html`<button type="button" key=${o} class=${'choice' + (on ? ' on' : '')} aria-pressed=${on} disabled=${busy}
            onClick=${() => onChange(multi ? (on ? cur.filter((x) => x !== o) : [...cur, o]) : on ? '' : o)}>
            ${on && html`<${Icon} name="check" size=${14} />`}${o}</button>`;
        })}
      </div>
      ${err}
    </div>`;
  }
  let input;
  if (q.type === 'textarea') input = html`<textarea ...${common} rows="4" value=${value || ''} onInput=${(e) => onChange(e.target.value)}></textarea>`;
  else if (q.type === 'select') input = html`<select ...${common} value=${value || ''} onChange=${(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>${(q.options || []).map((o) => html`<option value=${o}>${o}</option>`)}</select>`;
  else {
    const type = { number: 'number', email: 'email', phone: 'tel', date: 'date', link: 'url' }[q.type] || 'text';
    input = html`<input ...${common} type=${type} inputmode=${q.type === 'number' ? 'decimal' : q.type === 'link' ? 'url' : undefined}
      min=${q.type === 'number' ? '0' : undefined} placeholder=${q.type === 'link' ? 'https://…' : undefined} autocomplete=${q.type === 'link' ? 'off' : undefined}
      value=${value || ''} onInput=${(e) => onChange(e.target.value)} />`;
  }
  return html`<label class=${'field q-field' + (error ? ' has-error' : '')} for=${id}>${label}${help}${input}${err}</label>`;
}

// Links for an attached file (Drive links in Google mode, server links on Cloudflare, local links in the demo).
export function useFileLinks(api, files) {
  const [links, setLinks] = useState({});
  const key = (files || []).map((f) => f.id).join('|');
  useEffect(() => {
    let alive = true;
    Promise.all((files || []).map(async (f) => [f.id, await api.print.fileLinks(f.id)]))
      .then((pairs) => alive && setLinks(Object.fromEntries(pairs))).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return links;
}
