// Print Hub — customer order page (print/order.html#<order link key>).
// Customers only see this form: answer the questions, attach artwork, submit.
import { html, render, useState, useEffect } from '../lib.js';
import { loadBackend } from '../api.js';
import { CONFIG } from '../../config.js';
import { Icon, ToastHost, toastError } from '../ui.js';
import { QuestionField, answerText, isVisible, isBlank, normalizeLink } from './shared.js';

const api = await loadBackend({ portal: true });
const orderKey = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
const TITLE = CONFIG.PRINT_NAME || 'Print Hub';

function Brand() {
  const words = CONFIG.BRAND_NAME.trim().split(/\s+/);
  const initials = /^[A-Z0-9]{2,3}$/.test(words[0]) ? words[0] : words.map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return html`<span class="brand">${CONFIG.LOGO_URL ? html`<img src=${CONFIG.LOGO_URL} alt="" />` : html`<span class="brand-mark">${initials}</span>`}
    <span class="brand-name">${TITLE}</span></span>`;
}

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

function OrderPage() {
  const [form, setForm] = useState(undefined); // undefined = loading, null = link not active
  const [answers, setAnswers] = useState({});
  const [files, setFiles] = useState({}); // question id → [{ key, file, state, progress, error, uploaded }]
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    document.title = `Place an order · ${TITLE}`;
    if (!orderKey || !api.print) return setForm(null);
    api.print.form(orderKey).then(setForm).catch((e) => setForm({ error: e.message }));
  }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [busy]);

  const setAnswer = (id, v) => { setAnswers((a) => ({ ...a, [id]: v })); setErrors((e) => ({ ...e, [id]: null })); };
  const patchFile = (qid, key, p) => setFiles((f) => ({ ...f, [qid]: f[qid].map((x) => (x.key === key ? { ...x, ...p } : x)) }));
  const addFiles = (qid, list, replace = false) => {
    setErrors((e) => ({ ...e, [qid]: null }));
    const items = list.map((file) => ({ key: Math.random().toString(36).slice(2), file, state: 'ready', progress: 0 }));
    setFiles((f) => ({ ...f, [qid]: replace ? items : [...(f[qid] || []), ...items] }));
  };
  const visible = form?.questions ? form.questions.filter((q) => isVisible(q, answers, form.questions)) : [];

  const validate = () => {
    const errs = {};
    for (const q of visible) {
      if (q.type === 'voice_text') {
        if (q.required && !String(answers[q.id] || '').trim() && !files[q.id]?.length) errs[q.id] = 'Please type what you want, or record a voice note.';
        continue;
      }
      const v = q.type === 'file' ? files[q.id] : answers[q.id];
      const other = q.eitherWith && visible.find((x) => x.id === q.eitherWith); // e.g. a design file OR a link
      const otherDone = other && !isBlank(other.type === 'file' ? files[other.id] : answers[other.id]);
      if (q.required && isEmpty(typeof v === 'string' ? v.trim() : v) && !otherDone) {
        errs[q.id] = other ? `Please ${q.type === 'file' ? 'attach a file' : 'fill this in'} — or use “${other.label}”.` : q.type === 'file' ? 'Please attach a file.' : 'Please fill this in.';
      }
      else if (q.type === 'link' && v && !normalizeLink(v)) errs[q.id] = 'That link doesn\'t look right — copy the whole link (it usually starts with https://).';
      else if (q.type === 'email' && v && !/^\S+@\S+\.\S+$/.test(v)) errs[q.id] = 'That email doesn\'t look right.';
      else if (q.type === 'number' && v && Number.isNaN(Number(v))) errs[q.id] = 'Please enter a number.';
      else if (q.type === 'date' && v) {
        const t = new Date(); const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        if (v < todayStr) errs[q.id] = 'Please choose today or a future date.';
      }
    }
    return errs;
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) { document.getElementById('f_' + first)?.closest('.q-field')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    setBusy(true);
    try {
      const shown = new Set(visible.map((q) => q.id));
      const filesOut = {};
      for (const [qid, list] of Object.entries(files).filter(([qid]) => shown.has(qid))) {
        filesOut[qid] = [];
        for (const it of list) {
          let up = it.uploaded;
          if (!up) {
            patchFile(qid, it.key, { state: 'uploading', progress: 0, error: null });
            try {
              up = await api.print.uploadFile(it.file, { orderKey, onProgress: (p) => patchFile(qid, it.key, { progress: p }) });
              patchFile(qid, it.key, { state: 'done', progress: 1, uploaded: up });
            } catch (err) {
              patchFile(qid, it.key, { state: 'error', error: err.message });
              throw new Error(`“${it.file.name}” didn't upload: ${err.message}`);
            }
          }
          filesOut[qid].push(up);
        }
      }
      const answersOut = Object.fromEntries(Object.entries(answers).filter(([qid]) => shown.has(qid)));
      const r = await api.print.submit(orderKey, answersOut, filesOut);
      const summary = form.questions.filter((q) => ['name', 'item', 'quantity', 'deadline'].includes(q.role))
        .map((q) => ({ label: q.label, text: answerText({ type: q.type, value: answers[q.id] }) }));
      setDone({ ...r, summary, name: form.questions.find((q) => q.role === 'name') && answers[form.questions.find((q) => q.role === 'name').id] });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { toastError(err); }
    setBusy(false);
  };

  const reset = () => { setAnswers({}); setFiles({}); setErrors({}); setDone(null); window.scrollTo(0, 0); };

  if (form === undefined) return html`<div class="loading"><div class="spinner"></div></div>`;
  if (!form || form.error) {
    return html`<div class="auth-page"><div class="auth-card card center"><${Brand} />
      <h1>This order link isn't active</h1>
      <p class="muted">${form?.error || 'The link may have been changed or turned off. Please contact us for the current one.'}</p></div></div>`;
  }

  return html`<div class="portal">
    <header class="portal-head"><${Brand} /></header>
    <main class="portal-main">
      ${done ? html`<section class="card portal-card order-done">
          <div class="done-icon"><${Icon} name="check" size=${30} /></div>
          <h1>Thank you${done.name ? ', ' + String(done.name).split(' ')[0] : ''}! Order received.</h1>
          <p>Your order number is</p>
          <div class="order-no">${done.order_no}</div>
          <p class="muted">Please keep this number. We'll message you when your order is ready.</p>
          ${done.summary.length > 0 && html`<dl class="facts done-summary">${done.summary.map((s) => html`<dt>${s.label}</dt><dd>${s.text}</dd>`)}</dl>`}
          <button class="btn btn-block" onClick=${reset}><${Icon} name="plus" size=${16} />Place another order</button>
        </section>`
      : html`<form class="card portal-card order-form" onSubmit=${submit} novalidate>
          <h1>Place a print order</h1>
          <p class="muted">Fill in the details below and we'll get started. Fields marked <span class="req">*</span> are required.</p>
          ${visible.map((q) => html`<${QuestionField} key=${q.id} q=${q} value=${answers[q.id]} error=${errors[q.id]} busy=${busy}
            onChange=${(v) => setAnswer(q.id, v)} files=${files[q.id]} onFiles=${(list, replace) => addFiles(q.id, list, replace)}
            onRemoveFile=${(key) => setFiles((f) => ({ ...f, [q.id]: f[q.id].filter((x) => x.key !== key) }))} />`)}
          ${Object.values(errors).some(Boolean) && html`<p class="error-text small">Please check the highlighted questions.</p>`}
          <button class="btn btn-primary btn-block btn-lg" disabled=${busy}>
            <${Icon} name=${busy ? 'upload' : 'check'} size=${18} />${busy ? 'Sending your order… please keep this page open' : 'Submit order'}
          </button>
        </form>`}
      <p class="muted small center">Questions about your order? Contact us and mention your order number.</p>
    </main>
  </div>`;
}

render(html`<${OrderPage} /><${ToastHost} />`, document.getElementById('app'));
