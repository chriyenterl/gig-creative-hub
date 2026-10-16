// Join page (join.html#<joinKey>): a new team member types their name and picks a 6-digit passcode,
// then waits for the owner to approve them. After that they sign in anywhere with name + passcode.
import { html, render, useState, useEffect } from './lib.js';
import { loadBackend } from './api.js';
import { CONFIG } from '../config.js';
import { Icon, ToastHost, PasscodeInput, toastError } from './ui.js';
import { Brand } from './views/login.js';

const api = await loadBackend({ portal: true });
const joinKey = decodeURIComponent(location.hash.replace(/^#/, '')).trim();

function Join() {
  const [ok, setOk] = useState(undefined); // undefined = checking the link
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => {
    document.title = `Join the team · ${CONFIG.BRAND_NAME}`;
    if (!joinKey || !api.join) return setOk(false);
    api.join.info(joinKey).then((r) => setOk(!!r?.ok)).catch(() => setOk(false));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return toastError(new Error('Type your name.'));
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toastError(new Error('Type your email — it\'s only used if you forget your passcode.'));
    if (!/^\d{6}$/.test(code)) return toastError(new Error('Choose a passcode of exactly 6 digits.'));
    if (code !== again) return toastError(new Error("The two passcodes don't match — type it again."));
    setBusy(true);
    try { setDone((await api.join.request(joinKey, name.trim(), code, email.trim())).name); } catch (err) { toastError(err); }
    setBusy(false);
  };

  let body;
  if (ok === undefined) body = html`<div class="loading"><div class="spinner"></div></div>`;
  else if (!ok) body = html`<div class="auth-card card"><${Brand} /><h1>Link not active</h1>
    <p class="muted">This join link isn't working any more. Please ask the owner for a new one.</p></div>`;
  else if (done) body = html`<div class="auth-card card"><${Brand} />
    <div class="join-done"><${Icon} name="check" size=${28} /></div>
    <h1>Thanks, ${done}!</h1>
    <p>The owner has been asked to approve you. Once they have, sign in with your <b>name</b> and your <b>6-digit passcode</b>.</p>
    <a class="btn btn-primary btn-block btn-lg" href="index.html">Go to sign-in</a>
    <p class="muted small">Tip: add the app to your phone's Home Screen so it's one tap away.</p></div>`;
  else body = html`<form class="auth-card card" onSubmit=${submit}><${Brand} />
    <div><h1>Join the team</h1>
      <p class="muted">Type your name and choose a 6-digit passcode. You'll use them to sign in once the owner approves you.</p></div>
    <label class="field"><span class="field-label">Your name</span>
      <input autocomplete="name" value=${name} maxlength="40" placeholder="e.g. Ali Rahman" onInput=${(e) => setName(e.target.value)} autofocus /></label>
    <label class="field"><span class="field-label">Your email</span>
      <input type="email" autocomplete="email" value=${email} placeholder="you@example.com" onInput=${(e) => setEmail(e.target.value)} />
      <span class="field-hint">Only used to send you a link if you forget your passcode.</span></label>
    <${PasscodeInput} label="Choose a 6-digit passcode" value=${code} onInput=${setCode} />
    <${PasscodeInput} label="Type it again" value=${again} onInput=${setAgain} />
    <button class="btn btn-primary btn-block btn-lg" disabled=${busy}>${busy ? 'One moment…' : 'Ask to join'}</button>
    <p class="muted small center">You'll sign in with your name and passcode. Forget it? Reset it yourself by email.</p>
  </form>`;
  return html`<div class="auth-page">${body}</div><${ToastHost} />`;
}

render(html`<${Join} />`, document.getElementById('app'));
